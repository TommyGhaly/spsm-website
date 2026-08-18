import { describe, it, expect } from 'vitest';
import {
  verifySquareWebhookSignature,
  squareSignatureBase,
  interpretSquareWebhook,
  type VerifiedWebhookEvent,
} from '@spsm/shared';

/**
 * The webhook endpoint is public and unauthenticated, because Square has to be
 * able to call it. The HMAC below is the only thing separating "Square says
 * this order is paid" from "anyone who found the URL says so", which makes this
 * the highest-consequence function in the repo: getting it wrong means the
 * parish ships books for payments that never happened.
 */
const KEY = 'test-signature-key';
const URL_ = 'https://www.spsmwayland.org/api/square/webhook';

/** Sign a body the way Square does, so the tests exercise the real algorithm. */
async function sign(key: string, url: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(url + body));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const BODY = JSON.stringify({
  event_id: 'evt_1',
  type: 'payment.updated',
  data: { object: { payment: { id: 'pay_1', order_id: 'ord_1', status: 'COMPLETED' } } },
});

describe('verifySquareWebhookSignature', () => {
  it('accepts a correctly signed delivery', async () => {
    const signature = await sign(KEY, URL_, BODY);
    expect(
      await verifySquareWebhookSignature({
        signatureKey: KEY,
        notificationUrl: URL_,
        rawBody: BODY,
        signature,
      }),
    ).toBe(true);
  });

  it('rejects a body that was tampered with after signing', async () => {
    const signature = await sign(KEY, URL_, BODY);
    const tampered = BODY.replace('"status":"COMPLETED"', '"status":"COMPLETED "');
    expect(
      await verifySquareWebhookSignature({
        signatureKey: KEY,
        notificationUrl: URL_,
        rawBody: tampered,
        signature,
      }),
    ).toBe(false);
  });

  it('rejects a signature made with a different key', async () => {
    const signature = await sign('someone-elses-key', URL_, BODY);
    expect(
      await verifySquareWebhookSignature({
        signatureKey: KEY,
        notificationUrl: URL_,
        rawBody: BODY,
        signature,
      }),
    ).toBe(false);
  });

  /**
   * The URL is part of the signed message, and this is the failure that wastes
   * an afternoon: the key is right, the body is right, and a trailing slash or
   * an http/https difference makes every delivery fail verification.
   */
  it('rejects when the signed URL differs, even trivially', async () => {
    const signature = await sign(KEY, URL_, BODY);
    for (const wrong of [
      `${URL_}/`,
      URL_.replace('https', 'http'),
      URL_.replace('www.', ''),
      `${URL_}?x=1`,
    ]) {
      expect(
        await verifySquareWebhookSignature({
          signatureKey: KEY,
          notificationUrl: wrong,
          rawBody: BODY,
          signature,
        }),
      ).toBe(false);
    }
  });

  it('rejects rather than throwing on missing or malformed input', async () => {
    const signature = await sign(KEY, URL_, BODY);
    const base = { signatureKey: KEY, notificationUrl: URL_, rawBody: BODY, signature };

    for (const override of [
      { signatureKey: '' },
      { signature: '' },
      { notificationUrl: '' },
      { signature: 'not base64 !!!' },
      { signature: 'c2hvcnQ=' },
    ]) {
      await expect(
        verifySquareWebhookSignature({ ...base, ...override }),
      ).resolves.toBe(false);
    }
  });

  it('signs url + body, in that order', () => {
    expect(squareSignatureBase('https://x/y', '{"a":1}')).toBe('https://x/y{"a":1}');
  });
});

describe('interpretSquareWebhook', () => {
  const event = (type: string, object: unknown, eventId = 'evt_1'): VerifiedWebhookEvent => ({
    verified: true,
    eventId,
    type,
    payload: { event_id: eventId, type, data: { object } },
  });

  it('marks an order paid on a completed payment', () => {
    expect(
      interpretSquareWebhook(
        event('payment.updated', { payment: { id: 'pay_1', order_id: 'ord_1', status: 'COMPLETED' } }),
      ),
    ).toEqual({
      squareOrderId: 'ord_1',
      squarePaymentId: 'pay_1',
      status: 'paid',
      eventId: 'evt_1',
    });
  });

  /**
   * APPROVED is authorised but not captured — the money has not moved. Treating
   * it as paid would hand over a book on an authorisation that can still be
   * voided.
   */
  it('treats an approved-but-uncaptured payment as pending, not paid', () => {
    expect(
      interpretSquareWebhook(
        event('payment.updated', { payment: { order_id: 'ord_1', status: 'APPROVED' } }),
      )?.status,
    ).toBe('pending');
  });

  it('maps the failure states', () => {
    const status = (s: string) =>
      interpretSquareWebhook(event('payment.updated', { payment: { order_id: 'o', status: s } }))
        ?.status;
    expect(status('FAILED')).toBe('failed');
    expect(status('CANCELED')).toBe('canceled');
  });

  it('acts on a completed refund and ignores a pending one', () => {
    expect(
      interpretSquareWebhook(
        event('refund.updated', { refund: { order_id: 'ord_1', payment_id: 'pay_1', status: 'COMPLETED' } }),
      )?.status,
    ).toBe('refunded');

    // A refund that may still fail must not tell staff the money is back.
    expect(
      interpretSquareWebhook(
        event('refund.updated', { refund: { order_id: 'ord_1', status: 'PENDING' } }),
      ),
    ).toBeNull();
  });

  it('returns null for events we do not act on, rather than throwing', () => {
    for (const e of [
      event('inventory.count.updated', { count: {} }),
      event('payment.updated', { payment: { order_id: 'o', status: 'WHAT' } }),
      event('payment.updated', { payment: { status: 'COMPLETED' } }), // no order id
      event('payment.updated', {}),
      event('payment.updated', null),
    ]) {
      expect(interpretSquareWebhook(e)).toBeNull();
    }
    expect(() =>
      interpretSquareWebhook({ verified: true, eventId: 'e', type: 't', payload: 'junk' }),
    ).not.toThrow();
  });
});
