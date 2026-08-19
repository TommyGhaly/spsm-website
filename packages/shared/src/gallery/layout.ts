import {
  GALLERY_COLUMNS,
  clampPlacement,
  type GridPlacement,
} from '../schema/programs.js';

/**
 * Placing photographs on the gallery canvas.
 *
 * Two jobs, and they have to be the same function because they interleave:
 *
 *   - **auto** — an administrator marks photographs for the page and gets a
 *     sensible arrangement without doing any work
 *   - **manual** — they drag one, and it stays exactly where they put it while
 *     everything else flows around it
 *
 * Pure, and in `@spsm/shared` rather than the website, for the reason the whole
 * layout model is four integers: the mobile app has to lay out the same gallery
 * from the same documents and get the same answer. A packing algorithm that
 * lived in a React component would be reimplemented there, and the two would
 * disagree.
 */

/** What the packer needs to know about one item. Deliberately not the document. */
export interface Placeable {
  id: string;
  /** Manual position, or null to let the packer choose. */
  layout: GridPlacement | null;
  /** Width ÷ height of the source. Drives the shape auto-layout gives it. */
  aspect: number | null;
}

export interface PlacedItem {
  id: string;
  placement: GridPlacement;
  /** False when the administrator positioned this one by hand. */
  auto: boolean;
}

/**
 * The shapes auto-layout draws from, as [colSpan, rowSpan].
 *
 * A deliberately short list. The failure mode of a photo grid is not "too few
 * sizes", it is a page where every picture is a different size and the eye has
 * nowhere to rest — so there are three widths, and a portrait variant that is
 * tall instead of wide.
 */
const WIDE: readonly [number, number] = [12, 4];
const HALF: readonly [number, number] = [6, 4];
const THIRD: readonly [number, number] = [4, 3];
const TALL: readonly [number, number] = [4, 6];

/**
 * Pick a shape for one photograph from its proportions.
 *
 * Panoramas earn the full width because scaled into a third-column box they
 * become a stripe. Portraits get the tall box for the same reason in the other
 * direction. Everything else is an ordinary snapshot and takes an ordinary box.
 */
function shapeFor(aspect: number | null, index: number): readonly [number, number] {
  if (aspect === null) return THIRD;
  if (aspect >= 2.2) return WIDE;
  if (aspect <= 0.8) return TALL;
  // A gentle rhythm rather than a uniform grid: every fourth landscape picture
  // gets a half-width box, which breaks up an otherwise relentless row of
  // thirds without asking anybody to choose.
  return index % 4 === 0 ? HALF : THIRD;
}

/**
 * Lay out a gallery.
 *
 * Manual placements are honoured exactly and reserved first; auto items are
 * then packed into whatever is left, top-to-bottom and left-to-right, taking
 * the first gap each one fits in. That is what produces "drag one photograph
 * and the others flow around it" — the manual item is simply an occupied
 * region the packer has to route around, no different from a photograph
 * already placed.
 *
 * The result is stable: the same input always gives the same output, so a page
 * does not reshuffle itself between two visitors or between the website and the
 * app.
 */
export function packGallery(items: readonly Placeable[]): PlacedItem[] {
  /** Occupied cells, keyed `row:col`. Sparse, because the canvas is unbounded. */
  const taken = new Set<string>();
  const placed: PlacedItem[] = [];

  const occupy = (p: GridPlacement) => {
    for (let r = p.row; r < p.row + p.rowSpan; r += 1) {
      for (let c = p.col; c < p.col + p.colSpan; c += 1) taken.add(`${r}:${c}`);
    }
  };

  const free = (p: GridPlacement) => {
    for (let r = p.row; r < p.row + p.rowSpan; r += 1) {
      for (let c = p.col; c < p.col + p.colSpan; c += 1) {
        if (taken.has(`${r}:${c}`)) return false;
      }
    }
    return true;
  };

  // Manual first, and all of it, before any auto item is placed. Doing this in
  // one pass in document order would let an auto item claim a cell that a
  // manual item further down the list has already been promised, and the
  // administrator's drag would silently move.
  for (const item of items) {
    if (!item.layout) continue;
    const placement = clampPlacement(item.layout);
    occupy(placement);
    placed.push({ id: item.id, placement, auto: false });
  }

  let autoIndex = 0;
  for (const item of items) {
    if (item.layout) continue;

    const [colSpan, rowSpan] = shapeFor(item.aspect, autoIndex);
    autoIndex += 1;

    // Scan for the first gap. Unbounded downward: there is always a free row
    // below everything placed so far, so this cannot fail to terminate.
    let placement: GridPlacement | null = null;
    for (let row = 1; placement === null; row += 1) {
      for (let col = 1; col <= GALLERY_COLUMNS - colSpan + 1; col += 1) {
        const candidate = { col, row, colSpan, rowSpan };
        if (free(candidate)) {
          placement = candidate;
          break;
        }
      }
    }

    occupy(placement);
    placed.push({ id: item.id, placement, auto: true });
  }

  // Back into the caller's order. The packer needs manual-first; a renderer
  // wants the administrator's ordering, and the DOM order is what a screen
  // reader and keyboard tabbing follow.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((item) => byId.get(item.id)).filter((p): p is PlacedItem => p !== undefined);
}

/**
 * The same gallery on a narrow screen: one column, in reading order.
 *
 * A layout built on a 1400px canvas cannot be shown at 375px — a third-width
 * box is 100 pixels — so the phone does not try. It reads the placements
 * top-to-bottom, then left-to-right, and stacks them.
 *
 * Reading order, not document order, and that is the point. An administrator
 * who drags a photograph to the top of the canvas means it to come first, and
 * a phone that ignored the position would show it wherever it happened to sit
 * in the list.
 */
export function collapseToColumn(placed: readonly PlacedItem[]): PlacedItem[] {
  return [...placed]
    .sort((a, b) =>
      a.placement.row !== b.placement.row
        ? a.placement.row - b.placement.row
        : a.placement.col - b.placement.col,
    )
    .map((item, index) => ({
      ...item,
      placement: { col: 1, row: index + 1, colSpan: GALLERY_COLUMNS, rowSpan: 1 },
    }));
}

/**
 * How many rows the canvas needs. Drives the container's height so the grid
 * does not collapse around absolutely-nothing when every item is manual.
 */
export function canvasRows(placed: readonly PlacedItem[]): number {
  return placed.reduce((max, { placement }) => Math.max(max, placement.row + placement.rowSpan - 1), 0);
}
