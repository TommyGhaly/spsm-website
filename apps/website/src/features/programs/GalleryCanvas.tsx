'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GALLERY_COLUMNS,
  clampPlacement,
  focalPosition,
  packGallery,
  type DocOf,
  type GalleryMedia,
  type GridPlacement,
  type Placeable,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl } from './media';
import { useEditMode } from './editMode';

/**
 * The twelve-column canvas, with the pictures draggable and resizable.
 *
 * This is the editor docs/program-galleries.md §3 was written for — "the
 * requirement is *move anywhere, resize anything*" — and which nothing has
 * implemented since. `GalleryMedia.layout` has held four integers per photograph
 * from the beginning, the packer has honoured them, the mobile app reads them, and
 * the only way to set one was a REST client.
 *
 * ## Why it edits the same grid the public page renders
 *
 * Not a separate editing surface with a preview: *this is the page*, with handles
 * on it. The whole difficulty of arranging photographs is judging the result, and
 * a canvas that is a faithful copy of the real thing is one that will eventually
 * stop being faithful. So the markup and the CSS here are the public ones —
 * `.gallery-grid`, `.gallery-figure` — and arrange mode adds a wrapper, an
 * outline and two grips.
 *
 * ## Snapping, and why it is not optional
 *
 * A drag is measured in pixels and stored in **grid cells**. The conversion is
 * the whole point rather than a convenience: a pixel offset is meaningless to a
 * phone that renders the same gallery 500px narrower, and meaningless to an app
 * with no CSS at all. So the pointer delta is divided by the cell stride and
 * rounded, and what gets stored is a column and a row.
 *
 * ## Dragging an auto-placed photograph pins it
 *
 * Most photographs have `layout: null` and are positioned by the packer. There is
 * nothing to offset from, so the *packed* position is used as the starting point —
 * which means a drag of zero cells still writes a placement, and that is correct:
 * an administrator who touched a photograph has said where it goes. The others
 * then flow around it, which is what the manual/auto split is for. "Auto" on the
 * grip puts it back.
 */
export function GalleryCanvas({
  media,
  onChange,
  onRemove,
}: {
  media: DocOf<GalleryMedia>[];
  /** Commit one photograph's placement. `null` hands it back to the packer. */
  onChange: (mediaId: string, layout: GridPlacement | null) => void;
  /**
   * Take this one out of the block. Never deletes the photograph.
   *
   * The same × a wheel's tiles carry — see `PictureStrip`. It was only ever on the
   * wheels, which meant "press its × to take it off" was true of two of the three
   * displays and the grid was the default. Tommy: *"I want an x at the corner of
   * every picture to simply delete it."*
   */
  onRemove?: ((mediaId: string) => void) | undefined;
}) {
  const edit = useEditMode();
  const grid = useRef<HTMLUListElement | null>(null);

  /**
   * Placements changed here but not yet read back from Firestore.
   *
   * The documents arrive as props from a page that fetched them once, so without
   * this a photograph would snap back to where it started the moment the pointer
   * came up and stay there until something forced a refetch.
   */
  const [local, setLocal] = useState<Record<string, GridPlacement | null>>({});

  /** The drag in flight: what is being moved, from where, and in which mode. */
  const [drag, setDrag] = useState<{
    id: string;
    mode: 'move' | 'resize';
    base: GridPlacement;
    fromX: number;
    fromY: number;
  } | null>(null);

  /**
   * How far the pointer has travelled, in pixels, right now.
   *
   * **This is what makes the drag feel like a drag.** It used to not exist: the
   * tile's `grid-column` and `grid-row` were set to the *snapped* preview on every
   * pointer move, so a picture did not follow the finger — it sat still until the
   * pointer crossed half a cell and then teleported a whole one. On a section
   * whose rows are 260px tall that is a picture jumping 260px at a time under a
   * hand moving smoothly, which reads as a broken control rather than a coarse
   * one.
   *
   * Now the tile stays in its starting cell and is *translated* by the raw delta,
   * so it tracks the pointer 1:1, and a separate marker shows the cell it will
   * land in. The snapping is unchanged — it still stores a column and a row, for
   * all the reasons above — it simply stopped being the thing the eye follows.
   */
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  /** The placement the pointer is currently over. Drawn, not yet committed. */
  const [preview, setPreview] = useState<GridPlacement | null>(null);
  /**
   * The same value, readable without a state updater.
   *
   * The release handler has to know where the drag ended, and reading it through
   * `setPreview(current => …)` — which is the obvious way to avoid a stale
   * closure — is a **bug**: an updater is called *during render*, so the
   * `setLocal` and `onChange` inside it were React state updates issued from
   * another component's render pass. React says so out loud ("Cannot update a
   * component while rendering a different component"), and it is the kind of
   * thing that becomes a real misrender under concurrent rendering rather than
   * staying a console warning. A ref is the honest way to read a live value from
   * an event handler.
   */
  const previewRef = useRef<GridPlacement | null>(null);

  /** One place writes both, so they cannot disagree. */
  const showPreview = useCallback((next: GridPlacement | null) => {
    previewRef.current = next;
    setPreview(next);
  }, []);

  /*
   * The packed layout, with local edits folded in *before* packing.
   *
   * Before, not after: a photograph that has just been pinned is an occupied
   * region the packer has to route the others around, and that reflow is the
   * feedback the administrator is looking for. Folding the edit in afterwards
   * would move the dragged picture and leave everything else where it was, so the
   * arrangement on screen would not be the one that gets saved.
   */
  const placements = useMemo(() => {
    const placeable: Placeable[] = media.map((item) => ({
      id: item.id,
      layout: item.id in local ? local[item.id] ?? null : item.layout,
      aspect: item.width && item.height ? item.width / item.height : null,
    }));
    return new Map(packGallery(placeable).map((one) => [one.id, one]));
  }, [media, local]);

  /**
   * How far one column and one row are apart, in pixels.
   *
   * Measured off the live element rather than computed from the tokens: the row
   * height is a CSS variable the *section* sets from its scale, the gap is
   * another, and both are resolved values this component has no business knowing.
   * Read at the start of each drag, so a window resized between two drags cannot
   * leave a stale stride behind.
   */
  const stride = useCallback((): { col: number; row: number } => {
    const node = grid.current;
    if (!node) return { col: 1, row: 1 };
    const style = getComputedStyle(node);
    const gap = parseFloat(style.rowGap) || 0;
    const rowHeight = parseFloat(style.gridAutoRows) || 1;
    const width = node.getBoundingClientRect().width;
    return {
      // Twelve columns and eleven gaps between them.
      col: (width - gap * (GALLERY_COLUMNS - 1)) / GALLERY_COLUMNS + gap,
      row: rowHeight + gap,
    };
  }, []);

  const strideRef = useRef({ col: 1, row: 1 });

  const start = useCallback(
    (event: React.PointerEvent, id: string, mode: 'move' | 'resize') => {
      const placed = placements.get(id);
      if (!placed) return;
      // The grips are inside the draggable box, so a press on one would start a
      // move as well without this.
      event.stopPropagation();
      event.preventDefault();
      strideRef.current = stride();
      setDrag({
        id,
        mode,
        base: placed.placement,
        fromX: event.clientX,
        fromY: event.clientY,
      });
      showPreview(placed.placement);
      setOffset({ x: 0, y: 0 });
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    },
    [placements, stride, showPreview],
  );

  /*
   * The move and the release, on `window`.
   *
   * Not on the tile: a drag that leaves the grid — and one that ends outside the
   * window entirely, which is how a drag towards the edge of the screen normally
   * ends — would otherwise never see its `pointerup`, leaving the canvas stuck in
   * a drag with no way out but a reload.
   */
  useEffect(() => {
    if (drag === null) return;

    const onMove = (event: PointerEvent) => {
      const rawX = event.clientX - drag.fromX;
      const rawY = event.clientY - drag.fromY;
      // The raw travel, for the tile to follow. Only `move` translates; a resize
      // changes the box's *size*, which the span already expresses.
      setOffset(drag.mode === 'move' ? { x: rawX, y: rawY } : { x: 0, y: 0 });

      const dCol = Math.round(rawX / strideRef.current.col);
      const dRow = Math.round(rawY / strideRef.current.row);

      showPreview(
        clampPlacement(
          drag.mode === 'move'
            ? { ...drag.base, col: drag.base.col + dCol, row: drag.base.row + dRow }
            : {
                ...drag.base,
                colSpan: drag.base.colSpan + dCol,
                rowSpan: drag.base.rowSpan + dRow,
              },
        ),
      );
    };

    const onUp = () => {
      const landed = previewRef.current;
      setDrag(null);
      showPreview(null);
      setOffset(null);
      if (landed === null) return;

      /*
       * A press that did not move is a click, and a click selects.
       *
       * Without this, pressing a photograph on the canvas would *pin* it at the
       * position the packer had already given it — a write, and a change of state
       * from "auto" to "manual", from a gesture the administrator meant as "tell
       * me about this one". Comparing the landing placement with the starting one
       * is the honest test: it is exactly the question "did this drag do
       * anything".
       */
      if (same(landed, drag.base)) {
        edit.select({ kind: 'media', id: drag.id });
        return;
      }

      setLocal((was) => ({ ...was, [drag.id]: landed }));
      onChange(drag.id, landed);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, onChange, showPreview, edit]);

  /** Hand one photograph back to the packer. */
  const auto = useCallback(
    (id: string) => {
      setLocal((was) => ({ ...was, [id]: null }));
      onChange(id, null);
    },
    [onChange],
  );

  /**
   * Nudge by keyboard, which is the only way this is usable without a mouse.
   *
   * A drag is a pointer gesture and has no keyboard equivalent, so a canvas with
   * only handles is a canvas an administrator using a keyboard cannot arrange at
   * all. Arrow keys move; with Shift they resize.
   */
  const nudge = useCallback(
    (event: React.KeyboardEvent, id: string) => {
      const placed = placements.get(id);
      if (!placed) return;

      const step: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const move = step[event.key];
      if (!move) return;

      event.preventDefault();
      const [dCol, dRow] = move;
      const base = placed.placement;
      const next = clampPlacement(
        event.shiftKey
          ? { ...base, colSpan: base.colSpan + dCol, rowSpan: base.rowSpan + dRow }
          : { ...base, col: base.col + dCol, row: base.row + dRow },
      );
      setLocal((was) => ({ ...was, [id]: next }));
      onChange(id, next);
    },
    [placements, onChange],
  );

  return (
    <div className="canvas">
      {/*
        No Done button. Leaving edit mode is what ends this, which is the whole
        point of there being one mode rather than a mode inside a mode — a second
        Done was the thing that made "why will this picture not move" possible.
      */}
      <p className="canvas__hint">
        Drag a picture to move it, or its corner to resize. Arrow keys nudge; hold Shift to
        resize. <strong>Auto</strong> puts one back where the page would have placed it.
      </p>

      <ul className="gallery-grid canvas__grid" ref={grid}>
        {media.map((item) => {
          const placed = placements.get(item.id);
          if (!placed) return null;
          const moving = drag?.id === item.id && drag.mode === 'move';
          const sizing = drag?.id === item.id && drag.mode === 'resize';

          /*
           * Where the box *is*, versus where it is going.
           *
           * A move keeps the box in the cell it started in and slides it with a
           * transform — so it follows the pointer instead of hopping a cell at a
           * time — and the landing cell is drawn separately, below. A resize has
           * nowhere to slide to: its span *is* the change, so the preview is
           * applied directly and the marker is what shows the old size.
           */
          const showing = sizing && preview !== null ? preview : placed.placement;
          const poster = galleryPosterUrl(item);

          return (
            <li
              key={item.id}
              className={[
                'gallery-grid__cell',
                'canvas__cell',
                placed.auto ? 'canvas__cell--auto' : 'canvas__cell--pinned',
                drag?.id === item.id ? 'is-dragging' : '',
                edit.isSelected({ kind: 'media', id: item.id }) ? 'is-selected' : '',
              ]
                .join(' ')
                .trim()}
              style={{
                gridColumn: `${showing.col} / span ${showing.colSpan}`,
                gridRow: `${showing.row} / span ${showing.rowSpan}`,
                ...(moving && offset
                  ? {
                      /*
                        `translate3d` rather than `translate`: it puts the tile on
                        its own compositor layer for the duration of the drag, so
                        following the pointer is a paint-free transform rather than
                        a layout of the whole grid on every pointermove.
                      */
                      transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                      // No transition *while* dragging — a lag between the finger
                      // and the picture is the one thing worse than a jump.
                      transition: 'none',
                    }
                  : {}),
              }}
            >
              {/*
                A button, so it is focusable and the keyboard nudge has somewhere
                to land. `touch-action: none` in CSS is what stops the browser
                treating a drag on it as a page scroll.
              */}
              <button
                type="button"
                className="canvas__grab"
                onPointerDown={(event) => start(event, item.id, 'move')}
                onKeyDown={(event) => nudge(event, item.id)}
                aria-label={`Move ${item.caption || 'photograph'}`}
              >
                {poster ? (
                  <img
                    src={poster}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ objectPosition: focalPosition(item.focal) }}
                  />
                ) : (
                  <span className="canvas__blank">Processing…</span>
                )}
              </button>

              <span className="canvas__badge">
                {placed.auto ? 'Auto' : `${showing.colSpan}×${showing.rowSpan}`}
              </span>

              {/*
                Out of the block, not deleted.

                Top-right, the same corner the wheels put theirs in — a × that moves
                between displays is one somebody has to look for on each. "Auto"
                moved down to the bottom-left to make room, which is the right way
                round: the × is pressed constantly while arranging a page and Auto
                is pressed once per photograph that was dragged.
              */}
              {onRemove && (
                <button
                  type="button"
                  className="canvas__remove"
                  title="Take this out of the block"
                  aria-label={`Take ${item.caption || 'this photograph'} out of the block`}
                  // Otherwise the press starts a drag of the tile underneath and
                  // the click never lands.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              )}

              {!placed.auto && (
                <button
                  type="button"
                  className="canvas__auto"
                  onClick={() => auto(item.id)}
                  title="Let the page place this one"
                >
                  Auto
                </button>
              )}

              <span
                className="canvas__handle"
                onPointerDown={(event) => start(event, item.id, 'resize')}
                // Not a button: it is a pointer-only affordance, and the keyboard
                // route to the same thing is Shift with the arrow keys on the tile
                // itself. A focusable control that keyboard users cannot use is
                // worse than one they are not offered.
                aria-hidden="true"
              >
                <Icon name="expand" size={12} />
              </span>
            </li>
          );
        })}

        {/*
          Where it will land.

          The other half of letting the tile follow the pointer: once the picture
          is no longer sitting in the cell it is going to, something has to say
          which cell that is. Without it a smooth drag is *less* informative than
          the jumpy one it replaced — the snap becomes invisible until you let go,
          and a twelve-column grid is not something anybody eyeballs to the column.

          A hole in the grid rather than a copy of the picture: it is the shape of
          the space about to be taken, and a second copy of the same photograph
          floating under the first is the thing that reads as a rendering fault.
        */}
        {drag !== null && preview !== null && (
          <li
            className="canvas__target"
            aria-hidden="true"
            style={{
              gridColumn: `${preview.col} / span ${preview.colSpan}`,
              gridRow: `${preview.row} / span ${preview.rowSpan}`,
            }}
          />
        )}
      </ul>
    </div>
  );
}

/** Whether a drag actually moved anything. */
function same(a: GridPlacement, b: GridPlacement): boolean {
  return a.col === b.col && a.row === b.row && a.colSpan === b.colSpan && a.rowSpan === b.rowSpan;
}
