/**
 * Verifying and interpreting Square's webhooks.
 *
 * ---------------------------------------------------------------------------
 * The signature check is the entire security model for this endpoint.
 *
 * The webhook URL is public and unauthenticated — it has to be, because Square
 * calls it. The only thing separating "Square says this order is paid" from
 * "anyone on the internet says this order is paid" is the HMAC below. Get it
 * wrong and the parish ships books for forged payments.
 *
 * Square signs `notificationUrl + rawBody` with the subscription's signature
 * key, HMAC-SHA256, base64, and sends it as `x-square-hmacsha256-signature`.
 * Two details that are easy to get wrong and silently break everything:
 *
 *   - The URL is part of the signed message. It must be *exactly* the URL in
 *     the Square subscription, scheme and path included. A trailing slash, or
 *     `http` where the subscription says `https`, produces a valid-looking
 *     mismatch.
 *   - The body must be the RAW bytes as received. Parsing to JSON and
 *     re-serialising changes key order and whitespace, and the signature will
 *     never match again.
 * ---------------------------------------------------------------------------
 *
 * Web Crypto rather than `node:crypto`, deliberately: this package is imported
 * by the website and will be imported by the phone app, and `@spsm/shared` has
 * to stay free of Node built-ins. `crypto.subtle` exists in Node 22, in every
 * browser, and in React Native with a polyfill.
 */
import type { OrderStatusUpdate, VerifiedWebhookEvent } from './provider.js';

/** The exact message Square signs. Exported so a failure can be logged. */
export function squareSignatureBase(notificationUrl: string, rawBody: string): string {
  return notificationUrl + rawBody;
}

/**
 * True when `signature` is Square's, for this body, at this URL.
 *
 * Never throws — a malformed header or an unusable key is a failed
 * verification, not an exception for the caller to handle separately. There is
 * exactly one safe response to all of them.
 */
export async function verifySquareWebhookSignature(input: {
  signatureKey: string;
  notificationUrl: string;
  rawBody: string;
  signature: string;
}): Promise<boolean> {
  const { signatureKey, notificationUrl, rawBody, signature } = input;
  if (!signatureKey || !signature || !notificationUrl) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(signatureKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(squareSignatureBase(notificationUrl, rawBody)),
    );
    return timingSafeEqual(base64(new Uint8Array(mac)), signature);
  } catch {
    return false;
  }
}

/**
 * Constant-time string comparison.
 *
 * `===` on the two signatures leaks, through timing, how many leading
 * characters an attacker guessed correctly — which turns forging a signature
 * into guessing it one character at a time. The length check up front is not a
 * leak worth worrying about: the length of a base64 SHA-256 digest is fixed and
 * public.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** Bytes to base64, without depending on Buffer. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Turn a verified event into an order status change, or null when it is not one
 * we act on.
 *
 * Null rather than throwing, so the caller can acknowledge an event it does not
 * care about instead of treating "not interesting" as "failed" — an event Square
 * cannot deliver successfully is an event Square retries for days.
 *
 * Only the transitions that matter to a parish bookstore are modelled. Square
 * emits a great many more; every one of them lands here as null.
 */
export function interpretSquareWebhook(event: VerifiedWebhookEvent): OrderStatusUpdate | null {
  const data = asRecord(asRecord(event.payload)?.['data']);
  const object = asRecord(data?.['object']);
  if (!object) return null;

  if (event.type === 'payment.updated' || event.type === 'payment.created') {
    const payment = asRecord(object['payment']);
    const orderId = str(payment?.['order_id']);
    if (!orderId) return null;

    const status = paymentStatus(str(payment?.['status']));
    if (!status) return null;

    return {
      squareOrderId: orderId,
      squarePaymentId: str(payment?.['id']),
      status,
      eventId: event.eventId,
    };
  }

  if (event.type === 'refund.updated' || event.type === 'refund.created') {
    const refund = asRecord(object['refund']);
    const orderId = str(refund?.['order_id']);
    // Only a completed refund changes anything. A PENDING one is a refund that
    // has been asked for and may still fail, and marking the order refunded
    // then would tell staff the money is back when it is not.
    if (!orderId || str(refund?.['status']) !== 'COMPLETED') return null;

    return {
      squareOrderId: orderId,
      squarePaymentId: str(refund?.['payment_id']),
      status: 'refunded',
      eventId: event.eventId,
    };
  }

  return null;
}

/** Square's payment states, narrowed to the ones an order can be in. */
function paymentStatus(value: string | null): OrderStatusUpdate['status'] | null {
  switch (value) {
    // APPROVED is authorised but not captured. Treated as pending rather than
    // paid: the money has not moved, and a book handed over on an authorisation
    // that is later voided is a book given away.
    case 'APPROVED':
    case 'PENDING':
      return 'pending';
    case 'COMPLETED':
      return 'paid';
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
      return 'canceled';
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
