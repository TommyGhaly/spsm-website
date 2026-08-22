'use client';

import type { ReactNode } from 'react';
import {
  driftsFor,
  titlePlacementFor,
  type DocOf,
  type GalleryMedia,
  type GridPlacement,
  type SectionLayout,
} from '@spsm/shared';
import { DragRail } from '@/components/DragRail';
import { GalleryGrid } from './GalleryGrid';
import { GalleryFigure } from './GalleryFigure';
import { GalleryCanvas } from './GalleryCanvas';
import { PictureStrip } from './PictureStrip';
import { useEditMode } from './editMode';

/**
 * One titled block of photographs, arranged however its section says.
 *
 * This is the piece the redesign turns on. A section used to be a heading and a
 * packed grid, hardcoded, twice — once on the ministry page and once on a
 * gathering. Now the arrangement is data (`SectionLayout`), the same three
 * levels of it that the ministry, its gatherings and their subgroups each carry,
 * and this renders any of them.
 *
 * ## Three displays, one mechanism between two of them
 *
 * `grid` is the twelve-column canvas — the only display that can hold a
 * deliberate composition, and the default. `rail` and `column` are the *same*
 * drifting strip on different axes, which is why `DragRail` takes an `axis`
 * rather than there being two components. See `useDragRail` for why the vertical
 * one deliberately claims fewer gestures than the horizontal one.
 *
 * ## Why the scale is a CSS variable and not a class per size
 *
 * Each display counts its scale in a different unit — a grid in row heights, a
 * rail in tile height, a column in frame height — so one `--section-scale` would
 * be meaningless. Instead each display's block sets the one variable it needs
 * (`--gallery-row-height`, `--rail-tile`, `--rail-height`) from a shared four-step
 * ladder in globals.css. The names are the contract; the numbers are per display.
 */
export function GallerySection({
  id,
  title,
  layout,
  media,
  onSelect,
  /** Shown instead of the pictures when there are none. */
  empty,
  /** Staff controls, drawn under the pictures. Nothing for a visitor. */
  children,
  /** Stops a rail drifting while something else owns the page — an open editor. */
  frozen = false,
  onPlace,
  label,
  onDropPicture,
  onRemovePicture,
}: {
  id: string;
  /** Drawn as the heading. Empty draws none — see `named`. */
  title: string;
  /**
   * What to call this section when it has no visible heading: its accessible
   * name, and the wording on the little tab an administrator clicks to select it.
   * A block with no title still has to be nameable by both.
   */
  label?: string | undefined;
  layout: SectionLayout;
  media: DocOf<GalleryMedia>[];
  /** Opens the lightbox, by index into `media`. */
  onSelect?: ((index: number) => void) | undefined;
  empty?: ReactNode;
  children?: ReactNode;
  frozen?: boolean;
  onPlace?: ((mediaId: string, layout: GridPlacement | null) => void) | undefined;
  /**
   * The set, in a new order, after a picture was dragged in a wheel.
   *
   * A wheel's layout is an *order*, not a set of positions, so dragging inside one
   * has nothing to write to `GalleryMedia.layout` — it rewrites the sequence. A
   * grid gets the canvas instead, which is a different gesture for a different
   * kind of arrangement.
   */
  onDropPicture?: ((ordered: DocOf<GalleryMedia>[]) => void) | undefined;
  /** Take one photograph off this page. Never deletes the photograph. */
  onRemovePicture?: ((mediaId: string) => void) | undefined;
}) {
  const edit = useEditMode();
  const selected = edit.on && edit.isSelected({ kind: 'section', key: id });

  /*
   * The canvas replaces the grid whenever edit mode is on. There is no separate
   * "Move the pictures" step any more, and dropping it is the point: it was a
   * mode inside a mode, and an administrator who had pressed Edit and then
   * clicked a photograph could not understand why it would not move.
   *
   * A `grid` only. A rail's arrangement is an *order*, not a position, so there is
   * no canvas to put handles on — it keeps its normal display and stays
   * selectable.
   */
  const canArrange = edit.on && layout.display === 'grid' && onPlace !== undefined;

  const placement = titlePlacementFor(layout);
  const drifts = driftsFor(layout);

  /**
   * An empty title draws no heading at all.
   *
   * A real state, not a guard: a scroll wheel added under a block that already
   * says "Photographs" usually wants no second heading, and `GalleryBand.title`
   * is empty until somebody types one. Rendered anyway it is an empty `<h2>` —
   * which takes its margin, its line height and its place in the document
   * outline while saying nothing.
   *
   * The section still needs an accessible name, so `aria-labelledby` gives way to
   * `aria-label` below. Naming it after the level it is on rather than leaving it
   * anonymous: "region" with no name is what a screen reader announces otherwise,
   * which is worse than a plain one.
   */
  const named = title.trim() !== '';

  const heading = named ? (
    <h2
      id={id}
      className={[
        'gallery-title',
        `gallery-title--${layout.title.scale}`,
        `gallery-title--${layout.title.align}`,
      ].join(' ')}
    >
      {title}
    </h2>
  ) : null;

  const body =
    media.length === 0 ? (
      empty ?? null
    ) : canArrange ? (
      /* No `onSelect` while arranging: a press is a drag, and opening the
         lightbox on top of the canvas would swallow the gesture. */
      <GalleryCanvas media={media} onChange={onPlace} onRemove={onRemovePicture} />
    ) : layout.display === 'grid' ? (
      <GalleryGrid media={media} caption={layout.caption} onSelect={onSelect} />
    ) : edit.on && onDropPicture && onRemovePicture ? (
      /*
        A wheel, while editing: a still strip with the tiles draggable.
        
        Not the drifting rail. That renders its children two or three times to hide
        the loop's seam, so a duplicate tile carries the same id as its original and
        "which one did you grab" has no answer — and a strip moving under the hand
        cannot be aimed at anyway. See `PictureStrip`.
      */
      <PictureStrip
        media={media}
        axis={layout.display === 'column' ? 'y' : 'x'}
        onReorder={onDropPicture}
        onRemove={onRemovePicture}
        onSelect={onSelect}
      />
    ) : (
      /*
        A rail and a column are one component with the axis swapped.

        `rail--gallery` carries the tile size; the `--column` variant also carries
        the frame height, which a vertical rail has to have or there is nothing to
        overflow and so nothing to scroll.

        `drift={false}` still leaves the strip draggable — see `DragRail` — which
        is the point of `SectionLayout.drift` being stored rather than inferred: a
        set of six that a reader should pull through themselves is a real choice.
      */
      <DragRail
        axis={layout.display === 'column' ? 'y' : 'x'}
        className={`rail--gallery rail--gallery-${layout.display}`}
        drift={drifts}
        frozen={frozen}
      >
        <ul className={`gallery-strip gallery-strip--${layout.display}`}>
          {media.map((item, index) => (
            /*
              The tile's shape comes from the *document*, not from the loaded
              image, and that is a deadlock fix rather than an optimisation.

              A rail tile used to take its height from the scale and its width
              from the photograph — so before the photograph arrived the tile was
              zero wide. `useDragRail` measures the strip to decide whether there
              is anything to scroll, measured nothing, and left the rail static.
              A static rail never scrolls, and `loading="lazy"` inside a scroll
              container does not fetch what has not scrolled into view — so the
              pictures never loaded, so the strip stayed narrow. A rail of twenty
              photographs showed two and refused to move.

              `GalleryMedia.width`/`height` exist for exactly this. With the ratio
              known up front the strip measures correctly on first paint, the rail
              scrolls, lazy loading works as intended, and nothing reflows when a
              picture lands.
            */
            <li key={item.id} style={{ aspectRatio: aspectOf(item) }}>
              <GalleryFigure
                item={item}
                caption={layout.caption}
                onSelect={onSelect ? () => onSelect(index) : undefined}
              />
            </li>
          ))}
        </ul>
      </DragRail>
    );

  return (
    <section
      className={[
        'gallery-band',
        `gallery-band--${layout.display}`,
        `gallery-band--scale-${layout.scale}`,
        `gallery-band--title-${placement}`,
        `gallery-band--caption-${layout.caption.placement}`,
        selected ? 'is-selected' : '',
      ]
        .join(' ')
        .trim()}
      {...(named ? { 'aria-labelledby': id } : { 'aria-label': label ?? 'Photographs' })}
    >
      {/*
        A section is a heading plus a grid of photographs, and the photographs are
        themselves selectable — so "click the section" has nowhere unambiguous to
        land. A small tab above it does, and it doubles as the label saying what
        would be selected.
      */}
      {edit.on && (
        <button
          type="button"
          className={`section-handle${selected ? ' is-selected' : ''}`}
          onClick={() => edit.select({ kind: 'section', key: id })}
        >
          {title || label || 'Photographs'}
        </button>
      )}
      {/*
        `over` puts the title on the pictures, so it has to be inside the same
        positioned box as them — which `above` and `beside` must not be, or the
        title would be laid out on top of a grid it is meant to sit next to. Two
        branches rather than one clever one.
      */}
      {placement === 'over' ? (
        <div className="gallery-band__stage">
          {body}
          <div className="gallery-band__overlay">{heading}</div>
        </div>
      ) : (
        <>
          {heading}
          {body}
        </>
      )}

      {children}
    </section>
  );
}

/**
 * A picture's shape, as a CSS `aspect-ratio`.
 *
 * 3 / 2 when the document does not say — a submission whose dimensions the
 * transcode failed to record, or a video with no poster metadata. An ordinary
 * landscape snapshot is the least wrong guess, and the image is cropped to the
 * box either way, so a wrong guess costs a crop rather than a broken layout.
 */
function aspectOf(item: DocOf<GalleryMedia>): string {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return `${item.width} / ${item.height}`;
  }
  return '3 / 2';
}
