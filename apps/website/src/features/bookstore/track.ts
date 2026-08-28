/**
 * Recording what happens in the shop, without slowing it down or weighing it.
 *
 * ---------------------------------------------------------------------------
 * Three constraints, and each one rules out the obvious approach.
 *
 * 1. **No counters.** The natural shape for "most viewed" is a `views` field on
 *    the product that every visitor increments. Firestore sustains about one
 *    write per second to a single document, so the most popular book — the
 *    number anyone actually wants — is the first one to start timing out. Every
 *    event here is its own document with its own id, which contends with
 *    nothing. The arithmetic happens hourly in a scheduled Function instead.
 *
 * 2. **No Firestore SDK on the tracking path.** These writes go over the REST
 *    API with a bare `fetch`, which costs a few hundred bytes of code.
 *
 *    An earlier version of this note said /bookstore shipped no Firestore SDK at
 *    all and that the REST path was what kept it that way. That was wrong —
 *    measured against the export build on 2026-08-23, every page already carries
 *    about 604KB of it, and had before any of this. The REST path is still the
 *    right call (it needs no auth, no App Check handshake, and batches a whole
 *    browsing session into one request) but it is not what is keeping the SDK
 *    off this page, because nothing is.
 *
 * 3. **Never in the way.** Nothing here is awaited by anything the person is
 *    doing, every failure is swallowed, and the queue flushes on a timer rather
 *    than per interaction. A statistic that costs a buyer a dropped click is
 *    not worth collecting.
 *
 * ## The App Check caveat, for whoever turns enforcement on
 *
 * These writes carry no App Check token — the token comes from the SDK, and not
 * loading the SDK is the entire point of the REST path. Firestore enforcement
 * is currently off (see the note in lib/firebase.ts), so they succeed. If it is
 * ever switched on, these writes start failing silently — the errors are
 * swallowed by design — and the only symptom will be statistics that stop
 * moving. At that point this has to either load the SDK on /bookstore or post
 * to a Cloud Function instead. Nothing else in the pipeline changes.
 * ---------------------------------------------------------------------------
 */
import {
  EVENT_TTL_DAYS,
  VISITOR_LENGTH,
  normalizeBookstoreEvent,
  type BookstoreEventInput,
  type BookstoreEventKind,
  type NormalizedBookstoreEvent,
} from '@spsm/shared';

const VISITOR_KEY = 'spsm.bookstore.visitor';
const PARISH_TIME_ZONE = 'America/New_York';

/** Flush after this long with nothing new, so a browsing session batches up. */
const IDLE_FLUSH_MS = 3000;
/** Or immediately at this many, so a long session cannot lose everything. */
const MAX_BATCH = 20;
/** A hard ceiling on the queue, in case a flush keeps failing. */
const MAX_QUEUE = 100;

let queue: NormalizedBookstoreEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;

/**
 * A random id this browser keeps for itself.
 *
 * It exists for one reason: to tell "forty people looked at this book" from
 * "one person refreshed forty times". It is generated locally, is not derived
 * from anything about the person, is never sent anywhere but this collection,
 * and identifies nobody — the collection it lands in is readable by no client
 * at all.
 *
 * Regenerated silently if storage is unavailable, which means a private-browsing
 * visitor counts as a new person on each visit. That is the correct failure:
 * the alternative is fingerprinting them so the number is prettier.
 */
function visitorId(): string {
  try {
    const stored = localStorage.getItem(VISITOR_KEY);
    if (stored && new RegExp(`^[0-9a-f]{${VISITOR_LENGTH}}$`).test(stored)) return stored;
  } catch {
    /* Private browsing or a full quota. Fall through and make a fresh one. */
  }

  const bytes = new Uint8Array(VISITOR_LENGTH / 2);
  crypto.getRandomValues(bytes);
  const id = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

  try {
    localStorage.setItem(VISITOR_KEY, id);
  } catch {
    /* Not storable. The id still works for this page. */
  }
  return id;
}

/** Today in the parish's zone. A Saturday evening sale is a Saturday sale. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARISH_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Whether to record anything at all.
 *
 * Do Not Track is honoured even though these events identify nobody and could
 * defensibly ignore it. A parish asking to be trusted with someone's name,
 * address and card should not be the site that argues its way around a privacy
 * signal because the data happened to be anonymous. It costs some completeness
 * in the numbers and nothing else.
 */
function trackingAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const dnt =
      navigator.doNotTrack ??
      (window as unknown as { doNotTrack?: string }).doNotTrack ??
      (navigator as unknown as { msDoNotTrack?: string }).msDoNotTrack;
    if (dnt === '1' || dnt === 'yes') return false;
  } catch {
    /* No such property. Nothing to honour. */
  }
  return true;
}

/** Firestore's own auto-id alphabet and length. */
function autoId(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

interface RestTarget {
  url: string;
  parent: string;
}

/**
 * Where to POST, or null when the site is not configured for it.
 *
 * The names are spelled out rather than looked up, because Next inlines
 * `NEXT_PUBLIC_*` by literal textual match — the same rule as `publicEnv()` in
 * lib/firebase.ts.
 */
function restTarget(): RestTarget | null {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!project) return null;

  const parent = `projects/${project}/databases/(default)/documents`;

  if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
    // The emulator serves the same REST surface and ignores the API key.
    return { url: `http://127.0.0.1:8080/v1/${parent}:commit`, parent };
  }
  if (!apiKey) return null;
  return { url: `https://firestore.googleapis.com/v1/${parent}:commit?key=${apiKey}`, parent };
}

/**
 * One event as a Firestore REST write.
 *
 * `currentDocument: { exists: false }` makes this a create rather than an
 * overwrite, which is what `firestore.rules` allows — the collection has no
 * update rule at all, so a write that could land on an existing document would
 * be refused. The id is random, so it never does.
 *
 * `at` is set by an `updateTransform` rather than sent as a value, and the rule
 * requires exactly that: `doc.at == request.time`. A timestamp the browser
 * supplies is a timestamp the browser can choose, and a chosen one could
 * backdate an event into a period that has already been rolled up and read.
 */
function toWrite(event: NormalizedBookstoreEvent, parent: string): unknown {
  const expiresAt = new Date(Date.now() + EVENT_TTL_DAYS * 86_400_000).toISOString();

  return {
    update: {
      name: `${parent}/bookstoreEvents/${autoId()}`,
      fields: {
        kind: { stringValue: event.kind },
        slug: event.slug === null ? { nullValue: null } : { stringValue: event.slug },
        term: event.term === null ? { nullValue: null } : { stringValue: event.term },
        quantity: { integerValue: String(event.quantity) },
        visitor: { stringValue: event.visitor },
        day: { stringValue: event.day },
        expiresAt: { timestampValue: expiresAt },
      },
    },
    currentDocument: { exists: false },
    updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
  };
}

/**
 * Send what is queued.
 *
 * Drains the queue *before* the request rather than after, so a slow network
 * cannot cause the same events to be sent twice by a second flush overlapping
 * the first. Events are dropped on failure rather than retried: a retry queue
 * that survives a failing endpoint is a memory leak in a tab someone left open,
 * and the thing being lost is a page view.
 */
function flush(keepalive = false): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const target = restTarget();
  if (!target) return;

  try {
    void fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: batch.map((event) => toWrite(event, target.parent)) }),
      // So a flush started as the page closes is still delivered. Without it
      // the browser cancels in-flight requests on navigation, and the most
      // interesting events — the ones just before someone leaves — are exactly
      // the ones that never arrive.
      keepalive,
    }).catch(() => {
      /* Swallowed on purpose; see the header. */
    });
  } catch {
    /* Same. */
  }
}

function attachListeners(): void {
  if (listenersAttached || typeof document === 'undefined') return;
  listenersAttached = true;

  /*
   * `visibilitychange`, not `beforeunload`.
   *
   * Mobile browsers frequently never fire `beforeunload` — a tab discarded in
   * the background or an app switched away from just stops — so it loses
   * precisely the sessions that end the way most phone sessions end.
   * `visibilitychange` to `hidden` fires in all of those.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('pagehide', () => flush(true));
}

/**
 * Record something. Fire and forget — this never throws and never blocks.
 *
 * Malformed input is dropped silently rather than reported, because every call
 * site is a side effect of something the person was actually doing and none of
 * them can act on the failure.
 */
export function track(input: Omit<BookstoreEventInput, 'visitor' | 'day'>): void {
  if (!trackingAllowed()) return;

  const event = normalizeBookstoreEvent({
    ...input,
    visitor: visitorId(),
    day: today(),
  } as BookstoreEventInput);
  if (!event) return;

  attachListeners();

  // The cap is a backstop for a session whose flushes are all failing. Dropping
  // the oldest keeps the most recent behaviour, which is the more useful half.
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);

  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(), IDLE_FLUSH_MS);
}

/** Convenience wrappers, so call sites read as what happened. */
export const trackProduct = (kind: BookstoreEventKind, slug: string, quantity = 1): void =>
  track({ kind, slug, quantity });

export const trackSearch = (term: string, zeroResults: boolean): void =>
  track({ kind: zeroResults ? 'searchZero' : 'search', term });

/**
 * Grid impressions, counted once per product per page view.
 *
 * A product scrolled past three times is one view, not three. Without this the
 * "most viewed" list is really a list of which books sit where someone's thumb
 * rests while scrolling, which is a fact about the layout rather than about the
 * books.
 */
const seenThisPage = new Set<string>();

export function trackViewOnce(slug: string): void {
  if (seenThisPage.has(slug)) return;
  seenThisPage.add(slug);
  trackProduct('view', slug);
}
