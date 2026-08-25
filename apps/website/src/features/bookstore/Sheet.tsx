"use client";

import { useEffect, useRef } from "react";

/**
 * The modal sheet every screen in the bookstore appears in.
 *
 * Lifted out of `Shop` so the orders drawer can use it too. It was already the
 * one place this feature knows how to open something over the page — the basket,
 * the product detail, the payment form — and a second, near-identical overlay
 * written for the admin would be two implementations of Escape, of the backdrop
 * click, and of the pinned bar, drifting apart from the first day.
 *
 * A native `<dialog>` opened with `showModal()`, which is what gives it the top
 * layer, the inert page behind, focus containment, and Escape for free. None of
 * those are reimplemented here and none of them should be.
 */

/**
 * A modal, hand-rolled on `<dialog>`.
 *
 * `showModal()` rather than the `open` attribute: only the modal form gets the
 * top layer, the backdrop, focus trapping, and Escape-to-close from the
 * browser. Setting `open` renders a dialog that looks right and traps nothing.
 */
export function Dialog({
  title,
  heading,
  back,
  screen,
  className,
  onClose,
  children,
}: {
  title: string;
  /**
   * The visible title in the bar, where the screen has one to show.
   *
   * Separate from `title`, which is only the accessible name. The product
   * dialog sets its own heading in the reading column, at display size, and
   * repeating it in the bar two lines above would be the same words twice —
   * so it passes nothing and gets a bar holding only the close.
   */
  heading?: string;
  /**
   * The way back to the previous screen, pinned in the bar beside the title.
   *
   * It used to sit at the top of the checkout's recap panel, which scrolls —
   * and on a phone, where that panel stacks above the payment form rather than
   * beside it, scrolls away completely. A way out of a payment screen should
   * not be something you have to scroll back up to find.
   */
  back?: { label: string; onBack: () => void };
  /**
   * Changes when the dialog swaps one screen for another, so the scroll can go
   * back to the top.
   *
   * The sheet scrolls, and the two screens it holds are different heights. Left
   * alone, Checkout pressed at the foot of a long basket landed you part-way
   * down the payment form, and Back landed you in the middle of the basket —
   * both of which read as the dialog having lost its place.
   */
  screen?: string;
  /** A width modifier, or empty. The basket and the product page want
      different ones. */
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [screen]);

  return (
    <dialog
      ref={ref}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-label={title}
      // Fires for Escape as well as `close()`, so both routes out land here.
      onClose={onClose}
      // Clicking the backdrop is a click on the dialog element itself; a click
      // on anything inside it stops at that child.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      {/*
        The bar is pinned and the close lives in it.

        Both of those were bugs. The close was absolutely positioned against the
        sheet, so it scrolled away with the content — and the heading, which was
        sticky, then slid over the top of it and hid it on the way past. The
        heading was not properly pinned either: its `top` was a negative offset,
        so it moved a couple of centimetres before it stuck, which reads as the
        header sliding around while you scroll.

        One sticky bar at `top: 0` holding both fixes both. It only works
        because the sheet's own padding moved to `.sheet__body`: a sticky child
        of a padded scroller sticks to the *padding* box, which leaves a strip
        above it for content to scroll through.
      */}
      <div className="sheet__bar">
        {back && (
          <button type="button" className="sheet__back" onClick={back.onBack}>
            <span aria-hidden="true">←</span> {back.label}
          </button>
        )}
        {heading && <h2 className="sheet__name">{heading}</h2>}
        <button
          type="button"
          className="sheet__close"
          onClick={() => ref.current?.close()}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="sheet__body">{children}</div>
    </dialog>
  );
}
