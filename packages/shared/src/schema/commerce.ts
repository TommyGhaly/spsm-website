import type { AuditFields, Publishable, Timestamped } from './common.js';

/**
 * Bookstore.
 *
 * Money is always integer minor units (cents) plus an explicit currency. Never
 * a float, never a formatted string — Square's API works this way too, so the
 * boundary stays lossless.
 */
export interface Money {
  amount: number;
  currency: 'USD';
}

/**
 * Product catalog.
 *
 * Open Decision #5b (unresolved): is Square the source of truth for the catalog
 * (mirrored here by a sync Function) or is Firestore authoritative with Square
 * used for payment only?
 *
 * This shape works either way, which is the point of settling it later:
 *   - `squareCatalogObjectId` present + `syncedAt` set ⇒ mirrored from Square,
 *     and this doc must be treated as read-only by staff tooling.
 *   - both null ⇒ Firestore-authoritative, edit freely.
 */
export interface Product extends AuditFields, Publishable {
  slug: string;
  name: string;
  description: string;
  price: Money;
  imagePaths: string[];

  /** Set when this row mirrors a Square catalog object. */
  squareCatalogObjectId: string | null;
  squareVariationId: string | null;
  /** Last successful mirror from Square. Null ⇒ Firestore-authoritative. */
  syncedAt: Timestamped | null;

  /**
   * Null means "not tracked" — deliberately distinct from 0, which means sold
   * out. When mirroring from Square, Square's count wins.
   */
  stockCount: number | null;
  category: string | null;
}

/**
 * Orders, keyed to the Square order id.
 *
 * Written only by Cloud Functions — never by the client. The client's job ends
 * at "start a checkout"; everything after that is reconciled from Square's
 * webhook, so a closed laptop mid-payment can't lose an order.
 */
export interface Order extends AuditFields {
  /** Square's order id. Also used as the Firestore doc id. */
  squareOrderId: string;
  squarePaymentId: string | null;

  /** Purchaser. Null for a guest checkout. */
  memberUid: string | null;
  contactEmail: string;

  lineItems: OrderLineItem[];
  subtotal: Money;
  tax: Money;
  total: Money;

  status: OrderStatus;
  fulfillment: FulfillmentStatus;

  /**
   * Idempotency key we sent to Square. Kept so a retry after a network failure
   * cannot create a second order for the same cart.
   */
  idempotencyKey: string;

  /** Raw webhook event ids we've already applied, newest last. */
  appliedEventIds: string[];
}

export interface OrderLineItem {
  productId: string;
  /** Denormalized so a later price change doesn't rewrite history. */
  name: string;
  unitPrice: Money;
  quantity: number;
}

/** Mirrors the subset of Square payment states we care about. */
export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'canceled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_STATUSES = ['unfulfilled', 'ready', 'collected'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount / 100);
}

export function sumMoney(items: OrderLineItem[]): Money {
  return {
    amount: items.reduce((total, item) => total + item.unitPrice.amount * item.quantity, 0),
    currency: 'USD',
  };
}
