import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  dayKey,
  mergeStats,
  rollupBookstore,
  type BookstoreStats,
  type NormalizedBookstoreEvent,
  type Order,
  type RollupOrder,
} from '@spsm/shared';
import { callerOf, mayManageOrders } from './httpAuth.js';
import { BUDGETS, CAPS, exclusive, throttled } from './rateLimit.js';

/**
 * Turning the raw event stream into the numbers the admin reads.
 *
 * ---------------------------------------------------------------------------
 * All of the arithmetic happens here, and none of it happens on a page load.
 *
 * The bookstore writes one document per view, cart change, and search — never a
 * counter — because a shared counter document tops out near one write per
 * second and the most popular book is exactly the one that would start failing.
 * See schema/analytics.ts. The cost of that choice is that nothing is
 * pre-summed, and this Function is where the bill comes due: it reads a day of
 * events once, adds them up in memory, and writes a single document.
 *
 * So the expensive read happens 24 times a day on a schedule, not once per
 * visitor, and the admin dashboard is one `get` no matter how busy the shop
 * was. Nothing an admin does can be slow, because nothing an admin does
 * aggregates anything.
 * ---------------------------------------------------------------------------
 */

const PARISH_TIME_ZONE = 'America/New_York';

/** How many days back each run re-computes. */
const REWRITE_DAYS = 2;

function statsRef(period: BookstoreStats['period'], key: string) {
  return getFirestore().collection(COLLECTIONS.bookstoreStats).doc(`${period}-${key}`);
}

/**
 * Recompute one day from scratch.
 *
 * Idempotent by construction: it reads that day's events and orders and
 * overwrites the document, rather than adding to what is there. A rerun after a
 * crashed invocation therefore produces the same answer instead of double
 * counting — which is the only way a scheduled job that can be retried is safe
 * to write totals at all.
 *
 * Yesterday is recomputed as well as today because a payment can land after
 * midnight and because Square's webhooks arrive minutes late; a day is not
 * final at the moment it ends.
 */
export async function rollupDay(day: string): Promise<void> {
  const db = getFirestore();

  const eventsSnapshot = await db
    .collection(COLLECTIONS.bookstoreEvents)
    .where('day', '==', day)
    .get();

  const events: NormalizedBookstoreEvent[] = eventsSnapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      kind: data['kind'],
      slug: data['slug'] ?? null,
      term: data['term'] ?? null,
      quantity: Number(data['quantity']) || 1,
      visitor: String(data['visitor'] ?? ''),
      day: String(data['day'] ?? day),
    };
  });

  /*
   * Orders are fetched by a timestamp window rather than by a `day` field.
   *
   * They have no `day` field: they are written by the checkout Function, which
   * knows nothing about this rollup, and adding one would mean the checkout
   * path had to agree with this file about the parish's time zone forever. The
   * window is computed here instead, from the same `dayKey` everything else
   * uses, so there is one definition of what a day is.
   */
  const { start, end } = dayWindow(day);
  const ordersSnapshot = await db
    .collection(COLLECTIONS.orders)
    .where('createdAt', '>=', Timestamp.fromDate(start))
    .where('createdAt', '<', Timestamp.fromDate(end))
    .get();

  const orders: RollupOrder[] = ordersSnapshot.docs.map((doc) => {
    const order = doc.data() as Order;
    return {
      contactEmail: order.contactEmail ?? '',
      status: order.status,
      shipping: Boolean(order.shipping),
      total: order.total ?? { amount: 0 },
      lineItems: order.lineItems ?? [],
      day,
    };
  });

  const priorBuyerEmails = await buyersBefore(start);

  const rolled = rollupBookstore({ period: 'day', key: day, events, orders, priorBuyerEmails });
  await statsRef('day', day).set(
    { ...rolled, computedAt: FieldValue.serverTimestamp() },
    // Overwrite rather than merge: a merge would keep a product that has since
    // been deleted from the catalog alive in the map forever, because a merge
    // has no way to express "this key is gone".
    { merge: false },
  );

  await rollupMonth(day.slice(0, 7));
}

/**
 * A month, summed from its days rather than from raw events.
 *
 * It has to be. Raw events expire on a TTL after 90 days, so recomputing March
 * from events in July is not merely slow — the events are gone. The daily
 * documents are the durable record, and every wider period is derived from
 * them.
 */
export async function rollupMonth(month: string): Promise<void> {
  const db = getFirestore();
  const snapshot = await db
    .collection(COLLECTIONS.bookstoreStats)
    .where('period', '==', 'day')
    .where('key', '>=', `${month}-01`)
    .where('key', '<=', `${month}-31`)
    .get();

  const parts = snapshot.docs.map((doc) => doc.data() as BookstoreStats);
  const merged = mergeStats('month', month, parts);
  await statsRef('month', month).set(
    { ...merged, computedAt: FieldValue.serverTimestamp() },
    { merge: false },
  );
}

/**
 * Every email that had bought something before `before`.
 *
 * This is what makes "repeat buyer" mean anything. A day's own orders cannot
 * tell you whether the person who bought a book this morning had bought one in
 * March — so the set is read once, from paid orders only, and handed to the
 * pure rollup to count against.
 *
 * A whole-collection read, and knowingly so: the alternative is a running set
 * kept in a document, which is a shared mutable counter by another name and
 * would reintroduce exactly the contention this design exists to avoid. At
 * parish volume the read is cheap and it runs hourly, not per request. When it
 * stops being cheap, the fix is a `firstOrderAt` field on a `buyers` document
 * keyed by email hash — not a counter.
 */
async function buyersBefore(before: Date): Promise<Set<string>> {
  const snapshot = await getFirestore()
    .collection(COLLECTIONS.orders)
    .where('createdAt', '<', Timestamp.fromDate(before))
    .select('contactEmail', 'status')
    .get();

  const emails = new Set<string>();
  for (const doc of snapshot.docs) {
    const status = doc.get('status');
    if (status !== 'paid' && status !== 'refunded') continue;
    const email = String(doc.get('contactEmail') ?? '').trim().toLowerCase();
    if (email) emails.add(email);
  }
  return emails;
}

/** The instants a parish day starts and ends, as UTC. */
function dayWindow(day: string): { start: Date; end: Date } {
  /*
   * Found by search rather than by arithmetic on an offset.
   *
   * Adding "five hours" is wrong twice a year: on the March Sunday the parish
   * day is 23 hours long and on the November one it is 25, and a fixed offset
   * puts an hour of sales in the wrong bucket on both. Walking outward from a
   * UTC guess and asking `dayKey` — the same function the browser used when it
   * stamped the event — is correct on every day including those two.
   */
  const noonUtc = new Date(`${day}T12:00:00.000Z`);
  let start = new Date(noonUtc);
  while (dayKey(new Date(start.getTime() - 3600_000), PARISH_TIME_ZONE) === day) {
    start = new Date(start.getTime() - 3600_000);
  }
  start = new Date(start.getTime());
  // Back off to the exact minute the day begins.
  while (dayKey(new Date(start.getTime() - 60_000), PARISH_TIME_ZONE) === day) {
    start = new Date(start.getTime() - 60_000);
  }

  let end = new Date(noonUtc);
  while (dayKey(new Date(end.getTime() + 3600_000), PARISH_TIME_ZONE) === day) {
    end = new Date(end.getTime() + 3600_000);
  }
  while (dayKey(new Date(end.getTime() + 60_000), PARISH_TIME_ZONE) === day) {
    end = new Date(end.getTime() + 60_000);
  }
  end = new Date(end.getTime() + 60_000);

  return { start, end };
}

/** Today and the days just behind it, in the parish's zone. */
function recentDays(now: Date, count: number): string[] {
  const days: string[] = [];
  for (let back = 0; back < count; back += 1) {
    days.push(dayKey(new Date(now.getTime() - back * 86_400_000), PARISH_TIME_ZONE));
  }
  return [...new Set(days)];
}

/**
 * Hourly, not nightly.
 *
 * A dashboard that is a day stale is a dashboard nobody opens — the bookstore
 * volunteer wants to know what sold after this morning's Liturgy, this
 * afternoon. Hourly costs 24 runs over a collection that holds at most a day of
 * a parish's events, which is nothing, and it means the worst staleness anyone
 * ever sees is an hour with a `computedAt` on the page saying so.
 */
export const rollupBookstoreStats = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: PARISH_TIME_ZONE,
    timeoutSeconds: 300,
    maxInstances: CAPS.scheduled,
  },
  async () => {
    for (const day of recentDays(new Date(), REWRITE_DAYS)) {
      await rollupDay(day);
    }
  },
);

/**
 * The same rollup, on demand, for a staff member who does not want to wait an
 * hour to see whether the morning's sales landed.
 *
 * Guarded by the same claim as the refund endpoint. It is not a read — it
 * writes the stats documents — and an unauthenticated caller could otherwise
 * make the parish pay for a full-collection scan as often as they liked.
 */
export const refreshBookstoreStats = onRequest(
  { cors: false, maxInstances: CAPS.rebuild },
  async (req, res) => {
    // The cheap gate, before a token is verified.
    if (throttled(req, res, { bucket: 'stats:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    // A rewrite of several days of events, each a scan of that day's documents.
    // Six a minute for a button; the hold below stops two overlapping and writing
    // the same day's rollup twice.
    if (
      throttled(req, res, {
        bucket: 'statsRebuild',
        max: BUDGETS.rebuild,
        identity: caller!.uid,
        message: 'The statistics were just rebuilt. Please wait a minute before asking again.',
      })
    ) {
      return;
    }

    const release = exclusive('bookstoreRollup');
    if (!release) {
      // Already running here. 409 rather than 429: the caller is not over a
      // budget, the work is simply in progress — and a page that says so can wait
      // for it instead of asking again.
      res.status(409).json({ error: 'The statistics are being rebuilt right now.' });
      return;
    }

    try {
      const days = recentDays(new Date(), REWRITE_DAYS);
      for (const day of days) await rollupDay(day);
      res.status(200).json({ ok: true, days });
    } catch (error) {
      console.error('[stats] refresh failed', error);
      res.status(500).json({ error: 'Could not refresh the statistics.' });
    } finally {
      release();
    }
  },
);
