'use client';

import { useEffect, useRef, useState } from 'react';
import { squarePublicConfig } from './squareConfig';
import { loadSquareSdk, type SquareCard } from './squareSdk';

/**
 * A Square card field, mounted and tokenized — the dance, without the panel.
 *
 * ---------------------------------------------------------------------------
 * Three screens now take a card, and the third is what made this a hook.
 *
 * The bookstore's `CardPayment` was first; `FormPaymentStep` copied its middle
 * forty lines when a parish form needed to charge; and the camp's servant
 * sign-up would have been the third copy of the same `useEffect` — load the
 * SDK, `payments()`, `card()`, `attach()`, destroy on unmount, and the four
 * states in between. The copies had already begun to drift.
 *
 * What is deliberately *not* here is any markup. The three screens do not look
 * alike and should not: the shop's is a checkout panel, the form's is a step
 * with a way back to the answers, and the camp's is the last band of a public
 * form written for a sixteen-year-old on a phone. Sharing the plumbing and not
 * the panel is what lets each one read like the page it is on.
 *
 * Card details never reach this origin either way. `attach()` renders an iframe
 * served by Square, the fields inside belong to Square, and the single-use
 * token this returns is the only thing that leaves the browser.
 * ---------------------------------------------------------------------------
 */
export type SquareCardStatus = 'loading' | 'ready' | 'working' | 'unavailable';

export interface SquareCardField {
  /** Attach this to the element the card iframe should render into. */
  holder: React.RefObject<HTMLDivElement | null>;
  status: SquareCardStatus;
  /** Whatever went wrong last, in words a payer can read. */
  error: string | null;
  setError: (message: string | null) => void;
  /**
   * The single-use token, or null when the card would not tokenize.
   *
   * On success the field stays in `working` rather than returning to `ready`.
   * That is not an oversight: re-enabling the button would let a second tap
   * mint a second token against a submission that is already in flight. The
   * caller owns what happens next, and calls `release()` if it wants the field
   * back — after a rejection by its own server, say.
   */
  tokenize: () => Promise<string | null>;
  /** Put the field back in `ready` after the caller's own request failed. */
  release: (message?: string | null) => void;
  /** True when the sandbox SDK is loaded — worth saying out loud on screen. */
  sandbox: boolean;
  configured: boolean;
}

export function useSquareCard(): SquareCardField {
  const { applicationId, locationId, sandbox } = squarePublicConfig();
  const holder = useRef<HTMLDivElement>(null);
  const card = useRef<SquareCard | null>(null);
  const [status, setStatus] = useState<SquareCardStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId || !locationId) {
      setStatus('unavailable');
      setError('Card payments are not configured for this site yet.');
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        await loadSquareSdk(sandbox);
        if (cancelled || !window.Square || !holder.current) return;

        const payments = window.Square.payments(applicationId, locationId);
        const instance = await payments.card();
        if (cancelled) return;
        await instance.attach(holder.current);
        card.current = instance;
        setStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setStatus('unavailable');
        // Usually an application id from the other environment. Square's own
        // message names the application id, which is more specific than
        // anything invented here — even though the real fault is the pairing.
        setError(cause instanceof Error ? cause.message : 'The card form could not be loaded.');
      }
    }

    void start();
    return () => {
      cancelled = true;
      void card.current?.destroy?.();
    };
  }, [applicationId, locationId, sandbox]);

  async function tokenize(): Promise<string | null> {
    if (!card.current) return null;
    setError(null);
    setStatus('working');

    try {
      const result = await card.current.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setStatus('ready');
        setError(result.errors?.[0]?.message ?? 'Please check the card details.');
        return null;
      }
      return result.token;
    } catch {
      setStatus('ready');
      setError('The card could not be read. Please try again.');
      return null;
    }
  }

  function release(message?: string | null) {
    setStatus('ready');
    if (message !== undefined) setError(message);
  }

  return {
    holder,
    status,
    error,
    setError,
    tokenize,
    release,
    sandbox,
    configured: Boolean(applicationId && locationId),
  };
}
