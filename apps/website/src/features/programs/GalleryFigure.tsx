'use client';

import { focalPosition, type DocOf, type GalleryMedia, type SectionCaptionStyle } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl, galleryVideoUrl } from './media';
import { useEditMode } from './editMode';

/**
 * One photograph or clip, wherever it appears.
 *
 * Extracted because there are now three displays — the twelve-column grid, the
 * sideways rail, the drifting column — and a picture has to look the same in all
 * of them. Written per display it would not: the play badge, the caption
 * treatment, the "this opens" mark, the processing state and the alt-text rule
 * are five decisions each, and three copies of five decisions drift within a
 * week.
 *
 * The shape of the *box* is the caller's business — a grid cell is sized by grid
 * lines, a rail tile by a fixed height. This fills whatever it is given.
 */
export function GalleryFigure({
  item,
  caption,
  onSelect,
}: {
  item: DocOf<GalleryMedia>;
  /** How this section draws captions. See schema/sectionLayout.ts. */
  caption: SectionCaptionStyle;
  // `| undefined` spelled out because `exactOptionalPropertyTypes` is on: with
  // it, an optional property may be *omitted* but may not be *given* undefined,
  // and callers pass undefined explicitly.
  onSelect?: (() => void) | undefined;
}) {
  /*
   * In edit mode a click selects the picture instead of opening it.
   *
   * Read here rather than passed down, because this component is four levels
   * below the page — a figure inside a strip inside a rail inside a section — and
   * threading an editing concern through all of them would put it in the signature
   * of every component that draws a photograph, including on the public page.
   *
   * A photograph cannot both open full-screen and be selected by the same click,
   * and selecting is what somebody in edit mode means: the lightbox would cover
   * the panel they are editing with.
   */
  const edit = useEditMode();
  const selecting = edit.on;
  const selected = selecting && edit.isSelected({ kind: 'media', id: item.id });

  const poster = galleryPosterUrl(item);
  const isVideo = item.kind === 'video' && galleryVideoUrl(item) !== null;

  /*
   * Approved, publicly readable, and no file yet.
   *
   * Not a defensive branch — it is a state the design creates. Approval and
   * transcoding are two steps seconds apart, and in between the document is
   * live with a null `renditionPath`. Saying so beats a broken-image icon,
   * which reads as a site fault rather than a job still running.
   */
  if (poster === null) {
    return (
      <div className="gallery-figure gallery-figure--pending" aria-hidden="true">
        <span>Processing…</span>
      </div>
    );
  }

  const image = (
    <img
      src={poster}
      // The caption is the alt text, in every caption mode including `hidden` —
      // "not drawn" and "not there" are different things, and the alt text is
      // the one place the caption is never optional.
      alt={item.caption}
      loading="lazy"
      decoding="async"
      style={{ objectPosition: focalPosition(item.focal) }}
    />
  );

  const showCaption = caption.placement !== 'hidden' && item.caption.length > 0;

  /*
   * The overlay: a clip's badge, and the caption when this section draws them
   * over the picture.
   *
   * `aria-hidden`, all of it. The caption is already this picture's alt text and
   * the button's own label says what the click does, so exposing it a third time
   * makes a screen reader read one photograph three times over.
   */
  const veil = (
    <span
      className={`gallery-figure__veil${
        caption.placement === 'below' ? ' gallery-figure__veil--badge-only' : ''
      }`}
      aria-hidden="true"
    >
      {isVideo && (
        <span className="gallery-figure__badge">
          <Icon name="play" size={14} />
          {item.durationSeconds !== null && item.durationSeconds > 0 && (
            <span>{formatDuration(item.durationSeconds)}</span>
          )}
        </span>
      )}
      {showCaption && caption.placement === 'over' && (
        <span className="gallery-figure__caption">{item.caption}</span>
      )}
    </span>
  );

  const act = selecting ? () => edit.select({ kind: 'media', id: item.id }) : onSelect;

  const picture = act ? (
    <button
      type="button"
      className="gallery-figure__frame"
      onClick={(event) => {
        // The section around this is selectable too, and its handler is up the
        // tree — without this, selecting a picture would immediately be replaced
        // by selecting its section.
        if (selecting) event.stopPropagation();
        act();
      }}
    >
      {image}
      {veil}
      {/*
        The affordance. A photograph in a grid gives a visitor no reason to
        believe it opens — this is the one mark that says so, and it is drawn on
        hover and focus only, for the same reason the caption is.
      */}
      <span className="gallery-figure__open" aria-hidden="true">
        <Icon name={isVideo ? 'play' : 'expand'} size={18} />
      </span>
      <span className="visually-hidden">
        {selecting ? 'Select photograph' : isVideo ? 'Play video' : 'View photograph'}
        {item.caption ? `: ${item.caption}` : ''}
      </span>
    </button>
  ) : (
    <span className="gallery-figure__frame">
      {image}
      {veil}
    </span>
  );

  /*
   * `below` is a real caption in the flow rather than an overlay, so the element
   * has to be a `figure` — which is why this is not simply a class on the frame.
   * It also means the box the caller sized is now shared between the picture and
   * a line of text, which is what `.gallery-figure--titled` accounts for.
   */
  const classes = `gallery-figure${selected ? ' is-selected' : ''}`;

  if (showCaption && caption.placement === 'below') {
    return (
      <figure className={`${classes} gallery-figure--titled`}>
        {picture}
        <figcaption className="gallery-figure__below">{item.caption}</figcaption>
      </figure>
    );
  }

  return <div className={classes}>{picture}</div>;
}

/** `6` → `0:06`, `95` → `1:35`. Long enough for a parish clip; no hours. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
