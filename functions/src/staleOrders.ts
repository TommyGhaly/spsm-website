import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, getFirestore, type Timestamp } from 'firebase-admin/firestore';
import { COLLECTIONS, settleStaleOrder, shouldReturnSizes } from '@spsm/shared';
import { CAPS, exclusive } from './rateLimit.js';
import { SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN, squareClient } from './square.js';
import { readSizeReturn } from './sizeStock.js';

/**
 * The backstop behind "a paid order is never lost".
 *
 * ---------------------------------------------------------------------------
 * Checkout records every order as `pending` before it charges the card, and
 * normally marks it paid a second later; Square's webhook does the same again.
 * An order still pending twenty minutes on means both missed — and the staff
 * lists show only paid orders, so a paid one would sit there unseen, and an
 * unpaid one would keep its clothing sizes off the shelf indefinitely.
 *
 * So every half hour this asks Square about each one and settles it: paid,
 * failed (sizes back on the shelf), or left for later. The rule is
 * `settleStaleOrder` in the shared package; this is only the plumbing.
 *
 * One equality filter on `status`, so the automatic single-field index serves
 * it; age is checked here rather than in the query, which would need a
 * composite index for a collection that holds a handful of pending rows.
 * ---------------------------------------------------------------------------
 */
export const settleStaleOrders = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'America/New_York',
    timeoutSeconds: 120,
    maxInstances: CAPS.scheduled,
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
  },
  async () => {
    const release = exclusive('settleStaleOrders');
    if (!release) return;
    try {
      await sweep();
    } finally {
      release();
    }
  },
);

async function sweep(): Promise<void> {
  const square = squareClient();
  if (!square) return;
  const db = getFirestore();
  const pending = await db.collection(COLLECTIONS.orders).where('status', '==', 'pending').limit(100).get();

  for (const doc of pending.docs) {
    const created = doc.get('createdAt') as Timestamp | undefined;
    const ageMinutes = created ? (Date.now() - created.toMillis()) / 60_000 : Number.NaN;
    if (settleStaleOrder(ageMinutes, 'COMPLETED') === 'wait') continue; // too fresh to ask about

    try {
      /*
       * The payment, from the order's own id when checkout got as far as
       * writing it, otherwise from Square's order: a payment against it shows
       * as a tender. No tender means no money was taken.
       */
      let paymentId = (doc.get('squarePaymentId') as string | null) ?? null;
      if (!paymentId) {
        const orderRes = await fetch(`${square.host}/v2/orders/${encodeURIComponent(doc.id)}`, {
          headers: square.headers,
        });
        if (!orderRes.ok) {
          console.warn(`[stale] Square could not find order ${doc.id} (${orderRes.status}); left pending.`);
          continue;
        }
        const orderJson = (await orderRes.json()) as { order?: { tenders?: { payment_id?: string }[] } };
        paymentId = orderJson.order?.tenders?.find((tender) => tender.payment_id)?.payment_id ?? null;
      }

      let paymentStatus: string | null = null;
      if (paymentId) {
        const payRes = await fetch(`${square.host}/v2/payments/${encodeURIComponent(paymentId)}`, {
          headers: square.headers,
        });
        if (!payRes.ok) {
          console.warn(`[stale] Square could not read payment ${paymentId} for ${doc.id}; left pending.`);
          continue;
        }
        paymentStatus = ((await payRes.json()) as { payment?: { status?: string } }).payment?.status ?? null;
      }

      const verdict = settleStaleOrder(ageMinutes, paymentStatus);
      if (verdict === 'wait') continue;

      // One transaction, so a webhook marking it paid meanwhile cannot have
      // its sizes put back underneath it.
      await db.runTransaction(async (tx) => {
        const now = await tx.get(doc.ref);
        if (now.get('status') !== 'pending') return; // the webhook got there first
        const order = now.data() ?? {};
        const putBack = shouldReturnSizes(verdict, order) ? await readSizeReturn(tx, db, doc.ref, order) : null;
        putBack?.();
        tx.update(doc.ref, {
          status: verdict,
          ...(paymentId ? { squarePaymentId: paymentId } : {}),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: null,
        });
      });
      console.info(`[stale] settled ${doc.id} as ${verdict} (payment ${paymentId ?? 'none'}).`);
    } catch (cause) {
      console.error(`[stale] could not settle ${doc.id}; will try again next run.`, cause);
    }
  }
}
