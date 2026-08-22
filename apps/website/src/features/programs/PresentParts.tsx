'use client';

import { useEffect, useState } from 'react';
import { focalPosition, type DocOf, type GalleryMedia } from '@spsm/shared';
import { galleryPosterUrl, galleryVideoUrl } from './media';

/**
 * The pieces all three presentation styles share.
 *
 * One tile component, one shape function and two hooks — extracted when the
 * presentation went from one style to three (see Presentation.tsx). Each of
 * these had exactly one copy when there was one style, and the point of moving
 * them here rather than letting each stage grow its own is that they are the
 * places where being *slightly* different between styles would read as a bug:
 * a video that autoplays in the columns and not in the notebook, a tile that
 * knows its aspect ratio on one screen and guesses on another.
 */

/**
 * Below this width the notebook is not drawn.
 *
 * The notebook's whole effect is photographs overlapping across a plane wider
 * than the screen; at 420px there is room for one photograph and its neighbours'
 * corners, which reads as a broken grid rather than as a scrapbook. A phone gets
 * the columns instead — see `stageFor` in Presentation.tsx, which does the
 * substituting, and the switcher, which stops offering what cannot be drawn.
 */
export const NOTEBOOK_MIN_WIDTH = 700;

/**
 * The window's width, as state.
 *
 * A projector can be re-plugged and a window can be dragged between screens
 * mid-evening, so this is a subscription rather than a measurement taken at
 * mount. Starts at 0 — not at a guess — because a guess would draw the wrong
 * number of columns for one frame on every load; a stage asking about width is
 * asking a question that has no answer before the first effect runs, and 0 is
 * the honest one.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const read = () => setWidth(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  return width;
}

/**
 * Whether this machine has asked for less movement.
 *
 * `DragRail` asks the same question for itself, so the columns already honour it
 * without help. This is for the two stages that move things `DragRail` is not
 * moving: the notebook's vertical strips, and the slide's fades.
 *
 * The slide's *timer* is deliberately not gated on this — see PresentSlide.tsx.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  return reduced;
}

/**
 * One photograph or clip at its **own** shape, in the columns and the notebook.
 *
 * ## Nothing here is cropped, and `fit` is how
 *
 * At Tommy's direction: *"keep the dimensions original for all the photos and
 * videos… for the columns the width is set in stone but the height can be
 * adjusted to ensure the entire picture is shown."* So each caller says which
 * axis it owns and the other one follows the file:
 *
 * - `fit="width"` — the columns and the wheels. The column's width is fixed; the
 *   height is whatever the picture's ratio makes it.
 * - `fit="height"` — the notebook's prints, where the composition sets a height
 *   in vh and the width follows.
 *
 * **The ratio goes on this element, not on the box around it**, and it is written
 * `auto W / H` — see `ratioOf`. That is the whole mechanism: the box is sized by
 * the picture rather than the picture being squeezed into a box, so there is no
 * arrangement of numbers in which anything is cut off.
 *
 * `aria-hidden` from above, via the lane or the pile: this is ambient decoration
 * on a screen nobody is navigating with a keyboard, the captions are not drawn,
 * and every photograph appears in the gallery pages properly labelled.
 * Announcing two hundred unlabelled images would be worse than announcing none.
 *
 * The slide does not use this — it shows a whole photograph on a ground rather
 * than a tile, and it is the only stage with a caption and a position in a
 * sequence to announce. See PresentSlide.tsx.
 */
export function PresentMedia({
  item,
  fit,
}: {
  item: DocOf<GalleryMedia>;
  /** Which axis the caller has already decided. The other follows the file. */
  fit: 'width' | 'height';
}) {
  const poster = galleryPosterUrl(item);
  const video = galleryVideoUrl(item);
  const className = `present__media present__media--fit-${fit}`;
  const shape = { aspectRatio: ratioOf(item) };

  if (video) {
    return (
      <video
        className={className}
        style={shape}
        src={video}
        {...(poster ? { poster } : {})}
        autoPlay
        /*
         * Muted is not a compromise, it is the price of the requirement: an
         * unattended page has no user gesture behind it, so an unmuted clip is
         * *refused* by every browser and the tile sits on its poster frame
         * instead. A hall screen is watched, not listened to. (The lightbox,
         * which only ever opens from a click, does have sound.)
         */
        muted
        loop
        playsInline
        // A clip that will not load leaves its poster frame, which is a
        // photograph — better than a black hole in the composition.
        preload="metadata"
      />
    );
  }

  /*
   * No file at all: draw nothing.
   *
   * This was a grey 3:2 box, which made sense while a tile had a shape of its own
   * to fill. Now that every box is sized *by* its picture, a box with no picture
   * has no size to be given — and a placeholder would have to invent one on
   * whichever axis the caller did not fix. Nothing is also the better answer for
   * a hall screen: an approved photograph with neither a rendition nor a poster
   * is a broken record, and the place to notice that is the gallery page, not the
   * wall.
   */
  if (poster === null) return null;

  return (
    <img
      className={className}
      src={poster}
      alt=""
      loading="lazy"
      decoding="async"
      /*
        `objectPosition` still set, and it still costs nothing: with the box at
        the picture's own ratio there is nothing to choose between, so the focal
        point simply never comes into play. It stays because the box and the
        picture agreeing is a property of the *numbers being right*, and a
        photograph whose stored dimensions are wrong should crop towards its
        subject rather than towards its top-left corner.
      */
      style={{ ...shape, objectPosition: focalPosition(item.focal) }}
    />
  );
}

/**
 * A picture's shape, as a CSS `aspect-ratio` value.
 *
 * **`auto` first, and that keyword is the point.** `auto 3 / 2` means *use the
 * file's own ratio once the browser knows it, and this ratio until then* — so the
 * stored dimensions are a placeholder that keeps a lane the right height before
 * anything has loaded, and the photograph itself is what decides the final box.
 *
 * Without the keyword the stored numbers would be the final word, which is how a
 * picture gets cropped by a document rather than by a decision: `width` and
 * `height` on a `galleryMedia` document are written at upload from whatever the
 * uploader reported, and `3 / 2` is what a document with neither of them falls
 * back to. Before this, that fallback quietly cut the top and bottom off every
 * portrait whose dimensions had not been recorded.
 *
 * `auto` is also why the fallback can stay coarse: it is only ever load-time
 * scaffolding now, never the shape anything is finally drawn at.
 */
export function ratioOf(item: DocOf<GalleryMedia>): string {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return `auto ${item.width} / ${item.height}`;
  }
  return 'auto 3 / 2';
}
