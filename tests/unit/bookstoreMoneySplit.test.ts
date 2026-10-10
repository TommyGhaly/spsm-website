import { describe, expect, it } from 'vitest';
import {
  financeMonth,
  mergeStats,
  rollupBookstore,
  splitOrderTotal,
  withStatsDefaults,
  type RollupOrder,
} from '@spsm/shared';

/**
 * The bookstore's takings, divided into books, sales tax, postage and handling
 * — for the metrics tab, the orders list and the finance page. The property
 * every test here protects: the parts always add up to what Square charged.
 */
function order(over: Partial<RollupOrder> = {}): RollupOrder {
  return {
    contactEmail: 'buyer@example.com',
    status: 'paid',
    shipping: false,
    total: { amount: 2500 },
    lineItems: [{ productId: 'holy-bible', quantity: 1, unitPrice: { amount: 2500 } }],
    day: '2026-10-10',
    ...over,
  };
}

const sum = (parts: ReturnType<typeof splitOrderTotal>) =>
  parts.salesCents + parts.taxCents + parts.postageCents + parts.handlingCents;

describe('splitOrderTotal', () => {
  it('uses the recorded parts on a new order', () => {
    const parts = splitOrderTotal(
      order({
        shipping: true,
        total: { amount: 3485 },
        subtotal: { amount: 2300 },
        tax: { amount: 50 },
        shippingCents: 1135,
        handlingCents: 150,
      }),
    );
    expect(parts).toEqual({ salesCents: 2300, taxCents: 50, postageCents: 985, handlingCents: 150 });
    expect(sum(parts)).toBe(3485);
  });

  it('recovers the old flat delivery charge from an order that never wrote it down', () => {
    // $15 book + the $7 flat charge, before anything but the total was kept.
    const parts = splitOrderTotal(
      order({
        shipping: true,
        total: { amount: 2200 },
        lineItems: [{ productId: 'holy-bible', quantity: 1, unitPrice: { amount: 1500 } }],
      }),
    );
    expect(parts).toEqual({ salesCents: 1500, taxCents: 0, postageCents: 700, handlingCents: 0 });
  });

  it('calls everything books when an old order has no prices to split by', () => {
    const parts = splitOrderTotal(order({ shipping: true, total: { amount: 2200 }, lineItems: [{ productId: 'x', quantity: 1 }] }));
    expect(parts.salesCents).toBe(2200);
    expect(sum(parts)).toBe(2200);
  });

  it('has no delivery on a collection, whatever the numbers say', () => {
    expect(splitOrderTotal(order({ shippingCents: 700 })).postageCents).toBe(0);
  });
});

describe('the rollup and the month', () => {
  const taxed = order({
    shipping: true,
    total: { amount: 3485 },
    subtotal: { amount: 2300 },
    tax: { amount: 50 },
    shippingCents: 1135,
    handlingCents: 150,
    shippingService: 'USPS Ground Advantage',
  });
  const refundedTaxed = order({ status: 'refunded', total: { amount: 850 }, subtotal: { amount: 800 }, tax: { amount: 50 } });

  it('totals the parts and groups delivery by service', () => {
    const stats = rollupBookstore({ period: 'day', key: '2026-10-10', events: [], orders: [taxed, refundedTaxed, order()] });
    expect(stats.totals).toMatchObject({
      revenue: 3485 + 850 + 2500,
      salesCents: 2300 + 800 + 2500,
      taxCents: 100,
      postageCents: 985,
      handlingCents: 150,
      refundedTaxCents: 50,
    });
    expect(stats.shippingByService).toEqual({ 'USPS Ground Advantage': { orders: 1, cents: 1135 } });
  });

  it('merges a day rolled up before the split existed without NaN', () => {
    const today = rollupBookstore({ period: 'day', key: '2026-10-10', events: [], orders: [taxed] });
    const old = withStatsDefaults({ period: 'day', key: '2026-10-09', totals: { revenue: 1000, orders: 1 } })!;
    const month = mergeStats('month', '2026-10', [old, today]);
    expect(month.totals.taxCents).toBe(50);
    expect(month.totals.revenue).toBe(4485);
    expect(Number.isNaN(month.totals.salesCents)).toBe(false);
  });

  it('carries the split into the finance month, with the tax to pay over', () => {
    const stats = rollupBookstore({ period: 'month', key: '2026-10', events: [], orders: [taxed, refundedTaxed] });
    const month = financeMonth({ month: '2026-10', bookstore: stats.totals, camp: [], forms: [] });
    expect(month.bookstoreSalesCents + month.bookstoreTaxCents + month.bookstoreDeliveryCents).toBe(
      month.bookstoreCents,
    );
    expect(month.bookstoreTaxCents).toBe(100);
    expect(month.salesTaxDueCents).toBe(50);
    expect(month.bookstoreDeliveryCents).toBe(1135);
  });
});
