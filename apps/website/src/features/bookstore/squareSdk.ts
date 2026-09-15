'use client';

/**
 * Square's Web Payments SDK: the loader and the slice of its shape we use.
 *
 * Lifted out of `CardPayment` when the forms feature needed to take a payment
 * too. Two components now render a Square card field — the bookstore's
 * checkout and a paid parish form — and a second copy of this would be a second
 * place to get the sandbox/production host pairing wrong, which is exactly the
 * mistake that costs an hour and reads like a bad application id.
 *
 * Nothing here is bookstore-specific; it stays in this folder because that is
 * where the rest of the Square plumbing lives.
 */

/** What every tokenizing method here resolves to — card and wallet alike. */
export interface SquareTokenResult {
  status: string;
  token?: string;
  errors?: { message: string }[];
}

/** The slice of Square's card instance our components use. */
export interface SquareCard {
  attach: (target: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
  destroy?: () => Promise<void>;
}

/**
 * Apple Pay and Google Pay, which are the same object to us and not to Square.
 *
 * Google Pay draws its own button and therefore has `attach`; Apple Pay does
 * not, because Apple requires the button to be a real element on this page
 * styled with `-apple-pay-button` — Square has nothing to render. That is the
 * whole of the difference, so `attach` is optional and the rest is shared.
 *
 * `tokenize()` on either opens the wallet sheet and resolves when the payer has
 * authorized or dismissed it. The token it returns goes to exactly the same
 * `source_id` on the server as a card token does: nothing behind
 * `/api/square/checkout` knows or cares which of the three minted it.
 */
export interface SquareWallet {
  attach?: (selector: string, options?: SquareWalletButtonOptions) => Promise<void>;
  tokenize: () => Promise<SquareTokenResult>;
  destroy?: () => Promise<boolean>;
}

/** Google's own button vocabulary, passed straight through by Square. */
export interface SquareWalletButtonOptions {
  buttonColor?: 'default' | 'black' | 'white';
  buttonType?: 'long' | 'short' | 'buy' | 'plain';
  buttonSizeMode?: 'static' | 'fill';
}

/**
 * What the wallet sheet shows the payer, which must be what we then charge.
 *
 * `amount` is a decimal string of major units — '12.34', not 1234 — and this is
 * the one place in the payment code where cents are not the unit. Everything on
 * our side of the line counts in cents, so the conversion happens once, in
 * `useSquareWallets`, and nowhere else.
 */
export interface SquarePaymentRequestOptions {
  countryCode: string;
  currencyCode: string;
  total: { amount: string; label: string };
}

/** Opaque to us: built by `paymentRequest`, handed straight back to Square. */
export type SquarePaymentRequest = object;

export interface SquarePayments {
  card: () => Promise<SquareCard>;
  paymentRequest: (options: SquarePaymentRequestOptions) => SquarePaymentRequest;
  applePay: (request: SquarePaymentRequest) => Promise<SquareWallet>;
  googlePay: (request: SquarePaymentRequest) => Promise<SquareWallet>;
}

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments;
    };
  }
}

/**
 * Load Square's SDK once, and only when someone actually reaches a payment.
 *
 * Not in the page head: almost nobody who opens the shop reaches checkout, and
 * far fewer still open a form that charges. A third-party payments bundle on
 * every page view is a cost everyone pays for the few.
 *
 * The two hosts are not interchangeable. A sandbox application id against the
 * production script fails inside `payments()` with a message about the
 * application id, which reads like a wrong id rather than a wrong environment.
 */
/**
 * The one `Square.payments()` instance this page is allowed to have.
 *
 * ---------------------------------------------------------------------------
 * Square documents `payments()` as a per-page call, and for one release this
 * code called it twice — once in `useSquareCard` for the card iframe and once
 * in `useSquareWallets` for Apple Pay and Google Pay. It worked, until it did
 * not: both calls then failed together with *"Web Payments SDK was unable to be
 * initialized in time"*, twice in the console, once per instance. That message
 * names a timeout and nothing else, so it reads as a slow network rather than
 * as two initializations of the same SDK racing each other.
 *
 * Caching it is also the honest shape of the thing. `payments` is a factory —
 * `card()`, `applePay()`, `googlePay()` are all made from it — not a handle on
 * one payment, so there is nothing per-screen about it and no state to leak
 * between a checkout and the next one.
 *
 * Keyed on the credentials rather than stored bare: a sandbox instance handed
 * to a production application id fails inside Square with a message about the
 * application id, which is the single most expensive wrong-diagnosis available
 * in this file. The key makes that unreachable instead of unlikely.
 * ---------------------------------------------------------------------------
 */
let cachedPayments: { key: string; payments: Promise<SquarePayments> } | null = null;

export function squarePayments(
  applicationId: string,
  locationId: string,
  sandbox: boolean,
): Promise<SquarePayments> {
  const key = `${sandbox ? 'sandbox' : 'production'}|${applicationId}|${locationId}`;
  if (cachedPayments?.key === key) return cachedPayments.payments;

  /*
   * The *promise* is cached, and it is cached before the first `await` — which
   * is why this function is not `async`.
   *
   * An async version that awaited `loadSquareSdk` and then filled the cache
   * looked right and was not. `useSquareCard` and `useSquareWallets` mount in
   * the same commit and call this in the same tick, so both got past the cache
   * check while the script was still loading and both built an instance. The
   * console said so: the init error appeared exactly twice, once per instance,
   * which is the whole tell and is easy to read as one error logged twice.
   */
  const payments = loadSquareSdk(sandbox).then(() => {
    if (!window.Square) throw new Error('Square SDK failed to load.');
    return window.Square.payments(applicationId, locationId);
  });
  cachedPayments = { key, payments };

  /*
   * A failure is not cached. Square's SDK already remembers its own failed
   * bootstrap and rejects instantly forever after, which is bad enough; a
   * second layer of that here would mean a reader who opened the checkout
   * during a blip could never get a card form again without a reload.
   */
  void payments.catch(() => {
    if (cachedPayments?.payments === payments) cachedPayments = null;
  });

  return payments;
}

export function loadSquareSdk(sandbox: boolean): Promise<void> {
  const src = sandbox
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';

  if (window.Square) return Promise.resolve();

  return new Promise((resolve, reject) => {
    // A second component mounting while the first is still loading must wait on
    // the same tag rather than append another — two scripts racing to define
    // `window.Square` is a state neither of them handles.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Square SDK failed to load.')));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Square SDK failed to load.'));
    document.head.appendChild(script);
  });
}
