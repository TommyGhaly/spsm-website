import { describe, it, expect } from 'vitest';
import { buildOrderEmail, buildSquareOrder, stockRefusal, type Product } from '@spsm/shared';
import { trackedDemand } from '../../functions/src/stockHold';

/**
 * Stock is refused by count, not only at zero.
 *
 * Checkout used to turn a line away only when `stockCount` was exactly 0, so a
 * basket of five against a shelf of two went through and Square's count went
 * negative. These pin the rule for every channel — website, app, App Clip and
 * a volunteer's cash sale all go through `buildSquareOrder`.
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
  ['two-left', product({ name: 'Agpeya', stockCount: 2 })],
  ['untracked', product({ name: 'Bible', stockCount: null })],
  ['gone', product({ name: 'Synaxarium', stockCount: 0 })],
  ['shirt', product({ name: 'Camp shirt', sizes: [{ label: 'M', count: 1, extraCents: 0 }] })],
]);
const nameOf = (slug: string) => catalog.get(slug)?.name;

describe('buildSquareOrder against tracked stock', () => {
  it('sells up to the count', () => {
    const built = buildSquareOrder([{ slug: 'two-left', quantity: 2 }], catalog);
    expect(built.rejected).toEqual([]);
    expect(built.lines).toHaveLength(1);
  });

  it('refuses more than the count, saying how many are left', () => {
    const built = buildSquareOrder([{ slug: 'two-left', quantity: 5 }], catalog);
    expect(built.lines).toEqual([]);
    expect(built.rejected).toEqual([{ slug: 'two-left', reason: 'not-enough', left: 2 }]);
  });

  it('leaves untracked products unlimited', () => {
    const built = buildSquareOrder([{ slug: 'untracked', quantity: 20 }], catalog);
    expect(built.rejected).toEqual([]);
  });

  it('reports a short size with what is left', () => {
    const built = buildSquareOrder([{ slug: 'shirt', size: 'M', quantity: 3 }], catalog);
    expect(built.rejected).toEqual([{ slug: 'shirt', reason: 'not-enough', size: 'M', left: 1 }]);
  });
});

describe('stockRefusal', () => {
  it('is null when nothing was short', () => {
    expect(stockRefusal([{ slug: 'x', reason: 'unpublished' }], nameOf)).toBeNull();
  });

  it('names the item and the count', () => {
    const built = buildSquareOrder(
      [
        { slug: 'untracked', quantity: 1 },
        { slug: 'two-left', quantity: 3 },
      ],
      catalog,
    );
    expect(stockRefusal(built.rejected, nameOf)).toBe(
      'Only 2 of Agpeya are left. Please change the basket and try again. Nothing was charged.',
    );
  });

  it('says sold out at zero, with the size for clothing', () => {
    expect(stockRefusal(buildSquareOrder([{ slug: 'gone', quantity: 1 }], catalog).rejected, nameOf)).toMatch(
      /^Synaxarium is sold out\./,
    );
    expect(
      stockRefusal([{ slug: 'shirt', reason: 'sold-out', size: 'L', left: 0 }], nameOf),
    ).toMatch(/^Camp shirt in size L is sold out\./);
  });
});

describe('trackedDemand', () => {
  it('sums the lines Square counts and skips clothing', () => {
    const demand = trackedDemand([
      { productId: 'two-left', quantity: 1 },
      { productId: 'two-left', quantity: 1 },
      { productId: 'shirt', size: 'M', quantity: 1 },
      { slug: 'untracked', quantity: 3 },
    ]);
    expect([...demand]).toEqual([
      ['two-left', 2],
      ['untracked', 3],
    ]);
  });
});

describe('the cash-sale receipt', () => {
  it('says handed over, not collect it', () => {
    const mail = buildOrderEmail({
      orderId: 'O1',
      email: 'a@b.co',
      buyerName: 'Mina Saad',
      shipping: false,
      handedOver: true,
      lines: [{ name: 'Agpeya', quantity: 1, amount: 800, sku: null }],
      total: 800,
    });
    expect(mail.message.text).toMatch(/Paid in cash at the bookstore and handed over/);
    expect(mail.message.text).not.toMatch(/collect it after any Liturgy/);
    expect(mail.message.text).not.toMatch(/put aside under/);
  });
});
