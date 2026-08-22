import {
  GALLERY_COLUMNS,
  clampPlacement,
  type GridPlacement,
} from '../schema/programs.js';
import { SECTION_COLUMNS } from '../schema/sectionLayout.js';

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
 * The narrowest box auto-layout will ever draw.
 *
 * Load-bearing rather than descriptive: it is how the packer knows a leftover
 * strip is *unusable*. Fewer than four columns of the twelve is 8% of the width
 * per column, and nothing in the list above is that narrow, so a gap of one,
 * two or three columns can never be filled by a later photograph. See
 * `stretchIntoDeadSpace`.
 */
const NARROWEST_SPAN = Math.min(WIDE[0], HALF[0], THIRD[0], TALL[0]);

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

    const stretched = stretchIntoDeadSpace(placement, taken);
    occupy(stretched);
    placed.push({ id: item.id, placement: stretched, auto: true });
  }

  // Back into the caller's order. The packer needs manual-first; a renderer
  // wants the administrator's ordering, and the DOM order is what a screen
  // reader and keyboard tabbing follow.
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items
    .map((item) => byId.get(item.id))
    .filter((p): p is PlacedItem => p !== undefined);
}

/* -------------------------------------------------------------------------- */
/* The same thing again, for the blocks a page is made of                      */
/* -------------------------------------------------------------------------- */

/**
 * One block, as the packer sees it: how many of the page's columns it takes, and
 * how many row units tall it is.
 *
 * Deliberately not a `SectionLayout`. A photograph's shape comes from its
 * proportions and a block's comes from what is inside it, which only the browser
 * knows — so the caller measures and this stays pure. See `useBlockPacking`.
 */
export interface BlockBox {
  columns: number;
  rows: number;
}

/** Where one block landed. 1-indexed, like `GridPlacement`, for the same reason. */
export interface BlockSpot {
  col: number;
  row: number;
}

/**
 * Lay out the blocks of a page the way `packGallery` lays out photographs.
 *
 * Tommy: *"I want the entire sections to work the same way as the grid — where if
 * there is room to fit them in a given place it can go there, it doesn't have to be
 * set in stone and reserve more space than necessary."*
 *
 * ## What this replaced
 *
 * CSS auto-placement, which never runs backwards: a block that did not fit the
 * current row started a new one, under the *page* rather than under its neighbour,
 * and the columns beside a tall block stayed empty for its whole height. A page
 * with a tall grid and two wheels reserved three rows for two rows of content.
 *
 * Now every block takes the first place it fits, top to bottom and left to right —
 * so a wheel drops into the space beside a grid, and a second one under the first,
 * without anything being told to. It is the same first-fit scan as `packGallery`,
 * on the same twelve columns, and that is the point: a page of blocks and a block
 * of photographs should not have two different ideas of what "there is room here"
 * means.
 *
 * ## Why it scans candidate rows rather than every row
 *
 * `packGallery` walks `row = 1, 2, 3…` because a photograph is a handful of rows
 * tall. A block is measured in units of half a rem and can be two hundred of them,
 * so the same loop would test tens of thousands of positions per block.
 *
 * It does not need to: a first fit can only *start* at the top of the page or
 * immediately below something already placed. Anywhere else has a block directly
 * above it, and if there were room there, the scan would already have taken it one
 * row higher. So the candidates are `1` and the bottom edge of each placed block —
 * at most five rows on a page that carries four.
 *
 * ## Reading order is the document's, not this
 *
 * Blocks come back in the order they were given, and the caller renders them in
 * that order — only their *position* comes from here. A screen reader and the tab
 * key follow the page's own order, which is the same choice the photograph canvas
 * makes.
 */
export function packBlocks(boxes: readonly BlockBox[]): BlockSpot[] {
  const placed: (BlockSpot & BlockBox)[] = [];

  const clear = (col: number, row: number, box: BlockBox) =>
    placed.every(
      (one) =>
        col + box.columns <= one.col ||
        one.col + one.columns <= col ||
        row + box.rows <= one.row ||
        one.row + one.rows <= row,
    );

  return boxes.map((box) => {
    // Never wider than the page, and never zero-height: a block that measured
    // nothing — one whose pictures have not been laid out yet — would otherwise be
    // a hole every later block could be placed inside.
    const columns = Math.min(Math.max(box.columns, 1), SECTION_COLUMNS);
    const rows = Math.max(box.rows, 1);
    const shape = { columns, rows };

    const candidates = [1, ...placed.map((one) => one.row + one.rows)].sort(
      (a, b) => a - b,
    );

    for (const row of candidates) {
      for (let col = 1; col <= SECTION_COLUMNS - columns + 1; col += 1) {
        if (clear(col, row, shape)) {
          const spot = { col, row };
          placed.push({ ...spot, ...shape });
          return spot;
        }
      }
    }

    /*
     * Unreachable: the row below everything placed is always among the candidates
     * and always empty. Written out rather than left to a non-null assertion,
     * because "cannot happen" in a layout function usually means "happens on the
     * one page nobody tested".
     */
    const bottom = placed.reduce((low, one) => Math.max(low, one.row + one.rows), 1);
    placed.push({ col: 1, row: bottom, ...shape });
    return { col: 1, row: bottom };
  });
}

/**
 * Widen a placement into the unusable strip to its right, if there is one.
 *
 * ## The hole this closes
 *
 * Twelve columns and boxes of 12, 6 and 4 do not always divide. Pin one
 * photograph six columns wide at the top — which an administrator does by
 * dragging, and which is the whole point of manual placement — and six columns
 * are left beside it. A four-column box goes in, and **two columns are then dead
 * for the height of that box**: nothing in the shape list is narrower than four,
 * so no later photograph can ever fill them.
 *
 * On screen that is a 175-pixel column of empty paper down the side of the
 * gallery, and it reads as a picture that failed to load rather than as
 * whitespace. It was the most visible thing wrong with the section after the
 * spacing was fixed.
 *
 * ## Why widening, and not a narrower shape
 *
 * Adding a two-column box to the list would fill the gap and would also let
 * auto-layout put a photograph in a 90-pixel slot, which is not a photograph.
 * The short list of widths is deliberate — "the failure mode of a photo grid is
 * a page where every picture is a different size" — and this keeps it: the box is
 * still one of three widths *plus whatever it takes to reach the edge*, which is
 * what a masonry layout does and why its right edge is always flush.
 *
 * Only ever extends into space that no shape could have used, so it can never
 * take a slot from a later photograph. Manual placements are reserved before any
 * auto item is placed, so `taken` already accounts for every pin — this cannot
 * grow over one.
 *
 * Manual placements are not stretched. An administrator who sized a photograph
 * by hand has said what size it should be.
 */
function stretchIntoDeadSpace(
  placement: GridPlacement,
  taken: ReadonlySet<string>,
): GridPlacement {
  const columnFree = (col: number) => {
    for (let row = placement.row; row < placement.row + placement.rowSpan; row += 1) {
      if (taken.has(`${row}:${col}`)) return false;
    }
    return true;
  };

  let spare = 0;
  while (
    placement.col + placement.colSpan + spare <= GALLERY_COLUMNS &&
    columnFree(placement.col + placement.colSpan + spare)
  ) {
    spare += 1;
  }

  // A gap wide enough for a real box is left alone — the next photograph goes
  // there, which is a better use of it than making this one wider.
  if (spare === 0 || spare >= NARROWEST_SPAN) return placement;

  return { ...placement, colSpan: placement.colSpan + spare };
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
  return placed.reduce(
    (max, { placement }) => Math.max(max, placement.row + placement.rowSpan - 1),
    0,
  );
}
