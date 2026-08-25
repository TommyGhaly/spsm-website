import type { Timestamped } from './common.js';
import type { Money } from './commerce.js';

/**
 * What the bookstore records about itself.
 *
 * ---------------------------------------------------------------------------
 * One document per event, and never a counter.
 *
 * The obvious shape for "most viewed" is a `views` field on the product that
 * every visitor increments. It does not work here. Firestore sustains roughly
 * one write per second to a single document, and every write past that queues
 * behind the ones before it — so the busiest product, the one whose number you
 * actually want, is the one whose page starts timing out. A transaction makes
 * it worse rather than better: contention is the cost, and a transaction adds a
 * read and a retry loop to each contended write.
 *
 * So nothing is shared and nothing is contended. Each event is its own document
 * with its own id, which Firestore spreads across key ranges by construction,
 * and the arithmetic happens later in `rollupBookstore` — off the request path,
 * where being slow costs nobody a page load.
 *
 * The trade is storage and staleness: raw events accumulate (bounded by a TTL
 * policy on `expiresAt`) and the admin's numbers are as fresh as the last
 * rollup rather than live. For a parish bookstore both are the right way round.
 * ---------------------------------------------------------------------------
 */

/**
 * The things worth recording. Deliberately short.
 *
 * Every kind here answers a question an admin would actually ask — which books
 * people look at, which ones they pick up and put back, what they search for
 * and don't find. A kind that answers nothing is a row in a collection nobody
 * reads and a field in `firestore.rules` that has to be validated forever.
 */
export const BOOKSTORE_EVENT_KINDS = [
  /** The product's card was scrolled into view in the grid. */
  'view',
  /** Its detail dialog was opened — a much stronger signal than `view`. */
  'detail',
  'cartAdd',
  'cartRemove',
  /** The basket moved to the payment stage. Pairs with `orders` for drop-off. */
  'checkoutStart',
  'search',
  /** A search that matched nothing: the closest thing to a request list. */
  'searchZero',
] as const;

export type BookstoreEventKind = (typeof BOOKSTORE_EVENT_KINDS)[number];

/**
 * A single recorded interaction.
 *
 * Written by anyone, read by nobody — see `firestore.rules`. The client can
 * create these and cannot list, update, or delete them, which is what makes an
 * unauthenticated write path acceptable: the worst an abuser achieves is noise
 * in a statistic, not disclosure of anything.
 *
 * There is deliberately no IP address, no user agent, and no uid. `visitor` is
 * a random opaque string the browser generates for itself and keeps in
 * `localStorage`; it exists so "400 views" can be distinguished from "one
 * person refreshing 400 times", and it identifies nobody.
 */
export interface BookstoreEvent {
  kind: BookstoreEventKind;
  /** Product slug. Null for the two search kinds, which are not about a product. */
  slug: string | null;
  /** Search text, already lowercased and trimmed. Null for every other kind. */
  term: string | null;
  /** Units added or removed. 1 for kinds where it means nothing. */
  quantity: number;
  /** Opaque per-browser id. Not a uid, not derived from anything personal. */
  visitor: string;
  /** `YYYY-MM-DD` in the parish's zone — the rollup's bucket key. */
  day: string;
  at: Timestamped;
  /**
   * When Firestore's TTL policy should delete this row.
   *
   * The raw events are working material, not a record the parish keeps. The
   * rollups are the record, and they are small enough to keep forever.
   */
  expiresAt: Timestamped;
}

/** Everything the admin dashboard shows about one product, for one period. */
export interface ProductStats {
  views: number;
  details: number;
  cartAdds: number;
  cartRemoves: number;
  /** Orders that contained this product, from `orders` rather than from events. */
  orders: number;
  unitsSold: number;
  revenue: number;
}

export function emptyProductStats(): ProductStats {
  return { views: 0, details: 0, cartAdds: 0, cartRemoves: 0, orders: 0, unitsSold: 0, revenue: 0 };
}

/**
 * One rolled-up period, read by the admin in a single `get`.
 *
 * Keyed `day-YYYY-MM-DD` / `month-YYYY-MM` / `all`, so a dashboard showing
 * "this month" is one document read rather than a scan of every event and every
 * order in it.
 */
export interface BookstoreStats {
  period: 'day' | 'month' | 'all';
  /** `YYYY-MM-DD`, `YYYY-MM`, or `all`. Matches the doc id after the prefix. */
  key: string;

  /** Slug → its numbers. Only products with something to report appear. */
  products: Record<string, ProductStats>;

  /** Search term → how many times it was typed. */
  searches: Record<string, number>;
  /** The subset that matched nothing. */
  zeroResultSearches: Record<string, number>;

  totals: {
    views: number;
    details: number;
    cartAdds: number;
    cartRemoves: number;
    checkoutStarts: number;
    /** Distinct `visitor` values seen. Not distinct people, but close enough. */
    visitors: number;
    /** Paid orders. A refunded order stays counted here and in `refunded`. */
    orders: number;
    unitsSold: number;
    revenue: number;
    refunded: number;
    refundedOrders: number;
    shippedOrders: number;
    pickupOrders: number;
    /** Orders whose email had ordered before, within this period's input. */
    repeatBuyers: number;
  };

  /** When the rollup last ran. Staleness is visible rather than assumed. */
  computedAt: Timestamped;
}

export function emptyTotals(): BookstoreStats['totals'] {
  return {
    views: 0,
    details: 0,
    cartAdds: 0,
    cartRemoves: 0,
    checkoutStarts: 0,
    visitors: 0,
    orders: 0,
    unitsSold: 0,
    revenue: 0,
    refunded: 0,
    refundedOrders: 0,
    shippedOrders: 0,
    pickupOrders: 0,
    repeatBuyers: 0,
  };
}

/** Money for display, from the integer minor units the totals carry. */
export function statsMoney(amount: number): Money {
  return { amount, currency: 'USD' };
}
