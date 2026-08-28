'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GIVE_ORIGIN, giveFormUrl, givingUrl } from './config';

/**
 * The give action: Tithe.ly's own hosted form, opened in an overlay on this page.
 *
 * ---------------------------------------------------------------------------
 * Tommy: *"if there is a way to donate to tithely natively without opening an
 * outside website lets do that."* This is that — with one thing about it that
 * has to be written down, because it is a deliberate override of the vendor.
 *
 * **Tithe.ly publishes an embed script and we do not use it.** `give.js` looks
 * like the answer, and its second statement is this:
 *
 *     if (window.innerWidth < 768 || k.name === 'safari' || k.name === 'chrome')
 *       return window.open(s, '_blank');
 *
 * Their own "modal" refuses to be a modal on Chrome, on Safari, or on any phone
 * — which is nearly every visitor this parish has. Dropped in as documented it
 * would have opened a new tab for almost everyone and quietly not done the thing
 * that was asked for.
 *
 * So the iframe is ours. `?context=modal` is Tithe.ly's own framed mode — it is
 * what their script requests, and the framed page posts `closeWindow` back to
 * its parent, which is handled below. `give.tithe.ly` sends no
 * `X-Frame-Options` and no `frame-ancestors`, and the form renders and behaves
 * in the frame; that was checked on Chrome before this was written.
 *
 * **The risk, stated plainly.** Nobody outside Tithe.ly knows why that gate is
 * there. The most likely reason is wallets: Apple Pay and Google Pay refuse to
 * run in a cross-origin frame unless the embedder delegates permission, which is
 * what `allow="payment"` below does. But a card entered here goes through a path
 * their own script avoids, and a payment that fails in a frame fails silently
 * from our side — we never see it. Two things follow, and neither is optional:
 *
 *   1. The overlay always offers "Open in a new tab instead", so a visitor who
 *      hits trouble is one click from the path Tithe.ly prefers.
 *   2. A real gift needs to be completed through this overlay, on Safari and on
 *      Chrome, before the cutover. Not a test-mode gift — this form is the
 *      parish's live one.
 *
 * The card number is still never ours. It is typed into `give.tithe.ly`, in a
 * document on Tithe.ly's origin that this one cannot read across, and Tithe.ly
 * still processes, receipts, and schedules it. Nothing about decisions.md #2
 * changes: this is where their page is rendered, not who takes the payment.
 * ---------------------------------------------------------------------------
 *
 * The trigger stays an `<a>` with a real `href` rather than becoming a
 * `<button>`. The site is a static export, so that href is in the HTML on disk:
 * with JavaScript off, or before hydration, the link still reaches the identical
 * form. The overlay is an upgrade over a working link, never a replacement.
 */
export function GiveButton({
  children = 'Give',
  className = 'button',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const close = useCallback(() => {
    dialog.current?.close();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    /*
     * `showModal` rather than rendering a fixed div: it puts the overlay in the
     * top layer — above the sticky masthead and anything else this stylesheet
     * stacks, without a z-index — traps focus, and makes the rest of the page
     * inert for a screen reader. None of that is worth reimplementing.
     */
    const element = dialog.current;
    element?.showModal();

    /*
     * Escape, via a native listener rather than React's `onCancel`.
     *
     * `cancel` does not bubble, so it reaches a delegating framework only
     * through whatever special case that framework has written for it — React
     * 19 has one, React 18 did not, and this is not a behaviour to make
     * contingent on that. `preventDefault` so the browser's own close cannot
     * run: `close()` here is the single path out, and the alternative is a
     * dialog the DOM considers shut while React still renders it.
     */
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    element?.addEventListener('cancel', onCancel);

    /*
     * Tithe.ly's framed page posts `closeWindow` when the gift is finished or
     * the visitor backs out of it. Origin-checked: a `message` handler that
     * trusts any sender is a hole, and this is what lets the overlay close
     * itself on a completed gift — the one close a visitor should not have to
     * ask for.
     */
    const onMessage = (event: MessageEvent) => {
      if (event.origin === GIVE_ORIGIN && event.data === 'closeWindow') close();
    };
    window.addEventListener('message', onMessage);

    /*
     * `showModal` stops the *dialog* scrolling the page but not the page itself,
     * and the band behind this one is a photograph — scrolling it under an open
     * form looks like the overlay came loose.
     */
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    return () => {
      element?.removeEventListener('cancel', onCancel);
      window.removeEventListener('message', onMessage);
      document.documentElement.style.overflow = previous;
    };
  }, [open, close]);

  const fallback = givingUrl();

  return (
    <>
      <a
        className={className}
        href={fallback}
        rel="noopener noreferrer"
        /*
         * No `target="_blank"`: with scripting on this opens in place, and
         * announcing "opens in a new window" for something that does not is a
         * lie told specifically to the people relying on the announcement. The
         * no-script case loses the new tab and keeps a working link, which is
         * the right way round.
         */
        onClick={(event) => {
          // ⌘-click, middle-click, "open in new tab" — someone who asked for a
          // tab gets one, and gets the real URL because the href is real.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

          event.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>

      {open && (
        <dialog
          className="give-modal"
          ref={dialog}
          aria-label="Give to the church"
          /* A click on the backdrop targets the dialog element itself; a click
             anywhere inside targets a descendant. Escape is handled by a native
             `cancel` listener in the effect above, not here — see the note. */
          onClick={(event) => {
            if (event.target === dialog.current) close();
          }}
        >
          <div className="give-modal__head">
            <a
              className="give-modal__escape"
              href={fallback}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in a new tab instead
            </a>
            <button className="give-modal__close" type="button" onClick={close}>
              Close
            </button>
          </div>

          <iframe
            className="give-modal__frame"
            title="Tithe.ly giving form"
            src={giveFormUrl()}
            /*
             * Delegates the Payment Request API to `give.tithe.ly`, which is
             * what makes Apple Pay and Google Pay possible inside the frame.
             * Without it they are unavailable, and unavailable wallets are the
             * likeliest reason Tithe.ly's own script avoids framing on Chrome
             * and Safari at all. Do not remove this to "tighten" the embed.
             */
            allow="payment"
          />
        </dialog>
      )}
    </>
  );
}
