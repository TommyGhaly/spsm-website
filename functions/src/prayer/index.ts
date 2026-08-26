import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  COMMEMORATION_WHEN,
  PRAYER_KINDS,
  validatePrayerRequest,
  type CommemorationWhen,
  type PrayerKind,
  type PrayerRequestInput,
} from '@spsm/shared';
import { callerOf, hasRole, inGroup } from '../httpAuth.js';
import { PRAYER_KEY, open, seal, sealRoundTrips, sealingAvailable } from './seal.js';

/**
 * Prayer requests in and out, with the plaintext never touching the database.
 *
 * ---------------------------------------------------------------------------
 * Both directions are Functions now, and they have to be.
 *
 * Submission used to be an unauthenticated `addDoc` straight from the browser,
 * bounded by `firestore.rules`. That cannot survive encryption for the obvious
 * reason: sealing needs the key, and a key in a browser is not a key. So the
 * write moved here.
 *
 * Reading moved here too, and that is the less obvious half. Before this, a
 * clergy member could read a request in the Firestore console. After it they
 * cannot — the console shows envelopes — so encrypting without also building a
 * way to read would have made the feature strictly worse than plaintext:
 * confidential, and useless. Nothing in the app read this collection yet, which
 * is why the change costs nothing today and why it had to be built now.
 *
 * `firestore.rules` consequently closes the collection to clients in both
 * directions. The Admin SDK bypasses rules, so these two are unaffected.
 * ---------------------------------------------------------------------------
 */

/**
 * A speed bump on submission. Per-instance, so not a rate limit in any strict
 * sense — see the longer note in `forms/submit.ts`, which this mirrors rather
 * than reinvents.
 */
const RECENT = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 6;

function tooMany(ip: string): boolean {
  const now = Date.now();
  const hits = (RECENT.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  hits.push(now);
  RECENT.set(ip, hits);
  if (RECENT.size > 5_000) {
    for (const [k, times] of RECENT) {
      if (times.every((at) => now - at >= WINDOW_MS)) RECENT.delete(k);
    }
  }
  return hits.length > MAX_PER_WINDOW;
}

function text(value: unknown, cap: number): string {
  return typeof value === 'string' ? value.trim().slice(0, cap) : '';
}

/* ------------------------------------------------------------------------ */

export const prayerSubmit = onRequest(
  { cors: false, secrets: [PRAYER_KEY] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ errors: ['Method not allowed.'] });
      return;
    }

    const ip = String(req.headers['x-forwarded-for'] ?? req.ip ?? 'unknown').split(',')[0]!.trim();
    if (tooMany(ip)) {
      res.status(429).json({ errors: ['Too many requests from here. Please wait a minute.'] });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;

    const kindRaw = String(body['kind'] ?? 'prayer');
    const kind: PrayerKind = PRAYER_KINDS.includes(kindRaw as PrayerKind)
      ? (kindRaw as PrayerKind)
      : 'prayer';

    const whenRaw = body['commemoration'];
    const commemoration: CommemorationWhen | null =
      typeof whenRaw === 'string' && COMMEMORATION_WHEN.includes(whenRaw as CommemorationWhen)
        ? (whenRaw as CommemorationWhen)
        : null;

    const anonymous = body['anonymous'] === true;

    const input: PrayerRequestInput = {
      body: text(body['body'], 2000),
      anonymous,
      authorName: anonymous ? null : text(body['authorName'], 100) || null,
      contactEmail: text(body['contactEmail'], 254) || null,
      kind,
      commemoration,
    };

    /*
     * The same validator the form ran, against the same shared module. The
     * browser's run saves a round trip; this one decides.
     */
    const problems = validatePrayerRequest(input);
    if (problems.length > 0) {
      res.status(400).json({ errors: problems });
      return;
    }

    if (!sealingAvailable()) {
      console.error('[prayer] PRAYER_KEY is missing; refusing to store in the clear');
      res.status(503).json({
        errors: [
          'Prayer requests cannot be received at the moment. Please contact the parish office.',
        ],
      });
      return;
    }

    /*
     * Prove the key round-trips before trusting it with somebody's words.
     *
     * The failure this prevents is the worst one available here: sealing a
     * request under a key that cannot open it, nobody noticing until a priest
     * tries to read it weeks later, and no plaintext surviving anywhere. A
     * refusal now is recoverable; that is not.
     */
    if (!sealRoundTrips('round-trip')) {
      console.error('[prayer] PRAYER_KEY does not round-trip; refusing the write');
      res.status(503).json({
        errors: [
          'Prayer requests cannot be received at the moment. Please contact the parish office.',
        ],
      });
      return;
    }

    try {
      const written = await getFirestore()
        .collection(COLLECTIONS.prayerRequests)
        .add({
          // Sealed. Firestore never sees these three in the clear.
          body: seal(input.body),
          authorName: seal(input.authorName),
          contactEmail: seal(input.contactEmail),

          /*
           * Left readable, deliberately. These carry no confidence on their own
           * and the collection has to be sortable and filterable by somebody who
           * has not decrypted it yet — a clergy member opening "forty days"
           * should not require opening every record in the collection first.
           */
          kind: input.kind,
          commemoration: input.commemoration,
          anonymous: input.anonymous,
          status: 'active',

          // Anonymity is still absence, not a flag over a retained identity.
          authorUid: null,
          notifiedAt: null,

          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: null,
        });

      res.json({ id: written.id });
    } catch (error) {
      console.error('[prayer] could not store a request', error);
      res.status(500).json({ errors: ['That did not send. Please try again.'] });
    }
  },
);

/* ------------------------------------------------------------------------ */

/**
 * The clergy's read.
 *
 * `inGroup('clergy') || hasRole('admin')` — the same test `firestore.rules` used
 * to apply to this collection, carried over deliberately rather than relaxed to
 * `staff`. A facilities coordinator has no business reading these, and moving
 * the check from rules into a Function is not a licence to widen it.
 */
export const prayerList = onRequest(
  { cors: false, secrets: [PRAYER_KEY] },
  async (req, res) => {
    const caller = await callerOf(req);
    if (!(inGroup(caller, 'clergy') || hasRole(caller, 'admin'))) {
      res.status(403).json({ error: 'Clergy only.' });
      return;
    }

    if (!sealingAvailable()) {
      res.status(503).json({ error: 'PRAYER_KEY is not set, so nothing can be read.' });
      return;
    }

    const kind = String(req.query['kind'] ?? '');
    const when = String(req.query['commemoration'] ?? '');

    try {
      let query = getFirestore()
        .collection(COLLECTIONS.prayerRequests)
        .orderBy('createdAt', 'desc')
        .limit(200);

      if (PRAYER_KINDS.includes(kind as PrayerKind)) {
        query = query.where('kind', '==', kind) as typeof query;
      }
      if (COMMEMORATION_WHEN.includes(when as CommemorationWhen)) {
        query = query.where('commemoration', '==', when) as typeof query;
      }

      const snapshot = await query.get();

      res.json({
        requests: snapshot.docs.map((entry) => {
          const data = entry.data();
          const at = data['createdAt'] as { toDate?: () => Date } | undefined;
          return {
            id: entry.id,
            // Opened here and nowhere else. `open` returns null on a record it
            // cannot authenticate, which renders as "could not be read" rather
            // than taking the page down.
            body: open(data['body'] as string | null),
            authorName: open(data['authorName'] as string | null),
            contactEmail: open(data['contactEmail'] as string | null),
            kind: (data['kind'] as string) ?? 'prayer',
            commemoration: (data['commemoration'] as string | null) ?? null,
            anonymous: data['anonymous'] === true,
            status: (data['status'] as string) ?? 'active',
            createdAt:
              typeof at?.toDate === 'function' ? at.toDate().toISOString() : null,
          };
        }),
      });
    } catch (error) {
      console.error('[prayer] could not read the requests', error);
      res.status(500).json({ error: 'The requests could not be read.' });
    }
  },
);
