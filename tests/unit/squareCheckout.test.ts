import { describe, it, expect } from 'vitest';
import { buildSquareOrder, looksLikeEmail, isUsableAddress, MAX_QUANTITY, type Product } from '@spsm/shared';

/**
 * The cart arrives from a page anyone can edit, so the property these tests
 * exist to protect is simple: **no price the browser sends can ever reach
 * Square.** Line items go out as catalog ids and Square looks the money up
 * itself, which is why none of the assertions below mention an amount.
 */
const product = (over: Partial<Product> & { name: string }): Product =>
  ({
    slug: 'x',
    description: '',
    price: { amount: 800, currency: 'USD' },
    imagePaths: [],
    squareCatalogObjectId: 'ITEM',
    squareVariationId: 'VAR',
    syncedAt: null,
    stockCount: null,
    category: 'Bookstore',
    published: true,
    publishAt: null,
    createdAt: null as never,
    updatedAt: null as never,
    updatedBy: null,
    ...over,
  }) as Product;

const catalog = new Map<string, Product>([
  ['holy-bible', product({ name: 'Holy Bible', squareVariationId: 'VAR_BIBLE' })],
  ['hidden', product({ name: 'Hidden', published: false })],
  ['sold-out', product({ name: 'Sold Out', stockCount: 0 })],
  ['no-square', product({ name: 'Not Mirrored', squareVariationId: null })],
]);

describe('buildSquareOrder', () => {
  it('sends catalog ids and quantities, never an amount', () => {
    const built = buildSquareOrder([{ slug: 'holy-bible', quantity: 2 }], catalog);

    expect(built.lines).toEqual([{ catalog_object_id: 'VAR_BIBLE', quantity: '2' }]);
    // The whole security property, asserted directly.
    expect(JSON.stringify(built.lines)).not.toMatch(/amount|price|money/i);
    expect(built.names).toEqual({ 'holy-bible': 'Holy Bible' });
  });

  it('ignores any price the caller tries to smuggle in', () => {
    const built = buildSquareOrder(
      [{ slug: 'holy-bible', quantity: 1, price: { amount: 1 } } as never],
      catalog,
    );
    expect(built.lines).toEqual([{ catalog_object_id: 'VAR_BIBLE', quantity: '1' }]);
  });

  it('refuses a product that is not published', () => {
    const built = buildSquareOrder([{ slug: 'hidden', quantity: 1 }], catalog);
    expect(built.lines).toEqual([]);
    expect(built.rejected).toEqual([{ slug: 'hidden', reason: 'unpublished' }]);
  });

  it('refuses one that is sold out, or missing from Square', () => {
    expect(buildSquareOrder([{ slug: 'sold-out', quantity: 1 }], catalog).rejected[0]?.reason).toBe(
      'sold-out',
    );
    expect(buildSquareOrder([{ slug: 'no-square', quantity: 1 }], catalog).rejected[0]?.reason).toBe(
      'not-in-square',
    );
  });

  it('refuses an unknown slug rather than inventing a line', () => {
    expect(buildSquareOrder([{ slug: 'nope', quantity: 1 }], catalog).rejected).toEqual([
      { slug: 'nope', reason: 'unknown' },
    ]);
  });

  it('rejects quantities that are not sane', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_QUANTITY + 1, 9999]) {
      const built = buildSquareOrder([{ slug: 'holy-bible', quantity }], catalog);
      expect(built.lines, `quantity ${quantity}`).toEqual([]);
      expect(built.rejected[0]?.reason).toBe('bad-quantity');
    }
    // The boundary itself is allowed.
    expect(buildSquareOrder([{ slug: 'holy-bible', quantity: MAX_QUANTITY }], catalog).lines).toHaveLength(1);
  });

  it('collapses a repeated slug instead of charging for it twice', () => {
    const built = buildSquareOrder(
      [
        { slug: 'holy-bible', quantity: 1 },
        { slug: 'holy-bible', quantity: 19 },
      ],
      catalog,
    );
    expect(built.lines).toEqual([{ catalog_object_id: 'VAR_BIBLE', quantity: '1' }]);
  });

  it('keeps the good lines and reports the bad ones, rather than failing the basket', () => {
    const built = buildSquareOrder(
      [
        { slug: 'holy-bible', quantity: 1 },
        { slug: 'hidden', quantity: 1 },
      ],
      catalog,
    );
    expect(built.lines).toHaveLength(1);
    expect(built.rejected).toHaveLength(1);
  });

  it('survives junk without throwing', () => {
    expect(() => buildSquareOrder([null, 42, {}, { slug: '' }] as never, catalog)).not.toThrow();
    expect(buildSquareOrder([] as never, catalog).lines).toEqual([]);
  });
});

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const e of ['a@b.co', 'someone@spsmwayland.org', 'first.last+tag@example.com']) {
      expect(looksLikeEmail(e), e).toBe(true);
    }
  });

  it('catches the typos worth catching', () => {
    for (const e of ['', 'nope', 'a@b', 'a b@c.com', '@b.com', 'a@.com']) {
      expect(looksLikeEmail(e), e).toBe(false);
    }
  });
});

describe('isUsableAddress', () => {
  it('needs all four parts', () => {
    expect(isUsableAddress({ line1: '169 Rice Rd', city: 'Wayland', state: 'MA', postalCode: '01778' })).toBe(true);
    expect(isUsableAddress({ line1: '169 Rice Rd', city: 'Wayland', state: 'MA' })).toBe(false);
    expect(isUsableAddress({ line1: '  ', city: 'W', state: 'MA', postalCode: '01778' })).toBe(false);
  });
});
