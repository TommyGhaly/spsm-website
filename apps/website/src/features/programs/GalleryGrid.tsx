'use client';

import { useEffect, useState } from 'react';
import {
  GALLERY_COLUMNS,
  GALLERY_COLLAPSE_BELOW,
  collapseToColumn,
  packGallery,
  type DocOf,
  type GalleryMedia,
  type Placeable,
  type SectionCaptionStyle,
} from '@spsm/shared';
import { GalleryFigure } from './GalleryFigure';

/**
 * The gallery as a composition — the twelve-column canvas.
 *
 * One of three displays a section can choose (see `GallerySection`), and the only
 * one that can hold an arrangement somebody built by hand. The four integers on
 * each document (`col`, `row`, `colSpan`, `rowSpan`) map straight onto CSS grid
 * lines, which is why they are stored 1-indexed — no arithmetic between Firestore
 * and the stylesheet, and the mobile app reads the same numbers into its own
 * layout system.
 *
 * Rows are a fixed height rather than `auto`. A grid whose rows size to their
 * content cannot honour a `rowSpan`: an item told to be three rows tall would
 * simply be as tall as its own photograph, and every deliberate arrangement
 * would collapse into a jumble. The height is `--gallery-row-height`, which the
 * section sets from its scale, so a phone and a large section can both shrink it
 * without this component knowing.
 *
 * What a picture *looks* like is `GalleryFigure`'s business, not this file's.
 */
export function GalleryGrid({
  media,
  caption,
  onSelect,
}: {
  media: DocOf<GalleryMedia>[];
  caption: SectionCaptionStyle;
  /** Opens the lightbox. Absent only where a click has nowhere to go. */
  onSelect?: ((index: number) => void) | undefined;
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
            <GalleryFigure
              item={item}
              caption={caption}
              onSelect={onSelect ? () => onSelect(media.indexOf(item)) : undefined}
            />
          </li>
        );
      })}
    </ul>
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
