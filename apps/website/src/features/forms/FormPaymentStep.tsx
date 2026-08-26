'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormDefinition } from '@spsm/shared';
import { money } from '@/features/bookstore/money';
import { squarePublicConfig } from '@/features/bookstore/squareConfig';
import { loadSquareSdk, type SquareCard } from '@/features/bookstore/squareSdk';

/**
 * The card step of a paid form.
 *
 * ---------------------------------------------------------------------------
 * This component tokenizes. It does not charge.
 *
 * The bookstore's `CardPayment` does both — tokenize, then post the basket to
 * `/api/square/checkout` — and copying that shape here would have put a second
 * submission request in a second file, with its own idea of what a successful
 * response looks like. Instead this hands a single-use token back to
 * `FormRenderer`, which already owns the one request that sends the answers.
 *
 * The practical consequence is that the answers and the payment travel together
 * in one request. They have to: a form that charged and then failed to save the
 * submission would have taken someone's money for a registration the parish has
 * no record of. One request, one Function, one place that decides both.
 * ---------------------------------------------------------------------------
 *
 * Card details never reach this origin. `card.attach()` renders an iframe served
 * by Square, the fields inside belong to Square, and `tokenize()` returns the
 * only thing that leaves.
 */

type Status = 'loading' | 'ready' | 'working' | 'unavailable';

export function FormPaymentStep({
  form,
  totalCents,
  onBack,
  onToken,
}: {
  form: FormDefinition;
  totalCents: number;
  onBack: () => void;
  onToken: (cardToken: string, verificationToken: string | null) => void;
}) {
  const { applicationId, locationId, sandbox } = squarePublicConfig();
  const holder = useRef<HTMLDivElement>(null);
  const card = useRef<SquareCard | null>(null);
  const [status, setStatus] = useState<Status>('loading');
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

  async function pay() {
    if (!card.current) return;
    setError(null);
    setStatus('working');

    try {
      const result = await card.current.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setStatus('ready');
        setError(result.errors?.[0]?.message ?? 'Please check the card details.');
        return;
      }
      // Handing off. The parent takes it from here and this component stays
      // disabled — re-enabling it would let a second tap mint a second token
      // against a submission that is already in flight.
      onToken(result.token, null);
    } catch {
      setStatus('ready');
      setError('The card could not be read. Please try again.');
    }
  }

  return (
    <div className="form fx fx__pay">
      <button type="button" className="button button--quiet fx__back" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to the form
      </button>

      <h2>Payment</h2>
      <p className="fx__total">
        <span>{form.payment.label || form.title}</span>
        <strong>{money(totalCents)}</strong>
      </p>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/*
        The iframe's host. Kept mounted even while `status` is 'loading',
        because `attach()` needs a node in the document to render into — a
        holder swapped in after the SDK is ready has nothing to attach to.
      */}
      <div className="pay__card" ref={holder} />

      <button
        className="button"
        type="button"
        onClick={() => void pay()}
        disabled={status !== 'ready'}
      >
        {status === 'working' ? 'Submitting…' : `Pay ${money(totalCents)} and submit`}
      </button>

      <p className="meta">
        Your answers are sent with the payment, in one step. If the card is declined,
        nothing is submitted and nothing is charged.
      </p>

      {sandbox && (
        <p className="pay__sandbox">
          <strong>Test mode</strong> — no real money moves. Card{' '}
          <code>4111 1111 1111 1111</code>, any future expiry, any CVV.
        </p>
      )}
    </div>
  );
}
