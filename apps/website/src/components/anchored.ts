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

/**
 * The least room worth squeezing a panel into.
 *
 * Below this, sitting beside the anchor stops being a service. A panel of
 * captions and dates in a 160px letterbox is a scrolling slot two rows tall, and
 * that is what a full-height anchor produces: `/events` draws window-tall
 * ministry plates, so a tile 686px high in a 900px window leaves 47px under it
 * and 127px over it, and the arithmetic below dutifully picked the larger.
 *
 * Tommy on the result: *"I don't like how the editing panel looks and where it is
 * located very inconvenient."* Quite so.
 */
export const ANCHOR_MIN_ROOM = 260;

export interface Placement {
  left: number;
  top: number;
  /** True when the panel had to go above its anchor rather than below. */
  flipped: boolean;
  /** The room available, so a long panel scrolls rather than running off. */
  maxHeight: number;
  /**
   * There was nowhere beside the anchor worth using, so the caller should stop
   * anchoring and present the panel as a sheet.
   *
   * Reported rather than handled here because this module only does arithmetic —
   * where a sheet goes and what it looks like is a CSS question, and the two
   * callers answer it the same way but own it themselves.
   */
  cramped: boolean;
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
  const room = flipped ? above : below;

  /*
   * Neither side has enough room, which is not the same as "the panel is taller
   * than the space". An anchor most of the window high has no usable side at all,
   * and the honest answer is to stop pretending: the caller centres it instead.
   */
  const cramped = Math.max(above, below) < ANCHOR_MIN_ROOM;

  const maxHeight = Math.max(ANCHOR_MIN_ROOM, room);

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

  return { left, top, flipped, maxHeight, cramped };
}
