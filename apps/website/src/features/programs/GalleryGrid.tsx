'use client';

import { useEffect, useState } from 'react';
import {
  GALLERY_COLUMNS,
  GALLERY_COLLAPSE_BELOW,
  collapseToColumn,
  focalPosition,
  packGallery,
  type DocOf,
  type GalleryMedia,
  type Placeable,
} from '@spsm/shared';
import { galleryPosterUrl, galleryVideoUrl } from './media';

/**
 * The gallery, as an administrator arranged it.
 *
 * The four integers on each document (`col`, `row`, `colSpan`, `rowSpan`) map
 * straight onto CSS grid lines, which is why they are stored 1-indexed — no
 * arithmetic between Firestore and the stylesheet, and the mobile app reads the
 * same numbers into its own layout system.
 *
 * Rows are a fixed height rather than `auto`. A grid whose rows size to their
 * content cannot honour a `rowSpan`: an item told to be three rows tall would
 * simply be as tall as its own photograph, and every deliberate arrangement
 * would collapse into a jumble. The height is a CSS custom property so a phone
 * can shrink it without this component knowing.
 */

export function GalleryGrid({
  media,
  onSelect,
}: {
  media: DocOf<GalleryMedia>[];
  /** Opens the lightbox. Absent in the presentation, which is its own view. */
  onSelect?: (index: number) => void;
}) {
  const narrow = useNarrowViewport();

  const placeable: Placeable[] = media.map((item) => ({
    id: item.id,
    layout: item.layout,
    aspect: item.width && item.height ? item.width / item.height : null,
  }));

  const packed = packGallery(placeable);
  const placements = narrow ? collapseToColumn(packed) : packed;

  // `collapseToColumn` re-sorts into reading order, so the two arrays are no
  // longer parallel with `media`. Index by id rather than position.
  const byId = new Map(media.map((item) => [item.id, item]));

  return (
    <ul
      className="gallery-grid"
      style={{ ['--gallery-columns' as string]: narrow ? 1 : GALLERY_COLUMNS }}
    >
      {placements.map(({ id, placement }) => {
        const item = byId.get(id);
        if (!item) return null;

        return (
          <li
            key={id}
            className="gallery-grid__cell"
            style={{
              gridColumn: `${placement.col} / span ${placement.colSpan}`,
              gridRow: `${placement.row} / span ${placement.rowSpan}`,
            }}
          >
            <GalleryItem
              item={item}
              onSelect={onSelect ? () => onSelect(media.indexOf(item)) : undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

function GalleryItem({
  item,
  onSelect,
}: {
  item: DocOf<GalleryMedia>;
  // `| undefined` spelled out because `exactOptionalPropertyTypes` is on: with
  // it, an optional property may be *omitted* but may not be *given* undefined,
  // and the caller passes undefined explicitly for the presentation view.
  onSelect?: (() => void) | undefined;
}) {
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
      <div className="gallery-grid__pending" aria-hidden="true">
        <span>Processing…</span>
      </div>
    );
  }

  const image = (
    <img
      src={poster}
      // The caption is the alt text. An administrator writing one line is
      // doing double duty, which is the only way alt text on a few hundred
      // parish photographs ever gets written at all.
      alt={item.caption}
      loading="lazy"
      decoding="async"
      style={{ objectPosition: focalPosition(item.focal) }}
    />
  );

  if (!onSelect) return <figure className="gallery-grid__media">{image}</figure>;

  return (
    <button type="button" className="gallery-grid__media" onClick={onSelect}>
      {image}
      {isVideo && (
        <span className="gallery-grid__play" aria-hidden="true">
          ▶
        </span>
      )}
      {/*
        The caption is already the alt text above, so a screen reader would
        otherwise hear it twice — once for the image, once for the button. The
        visible text is hidden from the accessibility tree and the button gets
        the label instead.
      */}
      <span className="visually-hidden">
        {isVideo ? 'Play video' : 'View photograph'}
        {item.caption ? `: ${item.caption}` : ''}
      </span>
    </button>
  );
}

/**
 * Whether the canvas should collapse to a single column.
 *
 * A media query rather than a width measurement, and it starts `false` so the
 * first render matches on every device. The alternative — reading
 * `window.innerWidth` during render — is not available at all in the static
 * shell's first pass and produces a layout flash when it becomes available.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${GALLERY_COLLAPSE_BELOW - 1}px)`);
    setNarrow(query.matches);

    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
