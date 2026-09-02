'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FUTURE_GALLERY,
  galleryFull,
  galleryThumb,
  type FutureGalleryName,
} from './images';

const NAMES = Object.keys(FUTURE_GALLERY) as FutureGalleryName[];

/**
 * Ten more views of the proposed buildings, as a grid that opens.
 *
 * ---------------------------------------------------------------------------
 * **This is the one place on the page with a lightbox, and the exception is
 * argued rather than assumed.** /about/our-belief and /about/who-we-are have
 * none, and the plates on this page have none, for a good reason: a picture
 * beside a paragraph supports the sentence a reader is in the middle of, and a
 * modal that takes the screen, the focus and the body scroll is a way of losing
 * their place. None of that applies to a gallery. A grid of ten thumbnails
 * *is* the promise of a bigger picture; the reader who clicks one has stopped
 * reading on purpose, and giving them a 320px crop when they asked to look is
 * the actual failure. Same call the festival tour's galleries make.
 *
 * `<dialog showModal>` rather than a fixed div, for the reason `GiveButton`
 * uses one: the top layer sits above the sticky masthead with no z-index,
 * focus is trapped, and the rest of the page goes inert for a screen reader.
 * None of that is worth reimplementing.
 *
 * **The thumbnails are buttons, not links.** There is no URL for "picture six",
 * this is a static export with no route to give it, and an `<a href="#">` that
 * goes nowhere is worse for a keyboard than a button that does something. The
 * grid works with JavaScript off in the only way that matters: the thumbnails
 * are still `<img>` elements in the HTML with their captions, so a reader with
 * no scripting sees ten pictures and cannot enlarge them. That is a smaller
 * loss than the ten pictures not being there.
 * ---------------------------------------------------------------------------
 */
export function Gallery() {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  /* Where to put focus back when the dialog closes. `document.activeElement` at
     open time, because the reader may have got here by keyboard from anywhere
     in the grid and dumping them back at the top of the page is disorienting. */
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    dialog.current?.close();
    setOpen(null);
    opener.current?.focus();
  }, []);

  const step = useCallback((by: number) => {
    setOpen((current) => {
      if (current === null) return null;
      // Wrap. A gallery that dead-ends at both extremes makes the reader work
      // out where they are; wrapping means the arrow keys never stop working.
      return (current + by + NAMES.length) % NAMES.length;
    });
  }, []);

  useEffect(() => {
    if (open === null) return;

    const element = dialog.current;
    element?.showModal();

    /*
     * Escape via a native `cancel` listener rather than React's `onCancel`.
     * `cancel` does not bubble, so it only reaches a delegating framework
     * through a special case that framework has written — React 19 has one,
     * React 18 did not, and this should not depend on that. `preventDefault`
     * so the browser's own close cannot run: `close()` here is the single path
     * out, and the alternative is a dialog the DOM thinks is shut while React
     * still renders it. Same shape as `features/giving/GiveButton.tsx`.
     */
    const onCancel = (event: Event) => {
      event.preventDefault();
      close();
    };
    element?.addEventListener('cancel', onCancel);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);

    /* `showModal` stops the dialog scrolling the page but not the page itself,
       and this page is nine bands of pictures — scrolling them behind an open
       one looks like the overlay came loose. */
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    return () => {
      element?.removeEventListener('cancel', onCancel);
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = previous;
    };
    // `open` is in the deps so the effect re-runs on a change of picture, which
    // is harmless — `showModal` on an open dialog is a no-op — and is what
    // keeps the listeners alive for the whole time it is open.
  }, [open, close, step]);

  /* Derived once and narrowed here rather than indexed at each use.
     `noUncheckedIndexedAccess` is on in this project, so `NAMES[open]` is
     `… | undefined` however obviously in range `open` is, and threading that
     through four call sites is worse than one guard. */
  const openName = open === null ? undefined : NAMES[open];
  const current = openName ? FUTURE_GALLERY[openName] : undefined;

  return (
    <>
      <ul className="future-gallery">
        {NAMES.map((name, index) => (
          <li key={name} className="future-gallery__cell">
            <button
              type="button"
              className="future-gallery__button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpen(index);
              }}
            >
              <img
                className="future-gallery__thumb"
                src={galleryThumb(name)}
                /* The 3:2 crop the optimiser emits, stated so the grid does not
                   reflow as ten pictures land at different moments. */
                width={480}
                height={320}
                alt={FUTURE_GALLERY[name].alt}
                loading="lazy"
                decoding="async"
              />
              <span className="future-gallery__label">
                {FUTURE_GALLERY[name].caption}
                <span className="visually-hidden"> — open larger</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open !== null && openName && current && (
        <dialog
          className="future-lightbox"
          ref={dialog}
          aria-label={current.caption}
          onClick={(event) => {
            /* A click on the backdrop targets the dialog element itself; a
               click anywhere inside targets a descendant. */
            if (event.target === dialog.current) close();
          }}
        >
          <div className="future-lightbox__inner">
            <img
              className="future-lightbox__img"
              /* `key` forces a fresh element per picture. Without it React
                 reuses the `<img>` and swaps `src`, and the browser keeps
                 painting the previous picture until the next one decodes —
                 which on a slow connection is a second of the wrong building. */
              key={openName}
              src={galleryFull(openName)}
              alt={current.alt}
              width={1600}
              height={900}
            />
            <p className="future-lightbox__caption">
              <span>{current.caption}</span>
              <span className="future-lightbox__count">
                {open + 1} of {NAMES.length}
              </span>
            </p>
          </div>

          <div className="future-lightbox__controls">
            <button
              type="button"
              className="future-lightbox__step"
              onClick={() => step(-1)}
              aria-label="Previous picture"
            >
              ‹
            </button>
            <button
              type="button"
              className="future-lightbox__step"
              onClick={() => step(1)}
              aria-label="Next picture"
            >
              ›
            </button>
            <button type="button" className="future-lightbox__close" onClick={close}>
              Close
            </button>
          </div>
        </dialog>
      )}
    </>
  );
}
