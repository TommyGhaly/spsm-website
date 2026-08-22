'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { focalPosition, type DocOf, type GalleryMedia } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl, galleryVideoUrl } from './media';

/**
 * One photograph or clip, filling the screen.
 *
 * The gallery grid crops every picture to a cell — it has to, or an arrangement
 * is impossible — so until this existed there was **no way to see a parish
 * photograph whole**. Clicking one did nothing at all: `GalleryGrid` has taken
 * an `onSelect` since it was written and no caller ever passed one.
 *
 * ## Two different meanings of "full screen", and it does both
 *
 * A viewer like this is normally a fixed overlay: the picture covers the
 * browser's content area and the browser's own chrome stays. That is what people
 * expect from a click, and it is what this opens as.
 *
 * It is *not* what "show it fullscreen" means on a projector in the hall, where
 * the address bar and the tab strip are the problem. So there is also a button,
 * and `f`, that asks the Fullscreen API for the real thing. It has to be a
 * button: `requestFullscreen` is refused unless it is called from a user
 * gesture, so this cannot be done on open — a click on a photograph is a gesture
 * for the click handler, not for an effect that runs afterwards.
 *
 * The presentation (see Presentation.tsx) is the other half of the same
 * requirement — this is one picture on demand, that is all of them, unattended.
 *
 * ## Video
 *
 * Plays with the browser's own controls, and always starts by itself — sound
 * first, silently if that is refused.
 *
 * The claim this used to make, that a click is gesture enough for sound, is only
 * true in Chrome. Safari counts the gesture against the handler that received it
 * and not against a `<video>` mounted by the render afterwards, and iOS refuses
 * a stepped-to clip outright: `autoPlay` alone left the viewer sitting on a
 * poster frame with no explanation. So the play is attempted with sound and, if
 * the promise rejects, retried muted — a silent clip that is running beats a
 * clip that is not, and the controls are right there to unmute it.
 *
 * It is paused and unloaded when the slide changes — a `<video>` left in the DOM
 * keeps downloading and keeps playing behind whatever replaced it.
 */
export function Lightbox({
  media,
  index,
  onIndex,
  onClose,
}: {
  media: readonly DocOf<GalleryMedia>[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement | null>(null);
  /** The clip on the current slide, so the play attempt below can reach it. */
  const player = useRef<HTMLVideoElement | null>(null);
  /** Where a swipe began, so `touchend` can tell a swipe from a tap. */
  const swipeFrom = useRef<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const item = media[index];
  const count = media.length;

  /*
   * Wrapping rather than stopping at the ends.
   *
   * A gallery is a loop here for the same reason it is one in the presentation:
   * somebody looking at the last picture of a camp and pressing → once more
   * means "keep going", and a viewer that silently refuses looks broken. There
   * is a counter on screen saying where they are, so nobody gets lost.
   */
  const step = useCallback(
    (delta: number) => {
      if (count === 0) return;
      onIndex((index + delta + count) % count);
    },
    [count, index, onIndex],
  );

  /** The real thing, on the dialog element, so the controls come with it. */
  const toggleFullscreen = useCallback(() => {
    const node = dialog.current;
    if (!node) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // Refused on iOS Safari for a non-video element, which is why nothing
      // depends on it succeeding — the overlay is already the whole viewport.
      void node.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  /*
   * The keyboard, the scroll lock, and focus — all three in one effect because
   * all three have to be undone together. A cleanup that misses one leaves the
   * page unscrollable after the viewer has gone, which is the kind of bug that
   * gets blamed on the browser.
   */
  useEffect(() => {
    const opener = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Escape belongs to fullscreen first: the browser closes fullscreen on
        // Escape whether or not this listener runs, and closing the viewer at
        // the same time means one press does two things.
        if (document.fullscreenElement) return;
        event.preventDefault();
        onClose();
        return;
      }
      /*
       * Keep Tab inside.
       *
       * `aria-modal` tells a screen reader that the rest of the page is not
       * there; it does nothing at all about keyboard focus, which walks straight
       * out of the overlay into the gallery behind it — where the focus ring is
       * invisible because the page is covered. Six focusable elements at most, so
       * the wrap is a list lookup rather than a library.
       */
      if (event.key === 'Tab') {
        /*
         * `a[href]`, not `[href]`. The bare attribute selector also matches the
         * `<link rel="preload">` elements rendered below — which are not
         * focusable, so the last "focusable" element was one that can never be
         * the active element, and the wrap it guards never fired.
         */
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), video, a[href]',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFullscreen();
      }
    };

    const onFullscreenChange = () => setFullscreen(document.fullscreenElement !== null);

    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      // Back to the photograph they clicked, not to the top of the page.
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose, step, toggleFullscreen]);

  /*
   * The neighbours, fetched while this one is being looked at.
   *
   * These are full-size renditions over a phone connection, and stepping to the
   * next one without this is a second of blank screen every time. Two links
   * rather than a preloading library: the browser's own cache is the mechanism,
   * and `<link rel=preload>` in the head is how you reach it without rendering
   * anything.
   */
  /*
   * Start the clip on this slide, with sound where the browser allows it.
   *
   * Keyed on `item?.id` rather than on the element: the video is remounted per
   * slide (see the `key` below), so this runs once per clip, after the new
   * element exists.
   */
  useEffect(() => {
    const node = player.current;
    if (!node) return;
    node.muted = false;
    node.play().catch(() => {
      // Refused for having sound. Mute and take what we can get.
      node.muted = true;
      return node.play().catch(() => undefined);
    });
  }, [item?.id]);

  const neighbours = count > 1 ? [(index + 1) % count, (index - 1 + count) % count] : [];

  if (!item) return null;

  const poster = galleryPosterUrl(item);
  const video = galleryVideoUrl(item);

  return (
    <div
      className="lightbox"
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={item.caption || 'Photograph'}
      tabIndex={-1}
      /*
        Closing on a click of the backdrop, but only the backdrop.
        `event.target === event.currentTarget` rather than a separate backdrop
        element behind the picture: with a sibling backdrop, the gap either side
        of a portrait photograph belongs to the *figure*, not the backdrop, and
        clicking the obvious empty space does nothing.
      */
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (touch) swipeFrom.current = touch.clientX;
      }}
      onTouchEnd={(event) => {
        const start = swipeFrom.current;
        const touch = event.changedTouches[0];
        swipeFrom.current = null;
        if (start === null || !touch) return;
        const travelled = touch.clientX - start;
        // 48px, so a vertical scroll or a tap does not count as a swipe.
        if (Math.abs(travelled) > 48) step(travelled < 0 ? 1 : -1);
      }}
    >
      {neighbours.map((at) => {
        const next = media[at];
        const url = next ? galleryPosterUrl(next) : null;
        return url ? <link key={next?.id ?? at} rel="preload" as="image" href={url} /> : null;
      })}

      <div className="lightbox__bar">
        <p className="lightbox__count">
          {index + 1} <span aria-hidden="true">/</span>
          <span className="visually-hidden">of</span> {count}
        </p>

        <button
          type="button"
          className="lightbox__control"
          onClick={toggleFullscreen}
          aria-pressed={fullscreen}
        >
          <Icon name="expand" size={20} />
          <span className="visually-hidden">
            {fullscreen ? 'Leave full screen' : 'Fill the screen'}
          </span>
        </button>

        <button type="button" className="lightbox__control" onClick={onClose}>
          <Icon name="close" size={20} />
          <span className="visually-hidden">Close</span>
        </button>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox__step lightbox__step--prev"
            onClick={() => step(-1)}
          >
            <Icon name="prev" size={28} />
            <span className="visually-hidden">Previous</span>
          </button>
          <button
            type="button"
            className="lightbox__step lightbox__step--next"
            onClick={() => step(1)}
          >
            <Icon name="next" size={28} />
            <span className="visually-hidden">Next</span>
          </button>
        </>
      )}

      <figure className="lightbox__stage">
        {video ? (
          /*
            `key` on the element, not just a changed `src`. A `<video>` whose src
            attribute changes keeps the old media loaded and, in Safari, keeps
            playing it; remounting is the only reliable way to make it let go.
          */
          <video
            key={item.id}
            ref={player}
            className="lightbox__media"
            src={video}
            {...(poster ? { poster } : {})}
            controls
            autoPlay
            playsInline
          />
        ) : poster ? (
          <img
            key={item.id}
            className="lightbox__media"
            src={poster}
            alt={item.caption}
            // `contain`, not `cover`: the entire point of opening a photograph
            // is to see the part the grid cropped off. The focal point is still
            // honoured, for the rare case where the viewport is narrower than
            // the picture's own proportions allow.
            style={{ objectPosition: focalPosition(item.focal) }}
          />
        ) : (
          <p className="lightbox__pending">This photograph is still being processed.</p>
        )}

        {item.caption && <figcaption className="lightbox__caption">{item.caption}</figcaption>}
      </figure>
    </div>
  );
}
