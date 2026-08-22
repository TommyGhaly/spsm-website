'use client';

import { useCallback, useRef, useState } from 'react';
import { DEFAULT_FOCAL, focalPosition, type FocalPoint } from '@spsm/shared';

/**
 * Where in a photograph the thing that matters is. Click it.
 *
 * ## A field everything read and nothing wrote
 *
 * `GalleryMedia.focal` has been in the schema since it was written, with a note
 * saying what it is for: *"what must survive a crop, as a fraction of width and
 * height. Square thumbnails of a group photograph cut off faces without it."*
 * Every surface honours it — the grid, the canvas, the card covers, the picker
 * tiles, the presentation, all through `focalPosition` — and **nothing anywhere
 * set it.** Every photograph in the parish is `{ x: 0.5, y: 0.5 }`, because
 * that is the literal `submit.ts` writes and there was no second writer.
 *
 * So the crop was centred on every gallery on the site, and the one case the
 * field was added for — a wide group shot in a square tile, faces along the top —
 * was exactly the case that came out wrong. This is the missing half.
 *
 * ## Click the picture, not two number boxes
 *
 * The value is two fractions, and there is no arrangement of number inputs that
 * makes "0.42, 0.28" mean a face. Pressing the face is the whole interaction:
 * the marker goes where the pointer is, the frame beside it shows what a square
 * crop keeps, and both are the same photograph so the comparison needs no
 * explanation.
 *
 * Dragging works for the same reason a nudge does — this is a position, and
 * positions are dragged. Arrow keys move it a percent at a time, which is the
 * only way to be precise and the only way to do it at all without a pointer.
 *
 * ## Every move is written
 *
 * Live, like everything else in this panel: `onChange` fires on release and on
 * each key, and the caller persists. There is nothing to validate — the value is
 * clamped to the picture — and nothing to undo but another click.
 */
export function FocalPicker({
  /** A URL for the photograph itself, already resolved. */
  src,
  focal,
  onChange,
  busy = false,
}: {
  src: string;
  focal: FocalPoint;
  onChange: (next: FocalPoint) => void;
  busy?: boolean;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  /**
   * The point under the pointer while dragging, before it is committed.
   *
   * So the marker and the preview follow the finger without a Firestore write
   * per pixel. `null` means "use the stored value".
   */
  const [dragging, setDragging] = useState<FocalPoint | null>(null);
  const shown = dragging ?? focal;

  /** Pointer position as a fraction of the frame, clamped to it. */
  const pointFrom = useCallback((clientX: number, clientY: number): FocalPoint => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return DEFAULT_FOCAL;
    return {
      x: clamp((clientX - box.left) / box.width),
      y: clamp((clientY - box.top) / box.height),
    };
  }, []);

  return (
    <div className="focal">
      {/*
        The photograph, whole and uncropped, with the marker on it. `contain`
        rather than `cover`: this is the one place on the site that must show the
        picture the administrator is choosing *within*, so cropping it here would
        hide the very edges the control exists to rescue.
      */}
      <div
        className="focal__frame"
        ref={frame}
        role="slider"
        tabIndex={busy ? -1 : 0}
        aria-label="The part of this picture that must not be cropped"
        // Two axes in one control, so the value is stated in words rather than
        // as a number a screen reader would read as meaningless.
        aria-valuetext={`${Math.round(shown.x * 100)}% across, ${Math.round(shown.y * 100)}% down`}
        onPointerDown={(down) => {
          if (busy) return;
          /*
           * Capture, so a drag that leaves the frame keeps reporting. Without it
           * the marker sticks at the edge the pointer left by, which reads as the
           * control having a smaller area than the picture it is on.
           *
           * Guarded because a synthetic pointer event — which is how this is
           * exercised in a headless browser — carries a pointerId the browser has
           * never seen, and `setPointerCapture` throws on it.
           */
          try {
            down.currentTarget.setPointerCapture(down.pointerId);
          } catch {
            /* not a real pointer; the move handler still works */
          }
          setDragging(pointFrom(down.clientX, down.clientY));
        }}
        onPointerMove={(move) => {
          if (dragging === null) return;
          setDragging(pointFrom(move.clientX, move.clientY));
        }}
        onPointerUp={(up) => {
          if (dragging === null) return;
          const next = pointFrom(up.clientX, up.clientY);
          setDragging(null);
          onChange(next);
        }}
        /*
         * A cancelled drag — a browser gesture taking over, the window losing
         * focus — commits where it got to rather than snapping back. The marker
         * has been following the finger, so reverting would undo something the
         * person watched themselves do.
         */
        onPointerCancel={() => {
          if (dragging === null) return;
          onChange(dragging);
          setDragging(null);
        }}
        onKeyDown={(key) => {
          const step = key.shiftKey ? 0.1 : 0.02;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const move = moves[key.key];
          if (!move) return;
          key.preventDefault();
          onChange({ x: clamp(focal.x + move[0]), y: clamp(focal.y + move[1]) });
        }}
      >
        <img src={src} alt="" draggable={false} />

        {/*
          A ring, not a dot: it has to be visible over a bright sky and a dark
          doorway alike, and a filled marker large enough to see over both would
          cover the face it is pointing at.
        */}
        <span
          className="focal__marker"
          aria-hidden="true"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
        />
      </div>

      {/*
        What a square crop keeps, from the same value.

        The reason a preview is here rather than a note saying "affects
        thumbnails": square is the shape that crops hardest and the shape the card
        covers and picker tiles use, so it is the one where a wrong focal point
        actually costs somebody a face. Seeing both at once is the whole control.
      */}
      <div className="focal__crop" aria-hidden="true">
        <img src={src} alt="" style={{ objectPosition: focalPosition(shown) }} />
      </div>

      <p className="inspector__note">
        Click or drag on the picture to say what must stay in frame — a face, the
        altar. Arrow keys nudge it. The square beside it is what a card or a tile
        keeps.
      </p>
    </div>
  );
}

/** Into [0, 1]. A drag that left the frame and a held arrow key both land here. */
function clamp(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
