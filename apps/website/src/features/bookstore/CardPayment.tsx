'use client';

import { useEffect, useRef, useState } from 'react';
import { looksLikeEmail } from '@spsm/shared';
import { money } from './Shop';

/**
 * The card form, and the request that charges it.
 *
 * ---------------------------------------------------------------------------
 * Card numbers never enter this component, this bundle, or the parish's
 * servers.
 *
 * `card.attach()` renders an iframe served by Square into the div below. The
 * fields inside it belong to Square's origin, so nothing here — including any
 * script that later ends up on this page — can read what is typed. `tokenize()`
 * returns a single-use token, and that token is the only thing that leaves.
 *
 * That is also what keeps PCI scope off the parish: the site never handles a
 * PAN, so it never has to be audited for one.
 * ---------------------------------------------------------------------------
 *
 * The SDK is loaded from Square's CDN at interaction time rather than in the
 * page's head. Almost nobody who opens the bookstore reaches checkout, and a
 * third-party payments bundle on every product view is a cost paid by everyone
 * for the few.
 */
type Status = 'loading' | 'ready' | 'paying' | 'done' | 'unavailable';

interface CartLine {
  slug: string;
  quantity: number;
}

/** The slice of Square's card instance this component uses. */
interface SquareCard {
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

export function CardPayment({
  cart,
  total,
  applicationId,
  locationId,
  sandbox,
  onPaid,
}: {
  cart: CartLine[];
  total: number;
  applicationId: string;
  locationId: string;
  sandbox: boolean;
  onPaid: (orderId: string) => void;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [shipping, setShipping] = useState(false);
  const [address, setAddress] = useState({ line1: '', line2: '', city: '', state: '', postalCode: '' });

  const holder = useRef<HTMLDivElement>(null);
  const card = useRef<SquareCard | null>(null);

  /*
   * A key regenerated per mount, not per click.
   *
   * Square treats a repeated idempotency key as the *same* payment and returns
   * the original rather than charging again — which is exactly what should
   * happen when someone double-taps, or when the network drops after the charge
   * but before the response. Regenerating it on every click would turn a
   * double-tap into two charges.
   */
  const idempotencyKey = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `k${Date.now()}${Math.random().toString(36).slice(2)}`,
  );

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
        // The usual cause is an application id belonging to the other
        // environment — a sandbox id against production, or the reverse — and
        // the SDK's own message is more specific than anything invented here.
        setError(cause instanceof Error ? cause.message : 'The card form could not be loaded.');
      }
    }

    void start();
    return () => {
      cancelled = true;
      void card.current?.destroy?.();
    };
  }, [applicationId, locationId, sandbox]);

  const shippingIncomplete =
    shipping && !(address.line1.trim() && address.city.trim() && address.state.trim() && address.postalCode.trim());
  const blocked = status !== 'ready' || !looksLikeEmail(email) || shippingIncomplete;

  async function pay() {
    if (!card.current) return;
    setError(null);
    setStatus('paying');

    try {
      const result = await card.current.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setStatus('ready');
        setError(result.errors?.[0]?.message ?? 'Please check the card details.');
        return;
      }

      const response = await fetch('/api/square/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: result.token,
          cart,
          email: email.trim(),
          fulfillment: shipping ? 'ship' : 'pickup',
          address: shipping ? address : undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const body: { orderId?: string; error?: string } = await response.json().catch(() => ({}));

      if (!response.ok || !body.orderId) {
        setStatus('ready');
        setError(body.error ?? 'The payment could not be completed.');
        return;
      }

      setStatus('done');
      onPaid(body.orderId);
    } catch {
      setStatus('ready');
      // Deliberately says nothing about whether the charge went through,
      // because at this point we do not know — the request may have succeeded
      // and the response been lost. The idempotency key is what makes trying
      // again safe, and it is the same key.
      setError('The connection dropped. Check your email for a receipt before trying again.');
    }
  }

  if (status === 'unavailable') {
    return (
      <p className="note checkout__note">
        {error} The books are all available in the bookstore after Liturgy, and the office
        can hold any of them for you.
      </p>
    );
  }

  if (status === 'done') return null;

  return (
    <div className="pay">
      <label className="pay__field">
        <span>Email, for the receipt</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />
      </label>

      <fieldset className="pay__how">
        <legend>How would you like these?</legend>
        <label>
          <input type="radio" checked={!shipping} onChange={() => setShipping(false)} />
          Collect at the church
        </label>
        <label>
          <input type="radio" checked={shipping} onChange={() => setShipping(true)} />
          Post to me
        </label>
      </fieldset>

      {shipping && (
        <div className="pay__address">
          {(
            [
              ['line1', 'Address', 'address-line1'],
              ['line2', 'Address line 2 (optional)', 'address-line2'],
              ['city', 'Town or city', 'address-level2'],
              ['state', 'State', 'address-level1'],
              ['postalCode', 'ZIP code', 'postal-code'],
            ] as const
          ).map(([key, label, auto]) => (
            <label key={key} className="pay__field">
              <span>{label}</span>
              <input
                value={address[key]}
                autoComplete={auto}
                onChange={(event) => setAddress((a) => ({ ...a, [key]: event.target.value }))}
              />
            </label>
          ))}
          <p className="note">Postage is added at checkout.</p>
        </div>
      )}

      <div className="pay__field">
        <span>Card</span>
        {/* Square's iframe mounts here. Nothing inside is readable by this page. */}
        <div ref={holder} className="pay__card" />
        {status === 'loading' && <p className="note">Loading the secure card form…</p>}
      </div>

      {error && (
        <p className="note pay__error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="button button--full" disabled={blocked} onClick={pay}>
        {status === 'paying' ? 'Taking payment…' : `Pay ${money(total)}`}
      </button>

      {sandbox && (
        <p className="note pay__sandbox">
          Test mode — no real money moves. Use card <code>4111 1111 1111 1111</code>, any
          future expiry, any CVV.
        </p>
      )}
    </div>
  );
}

/** Load Square's SDK once, and only when someone actually reaches checkout. */
function loadSquareSdk(sandbox: boolean): Promise<void> {
  const src = sandbox
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';

  if (window.Square) return Promise.resolve();

  return new Promise((resolve, reject) => {
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
