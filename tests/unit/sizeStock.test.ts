import { describe, it, expect } from 'vitest';
import {
  ABANDONED_AFTER_MINUTES,
  MAX_SIZE_COUNT,
  STALE_AFTER_MINUTES,
  settleStaleOrder,
  cleanPhone,
  mayMoveOrder,
  retakeSizes,
  returnSizes,
  shouldReturnSizes,
  sizeDemand,
  takeSizes,
  type ProductSize,
} from '@spsm/shared';

const shirt: ProductSize[] = [
  { label: 'S', count: 3, extraCents: 0 },
  { label: 'M', count: 1, extraCents: 0 },
  { label: 'XL', count: 0, extraCents: 200 },
];

describe('sizeDemand', () => {
  it('sums one product-and-size across lines and ignores lines without a size', () => {
    expect(
      sizeDemand([
        { slug: 'tee', size: 'S', quantity: 1 },
        { slug: 'tee', size: 'S', quantity: 2 },
        { slug: 'tee', size: 'M', quantity: 1 },
        { slug: 'bible', size: null, quantity: 4 },
        { slug: 'hoodie', size: 'S', quantity: 0 },
      ]),
    ).toEqual([
      { slug: 'tee', size: 'S', quantity: 3 },
      { slug: 'tee', size: 'M', quantity: 1 },
    ]);
  });
});

describe('takeSizes', () => {
  it('takes exactly what was asked for, from that product only', () => {
    const demand = sizeDemand([
      { slug: 'tee', size: 'S', quantity: 2 },
      { slug: 'hoodie', size: 'M', quantity: 1 },
    ]);
    const { next, short } = takeSizes(shirt, 'tee', demand);
    expect(short).toEqual([]);
    expect(next.map((size) => size.count)).toEqual([1, 1, 0]);
  });

  it('can sell the last one', () => {
    const { next, short } = takeSizes(shirt, 'tee', [{ slug: 'tee', size: 'M', quantity: 1 }]);
    expect(short).toEqual([]);
    expect(next.find((size) => size.label === 'M')?.count).toBe(0);
  });

  it('refuses the whole product when one size cannot cover its share', () => {
    const { next, short } = takeSizes(shirt, 'tee', [
      { slug: 'tee', size: 'S', quantity: 1 },
      { slug: 'tee', size: 'M', quantity: 2 },
    ]);
    expect(short).toEqual([{ size: 'M', left: 1 }]);
    expect(next).toEqual(shirt);
  });

  it('treats a size staff removed as short, not free', () => {
    expect(takeSizes(shirt, 'tee', [{ slug: 'tee', size: 'L', quantity: 1 }]).short).toEqual([
      { size: 'L', left: 0 },
    ]);
  });

  it('does not touch the list it was given', () => {
    takeSizes(shirt, 'tee', [{ slug: 'tee', size: 'S', quantity: 3 }]);
    expect(shirt[0]?.count).toBe(3);
  });
});

describe('returnSizes', () => {
  it('puts back what was taken, and is the inverse of takeSizes', () => {
    const demand = [
      { slug: 'tee', size: 'S', quantity: 2 },
      { slug: 'tee', size: 'M', quantity: 1 },
    ];
    const { next } = takeSizes(shirt, 'tee', demand);
    expect(returnSizes(next, 'tee', demand)).toEqual(shirt);
  });

  it('leaves a removed size removed and caps the count', () => {
    const back = returnSizes([{ label: 'S', count: MAX_SIZE_COUNT, extraCents: 0 }], 'tee', [
      { slug: 'tee', size: 'S', quantity: 5 },
      { slug: 'tee', size: 'L', quantity: 1 },
    ]);
    expect(back).toEqual([{ label: 'S', count: MAX_SIZE_COUNT, extraCents: 0 }]);
  });
});

describe('shouldReturnSizes', () => {
  it('returns them for a failed or cancelled payment', () => {
    expect(shouldReturnSizes('failed', { sizesCounted: true })).toBe(true);
    expect(shouldReturnSizes('canceled', { sizesCounted: true })).toBe(true);
  });

  it('returns them for a refund only when staff asked to restock', () => {
    expect(shouldReturnSizes('refunded', { sizesCounted: true })).toBe(false);
    expect(shouldReturnSizes('refunded', { sizesCounted: true, refund: { restock: false } })).toBe(false);
    expect(shouldReturnSizes('refunded', { sizesCounted: true, refund: { restock: true } })).toBe(true);
  });

  it('never twice, and never for an order that took none', () => {
    expect(shouldReturnSizes('failed', { sizesCounted: false })).toBe(false);
    expect(shouldReturnSizes('failed', {})).toBe(false);
    expect(shouldReturnSizes('paid', { sizesCounted: true })).toBe(false);
  });
});

describe('cleanPhone', () => {
  it('keeps a number as it was typed', () => {
    expect(cleanPhone('  (508) 555-0134 ')).toBe('(508) 555-0134');
    expect(cleanPhone('+1 508 555 0134')).toBe('+1 508 555 0134');
    expect(cleanPhone('508.555.0134')).toBe('508.555.0134');
    expect(cleanPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(cleanPhone('508-555-0134 ext. 12')).toBe('508-555-0134 ext. 12');
  });

  it('refuses what is not a phone number', () => {
    expect(cleanPhone(undefined)).toBeNull();
    expect(cleanPhone(5085550134)).toBeNull();
    expect(cleanPhone('')).toBeNull();
    expect(cleanPhone('555-0134')).toBeNull();
    expect(cleanPhone('call me maybe')).toBeNull();
    expect(cleanPhone('508-555-0134; drop table')).toBeNull();
    expect(cleanPhone('1234567890123456')).toBeNull();
  });
});

describe('settleStaleOrder', () => {
  it('leaves a fresh order alone, whatever Square says', () => {
    expect(settleStaleOrder(STALE_AFTER_MINUTES - 1, 'COMPLETED')).toBe('wait');
    expect(settleStaleOrder(Number.NaN, null)).toBe('wait');
  });

  it('marks a paid order paid and a failed one failed', () => {
    expect(settleStaleOrder(STALE_AFTER_MINUTES, 'COMPLETED')).toBe('paid');
    expect(settleStaleOrder(STALE_AFTER_MINUTES, 'FAILED')).toBe('failed');
    expect(settleStaleOrder(STALE_AFTER_MINUTES, 'CANCELED')).toBe('failed');
  });

  it('waits for money that may still move', () => {
    expect(settleStaleOrder(10_000, 'APPROVED')).toBe('wait');
    expect(settleStaleOrder(10_000, 'PENDING')).toBe('wait');
  });

  it('gives up on an order with no payment only after the checkout could have closed', () => {
    expect(settleStaleOrder(ABANDONED_AFTER_MINUTES - 1, null)).toBe('wait');
    expect(settleStaleOrder(ABANDONED_AFTER_MINUTES, null)).toBe('failed');
  });
});

describe('mayMoveOrder', () => {
  it('moves forwards', () => {
    expect(mayMoveOrder(undefined, 'pending')).toBe(true);
    expect(mayMoveOrder('pending', 'paid')).toBe(true);
    expect(mayMoveOrder('pending', 'failed')).toBe(true);
    expect(mayMoveOrder('failed', 'paid')).toBe(true);
    expect(mayMoveOrder('paid', 'refunded')).toBe(true);
    expect(mayMoveOrder('paid', 'paid')).toBe(true);
  });

  it('never backwards', () => {
    expect(mayMoveOrder('paid', 'pending')).toBe(false);
    expect(mayMoveOrder('paid', 'failed')).toBe(false);
    expect(mayMoveOrder('paid', 'canceled')).toBe(false);
    expect(mayMoveOrder('refunded', 'canceled')).toBe(false);
    expect(mayMoveOrder('refunded', 'paid')).toBe(false);
  });
});

describe('retakeSizes', () => {
  it('takes again, down to zero, and says what was short', () => {
    const { next, short } = retakeSizes(shirt, 'tee', [
      { slug: 'tee', size: 'S', quantity: 2 },
      { slug: 'tee', size: 'M', quantity: 3 },
    ]);
    expect(next.map((size) => size.count)).toEqual([1, 0, 0]);
    expect(short).toEqual([{ size: 'M', missing: 2 }]);
  });
});
