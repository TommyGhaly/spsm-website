'use client';

import { useEffect, useRef, useState } from 'react';
import { squarePublicConfig } from './squareConfig';
import {
  squarePayments,
  type SquarePaymentRequestOptions,
  type SquareWallet,
} from './squareSdk';

/**
 * Apple Pay and Google Pay, mounted and tokenized — the sibling of
 * `useSquareCard`, and deliberately not part of it.
 *
 * ---------------------------------------------------------------------------
 * A wallet needs one thing a card field does not: the amount, before anybody
 * has pressed anything.
 *
 * A card form is a set of boxes that mean nothing until they are submitted, so
 * `useSquareCard` can be mounted the moment a payment screen opens and told the
 * total later. A wallet sheet is the opposite — it opens already showing a
 * figure, and that figure is a promise to the payer. Square therefore wants the
 * total at *construction* time, in `paymentRequest`, which is why this is a
 * second hook taking `amountCents` rather than four more return values on the
 * first one. Screens that charge nothing never call it.
 *
 * The practical rule that falls out of this, and it is the one thing to get
 * right when adding a wallet to a new screen: **only mount this with a total
 * that is exactly what the server will charge.** A sheet that says $24.00
 * against a charge of $31.00 is not a rounding difference to the person
 * authorizing it with their thumbprint — it is the parish taking more than it
 * showed.
 *
 * The bookstore is where that bit: `total` there is the books, and the delivery
 * charge was added server-side from `config/bookstore` and never reached the
 * page. The first answer was to withhold the wallets on deliveries, which was
 * honest and read as broken. The right answer was to get the figure to the page
 * — `useLiveCatalog` already fetched that document — so `CardPayment` computes
 * a `charge` and hands *that* over. Withholding a wallet is a workaround for a
 * total you do not have; go and get the total.
 *
 * What is *not* different from the card: the token. Apple Pay, Google Pay and a
 * typed card number all produce a single-use token that goes to the same
 * `source_id` field on the server, and nothing behind `/api/square/checkout`,
 * `/api/forms/submit` or `/api/camp/servant-request` knows which of the three
 * minted it. No endpoint changed to add these buttons.
 * ---------------------------------------------------------------------------
 */
export type WalletKind = 'apple' | 'google';

/**
 * How long a wallet gets to say whether it exists before it is treated as
 * absent. See the note where it is used — this is not a nicety, it is what
 * stops one unanswering wallet disabling the other.
 */
const WALLET_PROBE_MS = 10_000;

export type SquareWalletsStatus = 'loading' | 'ready' | 'working' | 'unavailable';

export interface SquareWalletsField {
  /**
   * True when this browser actually offers the wallet — Safari on an Apple
   * device with a card in Wallet, or a browser signed in to Google Pay. Both
   * are false on most desktops, which is the ordinary case and not a fault.
   */
  applePayReady: boolean;
  googlePayReady: boolean;
  /** True while either wallet is still being asked for. */
  status: SquareWalletsStatus;
  /**
   * The id of the element Google's button is rendered into. Square's
   * `attach()` takes a selector rather than a node, so the id has to be real
   * and unique — two payment panels on one page would otherwise attach two
   * buttons to the first one.
   */
  googleHolderId: string;
  error: string | null;
  /**
   * Open the wallet sheet and return the single-use token, or null.
   *
   * **Call this as the first thing in the button's own click handler.** Apple
   * refuses to open a payment sheet that is not a direct consequence of a
   * gesture, and an `await` before this line spends the gesture: the sheet
   * never appears and nothing says why. A synchronous check — "is the form
   * complete?" — is fine and is what the camp sign-up does.
   *
   * On success the field stays in `working`, for the same reason
   * `useSquareCard` does: re-enabling the button would let a second press mint
   * a second token against a submission already in flight.
   */
  tokenize: (kind: WalletKind) => Promise<string | null>;
  /** Put the buttons back after the caller's own request failed. */
  release: (message?: string | null) => void;
}

export function useSquareWallets({
  amountCents,
  label,
  currency = 'USD',
  country = 'US',
  enabled = true,
}: {
  /** What the sheet will show, and what the server must then charge. */
  amountCents: number;
  /** The single line the payer reads above the figure. */
  label: string;
  currency?: string;
  country?: string;
  /**
   * Set false to tear the wallets down without unmounting the caller.
   *
   * Nothing passes it today. It is kept because the alternative for a screen
   * that needs to stop offering a wallet is unmounting the component the hook
   * lives in, and hooks cannot be called conditionally. Note what it is NOT
   * for: withholding a wallet because the total is unreliable. See the header.
   */
  enabled?: boolean;
}): SquareWalletsField {
  const { applicationId, locationId, sandbox } = squarePublicConfig();

  /*
   * One id per hook instance, minted once and never regenerated.
   *
   * `useId` would be the obvious choice and cannot be used: React renders it as
   * `:r1:`, and a colon is a pseudo-class in a CSS selector, so the
   * `#:r1:` that `attach()` receives throws before Square sees it.
   */
  const [googleHolderId] = useState(
    () => `square-google-pay-${Math.random().toString(36).slice(2, 10)}`,
  );

  const applePay = useRef<SquareWallet | null>(null);
  const googlePay = useRef<SquareWallet | null>(null);
  /*
   * The previous instances' teardown, which the next attach must wait on.
   *
   * `destroy()` is asynchronous and a React cleanup function cannot be. Without
   * this the two overlap whenever `amountCents` changes — the effect re-runs,
   * cleanup fires `destroy()` and returns immediately, and `attach()` is called
   * on a holder the old button has not left yet. Square refuses it, the catch
   * below swallows the refusal because "this browser has no Google Pay" is the
   * ordinary case, and the button silently never comes back.
   *
   * That is not hypothetical: it is what toggling the bookstore's fulfilment
   * from delivery back to collection did, because the charge changes with it.
   * The first load always worked, which is what made it look like a toggle bug
   * rather than a lifecycle one.
   */
  const teardown = useRef<Promise<unknown>>(Promise.resolve());
  const [applePayReady, setApplePayReady] = useState(false);
  const [googlePayReady, setGooglePayReady] = useState(false);
  const [status, setStatus] = useState<SquareWalletsStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !applicationId || !locationId || amountCents <= 0) {
      setStatus('unavailable');
      setApplePayReady(false);
      setGooglePayReady(false);
      return;
    }

    let cancelled = false;
    setStatus('loading');

    /*
     * A fresh request object per wallet, not one shared between them.
     *
     * Square binds a `paymentRequest` to the first payment method that is given
     * it. Passing the same object to `applePay()` and then `googlePay()` gets
     * the second one rejected, on a Mac running Safari — which is to say, on
     * exactly the machine this would be written on and nowhere in CI.
     */
    const options: SquarePaymentRequestOptions = {
      countryCode: country,
      currencyCode: currency,
      // The one conversion from cents in the payment code. See the type.
      total: { amount: (amountCents / 100).toFixed(2), label },
    };

    /*
     * Everything Square ever handed back, so that cleanup can destroy it.
     *
     * A probe that times out is abandoned, not cancelled — Square has no way to
     * withdraw the request, and the instance may still arrive afterwards. Left
     * alone it would be an orphan holding the previous total, so it is parked
     * here and torn down with the rest.
     */
    const arrived: Promise<SquareWallet | null>[] = [];

    /** Resolve to the wallet, or to null if it refuses or does not answer. */
    function probe(request: Promise<SquareWallet>): Promise<SquareWallet | null> {
      const settled = request.catch(() => null);
      arrived.push(settled);
      return Promise.race([
        settled,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), WALLET_PROBE_MS)),
      ]);
    }

    async function start() {
      try {
        // Before anything else. React runs the previous effect's cleanup before
        // this body, so by now `teardown` holds that run's `destroy()` calls.
        await teardown.current;
        // The same instance the card field uses. Two `payments()` calls on one
        // page is what Square's init timeout looks like — see `squarePayments`.
        const payments = await squarePayments(applicationId, locationId, sandbox);
        if (cancelled) return;

        /*
         * Both wallets are asked at once, and each is bounded by a clock.
         *
         * Neither half of that is belt-and-braces. **In parallel**, because a
         * browser typically has one wallet and not the other, and asking in
         * sequence makes the second one wait out the first one's refusal for no
         * reason. **Bounded**, because `googlePay()` does not always settle: on
         * this project's Square *sandbox* credentials it hangs indefinitely —
         * it neither resolves nor rejects — which in a sequential `await` left
         * `status` at 'loading' for the life of the panel, so the Apple Pay
         * button that had already resolved stayed disabled and the card form
         * was the only thing anybody could use. A wallet that has not answered
         * in ten seconds is not one this checkout can wait on.
         *
         * A rejection either way is silent on purpose. `applePay()` rejects on
         * every browser that is not Safari and on a Safari with no card in
         * Wallet; `googlePay()` rejects where Google Pay is unavailable. That is
         * the ordinary state of most visitors' desktop browsers, not an error
         * anyone should be shown — the card form below is the answer and it is
         * already on screen.
         */
        const [apple, google] = await Promise.all([
          probe(payments.applePay(payments.paymentRequest(options))),
          probe(payments.googlePay(payments.paymentRequest(options))),
        ]);
        if (cancelled) return;

        if (apple) {
          applePay.current = apple;
          setApplePayReady(true);
        }

        if (google) {
          try {
            // Square renders Google's own button into this element. It has to
            // already be in the document — `WalletButtons` keeps the holder
            // mounted from the first render for exactly this reason.
            await google.attach?.(`#${googleHolderId}`, {
              buttonColor: 'black',
              buttonType: 'long',
              buttonSizeMode: 'fill',
            });
            if (!cancelled) {
              googlePay.current = google;
              setGooglePayReady(true);
            }
          } catch {
            // The button would not render. The card form is the answer.
          }
        }

        if (!cancelled) setStatus('ready');
      } catch (cause) {
        if (cancelled) return;
        setStatus('unavailable');
        // Reaching here means the SDK itself did not load or `payments()` threw,
        // which is the application id/environment pairing nine times in ten —
        // the same fault `useSquareCard` reports, and it will report it too.
        setError(cause instanceof Error ? cause.message : 'The wallets could not be loaded.');
      }
    }

    void start();

    return () => {
      cancelled = true;
      // Destroy rather than leave them: the total is baked into each instance,
      // so a stale one would open a sheet showing the previous figure. What the
      // next run waits on is the promise, not the call — see `teardown`.
      teardown.current = Promise.all(
        arrived.map((pending) => pending.then((wallet) => wallet?.destroy?.())),
      ).catch(() => undefined);
      applePay.current = null;
      googlePay.current = null;
      setApplePayReady(false);
      setGooglePayReady(false);
    };
  }, [
    applicationId,
    locationId,
    sandbox,
    amountCents,
    label,
    currency,
    country,
    enabled,
    googleHolderId,
  ]);

  async function tokenize(kind: WalletKind): Promise<string | null> {
    const wallet = kind === 'apple' ? applePay.current : googlePay.current;
    if (!wallet) return null;

    setError(null);
    setStatus('working');

    try {
      const result = await wallet.tokenize();
      if (result.status !== 'OK' || !result.token) {
        setStatus('ready');
        /*
         * A dismissed sheet is not a failure and must not be dressed as one.
         * Square reports it as `CANCEL`, and someone who changed their mind
         * does not need a red box telling them their payment did not complete.
         */
        if (result.status !== 'CANCEL') {
          setError(result.errors?.[0]?.message ?? 'The payment was not completed.');
        }
        return null;
      }
      return result.token;
    } catch {
      setStatus('ready');
      setError('The wallet could not be opened. You can pay by card instead.');
      return null;
    }
  }

  function release(message?: string | null) {
    setStatus('ready');
    if (message !== undefined) setError(message);
  }

  return {
    applePayReady,
    googlePayReady,
    status,
    googleHolderId,
    error,
    tokenize,
    release,
  };
}
