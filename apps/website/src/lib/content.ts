/**
 * Build-time reads. Everything here runs during `next build`, in Node, as an
 * unauthenticated client — never in the browser.
 *
 * ---------------------------------------------------------------------------
 * Every query here filters on `published == true`, and that is not optional.
 *
 * Firestore evaluates a `list` against the query's potential result set rather
 * than the documents it actually returns, so the query has to prove up front
 * that nothing disallowed could come back. Drop the filter and the read fails
 * with permission-denied even against an empty collection.
 *
 * `publishAt` is not a read-time filter — see the long note in firestore.rules
 * and docs/decisions.md #10. It is an instruction to a scheduled Function that
 * flips `published`. `warnIfEmbargoed` below catches the state where the two
 * disagree.
 * ---------------------------------------------------------------------------
 */
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  toDate,
  type Announcement,
  type ContentPage,
  type ContentSection,
  type DocOf,
  type Event,
} from '@spsm/shared';
import { db, isConfigured } from './firebase';

/**
 * A read that fails should not take the build down.
 *
 * A parish site whose events section is empty for one deploy is a bad
 * afternoon. A parish site that will not build is a worse one, and the failure
 * modes here — Firestore unreachable, collection not created yet, rules
 * tightened — are all recoverable by fixing data rather than code.
 *
 * The exception is a rules rejection, which is re-thrown: that means the public
 * cannot read something we believe is public, and shipping a silently empty
 * page would hide it.
 */
async function safely<T>(what: string, read: () => Promise<T>, fallback: T): Promise<T> {
  if (!isConfigured()) {
    console.warn(`[content] skipping ${what}: Firebase is not configured (see .env.local)`);
    return fallback;
  }
  try {
    return await read();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('permission-denied') || message.includes('Missing or insufficient')) {
      throw new Error(
        `[content] ${what} was denied by firestore.rules. This is not a data ` +
          `problem — the public genuinely cannot read it, so the built site ` +
          `would 403 too.\n` +
          `  Usual cause: the query is missing where('published','==',true), or ` +
          `the rule for this collection tests a field the query does not ` +
          `constrain. Firestore judges a list by what the query could return, ` +
          `not by what it did.\n  ${message}`,
      );
    }
    console.warn(`[content] ${what} failed, rendering without it: ${message}`);
    return fallback;
  }
}

function docOf<T>(snapshot: QueryDocumentSnapshot): DocOf<T> {
  return { id: snapshot.id, ...(snapshot.data() as T) };
}

/**
 * Drop documents that are marked live but scheduled for later, and say so.
 *
 * Reaching this means `published: true` and `publishAt` in the future on the
 * same document — the scheduler and the switch disagree. Warn rather than
 * throw: the rules already let anyone read that document, so failing the build
 * would not un-expose anything, it would only take the rest of the site down
 * with it. The fix is in the data.
 */
function warnIfEmbargoed<T extends { publishAt: unknown }>(what: string, docs: DocOf<T>[]): DocOf<T>[] {
  const now = Date.now();
  const live = docs.filter((doc) => {
    const at = toDate(doc.publishAt as never);
    return at === null || at.getTime() <= now;
  });

  if (live.length !== docs.length) {
    const held = docs.filter((d) => !live.includes(d)).map((d) => d.id);
    console.warn(
      `[content] ${what}: ${held.length} document(s) have published:true but a ` +
        `future publishAt, so they are already publicly readable via the API ` +
        `while being held back from the site. Withheld here, but fix the data — ` +
        `set published:false and let the scheduler flip it. ids: ${held.join(', ')}`,
    );
  }
  return live;
}

// ---------------------------------------------------------------------------
// Content pages — About, Our Beliefs, clergy bios, Contact copy.

export async function getContentPages(section?: ContentSection): Promise<DocOf<ContentPage>[]> {
  return safely(
    `content pages${section ? ` (${section})` : ''}`,
    async () => {
      const constraints = [where('published', '==', true), orderBy('order', 'asc')];
      if (section) constraints.unshift(where('section', '==', section));

      const snapshot = await getDocs(query(collection(db(), COLLECTIONS.content), ...constraints));
      return warnIfEmbargoed('content', snapshot.docs.map(docOf<ContentPage>));
    },
    [],
  );
}

export async function getContentPage(slug: string): Promise<DocOf<ContentPage> | null> {
  return safely(
    `content page "${slug}"`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.content),
          where('published', '==', true),
          where('slug', '==', slug),
          limit(1),
        ),
      );
      const [first] = warnIfEmbargoed('content', snapshot.docs.map(docOf<ContentPage>));
      return first ?? null;
    },
    null,
  );
}

// ---------------------------------------------------------------------------
// Announcements — homepage strip.

export async function getAnnouncements(max = 6): Promise<DocOf<Announcement>[]> {
  return safely(
    'announcements',
    async () => {
      // Ordering matches the "pinned first, then newest" composite index that
      // already exists in firestore.indexes.json — sorting in the query rather
      // than afterwards means the `limit` below actually limits the right
      // documents, instead of trimming an arbitrary page and then reordering it.
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.announcements),
          where('published', '==', true),
          orderBy('pinned', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(max * 2), // over-fetch: expiry is filtered below, not in the query
        ),
      );

      const live = warnIfEmbargoed('announcements', snapshot.docs.map(docOf<Announcement>));
      const now = Date.now();

      return live
        .filter((a) => {
          const expires = toDate(a.expiresAt);
          return expires === null || expires.getTime() > now;
        })
        .slice(0, max);
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// Events — parish calendar. `servantEvents` is a separate, staff-gated
// collection and is deliberately not reachable from the static site.

export async function getUpcomingEvents(max = 12): Promise<DocOf<Event>[]> {
  return safely(
    'upcoming events',
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.events),
          where('published', '==', true),
          orderBy('startAt', 'asc'),
          limit(max * 3),
        ),
      );

      const live = warnIfEmbargoed('events', snapshot.docs.map(docOf<Event>));

      // Past events are filtered here rather than with where('startAt','>=',now)
      // for a reason worth keeping: a build-time range filter bakes the build
      // machine's clock into static HTML. An event would vanish from the page
      // hours before it actually starts, or linger after, depending on when the
      // deploy ran. Filtering after the fetch keeps the query stable and the
      // cutoff explicit.
      const cutoff = Date.now();
      return live
        .filter((event) => {
          const end = toDate(event.endAt) ?? toDate(event.startAt);
          return end === null || end.getTime() >= cutoff;
        })
        .slice(0, max);
    },
    [],
  );
}

export async function getAllEvents(): Promise<DocOf<Event>[]> {
  return safely(
    'all events',
    async () => {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.events), where('published', '==', true)),
      );
      return warnIfEmbargoed('events', snapshot.docs.map(docOf<Event>));
    },
    [],
  );
}

export async function getEvent(slug: string): Promise<DocOf<Event> | null> {
  const all = await getAllEvents();
  return all.find((event) => event.slug === slug) ?? null;
}

// The weekly bulletin is not in our Firestore. It is read straight from the
// announcements project at build time — see src/lib/bulletin.ts.
