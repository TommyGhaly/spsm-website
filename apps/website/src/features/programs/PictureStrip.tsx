'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { focalPosition, type DocOf, type GalleryMedia } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl } from './media';

/**
 * A wheel's photographs, while somebody is editing: drag one to move it, press
 * its × to take it off the page.
 *
 * ## Why a wheel needs its own editing view
 *
 * A grid has the canvas — drag a tile, resize it, and the packer routes the rest
 * around it. A wheel has no canvas because its layout is not a set of positions:
 * it is an **order**. So the only meaningful arrangement is "this one before that
 * one", and until now the only way to say it was two buttons in a panel labelled
 * *Move earlier* and *Move later*.
 *
 * Tommy: *"it should be easy to simply drag a scrollwheel to where I want it to be
 * and delete it when I don't want it anymore, same with the rest of the pictures
 * and videos."* Which is this.
 *
 * ## It is a plain strip, not the drifting rail
 *
 * The public wheel is `DragRail` — it loops, it renders its children two or three
 * times to make the seam invisible, and it drifts. Every one of those is wrong to
 * drag inside: a duplicate tile has the same id as the original, so "which one did
 * you grab" has no answer, and a strip that moves under the hand cannot be aimed
 * at.
 *
 * So while editing the wheel is a single, still, scrollable row. It is the same
 * tiles at the same size in the same order, which is what makes it a faithful
 * enough thing to arrange in — and the moment editing stops it is the real wheel
 * again.
 *
 * ## The drag reorders by midpoint
 *
 * Unlike the blocks — which move one place per drag, because a page has three of
 * them — a wheel can hold hundreds, so "one place per drag" would be unusable.
 * The tile follows the pointer and the gap opens wherever it is: the target is
 * whichever tile's midpoint the pointer has passed, recomputed from live boxes on
 * every move.
 */
export function PictureStrip({
  media,
  axis,
  onReorder,
  onRemove,
  onSelect,
}: {
  media: readonly DocOf<GalleryMedia>[];
  axis: 'x' | 'y';
  /** The whole set, in its new order. One write, never a swap. */
  onReorder: (ordered: DocOf<GalleryMedia>[]) => void;
  /** Take this one off the page. Never deletes the photograph itself. */
  onRemove: (mediaId: string) => void;
  onSelect?: ((index: number) => void) | undefined;
}) {
  const strip = useRef<HTMLUListElement | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
    dx: number;
    dy: number;
  } | null>(null);

  /**
   * The order as it stands mid-drag, so the gap opens where the pointer is.
   *
   * Derived rather than stored: the source order is `media`, and holding a second
   * copy of it is how the strip and the page end up disagreeing about where a
   * picture is.
   */
  const shown = (() => {
    if (drag === null) return media;
    const next = [...media];
    const [lifted] = next.splice(drag.from, 1);
    if (!lifted) return media;
    next.splice(drag.to, 0, lifted);
    return next;
  })();

  const begin = useCallback(
    (event: React.PointerEvent, id: string, index: number) => {
      // Otherwise the browser starts its own image-drag on the photograph.
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still work */
      }
      setDrag({ id, from: index, to: index, dx: 0, dy: 0 });
    },
    [],
  );

  useEffect(() => {
    if (drag === null) return;
    const node = strip.current;
    if (!node) return;

    const origin = { x: 0, y: 0 };
    const grabbed = node.querySelector<HTMLElement>(`[data-media="${drag.id}"]`);
    const box = grabbed?.getBoundingClientRect();
    if (box) {
      origin.x = box.left + box.width / 2;
      origin.y = box.top + box.height / 2;
    }

    const onMove = (event: PointerEvent) => {
      /*
       * Where the pointer is, against every tile's midpoint.
       *
       * Read off the live boxes rather than computed from a tile width, because a
       * strip's tiles are each the shape of their own photograph — a panorama and
       * a portrait next to each other are nowhere near the same width.
       */
      const tiles = [...node.querySelectorAll<HTMLElement>('[data-media]')];
      let to = 0;
      for (const [at, tile] of tiles.entries()) {
        const rect = tile.getBoundingClientRect();
        const middle = axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
        const pointer = axis === 'x' ? event.clientX : event.clientY;
        if (pointer > middle) to = at;
      }

      setDrag((was) =>
        was === null
          ? null
          : {
              ...was,
              to,
              dx: event.clientX - origin.x,
              dy: event.clientY - origin.y,
            },
      );
    };

    const onUp = () => {
      const landed = drag;
      setDrag(null);
      if (landed.to === landed.from) return;
      const next = [...media];
      const [lifted] = next.splice(landed.from, 1);
      if (!lifted) return;
      next.splice(landed.to, 0, lifted);
      onReorder(next);
    };

    // On `window`: a drag that ends outside it would otherwise never see its
    // `pointerup`, leaving the strip stuck mid-drag with no way out but a reload.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, media, onReorder, axis]);

  return (
    <ul
      className={`pstrip pstrip--${axis}${drag ? ' is-dragging' : ''}`}
      ref={strip}
    >
      {shown.map((item, index) => {
        const poster = galleryPosterUrl(item);
        const moving = drag?.id === item.id;

        return (
          <li
            key={item.id}
            data-media={item.id}
            className={`pstrip__cell${moving ? ' is-moving' : ''}`}
            style={{
              aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : '3 / 2',
              ...(moving && drag
                ? {
                    // Follows the pointer on its own layer; no transition, because
                    // lag between the finger and the picture is worse than a jump.
                    transform: `translate3d(${drag.dx}px, ${drag.dy}px, 0)`,
                    transition: 'none',
                  }
                : {}),
            }}
          >
            <button
              type="button"
              className="pstrip__grab"
              onPointerDown={(event) => begin(event, item.id, index)}
              /*
                A keyboard route, because a drag has none. `[` and `]` rather than
                the arrow keys: a strip is inside a scroll container and the arrows
                are how somebody scrolls it.
              */
              onKeyDown={(key) => {
                const step = key.key === '[' ? -1 : key.key === ']' ? 1 : 0;
                if (step === 0) return;
                key.preventDefault();
                const to = index + step;
                if (to < 0 || to >= media.length) return;
                const next = [...media];
                const [lifted] = next.splice(index, 1);
                if (!lifted) return;
                next.splice(to, 0, lifted);
                onReorder(next);
              }}
              aria-label={`Move ${item.caption || 'photograph'}`}
            >
              {poster ? (
                <img
                  src={poster}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  style={{ objectPosition: focalPosition(item.focal) }}
                />
              ) : (
                <span className="pstrip__blank">Processing…</span>
              )}
            </button>

            {/*
              Off the page, not deleted.

              It removes this photograph from what *this page* shows. The
              photograph itself stays approved, stays in the parish's storage, and
              stays on the page of the level it is filed under — which is why this
              needs no confirmation and says "off this page" rather than "delete".
            */}
            <button
              type="button"
              className="pstrip__remove"
              title="Take this off the page"
              aria-label={`Take ${item.caption || 'this photograph'} off this page`}
              onClick={() => onRemove(item.id)}
            >
              <Icon name="close" size={12} />
            </button>

            {onSelect && (
              <button
                type="button"
                className="pstrip__open"
                title="Open it"
                aria-label={`Open ${item.caption || 'photograph'}`}
                onClick={() => onSelect(index)}
              >
                <Icon name="expand" size={12} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
