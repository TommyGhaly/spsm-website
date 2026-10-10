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
import { FLAT_SHIPPING_LABEL } from '../payments/shipping.js';

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
  /*
   * The parts of `total`, where the order recorded them. Optional because
   * orders taken before they were written have only the total — see
   * `splitOrderTotal` for how those are divided.
   */
  subtotal?: { amount: number } | null;
  tax?: { amount: number } | null;
  /** Everything charged for delivery, handling included. */
  shippingCents?: number | null;
  /** The handling part of `shippingCents`. */
  handlingCents?: number | null;
  shippingService?: string | null;
}

/**
 * An order's total, divided into goods, tax, postage and handling.
 *
 * ---------------------------------------------------------------------------
 * Exact for orders that recorded their parts; reconstructed for older ones,
 * always so the four add up to the total Square charged:
 *
 *   - tax is what the order says, or 0 — nothing was taxed before tax existed.
 *   - delivery is the recorded charge, else — on a delivered order — whatever
 *     the total leaves after the lines' prices and tax. That is exactly the old
 *     flat charge, which was never written down anywhere else.
 *   - handling is the recorded part, else 0 (there was no handling fee).
 *   - goods is whatever is left, so the four always sum to what was charged.
 * ---------------------------------------------------------------------------
 */
export function splitOrderTotal(order: RollupOrder): {
  salesCents: number;
  taxCents: number;
  postageCents: number;
  handlingCents: number;
} {
  const total = order.total.amount;
  const tax = Math.max(0, order.tax?.amount ?? 0);
  const recordedDelivery = typeof order.shippingCents === 'number' ? Math.max(0, order.shippingCents) : null;

  let delivery = 0;
  if (order.shipping) {
    if (recordedDelivery !== null) {
      delivery = recordedDelivery;
    } else {
      const priced =
        order.lineItems.length > 0 &&
        order.lineItems.every((line) => typeof line.unitPrice?.amount === 'number');
      const goods =
        order.subtotal?.amount ??
        (priced
          ? order.lineItems.reduce(
              (sum, line) => sum + line.unitPrice!.amount * (Number(line.quantity) || 0),
              0,
            )
          : null);
      delivery = goods === null ? 0 : Math.max(0, total - goods - tax);
    }
  }
  const handling = Math.min(delivery, Math.max(0, order.handlingCents ?? 0));
  return {
    salesCents: total - tax - delivery,
    taxCents: tax,
    postageCents: delivery - handling,
    handlingCents: handling,
  };
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
  const shippingByService: Record<string, { orders: number; cents: number }> = {};

  for (const order of input.orders) {
    if (!SOLD_STATUSES.has(order.status)) continue;

    totals.orders += 1;
    totals.revenue += order.total.amount;
    if (order.shipping) totals.shippedOrders += 1;
    else totals.pickupOrders += 1;

    const parts = splitOrderTotal(order);
    totals.salesCents += parts.salesCents;
    totals.taxCents += parts.taxCents;
    totals.postageCents += parts.postageCents;
    totals.handlingCents += parts.handlingCents;
    if (order.shipping) {
      // An order with no service named is from before live postage, when every
      // delivery paid the flat charge — so that is what it is called.
      const service = order.shippingService?.trim() || FLAT_SHIPPING_LABEL;
      const row = (shippingByService[service] ??= { orders: 0, cents: 0 });
      row.orders += 1;
      row.cents += parts.postageCents + parts.handlingCents;
    }

    if (order.status === 'refunded') {
      totals.refundedOrders += 1;
      totals.refunded += order.total.amount;
      // Refunds are whole-order, so the tax on it went back too.
      totals.refundedTaxCents += parts.taxCents;
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
    shippingByService,
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
  const shippingByService: Record<string, { orders: number; cents: number }> = {};

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
      // `?? 0`: a day rolled up before a field existed lacks it.
      const value = part.totals[field] ?? 0;
      if (field === 'visitors' || field === 'repeatBuyers') {
        totals[field] = Math.max(totals[field], value);
      } else {
        totals[field] += value;
      }
    }
    for (const [service, row] of Object.entries(part.shippingByService ?? {})) {
      const target = (shippingByService[service] ??= { orders: 0, cents: 0 });
      target.orders += row.orders;
      target.cents += row.cents;
    }
  }

  return { period, key, products, searches, zeroResultSearches, totals, shippingByService };
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
