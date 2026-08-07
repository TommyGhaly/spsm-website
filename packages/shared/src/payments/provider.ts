import type { Money, OrderLineItem } from '../schema/commerce.js';

/**
 * The seam between the bookstore and Square.
 *
 * Open Decision #5a is unresolved: Square Checkout Links (redirect, minimal
 * code) vs. the Web Payments SDK (embedded card form, more control). Rather
 * than block the bookstore on that call, both are implementations of this one
 * interface — so the decision costs a file swap, not a rewrite of the cart,
 * order schema, or webhook handler.
 *
 * Deliberately narrow: the app can start a checkout and read back status. It
 * cannot capture, refund, or mutate money. Those stay in the Square Dashboard,
 * where staff already have admin access and a real audit trail (§3.2).
 */
export interface PaymentProvider {
  readonly name: 'square-checkout-link' | 'square-web-payments';

  /**
   * Turn a cart into something the user can pay with.
   *
   * Runs server-side only (Cloud Function) — it needs the Square access token,
   * which must never reach the browser bundle.
   */
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Translate a verified Square webhook into an order-status change.
   *
   * Returns null when the event isn't one we act on, so the caller can ack it
   * and move on rather than treating "not interesting" as "failed".
   */
  interpretWebhook(event: VerifiedWebhookEvent): OrderStatusUpdate | null;
}

export interface CheckoutRequest {
  lineItems: OrderLineItem[];
  /** Null for guest checkout. */
  memberUid: string | null;
  contactEmail: string;
  /**
   * Caller-generated, stable for a given cart submission. Passed straight to
   * Square so a double-tap or a retried Function invocation cannot charge twice.
   */
  idempotencyKey: string;
  /** Where Square sends the user afterward. Checkout Links path only. */
  redirectUrl?: string;
}

/**
 * Discriminated on `kind` so the frontend cannot accidentally treat a hosted
 * redirect as an embeddable payment token.
 */
export type CheckoutResult =
  | {
      kind: 'redirect';
      squareOrderId: string;
      /** Square-hosted payment page. Navigate the user here. */
      url: string;
      total: Money;
    }
  | {
      kind: 'embedded';
      squareOrderId: string;
      /** Handed to the Web Payments SDK to render the card form. */
      paymentToken: string;
      total: Money;
    };

/**
 * A webhook whose signature has *already* been verified against the Square
 * signature key. The type exists to make it structurally awkward to call
 * `interpretWebhook` on unverified input.
 */
export interface VerifiedWebhookEvent {
  readonly verified: true;
  eventId: string;
  type: string;
  payload: unknown;
}

export interface OrderStatusUpdate {
  squareOrderId: string;
  squarePaymentId: string | null;
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'canceled';
  /** For the `appliedEventIds` guard against replayed webhooks. */
  eventId: string;
}

/**
 * Placeholder until Square credentials exist. Fails loudly and specifically
 * rather than producing a confusing 401 from Square, so nobody loses an hour to
 * "why is checkout returning nothing".
 */
export const unconfiguredPaymentProvider: PaymentProvider = {
  name: 'square-checkout-link',
  async createCheckout() {
    throw new Error(
      'No payment provider configured. Set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID ' +
        'in the Functions runtime config, then swap in the real implementation. ' +
        'See docs/api-keys.md.',
    );
  },
  interpretWebhook() {
    return null;
  },
};
