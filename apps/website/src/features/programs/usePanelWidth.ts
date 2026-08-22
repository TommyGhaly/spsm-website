'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How wide the editing column is, dragged by its edge and remembered.
 *
 * ## Why the width lives on `document.body` as a custom property
 *
 * Because three unrelated things have to agree about it, and only one of them is
 * this component. The column's own width; the `padding-right` that makes room for
 * it, which is on `body` because a full-bleed rail measures itself against the
 * viewport and narrowing it needs a selector above the article; and
 * `.rail--bleed`'s `100vw` arithmetic, which is in the stylesheet and cannot be
 * handed a React value. A custom property is the only channel all three can read.
 *
 * It is set imperatively rather than through a `style` prop for the same reason:
 * the element that needs it is `body`, which no component owns.
 *
 * ## Why localStorage and not Firestore
 *
 * This is one person's preference on one screen, not the parish's data. Writing it
 * to Firestore would put a per-device UI setting in the document the mobile app
 * reads, and would make "how wide is my panel" a thing two administrators can
 * disagree about across a network.
 *
 * Read once on mount and never again — `localStorage` is synchronous and this runs
 * in an effect, so a server render never touches it.
 */

const KEY = 'spsm.editPanelWidth';

/*
 * The stops. Narrower than `MIN` and the date row and the disclosure rows stop
 * fitting; wider than `MAX` and the gallery being judged is the smaller half of
 * the screen, which is the mistake the 22rem column made the first time.
 */
const MIN = 288;
const MAX = 560;
const DEFAULT = 352;

function clamp(px: number): number {
  /*
   * Also capped at 40% of the window, so a width dragged out on a wide monitor and
   * remembered does not swallow a laptop. Checked against `MIN` last, so a very
   * narrow window gets a usable panel rather than an arithmetically tidy one.
   */
  const ceiling = Math.min(MAX, Math.round(window.innerWidth * 0.4));
  return Math.max(MIN, Math.min(px, Math.max(MIN, ceiling)));
}

export interface PanelWidth {
  /** In pixels. Only meaningful once `ready` — before that it is the default. */
  width: number;
  /** Starts a drag from the panel's edge. */
  onGrab: (event: React.PointerEvent) => void;
  /**
   * Widen or narrow by a step, for the arrow keys.
   *
   * The handle is the one control in the column a keyboard cannot otherwise
   * operate — a drag has no keyboard equivalent — and a resizer that only exists
   * for a mouse is a panel somebody cannot make readable.
   */
  onNudge: (by: number) => void;
  dragging: boolean;
}

export function usePanelWidth(active: boolean): PanelWidth {
  const [width, setWidth] = useState(DEFAULT);
  const [dragging, setDragging] = useState(false);

  /* Restore. Guarded rather than trusted: a hand-edited or stale value is a
     panel that fills the screen, and the clamp is what makes that impossible. */
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved > 0) setWidth(clamp(saved));
  }, []);

  /*
   * Publish the width, and take it away again.
   *
   * The cleanup is the load-bearing half: `--edit-gutter` is what `.is-editing`
   * pads by and what `.rail--bleed` subtracts, so a value left behind after Done
   * would leave every page on the site padded for a panel that is not there. Same
   * failure `BodyEditingClass` guards against with its own class.
   */
  useEffect(() => {
    if (!active) return;
    document.body.style.setProperty('--edit-gutter', `${width}px`);
    return () => {
      // Braced, not a concise arrow: `removeProperty` returns the old value, and
      // returning a string from a cleanup is a type error rather than a bug.
      document.body.style.removeProperty('--edit-gutter');
    };
  }, [active, width]);

  /* Re-clamp when the window changes: a panel dragged wide on a big monitor is
     over 40% of a small one, and the page behind it has to stay usable. */
  useEffect(() => {
    if (!active) return;
    const onResize = () => setWidth((was) => clamp(was));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  const from = useRef<{ x: number; width: number } | null>(null);

  const onGrab = useCallback(
    (event: React.PointerEvent) => {
      // Otherwise the browser starts a text selection across the page behind.
      event.preventDefault();
      from.current = { x: event.clientX, width };
      setDragging(true);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still work */
      }
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      const start = from.current;
      if (!start) return;
      // Dragging left widens: the handle is on the panel's left edge and the panel
      // is on the right, so the two move in opposite directions.
      setWidth(clamp(start.width + (start.x - event.clientX)));
    };

    const stop = () => {
      setDragging(false);
      from.current = null;
      // Written on release rather than on every move: a drag is a hundred events
      // and `localStorage` is synchronous.
      setWidth((settled) => {
        window.localStorage.setItem(KEY, String(settled));
        return settled;
      });
    };

    /*
     * On `window`, not the handle: a drag that ends outside the window — which is
     * how a drag towards the edge of the screen normally ends — would otherwise
     * never see its `pointerup`, leaving the panel stuck following the cursor.
     */
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging]);

  const onNudge = useCallback((by: number) => {
    setWidth((was) => {
      const next = clamp(was + by);
      window.localStorage.setItem(KEY, String(next));
      return next;
    });
  }, []);

  return { width, onGrab, onNudge, dragging };
}

export { MIN as PANEL_MIN, MAX as PANEL_MAX };
