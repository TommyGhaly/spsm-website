/**
 * Where to put a floating panel so it sits beside the thing it is about.
 *
 * Extracted out of `Popover` because two different kinds of caller need the same
 * arithmetic and neither should own it: `Popover` anchors a panel to its own
 * trigger button, and the galleries' `Inspector` anchors one to whatever was
 * clicked somewhere else on the page. The rules — prefer below, flip only when
 * that is clearly worse, never leave the window — are the same either way, and
 * two copies of them would drift.
 *
 * Pure, and deliberately so: it takes two rectangles and the window's size and
 * returns numbers. That makes the awkward part — the flipping and the clamping —
 * testable without a browser.
 */

/** How far a panel sits from its anchor, and from the window's edges. */
export const ANCHOR_GAP = 8;
export const ANCHOR_MARGIN = 12;

export interface Placement {
  left: number;
  top: number;
  /** True when the panel had to go above its anchor rather than below. */
  flipped: boolean;
  /** The room available, so a long panel scrolls rather than running off. */
  maxHeight: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export function placeBeside(
  anchor: { top: number; bottom: number; left: number; right: number },
  panel: { width: number; height: number },
  view: Viewport,
  {
    /**
     * Line the panel's *right* edge up with the anchor's instead of its left.
     *
     * For a control already in the right-hand part of the window — the galleries'
     * corner pill — where left-aligning means the panel is immediately clamped
     * and appears to have nothing to do with what opened it.
     */
    align = 'start',
  }: { align?: 'start' | 'end' } = {},
): Placement {
  const below = view.height - anchor.bottom - ANCHOR_GAP - ANCHOR_MARGIN;
  const above = anchor.top - ANCHOR_GAP - ANCHOR_MARGIN;

  /*
   * Below unless below is both too small *and* worse than above. The bias
   * matters: a panel that flips upward the moment it is one pixel short jumps
   * about as somebody scrolls, and reading downward from the thing you clicked is
   * what everybody expects.
   */
  const flipped = panel.height > below && above > below;
  const maxHeight = Math.max(160, flipped ? above : below);

  const top = flipped
    ? Math.max(ANCHOR_MARGIN, anchor.top - ANCHOR_GAP - Math.min(panel.height, maxHeight))
    : anchor.bottom + ANCHOR_GAP;

  const wanted = align === 'end' ? anchor.right - panel.width : anchor.left;

  /*
   * Clamped into the window. `Math.max` on the outside as well as the inside,
   * because on a window narrower than the panel the two bounds cross over and
   * the inner `Math.min` would otherwise return a negative left.
   */
  const left = Math.min(
    Math.max(ANCHOR_MARGIN, wanted),
    Math.max(ANCHOR_MARGIN, view.width - panel.width - ANCHOR_MARGIN),
  );

  return { left, top, flipped, maxHeight };
}
