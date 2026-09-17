/**
 * A speed bump for every endpoint that costs the parish something to answer.
 *
 * ---------------------------------------------------------------------------
 * Worth being accurate about what this is not.
 *
 * It is a per-instance map, so it is not a rate limit in any strict sense:
 * Cloud Run scales to many instances, each with its own copy, and a determined
 * flood spreads across all of them. It stops the accidental case — a double tap,
 * a stuck retry loop, a script someone points at the endpoint for an afternoon —
 * and it costs one map lookup.
 *
 * The real defence against a sustained flood is App Check, which the site
 * already initialises for the browser SDK. If one of these endpoints ever needs
 * more than a speed bump, enforcing an App Check token there is the next step,
 * not a bigger map.
 *
 * Its own module because the limits are only legible if they sit together. Two
 * endpoints copying twenty lines out of a third is how three limits that were
 * meant to be the same drift into being different, and a budget that lives at
 * its call site is a budget nobody can compare with its neighbour.
 *
 * ## Two tiers, and the order matters
 *
 * On an authenticated endpoint the address gate runs FIRST — before
 * `callerOf`, which verifies an ID token and reads a member document. A flood
 * of junk tokens would otherwise buy an attacker one token verification and one
 * billed read per request, which is precisely the cost the gate exists to
 * refuse. The identity gate runs after, on the uid, and it is the tighter of
 * the two: the parish's staff share a building and therefore an address, so an
 * address-keyed budget that is tight enough to matter for one person is a
 * budget that locks out the room.
 * ---------------------------------------------------------------------------
 */

const WINDOW_MS = 60_000;

/**
 * Buckets are per caller **and per endpoint**.
 *
 * Keyed on both, so a family filling in a form does not spend the allowance of
 * the servant signing up from the same church wifi. They are genuinely
 * different actions and sharing one counter would make a busy Sunday look like
 * an attack.
 */
const RECENT = new Map<string, number[]>();

/**
 * Every budget on the site, in one table, per caller per minute.
 *
 * Read the public half as "what does the busiest honest minute look like from a
 * single address", not as "what does one person do". The parish wifi puts the
 * whole congregation behind one address, so a limit set for one visitor is a
 * limit that fails during a liturgy — which is the one hour of the week these
 * endpoints exist for. The polled reads are therefore generous on purpose;
 * their protection against a real flood is the CDN, which serves the cached
 * answer without ever reaching a Function.
 *
 * The private half can afford to be strict, because it is keyed on a uid rather
 * than an address and no honest person exceeds these by accident.
 */
export const BUDGETS = {
  // ── Public, unauthenticated ───────────────────────────────────────────────
  /** The homepage bulletin. Polled every 60s per open tab; CDN-cached 60s. */
  bulletin: 120,
  /** The livestream probe. Polled every 60s per open tab; CDN-cached 30s. */
  live: 120,
  /** The church schedule. One read per /calendar visit, plus month paging. */
  calendar: 60,
  /** A buyer finding their own orders. The credential is guessable in shape. */
  orderLookup: 10,
  /** Checkout. Every call creates a Square order and costs a Square API call. */
  squareCheckout: 12,
  /**
   * Square's own deliveries. High because Square redelivers in bursts after any
   * outage and being throttled would make it redeliver harder; the point here
   * is only to bound what an unsigned flood can spend on HMAC verification.
   */
  squareWebhook: 600,
  /** A native form submission. Unchanged. */
  formSubmit: 10,
  /**
   * A servant's own camp sign-up. Tighter than the forms endpoint's ten: a
   * servant signs up once, somebody correcting a rejected form might post three
   * or four times in a minute, and nobody posts a fifth legitimately.
   */
  campServantRequest: 5,
  /**
   * Asking for a signed URL to upload one gallery photograph.
   *
   * Sixty, because this is called once per *file* and a batch is sixty files —
   * somebody emptying a camp's worth of pictures must not be stopped halfway
   * through their own upload. That makes it the loosest public budget here, and
   * the map is not what bounds it: this endpoint verifies an App Check token
   * before it does any work, which is the thing the header of this file
   * recommends when a speed bump is not enough, and it counts every issued URL
   * against a Firestore quota that survives across instances. This entry only
   * stops a single instance being asked faster than a person could ask.
   */
  galleryUpload: 60,
  /**
   * The same thing for a photograph attached to a form, and a twentieth of the
   * allowance. Nothing about a form is a batch: the field takes one picture at
   * a time and a person filling one in sends two or three, so a minute's worth
   * of legitimate use is nowhere near this. The gallery's sixty exists only
   * because emptying a camp's camera roll must not trip halfway through.
   */
  formUpload: 12,

  // ── The address gate on authenticated endpoints ───────────────────────────
  /**
   * Deliberately loose. This is the cheap gate that runs before a token is
   * verified, and its whole job is to bound the cost of junk; the real limit on
   * these endpoints is the uid one below.
   */
  adminAddress: 120,

  // ── The identity gate, keyed on uid ───────────────────────────────────────
  /**
   * Editing the shop. Loose enough for a batch of photographs — a product with
   * eight pictures is eight calls, and somebody adding two such products in a
   * sitting must not be stopped halfway.
   */
  bookstoreEdit: 90,
  /**
   * Registering a phone for notifications.
   *
   * Called on every app start — the token is re-asserted so a dead device can
   * be swept — and again whenever somebody flips a switch on the settings
   * screen. Thirty covers a person toggling every row twice and still bounds a
   * loop in a bad release, which is the realistic threat: this endpoint is
   * called by client code on a timer rather than by a person clicking.
   */
  pushRegister: 30,
  /** Refunding. Money leaves the parish; nobody issues ten in a minute. */
  refund: 10,
  /**
   * Re-running a mirror or a rollup by hand. Each one is a full scan, so the
   * button is a button, not a poll. Paired with `exclusive()` below.
   */
  rebuild: 6,
  /** The finance rollup reads two collections in full and may take minutes. */
  financeRebuild: 4,
  /**
   * Deleting your own account. Two, because the honest number is one — the
   * second is for the person who clicked, saw a network error, and tried again.
   * A third attempt in the same minute is not a servant leaving the parish.
   */
  accountDelete: 2,
} as const;

/**
 * How many instances of each Function may exist at once.
 *
 * ---------------------------------------------------------------------------
 * The other half of the map above, and the half that actually bounds a bill.
 *
 * The header of this file is honest that the counter is per instance and that a
 * flood spreads across all of them. This is what stops there being an unlimited
 * number of them to spread across: a second-generation Function scales to a
 * thousand instances by default, so an uncapped endpoint is an uncapped
 * invoice, and the parish finds out about it a month later.
 *
 * Over the cap, Cloud Run queues and then sheds — which is the throttle working
 * rather than the site breaking, and is why the numbers below are not tight.
 * Each is "more than the busiest honest minute has ever needed", not "what one
 * person needs".
 *
 * **These count calls, never bytes.** Nothing here caps how large a photograph
 * may be, and nothing here should ever be made to; a photograph off a phone is
 * routinely twelve megabytes and the events pages take them as they come.
 *
 * Set per Function rather than through `setGlobalOptions`, and that is not a
 * preference. ES module imports run before the body of the module that imports
 * them, so a `setGlobalOptions` call in index.ts would execute *after* every
 * Function in every imported module had already been defined — and would
 * silently apply to none of them.
 * ---------------------------------------------------------------------------
 */
export const CAPS = {
  /** The polled public reads. The CDN answers most of these without us. */
  bulletin: 20,
  live: 20,
  calendar: 10,
  /** Anyone may post to these, so they are the ones worth bounding. */
  orderLookup: 10,
  formSubmit: 20,
  campServantRequest: 10,
  /**
   * Handing out signed upload URLs. Cheap per call — it verifies two tokens,
   * touches a counter and signs a string, and never sees a byte of the
   * photograph, which goes straight to the bucket. Ten is a queue for a very
   * busy afternoon rather than a refusal.
   */
  galleryUpload: 10,
  /** The form path's equivalent, and quieter — nobody sends a batch to a form. */
  formUpload: 5,
  /** Must not shed during a rush; a refused checkout is a lost sale. */
  squareCheckout: 20,
  squareWebhook: 10,
  /** Signed-in editing. A handful of volunteers, never a crowd. */
  bookstoreEdit: 10,
  refund: 5,
  /** Registering a phone. One tiny write; called once per app start. */
  pushRegister: 10,
  /** Deleting your own account. Rarer than a refund by a wide margin. */
  accountDelete: 2,
  /** Full scans. More than a few at once is a mistake by definition. */
  rebuild: 3,
  scheduled: 2,
  /**
   * The transcode. 1GiB and up to five minutes each, one per photograph — so
   * this is the cap with the largest bill behind it, and the one a batch of
   * forty photographs meets first. Meeting it costs a queue, not a failure:
   * Firestore triggers retry, so the fortieth photograph is transcoded a little
   * later rather than not at all.
   */
  transcode: 10,
  /** One write per member document, and there are a few hundred members. */
  claims: 10,
} as const;

/** The caller, as well as this can be known behind Hosting. */
export function callerIp(headers: Record<string, unknown>, fallback: string | undefined): string {
  return String(headers['x-forwarded-for'] ?? fallback ?? 'unknown').split(',')[0]!.trim();
}

/** What a gate decided, and how long to wait if it refused. */
export interface Verdict {
  allowed: boolean;
  /** Whole seconds until the oldest hit in the window falls out of it. */
  retryAfterSeconds: number;
}

/**
 * Whether this caller has had too many goes at this endpoint in the last
 * minute, and when they may try again.
 *
 * Records the attempt as it checks, so a caller who is already over the line
 * stays over it while they keep trying rather than being let back in by the
 * window sliding past their earlier attempts.
 */
export function check(bucket: string, identity: string, maxPerWindow: number): Verdict {
  const key = `${bucket}:${identity}`;
  const now = Date.now();
  const hits = (RECENT.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  hits.push(now);
  RECENT.set(key, hits);

  // Unbounded growth across a long-lived instance is the one way this could
  // itself become the problem. Cheap sweep, only when the map is large.
  if (RECENT.size > 5_000) {
    for (const [existing, times] of RECENT) {
      if (times.every((at) => now - at >= WINDOW_MS)) RECENT.delete(existing);
    }
  }

  if (hits.length <= maxPerWindow) return { allowed: true, retryAfterSeconds: 0 };

  // The oldest hit still in the window is what has to expire before there is
  // room again. Rounded up, and never zero — a `Retry-After: 0` invites the
  // immediate retry this is trying to prevent.
  const oldest = hits[0]!;
  const wait = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
  return { allowed: false, retryAfterSeconds: Math.max(1, wait) };
}

/**
 * As much of an HTTP response as this module needs.
 *
 * Structural rather than `express.Response`, so nothing here depends on the
 * shape of the framework the Functions runtime happens to hand us.
 */
export interface Responder {
  set(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

export interface ThrottleOptions {
  /** The counter's name. Per endpoint, and never shared with another. */
  bucket: string;
  /** How many in a window. Take it from `BUDGETS`. */
  max: number;
  /**
   * Who is asking. A uid on an authenticated gate; omitted for the address
   * gate, which reads the forwarded address off the request itself.
   */
  identity?: string | null;
  /** What to tell them. There is a serviceable default. */
  message?: string;
  /**
   * `{ errors: [message] }` rather than `{ error: message }`.
   *
   * The forms and camp endpoints answer in the plural everywhere else and their
   * clients read `errors`; a 429 in the other shape is a 429 the page cannot
   * display.
   */
  plural?: boolean;
}

/**
 * Refuse this request if the caller is over their budget, and say so properly.
 *
 * Returns true when it has answered and the handler must stop. The call reads
 * as a guard clause:
 *
 *     if (throttled(req, res, { bucket: 'live', max: BUDGETS.live })) return;
 *
 * Sends `Retry-After`, which is the part a bare 429 leaves out: a client that
 * is told to wait can wait, and one that is not told retries immediately and
 * makes the situation worse. `RateLimit-*` go alongside it — the draft standard
 * headers, free to send and read by anything that understands them.
 */
export function throttled(
  req: { headers: Record<string, unknown>; ip?: string | undefined },
  res: Responder,
  options: ThrottleOptions,
): boolean {
  const identity = options.identity ?? callerIp(req.headers, req.ip);
  const verdict = check(options.bucket, identity, options.max);
  if (verdict.allowed) return false;

  const message =
    options.message ?? 'Too many requests from here. Please wait a minute and try again.';

  res.set('Retry-After', String(verdict.retryAfterSeconds));
  res.set('RateLimit-Limit', String(options.max));
  res.set('RateLimit-Remaining', '0');
  res.set('RateLimit-Reset', String(verdict.retryAfterSeconds));
  // A 429 must never be cached — the CDN would then serve the refusal to
  // everybody behind that address for as long as it held it.
  res.set('Cache-Control', 'no-store');

  res.status(429).json(options.plural ? { errors: [message] } : { error: message });
  return true;
}

/* -------------------------------------------------------------------------- */
/* One at a time                                                               */
/* -------------------------------------------------------------------------- */

/** Jobs currently running on this instance. */
const RUNNING = new Set<string>();

/**
 * Hold a named job open, or refuse because it is already running here.
 *
 * A budget bounds how often something may be *started*; this bounds how many
 * may be *in flight*. They are different problems and the rollups have both:
 * `refreshFinanceStats` scans two collections in full and is allowed nine
 * minutes to do it, so six starts a minute apart is six concurrent full scans,
 * and the budget alone would let that happen.
 *
 * Per instance, with the same honesty as the map above: two instances can each
 * run one. That still turns "a volunteer leaning on the button" — which is the
 * case that actually occurs, because a slow job looks like a broken one — into
 * a single scan and a sentence asking them to wait.
 *
 * Returns a release function, or null when the job is already running. Release
 * from a `finally`; a leaked hold is an endpoint that has switched itself off
 * until the instance is recycled.
 */
export function exclusive(job: string): (() => void) | null {
  if (RUNNING.has(job)) return null;
  RUNNING.add(job);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    RUNNING.delete(job);
  };
}

/** Test seam. Nothing in production calls this. */
export function resetLimits(): void {
  RECENT.clear();
  RUNNING.clear();
}
