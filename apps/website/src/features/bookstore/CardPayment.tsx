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
  /**
   * The order id, plus the two answers the confirmation screen needs to tell
   * someone what actually happens next. Both live in this component's state and
   * are gone by the time the basket re-renders.
   */
  onPaid: (orderId: string, detail: { email: string; shipping: boolean }) => void;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  /*
   * The buyer's name, and why it is asked for rather than inferred.
   *
   * A collection order is handed to a person across a table, and "an order for
   * b.something@gmail" is not something a volunteer can call out or file a
   * paper bag under. Square captures a cardholder name, but that is the name on
   * the card — a spouse's, a parent's, sometimes a business's — and it is not
   * returned to us in a form we can rely on. So it is asked once, plainly, and
   * it is the name the order is put aside under.
   */
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
  const named = firstName.trim().length > 0 && lastName.trim().length > 0;
  const blocked = status !== 'ready' || !looksLikeEmail(email) || !named || shippingIncomplete;

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
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          fulfillment: shipping ? 'ship' : 'pickup',
          address: shipping ? address : undefined,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      /*
       * Read the body as text first, then try it as JSON.
       *
       * `response.json().catch(() => ({}))` threw away the one fact worth
       * having. The checkout endpoint is a Cloud Function reached through a
       * Firebase Hosting rewrite, so on any origin without that rewrite — a
       * bare `next dev`, a preview channel serving only the static export — the
       * request lands on a 404 *HTML* page. That parsed to `{}`, and the reader
       * was told "the payment could not be completed", which is what a refused
       * card says. The two failures are nothing alike and one of them is not
       * about their card at all.
       */
      const raw = await response.text();
      let body: { orderId?: string; error?: string } = {};
      let wasJson = false;
      try {
        body = JSON.parse(raw) as { orderId?: string; error?: string };
        wasJson = true;
      } catch {
        // Left as `{}`; `wasJson` is what the message below turns on.
      }

      if (!response.ok || !body.orderId) {
        setStatus('ready');

        if (!wasJson) {
          // Worth a line in the console: whoever sees this is a developer on an
          // origin where the rewrite is missing, not a parishioner.
          console.error(
            `[checkout] ${response.status} from /api/square/checkout, and the body was not JSON. ` +
              'That endpoint is a Cloud Function behind a Firebase Hosting rewrite — it does not ' +
              'exist on the Next dev server. Serve the site through the hosting emulator to test paying.',
          );
        }

        setError(
          body.error ??
            (wasJson
              ? 'The payment could not be completed. Your card has not been charged.'
              : 'Checkout is not reachable from this address, so no payment was taken. ' +
                'The books can be bought at the bookstore after Liturgy.'),
        );
        return;
      }

      setStatus('done');
      onPaid(body.orderId, { email: email.trim(), shipping });
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
      {/*
        Numbered steps rather than a stack of fields.

        This was an email box, two radio buttons, a card frame and a button in a
        column, which reads as a form to be filled rather than a purchase being
        made — and gave no sense of how much was left. Three numbered steps say
        what is being asked and how far along you are, which is what every
        checkout worth using does.
      */}
      <ol className="pay__steps">
        <li className="pay__step">
          <span className="pay__num" aria-hidden="true">
            1
          </span>
          <div className="pay__body">
            <label className="pay__label" htmlFor="pay-first">
              Who is this order for?
            </label>
            {/* Two fields rather than one "full name", because the bookstore
                files collection orders by surname and splitting a single string
                on a space gets Coptic and hyphenated names wrong. */}
            <div className="pay__name">
              <input
                id="pay-first"
                value={firstName}
                autoComplete="given-name"
                onChange={(event) => setFirstName(event.target.value)}
                placeholder="First name"
                aria-label="First name"
              />
              <input
                id="pay-last"
                value={lastName}
                autoComplete="family-name"
                onChange={(event) => setLastName(event.target.value)}
                placeholder="Last name"
                aria-label="Last name"
              />
            </div>

            <label className="pay__label pay__label--stacked" htmlFor="pay-email">
              Where should the receipt go?
            </label>
            <input
              id="pay-email"
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
        </li>

        <li className="pay__step">
          <span className="pay__num" aria-hidden="true">
            2
          </span>
          <div className="pay__body">
            <span className="pay__label">How would you like these?</span>

            {/*
              Two pressable panels, not radios. The choice changes what the
              order costs and where it goes, which is too consequential for a
              5mm circle — and a panel can carry the consequence as a second
              line, which a radio label cannot.
            */}
            <div className="choice">
              <button
                type="button"
                className={!shipping ? 'choice__opt is-on' : 'choice__opt'}
                onClick={() => setShipping(false)}
                aria-pressed={!shipping}
              >
                <span className="choice__name">Collect at the church</span>
                <span className="choice__note">Ready after Liturgy. No delivery charge.</span>
              </button>

              <button
                type="button"
                className={shipping ? 'choice__opt is-on' : 'choice__opt'}
                onClick={() => setShipping(true)}
                aria-pressed={shipping}
              >
                <span className="choice__name">Deliver to me</span>
                <span className="choice__note">Flat delivery charge, added at checkout.</span>
              </button>
            </div>

            {shipping && (
              <div className="pay__address">
                {(
                  [
                    ['line1', 'Address', 'address-line1', 'full'],
                    ['line2', 'Address line 2 (optional)', 'address-line2', 'full'],
                    ['city', 'Town or city', 'address-level2', 'full'],
                    ['state', 'State', 'address-level1', 'half'],
                    ['postalCode', 'ZIP code', 'postal-code', 'half'],
                  ] as const
                ).map(([key, label, auto, span]) => (
                  <label key={key} className={`pay__field pay__field--${span}`}>
                    <span>{label}</span>
                    <input
                      value={address[key]}
                      autoComplete={auto}
                      onChange={(event) => setAddress((a) => ({ ...a, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </li>

        <li className="pay__step">
          <span className="pay__num" aria-hidden="true">
            3
          </span>
          <div className="pay__body">
            <span className="pay__label">Card details</span>
            {/* Square's iframe mounts here. Nothing inside is readable by this
                page, which is what keeps card numbers out of this codebase. */}
            <div ref={holder} className="pay__card" />
            {status === 'loading' && <p className="pay__hint">Loading the secure card form…</p>}
            <p className="pay__hint pay__hint--secure">
              Card details go straight to Square. They never reach the parish.
            </p>
          </div>
        </li>
      </ol>

      {error && (
        <p className="pay__error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="pay__submit" disabled={blocked} onClick={pay}>
        {status === 'paying' ? 'Taking payment…' : `Pay ${money(total)}`}
      </button>

      {sandbox && (
        <p className="pay__sandbox">
          <strong>Test mode</strong> — no real money moves. Card{' '}
          <code>4111 1111 1111 1111</code>, any future expiry, any CVV.
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
