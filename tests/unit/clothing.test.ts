import { describe, it, expect } from 'vitest';
import { SIZE_PRESETS, cleanSizes, clearanceOf, sizesSoldOut } from '@spsm/shared';

describe('cleanSizes', () => {
  it('is null for anything that is not a list — not clothing', () => {
    expect(cleanSizes(undefined)).toBeNull();
    expect(cleanSizes(null)).toBeNull();
    expect(cleanSizes({ label: 'M' })).toBeNull();
  });

  it('keeps known sizes once each, in preset order, with sane numbers', () => {
    expect(
      cleanSizes([
        { label: 'XL', count: 2, extraCents: 0 },
        { label: 'S', count: 4.5, extraCents: -100 },
        { label: 'Huge', count: 1, extraCents: 0 },
        { label: 'XL', count: 9, extraCents: 0 },
        { label: '2XL', count: -3, extraCents: 1_000_000 },
      ]),
    ).toEqual([
      { label: 'S', count: 0, extraCents: 0 },
      { label: 'XL', count: 2, extraCents: 0 },
      { label: '2XL', count: 0, extraCents: 10_000 },
    ]);
  });

  it('runs small to large', () => {
    expect(SIZE_PRESETS.indexOf('Youth XL')).toBeLessThan(SIZE_PRESETS.indexOf('XS'));
  });
});

describe('sizesSoldOut', () => {
  it('is true when every size is gone, or none are offered', () => {
    expect(sizesSoldOut([])).toBe(true);
    expect(sizesSoldOut([{ label: 'M', count: 0, extraCents: 0 }])).toBe(true);
    expect(sizesSoldOut([{ label: 'M', count: 0, extraCents: 0 }, { label: 'L', count: 1, extraCents: 0 }])).toBe(false);
  });
});

describe('clearanceOf', () => {
  it('reads the old price, the new one and the saving', () => {
    expect(clearanceOf({ wasPriceCents: 2000, amountCents: 1500 })).toEqual({
      wasCents: 2000,
      nowCents: 1500,
      percentOff: 25,
    });
  });

  it('is no sale unless the old price is the higher one', () => {
    expect(clearanceOf({ wasPriceCents: null, amountCents: 1500 })).toBeNull();
    expect(clearanceOf({ wasPriceCents: undefined, amountCents: 1500 })).toBeNull();
    // Raised in Square past the remembered price: no longer reads as a sale.
    expect(clearanceOf({ wasPriceCents: 1500, amountCents: 1800 })).toBeNull();
    expect(clearanceOf({ wasPriceCents: 1500, amountCents: 1500 })).toBeNull();
  });
});
