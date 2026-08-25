/**
 * Turning raw events and orders into the numbers an admin reads.
 *
 * A pure function over two arrays — no Firestore, no clock, no network — for
 * the same reason `buildOrderEmail` is: the arithmetic in a sales report is
 * exactly the part that must be checkable without an emulator, and exactly the
 * part where an off-by-one is invisible until someone reconciles against Square
 * months later.
 *
 * The scheduled Function's whole job is to fetch, call this, and write the
 * result. Anything it does beyond that belongs here instead.
 */
import {
  emptyProductStats,
  emptyTotals,
  type BookstoreStats,
  type ProductStats,
} from '../schema/analytics.js';
import type { NormalizedBookstoreEvent } from './bookstoreEvents.js';

/**
 * The slice of an order the rollup needs.
 *
 * Narrower than `Order` on purpose: this takes what it reads and nothing else,
 * so a change to shipping addresses or webhook bookkeeping cannot break a
 * revenue figure or the test that pins it.
 */
export interface RollupOrder {
  contactEmail: string;
  status: string;
  shipping: boolean;
  total: { amount: number };
  lineItems: { productId: string; quantity: number; unitPrice?: { amount: number } | null }[];
  /** `YYYY-MM-DD` in the parish's zone, computed by the caller from createdAt. */
  day: string;
}

export interface RollupInput {
  period: BookstoreStats['period'];
  key: string;
  events: readonly NormalizedBookstoreEvent[];
  orders: readonly RollupOrder[];
  /**
   * Emails that had already bought something *before* this period began.
   *
   * Passed in rather than derived, because "repeat buyer" is not answerable
   * from a single period's orders: someone whose only two purchases were in
   * March and in June is a repeat buyer in June, and June's orders alone cannot
   * know that. The caller reads the running set; this function only counts.
   */
  priorBuyerEmails?: ReadonlySet<string>;
}

/**
 * Which order statuses count as a sale.
 *
 * `refunded` is in the list, and that is the deliberate choice. A refunded
 * order *was* a sale — the book left the shelf and the money moved, and both
 * facts stay true after the refund. Dropping it from revenue would make the
 * dashboard disagree with Square's own reports, which is the one thing a parish
 * treasurer will notice. The refund is reported alongside as its own number, so
 * net is `revenue - refunded` and both halves are visible.
 */
const SOLD_STATUSES = new Set(['paid', 'refunded']);

function bucket(products: Record<string, ProductStats>, slug: string): ProductStats {
  const existing = products[slug];
  if (existing) return existing;
  const created = emptyProductStats();
  products[slug] = created;
  return created;
}

function bump(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

export function rollupBookstore(input: RollupInput): Omit<BookstoreStats, 'computedAt'> {
  const products: Record<string, ProductStats> = {};
  const searches: Record<string, number> = {};
  const zeroResultSearches: Record<string, number> = {};
  const totals = emptyTotals();
  const visitors = new Set<string>();

  for (const event of input.events) {
    visitors.add(event.visitor);

    if (event.kind === 'search' || event.kind === 'searchZero') {
      if (!event.term) continue;
      /*
       * A zero-result search is counted in both tables, not moved into one.
       *
       * `searches` answers "what do people look for", and a search that failed
       * is still a thing someone looked for — excluding it would understate
       * demand for precisely the titles the parish does not stock, which is the
       * question this data exists to answer.
       */
      bump(searches, event.term);
      if (event.kind === 'searchZero') bump(zeroResultSearches, event.term);
      continue;
    }

    if (!event.slug) continue;
    const stats = bucket(products, event.slug);

    switch (event.kind) {
      case 'view':
        stats.views += 1;
        totals.views += 1;
        break;
      case 'detail':
        stats.details += 1;
        totals.details += 1;
        break;
      case 'cartAdd':
        stats.cartAdds += event.quantity;
        totals.cartAdds += event.quantity;
        break;
      case 'cartRemove':
        stats.cartRemoves += event.quantity;
        totals.cartRemoves += event.quantity;
        break;
      case 'checkoutStart':
        totals.checkoutStarts += 1;
        break;
    }
  }

  totals.visitors = visitors.size;

  /*
   * Sales come from `orders`, never from a `purchase` event.
   *
   * There is no client-side purchase event and there must not be one. Orders
   * are written by the checkout Function from what Square actually charged, so
   * they are the only record that cannot be inflated by anyone with the page
   * open — and a browser that closes between the payment and the event write
   * would lose a sale from the report while the money sat in the bank.
   */
  const seenEmails = new Set(input.priorBuyerEmails ?? []);

  for (const order of input.orders) {
    if (!SOLD_STATUSES.has(order.status)) continue;

    totals.orders += 1;
    totals.revenue += order.total.amount;
    if (order.shipping) totals.shippedOrders += 1;
    else totals.pickupOrders += 1;

    if (order.status === 'refunded') {
      totals.refundedOrders += 1;
      totals.refunded += order.total.amount;
    }

    const email = order.contactEmail.trim().toLowerCase();
    if (email) {
      if (seenEmails.has(email)) totals.repeatBuyers += 1;
      seenEmails.add(email);
    }

    /*
     * Counted once per order however many lines mention the product.
     *
     * The checkout Function de-duplicates by slug, so this cannot happen today
     * — but "orders containing this book" is the number people read off the
     * page, and a shape change upstream should not quietly turn it into
     * something else.
     */
    const counted = new Set<string>();
    for (const line of order.lineItems) {
      const slug = line.productId;
      if (!slug) continue;
      const stats = bucket(products, slug);
      if (!counted.has(slug)) {
        stats.orders += 1;
        counted.add(slug);
      }
      const quantity = Number(line.quantity) || 0;
      stats.unitsSold += quantity;
      totals.unitsSold += quantity;
      /*
       * Line revenue only where a unit price was recorded. Orders written
       * before the checkout Function started storing one contribute to
       * `totals.revenue` — which comes off the order, not the line — and leave
       * per-product revenue at zero rather than guessing it from the total.
       */
      const unit = line.unitPrice?.amount;
      if (typeof unit === 'number') stats.revenue += unit * quantity;
    }
  }

  return {
    period: input.period,
    key: input.key,
    products,
    searches,
    zeroResultSearches,
    totals,
  };
}

/**
 * Merge already-rolled-up periods into a wider one.
 *
 * A month is the sum of its days, and re-reading every raw event to compute one
 * is both slower and impossible past the TTL — the events for the 1st are gone
 * by the time the report for that quarter is wanted. Daily rollups are the
 * durable record; everything wider is built from them.
 *
 * Two numbers cannot be summed this way and are not:
 *
 *   - `visitors` is a set size. Summing days double-counts the person who came
 *     on Tuesday and again on Friday. It is left as the largest single day's
 *     figure, which is a lower bound and labelled as one in the UI.
 *   - `repeatBuyers` has the same problem for the same reason, and is handled
 *     the same way.
 */
export function mergeStats(
  period: BookstoreStats['period'],
  key: string,
  parts: readonly Omit<BookstoreStats, 'computedAt'>[],
): Omit<BookstoreStats, 'computedAt'> {
  const products: Record<string, ProductStats> = {};
  const searches: Record<string, number> = {};
  const zeroResultSearches: Record<string, number> = {};
  const totals = emptyTotals();

  for (const part of parts) {
    for (const [slug, stats] of Object.entries(part.products)) {
      const target = bucket(products, slug);
      target.views += stats.views;
      target.details += stats.details;
      target.cartAdds += stats.cartAdds;
      target.cartRemoves += stats.cartRemoves;
      target.orders += stats.orders;
      target.unitsSold += stats.unitsSold;
      target.revenue += stats.revenue;
    }
    for (const [term, count] of Object.entries(part.searches)) bump(searches, term, count);
    for (const [term, count] of Object.entries(part.zeroResultSearches)) {
      bump(zeroResultSearches, term, count);
    }

    for (const field of Object.keys(totals) as (keyof typeof totals)[]) {
      if (field === 'visitors' || field === 'repeatBuyers') {
        totals[field] = Math.max(totals[field], part.totals[field]);
      } else {
        totals[field] += part.totals[field];
      }
    }
  }

  return { period, key, products, searches, zeroResultSearches, totals };
}

/**
 * The leaderboards the dashboard actually renders.
 *
 * Ties broken by slug so the order is stable between two rollups with the same
 * numbers — otherwise a book appears to move up the list when nothing happened.
 */
export function topProducts(
  stats: Pick<BookstoreStats, 'products'>,
  by: keyof ProductStats,
  limit = 10,
): { slug: string; value: number; stats: ProductStats }[] {
  return Object.entries(stats.products)
    .map(([slug, value]) => ({ slug, value: value[by], stats: value }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.slug.localeCompare(b.slug))
    .slice(0, limit);
}

/**
 * How few looks is too few to quote a percentage from.
 *
 * One person opening a book and not buying it is not "0% conversion", it is one
 * person. At four it is still noise. This is not a statistically defensible
 * threshold — no threshold on this data would be — it is the point below which
 * the number says less than the silence would.
 */
export const MIN_CONVERSION_SAMPLE = 5;

/**
 * Views per purchase, as a percentage, or null when the number would lie.
 *
 * Null in two cases and for one reason: printing a figure nobody should act on
 * is worse than printing nothing. "Nobody looked at it" is not 0% conversion,
 * and neither is "one person looked at it once" — but both render as a
 * confident `0%` next to a title, which is a harsh thing to say about a book on
 * the strength of no evidence. The dashboard shows a blank instead, and the
 * ranking beside it still tells you what was popular.
 */
export function conversionRate(stats: ProductStats): number | null {
  const looked = stats.details || stats.views;
  if (looked < MIN_CONVERSION_SAMPLE) return null;
  return (stats.orders / looked) * 100;
}
