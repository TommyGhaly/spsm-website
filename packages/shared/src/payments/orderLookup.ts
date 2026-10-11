/**
 * Letting a buyer find their own orders without an account.
 *
 * ---------------------------------------------------------------------------
 * The credential is the pair, and it has to stay the pair.
 *
 * Nobody who buys from this bookstore has a login. Sign-in is Microsoft-only
 * and restricted to the parish's Entra tenant, so a parishioner literally
 * cannot authenticate — see apps/website/src/lib/auth.ts. That leaves proof of
 * purchase as the only thing a buyer can present, and it is made of two parts:
 *
 *   - a Square order id, which is a long opaque string nobody can guess, and
 *   - the email address that order was placed with.
 *
 * Either one alone is not enough and must never be accepted alone. The order id
 * alone would let anyone who saw a receipt over someone's shoulder read the
 * address it shipped to. The email alone would let anyone who knows a
 * parishioner's address enumerate their purchases, which is a far worse
 * disclosure than it first sounds in a small parish.
 *
 * Together they unlock the full history for that address, which is the point:
 * having one valid pair already proves the person is the buyer, and making them
 * dig out a second receipt to see a second order protects nothing.
 * ---------------------------------------------------------------------------
 */
import type { DocOf } from '../schema/common.js';
import type { Order, OrderLineItem } from '../schema/commerce.js';
import { looksLikeEmail } from './squareCheckout.js';

/** Square order ids are 20-30 characters of base62. Bounded, not parsed. */
export const MAX_ORDER_ID = 64;

/**
 * How many past orders one lookup returns.
 *
 * A cap rather than pagination: a parish bookstore buyer with more than fifty
 * orders does not exist, and a "load more" button on a page reached by typing a
 * receipt number is more machinery than the case deserves.
 */
export const MAX_LOOKUP_RESULTS = 50;

export interface OrderLookupRequest {
  orderId: string;
  email: string;
}

/** Cleaned input, or null when there is nothing worth querying for. */
export function parseLookupRequest(body: {
  orderId?: unknown;
  email?: unknown;
}): OrderLookupRequest | null {
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim().slice(0, MAX_ORDER_ID) : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!orderId || !looksLikeEmail(email)) return null;
  return { orderId, email };
}

/** The one normalization both the query and the comparison must agree on. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Does this order belong to the person who typed this email?
 *
 * Compared case-insensitively, because the buyer typed the address twice —
 * once at checkout and once here — and expecting the capitalisation to match
 * between the two is expecting them to fail.
 */
export function orderMatchesEmail(order: Pick<Order, 'contactEmail'>, email: string): boolean {
  return normalizeEmail(order.contactEmail ?? '') === normalizeEmail(email);
}

/**
 * What a buyer is allowed to see about their own order.
 *
 * An allowlist, and the direction matters: the Function projects onto this
 * shape instead of deleting fields it considers sensitive. A field added to
 * `Order` later is invisible here by default, whereas a denylist would leak it
 * the day it was added and nobody would notice. `appliedEventIds`,
 * `idempotencyKey`, `updatedBy`, `memberUid`, and the whole `refund` block —
 * which names the staff member who authorised it — stay on the server.
 */
export interface PublicOrderView {
  orderId: string;
  /**
   * Who the order is for. Empty on orders taken before this was asked.
   *
   * Safe to return: the buyer proved the receipt, and this is the name they
   * themselves typed onto their own order. It is here because it is the string
   * a volunteer will read back to them at the bookstore table.
   */
  buyerName: string;
  status: Order['status'];
  fulfillment: Order['fulfillment'];
  shipping: boolean;
  total: Order['total'];
  lineItems: { name: string; quantity: number; amount: number | null }[];
  /** ISO-8601, or null on an order written before timestamps were reliable. */
  placedAt: string | null;
  /** True when this order was refunded. The reason and the author are not shown. */
  refunded: boolean;
  refundedAmount: number | null;
}

export function toPublicOrderView(
  order: DocOf<Order>,
  placedAt: Date | null,
): PublicOrderView {
  return {
    orderId: order.id,
    buyerName: [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' '),
    status: order.status,
    fulfillment: order.fulfillment,
    shipping: Boolean(order.shipping),
    total: order.total,
    lineItems: (order.lineItems ?? []).map((line: OrderLineItem) => ({
      name: line.size ? `${line.name} — size ${line.size}` : line.name,
      quantity: line.quantity,
      amount:
        typeof line.unitPrice?.amount === 'number' ? line.unitPrice.amount * line.quantity : null,
    })),
    placedAt: placedAt ? placedAt.toISOString() : null,
    refunded: order.status === 'refunded',
    refundedAmount: order.refund?.amount.amount ?? null,
  };
}

/**
 * The sentence a buyer reads about where their order has got to.
 *
 * Written as plain statements of fact. A parish is not a courier and should not
 * write like one — no "your order is on its way!", no tracking-page cheer for a
 * book someone will pick up after Liturgy.
 */
export function describeOrderState(view: PublicOrderView): string {
  if (view.status === 'refunded') return 'Refunded.';
  if (view.status === 'failed') return 'The payment did not go through.';
  if (view.status === 'canceled') return 'Cancelled.';
  if (view.status === 'pending') return 'Payment is still being confirmed.';

  if (view.shipping) {
    if (view.fulfillment === 'collected') return 'Paid. Posted.';
    if (view.fulfillment === 'ready') return 'Paid. Packed, waiting to go out.';
    return 'Paid. Being packed.';
  }

  if (view.fulfillment === 'collected') return 'Paid. Collected.';
  if (view.fulfillment === 'ready') return 'Paid. Waiting for you in the bookstore.';
  return 'Paid. Being put aside for you.';
}

/** Shared shape of both this endpoint's replies, so the client narrows on `ok`. */
export type OrderLookupResponse =
  | { ok: true; orders: PublicOrderView[] }
  | { ok: false; error: string };
