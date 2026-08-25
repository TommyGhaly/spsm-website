import { describe, expect, it } from 'vitest';
import {
  MIN_CONVERSION_SAMPLE,
  conversionRate,
  mergeStats,
  rollupBookstore,
  topProducts,
  type NormalizedBookstoreEvent,
  type RollupOrder,
} from '@spsm/shared';

/**
 * The arithmetic behind every number an admin reads.
 *
 * This is the part that has to be checkable without an emulator: a sales report
 * that is quietly wrong stays wrong until somebody reconciles it against Square
 * months later, and by then nobody remembers which release changed it.
 */

const DAY = '2026-08-23';

function event(
  kind: NormalizedBookstoreEvent['kind'],
  over: Partial<NormalizedBookstoreEvent> = {},
): NormalizedBookstoreEvent {
  return {
    kind,
    slug: 'be-prepared',
    term: null,
    quantity: 1,
    visitor: 'aaaaaaaaaaaaaaaa',
    day: DAY,
    ...over,
  };
}

function order(over: Partial<RollupOrder> = {}): RollupOrder {
  return {
    contactEmail: 'buyer@example.com',
    status: 'paid',
    shipping: false,
    total: { amount: 2500 },
    lineItems: [{ productId: 'be-prepared', quantity: 1, unitPrice: { amount: 1800 } }],
    day: DAY,
    ...over,
  };
}

const roll = (events: NormalizedBookstoreEvent[], orders: RollupOrder[] = [], prior?: Set<string>) =>
  rollupBookstore({ period: 'day', key: DAY, events, orders, ...(prior ? { priorBuyerEmails: prior } : {}) });

describe('rollupBookstore — events', () => {
  it('counts each kind against its product and the totals', () => {
    const stats = roll([
      event('view'),
      event('view'),
      event('detail'),
      event('cartAdd', { quantity: 3 }),
      event('cartRemove'),
    ]);

    expect(stats.products['be-prepared']).toMatchObject({
      views: 2,
      details: 1,
      cartAdds: 3,
      cartRemoves: 1,
    });
    expect(stats.totals).toMatchObject({ views: 2, details: 1, cartAdds: 3, cartRemoves: 1 });
  });

  it('counts distinct visitors, not events', () => {
    const stats = roll([
      event('view', { visitor: 'aaaaaaaaaaaaaaaa' }),
      event('view', { visitor: 'aaaaaaaaaaaaaaaa' }),
      event('view', { visitor: 'bbbbbbbbbbbbbbbb' }),
    ]);
    expect(stats.totals.views).toBe(3);
    expect(stats.totals.visitors).toBe(2);
  });

  it('files a zero-result search under both tables', () => {
    const stats = roll([
      event('search', { slug: null, term: 'psalms' }),
      event('searchZero', { slug: null, term: 'agpeya' }),
    ]);

    // A failed search is still a thing someone looked for; excluding it from
    // `searches` would understate demand for exactly the titles not stocked.
    expect(stats.searches).toEqual({ psalms: 1, agpeya: 1 });
    expect(stats.zeroResultSearches).toEqual({ agpeya: 1 });
  });

  it('keeps checkoutStart out of the per-product counters', () => {
    const stats = roll([event('checkoutStart')]);
    expect(stats.totals.checkoutStarts).toBe(1);
    expect(stats.products['be-prepared']).toMatchObject({ views: 0, cartAdds: 0 });
  });
});

describe('rollupBookstore — orders', () => {
  it('counts a paid order once, with its units and revenue', () => {
    const stats = roll([], [order()]);
    expect(stats.totals).toMatchObject({ orders: 1, unitsSold: 1, revenue: 2500 });
    expect(stats.products['be-prepared']).toMatchObject({
      orders: 1,
      unitsSold: 1,
      revenue: 1800,
    });
  });

  it('ignores an order that was never paid for', () => {
    const stats = roll([], [order({ status: 'pending' }), order({ status: 'failed' })]);
    expect(stats.totals.orders).toBe(0);
    expect(stats.totals.revenue).toBe(0);
  });

  /*
   * The choice most likely to be "corrected" by someone later, so it is pinned
   * here with the reasoning: a refunded order was a sale. The book left the
   * shelf and the money moved, and Square's own reports say so. Net is
   * `revenue - refunded`, and both halves are reported.
   */
  it('keeps a refunded order in revenue and reports the refund separately', () => {
    const stats = roll([], [order({ status: 'refunded' })]);
    expect(stats.totals).toMatchObject({
      orders: 1,
      revenue: 2500,
      refundedOrders: 1,
      refunded: 2500,
    });
  });

  it('splits shipped from collected', () => {
    const stats = roll([], [order({ shipping: true }), order(), order()]);
    expect(stats.totals).toMatchObject({ shippedOrders: 1, pickupOrders: 2 });
  });

  it('leaves per-product revenue at zero when no unit price was recorded', () => {
    const stats = roll(
      [],
      [order({ lineItems: [{ productId: 'be-prepared', quantity: 2 }] })],
    );
    // The order total is still true and still counted; only the line is unknown.
    expect(stats.totals.revenue).toBe(2500);
    expect(stats.products['be-prepared']?.revenue).toBe(0);
    expect(stats.products['be-prepared']?.unitsSold).toBe(2);
  });

  it('counts a product once per order however many lines name it', () => {
    const stats = roll(
      [],
      [
        order({
          lineItems: [
            { productId: 'be-prepared', quantity: 1, unitPrice: { amount: 1000 } },
            { productId: 'be-prepared', quantity: 2, unitPrice: { amount: 1000 } },
          ],
        }),
      ],
    );
    expect(stats.products['be-prepared']).toMatchObject({ orders: 1, unitsSold: 3, revenue: 3000 });
  });
});

describe('rollupBookstore — repeat buyers', () => {
  it('does not call a first-time buyer a repeat buyer', () => {
    expect(roll([], [order()]).totals.repeatBuyers).toBe(0);
  });

  it('counts a second order from the same address within the period', () => {
    expect(roll([], [order(), order()]).totals.repeatBuyers).toBe(1);
  });

  it('is case-insensitive about the address', () => {
    const stats = roll([], [order(), order({ contactEmail: 'BUYER@Example.com' })]);
    expect(stats.totals.repeatBuyers).toBe(1);
  });

  /*
   * The whole reason `priorBuyerEmails` is a parameter. Someone whose only two
   * purchases were in March and today is a repeat buyer today, and today's
   * orders alone cannot know that.
   */
  it('counts someone whose earlier order was before this period', () => {
    const stats = roll([], [order()], new Set(['buyer@example.com']));
    expect(stats.totals.repeatBuyers).toBe(1);
  });
});

describe('mergeStats', () => {
  const monday = roll([event('view'), event('view')], [order()]);
  const tuesday = roll(
    [event('view'), event('view'), event('view', { visitor: 'bbbbbbbbbbbbbbbb' })],
    [order({ contactEmail: 'other@example.com' })],
  );

  it('sums the countable fields', () => {
    const month = mergeStats('month', '2026-08', [monday, tuesday]);
    expect(month.totals.views).toBe(5);
    expect(month.totals.orders).toBe(2);
    expect(month.totals.revenue).toBe(5000);
    expect(month.products['be-prepared']?.views).toBe(5);
  });

  /*
   * `visitors` is a set size, and a set size does not add. The person who came
   * on Monday and again on Tuesday would be counted twice. Taking the largest
   * single day is a lower bound, which is the honest answer available from
   * daily documents alone.
   */
  it('does not sum distinct-visitor counts', () => {
    const month = mergeStats('month', '2026-08', [monday, tuesday]);
    expect(monday.totals.visitors).toBe(1);
    expect(tuesday.totals.visitors).toBe(2);
    expect(month.totals.visitors).toBe(2);
  });

  it('is an identity over a single part, for the countable fields', () => {
    const month = mergeStats('month', '2026-08', [monday]);
    expect(month.totals).toEqual(monday.totals);
  });

  it('merges search tables', () => {
    const a = roll([event('search', { slug: null, term: 'psalms' })]);
    const b = roll([event('search', { slug: null, term: 'psalms' })]);
    expect(mergeStats('month', '2026-08', [a, b]).searches).toEqual({ psalms: 2 });
  });
});

describe('topProducts', () => {
  it('ranks by the requested field and drops the zeroes', () => {
    const stats = roll([
      event('view', { slug: 'a' }),
      event('view', { slug: 'b' }),
      event('view', { slug: 'b' }),
      event('detail', { slug: 'c' }),
    ]);

    expect(topProducts(stats, 'views').map((row) => row.slug)).toEqual(['b', 'a']);
  });

  it('breaks ties by slug, so the order does not wander between runs', () => {
    const stats = roll([event('view', { slug: 'zeta' }), event('view', { slug: 'alpha' })]);
    expect(topProducts(stats, 'views').map((row) => row.slug)).toEqual(['alpha', 'zeta']);
  });
});

describe('conversionRate', () => {
  it('is null when nobody looked, rather than zero', () => {
    const stats = roll([], [order()]);
    const product = stats.products['be-prepared']!;
    expect(product.views).toBe(0);
    expect(conversionRate(product)).toBeNull();
  });

  /*
   * The case that put "0% bought" next to a book somebody had glanced at once.
   * A percentage off a sample of one is not a fact about the book.
   */
  it('is null when too few people looked to mean anything', () => {
    const barelySeen = roll([event('view'), event('detail')], []);
    expect(conversionRate(barelySeen.products['be-prepared']!)).toBeNull();

    const seenEnough = roll(
      Array.from({ length: MIN_CONVERSION_SAMPLE }, () => event('detail')),
      [],
    );
    expect(conversionRate(seenEnough.products['be-prepared']!)).toBe(0);
  });

  it('prefers detail opens to grid impressions', () => {
    const stats = roll(
      [
        ...Array.from({ length: 40 }, () => event('view')),
        ...Array.from({ length: 5 }, () => event('detail')),
      ],
      [order()],
    );
    // One order against five detail opens, not against forty impressions.
    expect(conversionRate(stats.products['be-prepared']!)).toBe(20);
  });
});
