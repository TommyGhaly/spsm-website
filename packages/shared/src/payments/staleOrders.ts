/**
 * What to do about an order still `pending` long after checkout.
 *
 * Checkout writes every order *before* it charges the card, so `pending` is
 * normally a few seconds long. It lasts when something between the charge and
 * the next write went wrong — the Function timed out, Square did not answer,
 * the webhook never arrived — and then the order is either paid and invisible
 * to the staff lists (which show paid orders only) or unpaid and still holding
 * clothing sizes off the shelf. `settleStaleOrders` asks Square which, and this
 * is the rule it applies to the answer. Pure, so the rule is tested without
 * Square.
 */

/** Left alone for this long, so the sweep never races a checkout in progress. */
export const STALE_AFTER_MINUTES = 20;
/**
 * With no payment on the order at all, how long before it is given up on.
 * Longer than any checkout screen stays open: a buyer can still pay against the
 * same Square order with the same idempotency key until they leave it.
 */
export const ABANDONED_AFTER_MINUTES = 120;

export type StaleVerdict = 'paid' | 'failed' | 'wait';

/**
 * @param ageMinutes  how long ago the order was written.
 * @param paymentStatus  Square's status for the payment on the order, or null
 *   when the order has no payment.
 */
export function settleStaleOrder(ageMinutes: number, paymentStatus: string | null): StaleVerdict {
  if (!(ageMinutes >= STALE_AFTER_MINUTES)) return 'wait';
  if (paymentStatus === 'COMPLETED') return 'paid';
  if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELED') return 'failed';
  // APPROVED or PENDING: money may yet move. Square's own webhook settles it.
  if (paymentStatus !== null) return 'wait';
  return ageMinutes >= ABANDONED_AFTER_MINUTES ? 'failed' : 'wait';
}
