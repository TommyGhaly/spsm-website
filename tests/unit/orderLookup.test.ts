import { describe, expect, it } from 'vitest';
import {
  MAX_NAME,
  cleanName,
  describeOrderState,
  orderMatchesEmail,
  parseLookupRequest,
  toPublicOrderView,
  type DocOf,
  type Order,
  type PublicOrderView,
} from '@spsm/shared';

/**
 * The buyer-facing order lookup.
 *
 * Two things are worth pinning here and one of them is a disclosure boundary:
 * `toPublicOrderView` is what stands between an order document and a response
 * sent to anyone holding a receipt, and a field added to `Order` must not
 * appear in it by accident.
 */

function orderDoc(over: Partial<Order> = {}): DocOf<Order> {
  return {
    id: 'sq-order-1',
    squareOrderId: 'sq-order-1',
    squarePaymentId: 'pay-1',
    memberUid: null,
    contactEmail: 'Buyer@Example.com',
    contactEmailLower: 'buyer@example.com',
    buyerFirstName: 'Mina',
    buyerLastName: 'Abdelmalek',
    lineItems: [
      { productId: 'be-prepared', name: 'Be Prepared', quantity: 2, unitPrice: { amount: 1200, currency: 'USD' } },
    ],
    total: { amount: 3100, currency: 'USD' },
    status: 'paid',
    fulfillment: 'unfulfilled',
    shipping: false,
    shippingAddress: null,
    idempotencyKey: 'idem-1',
    appliedEventIds: ['evt-1'],
    createdAt: new Date('2026-08-23T14:00:00Z'),
    updatedAt: new Date('2026-08-23T14:00:00Z'),
    updatedBy: null,
    ...over,
  } as DocOf<Order>;
}

describe('parseLookupRequest', () => {
  it('accepts a plausible pair', () => {
    expect(parseLookupRequest({ orderId: ' sq-1 ', email: ' a@b.co ' })).toEqual({
      orderId: 'sq-1',
      email: 'a@b.co',
    });
  });

  /*
   * Both halves are the credential. Either one alone must be refused before any
   * query runs — the email alone would let anyone who knows a parishioner's
   * address enumerate their purchases.
   */
  it('refuses either half on its own', () => {
    expect(parseLookupRequest({ orderId: 'sq-1' })).toBeNull();
    expect(parseLookupRequest({ email: 'a@b.co' })).toBeNull();
    expect(parseLookupRequest({})).toBeNull();
  });

  it('refuses something that is not an email', () => {
    expect(parseLookupRequest({ orderId: 'sq-1', email: 'not-an-email' })).toBeNull();
  });

  it('bounds the order id rather than trusting its length', () => {
    const parsed = parseLookupRequest({ orderId: 'x'.repeat(500), email: 'a@b.co' });
    expect(parsed?.orderId.length).toBeLessThanOrEqual(64);
  });
});

describe('orderMatchesEmail', () => {
  it('ignores case, because the buyer typed the address twice', () => {
    expect(orderMatchesEmail({ contactEmail: 'Buyer@Example.com' }, 'buyer@example.com')).toBe(true);
    expect(orderMatchesEmail({ contactEmail: 'buyer@example.com' }, ' BUYER@EXAMPLE.COM ')).toBe(true);
  });

  it('does not match a different address', () => {
    expect(orderMatchesEmail({ contactEmail: 'buyer@example.com' }, 'other@example.com')).toBe(false);
  });
});

describe('toPublicOrderView', () => {
  const view = toPublicOrderView(orderDoc(), new Date('2026-08-23T14:00:00Z'));

  it('carries the name the order is filed under', () => {
    expect(view.buyerName).toBe('Mina Abdelmalek');
  });

  it('leaves the name empty on an order taken before names were asked for', () => {
    const old = toPublicOrderView(
      orderDoc({ buyerFirstName: undefined, buyerLastName: undefined }),
      null,
    );
    // Empty, not "undefined undefined" — this string is rendered.
    expect(old.buyerName).toBe('');
  });

  it('carries what a buyer needs', () => {
    expect(view).toMatchObject({
      orderId: 'sq-order-1',
      status: 'paid',
      fulfillment: 'unfulfilled',
      shipping: false,
      total: { amount: 3100, currency: 'USD' },
    });
    expect(view.lineItems).toEqual([{ name: 'Be Prepared', quantity: 2, amount: 2400 }]);
  });

  /*
   * The disclosure test. These are all real fields on the order document, and
   * none of them belongs in a response authenticated by a receipt — `refund`
   * in particular names the staff member who authorised it.
   */
  it('leaves the staff-only fields on the server', () => {
    const leaked = toPublicOrderView(
      orderDoc({
        memberUid: 'uid-7',
        refund: {
          squareRefundId: 'ref-1',
          amount: { amount: 3100, currency: 'USD' },
          reason: 'Damaged in the post',
          refundedBy: 'staff-uid',
          refundedByEmail: 'staff@parish.org',
          refundedAt: new Date(),
        },
        shippingAddress: { line1: '1 Main St', city: 'Wayland' },
      }),
      null,
    );

    const json = JSON.stringify(leaked);
    for (const secret of [
      'uid-7',
      'staff-uid',
      'staff@parish.org',
      'Damaged in the post',
      'idem-1',
      'evt-1',
      'pay-1',
      '1 Main St',
      'Buyer@Example.com',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('reports a refund as an amount and nothing else', () => {
    const refunded = toPublicOrderView(
      orderDoc({
        status: 'refunded',
        refund: {
          squareRefundId: 'ref-1',
          amount: { amount: 3100, currency: 'USD' },
          reason: 'Wrong title sent',
          refundedBy: 'staff-uid',
          refundedByEmail: 'staff@parish.org',
          refundedAt: new Date(),
        },
      }),
      null,
    );
    expect(refunded.refunded).toBe(true);
    expect(refunded.refundedAmount).toBe(3100);
  });

  it('leaves a line amount null when no unit price was recorded', () => {
    const noPrice = toPublicOrderView(
      orderDoc({ lineItems: [{ productId: 'x', name: 'A Book', quantity: 1 }] }),
      null,
    );
    expect(noPrice.lineItems[0]?.amount).toBeNull();
  });
});

describe('describeOrderState', () => {
  const view = (over: Partial<PublicOrderView>): PublicOrderView =>
    ({
      orderId: 'x',
      status: 'paid',
      fulfillment: 'unfulfilled',
      shipping: false,
      total: { amount: 100, currency: 'USD' },
      lineItems: [],
      placedAt: null,
      refunded: false,
      refundedAmount: null,
      ...over,
    }) as PublicOrderView;

  it('tells collection and delivery apart', () => {
    expect(describeOrderState(view({ shipping: false, fulfillment: 'ready' }))).toContain(
      'bookstore',
    );
    expect(describeOrderState(view({ shipping: true, fulfillment: 'collected' }))).toContain(
      'Posted',
    );
  });

  it('reports a payment state before a fulfilment state', () => {
    // A pending payment on a "ready" order must not read as ready to collect.
    expect(describeOrderState(view({ status: 'pending', fulfillment: 'ready' }))).toBe(
      'Payment is still being confirmed.',
    );
    expect(describeOrderState(view({ status: 'refunded', fulfillment: 'collected' }))).toBe(
      'Refunded.',
    );
  });
});

describe('cleanName', () => {
  it('accepts the names this parish actually has', () => {
    // Deliberately permissive: a pattern strict enough to exclude nonsense
    // excludes parishioners first.
    for (const name of ['Mina', "Y'akoub", 'Abdel-Malek', 'مينا', 'Mary Anne']) {
      expect(cleanName(name)).toBe(name);
    }
  });

  it('collapses whitespace and refuses nothing at all', () => {
    expect(cleanName('  Mina   George ')).toBe('Mina George');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('')).toBeNull();
    expect(cleanName(undefined)).toBeNull();
    expect(cleanName(42)).toBeNull();
  });

  it('bounds the length rather than rejecting', () => {
    expect(cleanName('a'.repeat(500))).toHaveLength(MAX_NAME);
  });
});
