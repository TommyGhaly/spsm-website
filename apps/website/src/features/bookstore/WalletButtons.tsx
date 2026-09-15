'use client';

import type { SquareWalletsField, WalletKind } from './useSquareWallets';

/**
 * The Apple Pay and Google Pay buttons, and the rule that they are never drawn.
 *
 * ---------------------------------------------------------------------------
 * Shared markup, unlike the card panels — and that is not an inconsistency.
 *
 * `useSquareCard` deliberately carries no markup, because the three screens
 * that take a card should each look like the page they are on. These two do not
 * get that choice. Apple and Google both publish brand rules covering the
 * button's shape, wording, colour and minimum size, and both reserve the right
 * to withdraw the payment method over them; Apple's button is drawn by Safari
 * itself from `appearance: -apple-pay-button` and Google's is injected by
 * Square. There is nothing here for a designer to decide, so there is no reason
 * for three copies of it.
 *
 * The holder for Google's button is mounted from the first render and stays
 * mounted even while it is empty. `attach()` needs a node already in the
 * document to render into — a holder revealed after the wallet is ready has
 * nothing to attach to, which is the same trap the card iframe's holder has a
 * comment about in every screen that mounts one.
 * ---------------------------------------------------------------------------
 */
export function WalletButtons({
  wallets,
  disabled = false,
  disabledHint,
  onPay,
}: {
  wallets: SquareWalletsField;
  /** The caller's own gate — an unfilled name, a form with a missing answer. */
  disabled?: boolean;
  /** Why it is disabled, in words the payer can act on. */
  disabledHint?: string;
  /**
   * Called from the button's own click handler.
   *
   * The handler this leads to must call `wallets.tokenize(kind)` as its first
   * act: Apple will not open a sheet that is not a direct consequence of the
   * gesture, and an `await` in between spends it silently. See the note on
   * `tokenize`.
   */
  onPay: (kind: WalletKind) => void;
}) {
  const offered = wallets.applePayReady || wallets.googlePayReady;
  const blocked = disabled || wallets.status !== 'ready';

  return (
    <div className="wallets" data-offered={offered ? 'yes' : 'no'}>
      {wallets.applePayReady && (
        <button
          type="button"
          className="wallets__apple"
          disabled={blocked}
          onClick={() => onPay('apple')}
        >
          {/* Safari draws the label itself. The text is for screen readers and
              for the seconds before the button's own styling resolves. */}
          <span className="visually-hidden">Pay with Apple Pay</span>
        </button>
      )}

      {/*
        Always in the document, never conditional — see the note above. Square
        injects Google's button inside it; the click that matters is the one on
        that injected button, which bubbles to this handler.
      */}
      <div
        id={wallets.googleHolderId}
        className="wallets__google"
        hidden={!wallets.googlePayReady}
        onClick={() => {
          if (!blocked) onPay('google');
        }}
      />

      {offered && disabled && disabledHint && <p className="wallets__hint">{disabledHint}</p>}

      {/*
        The divider, and it only exists when there is something above it to
        divide from. On most desktop browsers neither wallet is available and
        this component renders an empty, invisible holder — which is the right
        outcome: the card form below is simply the whole of the payment panel,
        with nothing to explain.
      */}
      {offered && (
        <p className="wallets__or">
          <span>or pay by card</span>
        </p>
      )}
    </div>
  );
}
