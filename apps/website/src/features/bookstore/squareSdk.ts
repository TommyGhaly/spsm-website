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

/** The slice of Square's card instance our components use. */
export interface SquareCard {
  attach: (target: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: { message: string }[] }>;
  destroy?: () => Promise<void>;
}

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => { card: () => Promise<SquareCard> };
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
