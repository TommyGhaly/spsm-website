import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type Order } from '@spsm/shared';
import { callerOf, mayManageOrders } from './httpAuth.js';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  squareClient,
} from './square.js';

/**
 * Refunding an order in full.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, given the policy.
 *
 * The parish publishes a no-returns policy: all sales final, contact the office
 * about a damaged or incorrect book. That is a deliberate choice — a real
 * returns system is an RMA subsystem (request, approval, inbound tracking,
 * condition, restock, partial refund) and this is a volunteer-run bookstore
 * selling a dozen titles.
 *
 * But a policy of "no returns" is not a policy of "no refunds". A book will
 * arrive damaged, an order will be taken for something that turns out to be out
 * of print, and a buyer will occasionally dispute a charge whatever the notice
 * on the page says. Every one of those ends in money going back. This endpoint
 * is the parish making that exception deliberately, with a name and a reason
 * attached to it — not a routine part of buying.
 *
 * Note that provider.ts still describes refunds as Dashboard-only. That was
 * true and is no longer: a volunteer who can pack an order should not also need
 * Square Dashboard admin, which is the credential that can move the parish's
 * money anywhere. This is the narrower door — full refund, this order, that
 * amount, logged.
 * ---------------------------------------------------------------------------
 *
 * Full-order only, on purpose. One button, one amount, no arithmetic for a
 * volunteer to get wrong at the moment they are already dealing with an unhappy
 * buyer. Partial refunds stay in the Square Dashboard, where the person doing
 * them has chosen to be.
 */
export const squareRefund = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      // 403 for a valid token without the claim, 401 for no usable token at
      // all — the two need different fixes and a volunteer should be told which.
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Refunds are limited to the bookstore group and parish staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    const body = (req.body ?? {}) as { orderId?: unknown; reason?: unknown };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    // Required, and required for a reason: an untraceable refund on a parish's
    // books is the thing an audit asks about first.
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
    if (!orderId || reason.length < 3) {
      res.status(400).json({ error: 'An order and a reason are both needed.' });
      return;
    }

    const square = squareClient();
    if (!square) {
      res.status(503).json({ error: 'Square is not configured.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.orders).doc(orderId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      res.status(404).json({ error: 'No such order.' });
      return;
    }

    const order = snapshot.data() as Order;
    if (!order.squarePaymentId) {
      res.status(409).json({ error: 'This order has no payment to refund.' });
      return;
    }
    if (order.status === 'refunded' || order.refund) {
      // Not an error worth a 4xx panic — two volunteers looking at the same
      // queue is normal. Say what already happened and stop.
      res.status(200).json({ ok: true, alreadyRefunded: true });
      return;
    }
    if (order.status !== 'paid') {
      res.status(409).json({
        error: `Only a paid order can be refunded; this one is ${order.status}.`,
      });
      return;
    }

    try {
      const response = await fetch(`${square.host}/v2/refunds`, {
        method: 'POST',
        headers: square.headers,
        /*
         * Keyed on the order, not on the moment.
         *
         * A random key per request would let a double-click issue two refunds
         * for one order, which is real money leaving twice. Because the key is
         * derived from the order id, Square returns the *original* refund for
         * the second press instead of creating another — the same property the
         * checkout relies on, for the same reason.
         */
        body: JSON.stringify({
          idempotency_key: `refund-${orderId}`.slice(0, 45),
          payment_id: order.squarePaymentId,
          amount_money: { amount: order.total.amount, currency: order.total.currency },
          reason: reason.slice(0, 192),
        }),
      });

      const json = (await response.json()) as {
        refund?: { id?: string; status?: string };
        errors?: { detail?: string }[];
      };

      if (!response.ok || !json.refund?.id) {
        console.error('[refund] Square refused', JSON.stringify(json.errors));
        res.status(502).json({ error: json.errors?.[0]?.detail ?? 'Square refused the refund.' });
        return;
      }

      /*
       * `status` is deliberately NOT written here.
       *
       * Square's refund is PENDING at this point on most funding sources, and
       * marking the order `refunded` now would tell staff the money is back
       * when it is not — the same distinction `interpretSquareWebhook` already
       * makes when it ignores a PENDING refund. The `refund.updated` webhook
       * flips the status when the refund actually completes. What is recorded
       * here is only the parish's half: who authorised it and why.
       */
      await ref.update({
        refund: {
          squareRefundId: json.refund.id,
          amount: order.total,
          reason,
          refundedBy: caller?.uid ?? '',
          refundedByEmail: caller?.email ?? '',
          refundedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller?.uid ?? null,
      });

      res.status(200).json({ ok: true, refundId: json.refund.id, status: json.refund.status });
    } catch (error) {
      console.error('[refund] unexpected failure', error);
      res.status(500).json({ error: 'The refund could not be sent.' });
    }
  },
);
