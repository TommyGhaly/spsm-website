'use client';

import { useEffect, useState } from 'react';
import { usableZip, type ShippingOption, type ShippingQuoteResponse } from '@spsm/shared';

/**
 * Live USPS postage for the basket, once there is a ZIP code to price it to.
 *
 * ---------------------------------------------------------------------------
 * What the page shows is what checkout charges, and this is how.
 *
 * Every option comes back with a signed id, and `squareCheckout` charges the
 * cents inside that signature — never a number this page computed. An empty
 * `options` means the server could not quote (an unweighed book, live rates
 * switched off, USPS slow), and the page then shows `fallbackCents` and sends
 * no id, which is the flat charge on both sides.
 *
 * Asked again whenever the ZIP or the basket changes, after a short pause so a
 * ZIP typed digit by digit is one request rather than five. A quote that comes
 * back for a basket or ZIP that has since changed is dropped, not shown.
 * ---------------------------------------------------------------------------
 */

export type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; options: ShippingOption[]; fallbackCents: number }
  | { status: 'error' };

const PAUSE_MS = 400;

export function useShippingQuote({
  enabled,
  cart,
  postalCode,
}: {
  enabled: boolean;
  cart: readonly { slug: string; quantity: number }[];
  postalCode: string;
}): QuoteState & { refresh: () => void } {
  const [state, setState] = useState<QuoteState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const zip = usableZip(postalCode);
  // The basket as a string, so a new array with the same lines is not a change.
  const basket = JSON.stringify(cart.map((line) => [line.slug, line.quantity]));

  useEffect(() => {
    if (!enabled || !zip) {
      setState({ status: 'idle' });
      return;
    }

    setState({ status: 'loading' });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch('/api/shipping/quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              cart: (JSON.parse(basket) as [string, number][]).map(([slug, quantity]) => ({
                slug,
                quantity,
              })),
              postalCode: zip,
            }),
          });
          if (!response.ok) throw new Error(String(response.status));
          const body = (await response.json()) as ShippingQuoteResponse;
          if (typeof body.fallbackCents !== 'number') throw new Error('No flat charge in the quote.');
          setState({
            status: 'ready',
            options: Array.isArray(body.options) ? body.options : [],
            fallbackCents: body.fallbackCents,
          });
        } catch {
          if (!controller.signal.aborted) setState({ status: 'error' });
        }
      })();
    }, PAUSE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, zip, basket, attempt]);

  return { ...state, refresh: () => setAttempt((n) => n + 1) };
}
