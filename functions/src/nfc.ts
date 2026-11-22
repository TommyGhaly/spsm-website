import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue, Timestamp, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  NFC_EVENT_TTL_DAYS,
  PARISH_TIME_ZONE,
  dayKey,
  nestFieldPaths,
  nfcPeriodIds,
  nfcRevenuePaths,
  nfcStatsPaths,
  parseNfcAttribution,
  parseNfcEvent,
  type NfcAction,
  type NfcAttribution,
  type NfcRevenueSource,
} from '@spsm/shared';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';

/**
 * NFC tag statistics: the endpoint every tap reports to, and the two triggers
 * that credit money to the tag a purchase started from.
 *
 * ---------------------------------------------------------------------------
 * The model — the three ways a tap opens, what a visit is, and why money is a
 * separate collection — is in packages/shared/src/analytics/nfc.ts. This file
 * is the writing half and nothing else.
 *
 * ## Every write is one batch that begins with a `create`
 *
 * The `create` is of `nfcEvents/<visit>-<action>` (or, for money, a marker
 * named for the order or the submission), and it fails if that document
 * already exists. Because the counters ride in the same batch, a repeat
 * changes nothing: the second "added to basket" in a visit is dropped, and a
 * Firestore trigger redelivered after a timeout — which v2 triggers are
 * allowed to do — cannot credit an order twice. One mechanism for both, and no
 * read before the write.
 *
 * ## No client can reach any of this except the endpoint
 *
 * `firestore.rules` refuses every client read and write on `nfcEvents`,
 * `nfcStats` writes and `nfcRevenue` writes. The Admin SDK here bypasses those
 * rules, which is the point: the counts are only ever moved by this file.
 * ---------------------------------------------------------------------------
 */

const TTL_MS = NFC_EVENT_TTL_DAYS * 86_400_000;

/** `ALREADY_EXISTS`, which is how a dropped repeat announces itself. */
function alreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists';
}

/** Increment every path in both of the day's documents — the day and its month. */
function bump(
  batch: WriteBatch,
  collection: string,
  day: string,
  increments: Record<string, number>,
): void {
  const ids = nfcPeriodIds(day);
  const patch = nestFieldPaths(
    Object.fromEntries(Object.entries(increments).map(([path, by]) => [path, FieldValue.increment(by)])),
  );
  const col = getFirestore().collection(collection);
  const updatedAt = FieldValue.serverTimestamp();
  batch.set(col.doc(ids.day), { period: 'day', key: day, ...patch, updatedAt }, { merge: true });
  batch.set(col.doc(ids.month), { period: 'month', key: day.slice(0, 7), ...patch, updatedAt }, { merge: true });
}

/**
 * Count one step of one visit, once. Resolves false for a repeat.
 *
 * Exported for the two triggers below, which record `formSubmit` and `paid`
 * this way — the only two steps a device is not trusted to report.
 */
export async function recordNfcAction(attribution: NfcAttribution, action: NfcAction): Promise<boolean> {
  const db = getFirestore();
  const day = dayKey(new Date(), PARISH_TIME_ZONE);
  const batch = db.batch();
  batch.create(db.collection(COLLECTIONS.nfcEvents).doc(`${attribution.visit}-${action}`), {
    ...attribution,
    action,
    day,
    at: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
  });
  bump(
    batch,
    COLLECTIONS.nfcStats,
    day,
    Object.fromEntries(nfcStatsPaths(attribution, action).map((path) => [path, 1])),
  );
  try {
    await batch.commit();
    return true;
  } catch (error) {
    if (alreadyExists(error)) return false;
    throw error;
  }
}

/**
 * Credit a payment to the tag its visit started on, once per `marker`.
 *
 * The marker is the order or the submission, never the visit: one visit can
 * buy twice, and both purchases are money the tag brought in. The `paid` step
 * of the funnel is recorded afterwards and *is* per visit, like every step.
 */
async function creditNfcRevenue(
  marker: string,
  attribution: NfcAttribution,
  source: NfcRevenueSource,
  cents: number,
): Promise<void> {
  if (!Number.isInteger(cents) || cents <= 0) return;
  const db = getFirestore();
  const day = dayKey(new Date(), PARISH_TIME_ZONE);
  const batch = db.batch();
  batch.create(db.collection(COLLECTIONS.nfcEvents).doc(marker), {
    ...attribution,
    action: 'revenue',
    source,
    cents,
    day,
    at: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
  });
  bump(batch, COLLECTIONS.nfcRevenue, day, nfcRevenuePaths(attribution, source, cents));
  try {
    await batch.commit();
  } catch (error) {
    if (alreadyExists(error)) return;
    throw error;
  }
  await recordNfcAction(attribution, 'paid');
}

/**
 * The body as an object, whichever way it arrived.
 *
 * `navigator.sendBeacon` — which a fallback page uses when somebody taps
 * through before a `fetch` could finish — can only send `text/plain`, and the
 * framework leaves that body unparsed.
 */
function bodyOf(req: { body?: unknown; rawBody?: Buffer }): unknown {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = typeof req.body === 'string' ? req.body : req.rawBody?.toString('utf8') ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * `POST /api/nfc/event` — one tap, or one step after it.
 *
 * Unauthenticated, necessarily: the people tapping a tag on a church wall are
 * not signed in to anything. So, like `bookstoreEvents`, the shape is the gate
 * — `parseNfcEvent` accepts eight slugs, three paths, three platforms, seven
 * actions and a sixteen-character hex visit, and nothing else reaches a write.
 * The worst somebody posting junk achieves is a wrong number on a dashboard.
 *
 * 204 for a counted event and for a dropped repeat alike: the caller is
 * fire-and-forget and has no use for the difference.
 */
export const nfcEvent = onRequest(
  {
    maxInstances: CAPS.nfcEvent,
    // Same origin from the fallback pages; the app and the clip are native and
    // send no Origin at all. Nothing on another site has a reason to post here.
    cors: false,
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }
    if (throttled(req, res, { bucket: 'nfcEvent', max: BUDGETS.nfcEvent })) return;

    const event = parseNfcEvent(bodyOf(req));
    if (!event) {
      res.status(400).json({ error: 'Not an NFC event.' });
      return;
    }

    const { action, ...attribution } = event;
    try {
      await recordNfcAction(attribution, action);
      res.status(204).end();
    } catch (error) {
      console.error('[nfc] could not record an event', error);
      res.status(500).json({ error: 'Not recorded.' });
    }
  },
);

/** The triggers sit with their database, like the ones in notify/triggers.ts. */
const TRIGGER = { region: 'us-east1', memory: '256MiB' as const, maxInstances: 5 };

/**
 * A bookstore order from a tap, turning `paid`.
 *
 * The transition, not the state — `before.status !== 'paid'` — for the reason
 * `onOrderPaid` gives, and the marker makes a redelivery harmless anyway. The
 * amount is `total`, which is what Square charged; a later refund is not taken
 * back out here, so this is money taken rather than money kept. The finance
 * screen is where refunds are netted.
 */
export const onNfcOrderPaid = onDocumentWritten(
  { ...TRIGGER, document: `${COLLECTIONS.orders}/{orderId}` },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after || after['status'] !== 'paid' || before?.['status'] === 'paid') return;
    const attribution = parseNfcAttribution(after['nfc']);
    if (!attribution) return;
    const total = after['total'] as { amount?: unknown } | undefined;
    const cents = typeof total?.amount === 'number' ? Math.round(total.amount) : 0;
    try {
      await creditNfcRevenue(`order-${event.params.orderId}`, attribution, 'bookstore', cents);
    } catch (error) {
      // Thrown, so the platform retries: the marker makes a retry safe.
      console.error(`[nfc] could not credit order ${event.params.orderId}`, error);
      throw error;
    }
  },
);

/**
 * A form sent from a tap — and paid for, when it charged.
 *
 * `formSubmit` only ever writes a submission after the card has been taken, so
 * a submission with `totalCents` is a payment that happened.
 */
export const onNfcFormSubmitted = onDocumentCreated(
  { ...TRIGGER, document: `${COLLECTIONS.formSubmissions}/{submissionId}` },
  async (event) => {
    const submission = event.data?.data();
    const attribution = parseNfcAttribution(submission?.['nfc']);
    if (!submission || !attribution) return;
    try {
      await recordNfcAction(attribution, 'formSubmit');
      const cents = typeof submission['totalCents'] === 'number' ? submission['totalCents'] : 0;
      await creditNfcRevenue(`form-${event.params.submissionId}`, attribution, 'forms', cents);
    } catch (error) {
      console.error(`[nfc] could not credit submission ${event.params.submissionId}`, error);
      throw error;
    }
  },
);
