import { describe, it, expect } from 'vitest';
import {
  packGallery,
  collapseToColumn,
  canvasRows,
  clampPlacement,
  GALLERY_COLUMNS,
  type Placeable,
  type PlacedItem,
} from '@spsm/shared';

/**
 * The gallery packer.
 *
 * Worth testing properly rather than by looking at it, because the two things
 * it promises are invisible until they break in front of somebody:
 *
 *   - a photograph an administrator dragged stays exactly where they dropped it
 *   - nothing ever overlaps anything else
 *
 * Overlap is the nasty one. On screen two absolutely-placed images on the same
 * cells look like one image, so the second is not "misplaced", it is *gone* —
 * and only on the gallery where it happens.
 */

const auto = (id: string, aspect: number | null = 1.5): Placeable => ({ id, layout: null, aspect });

/** Every cell an arrangement covers, as `row:col`, for overlap checking. */
function cells(placed: readonly PlacedItem[]): string[] {
  const out: string[] = [];
  for (const { placement } of placed) {
    for (let r = placement.row; r < placement.row + placement.rowSpan; r += 1) {
      for (let c = placement.col; c < placement.col + placement.colSpan; c += 1) out.push(`${r}:${c}`);
    }
  }
  return out;
}

function expectNoOverlap(placed: readonly PlacedItem[]) {
  const all = cells(placed);
  expect(new Set(all).size).toBe(all.length);
}

describe('packGallery', () => {
  it('places everything it is given, once', () => {
    const placed = packGallery([auto('a'), auto('b'), auto('c'), auto('d')]);
    expect(placed.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('never overlaps, across a mix of shapes', () => {
    const placed = packGallery([
      auto('pano', 3.0),
      auto('portrait', 0.66),
      auto('snap-1'),
      auto('snap-2'),
      auto('snap-3'),
      auto('snap-4'),
      auto('unknown', null),
      auto('pano-2', 2.5),
    ]);
    expectNoOverlap(placed);
  });

  it('keeps every item inside the twelve columns', () => {
    const placed = packGallery(Array.from({ length: 30 }, (_, i) => auto(`p${i}`, i % 3 === 0 ? 3 : 1.4)));
    for (const { placement } of placed) {
      expect(placement.col).toBeGreaterThanOrEqual(1);
      expect(placement.col + placement.colSpan - 1).toBeLessThanOrEqual(GALLERY_COLUMNS);
    }
  });

  it('gives a panorama the full width and a portrait a tall box', () => {
    const placed = packGallery([auto('pano', 3.0), auto('portrait', 0.5)]);
    const pano = placed.find((p) => p.id === 'pano')!;
    const portrait = placed.find((p) => p.id === 'portrait')!;
    expect(pano.placement.colSpan).toBe(GALLERY_COLUMNS);
    expect(portrait.placement.rowSpan).toBeGreaterThan(portrait.placement.colSpan / 2);
  });

  /** The promise the whole manual/auto split exists to keep. */
  it('leaves a hand-placed photograph exactly where it was dropped', () => {
    const pinned = { col: 3, row: 2, colSpan: 6, rowSpan: 3 };
    const placed = packGallery([
      auto('a'),
      { id: 'pinned', layout: pinned, aspect: 1.5 },
      auto('b'),
      auto('c'),
    ]);
    expect(placed.find((p) => p.id === 'pinned')!.placement).toEqual(pinned);
    expect(placed.find((p) => p.id === 'pinned')!.auto).toBe(false);
    expectNoOverlap(placed);
  });

  it('flows auto items around several pinned ones', () => {
    const placed = packGallery([
      { id: 'p1', layout: { col: 1, row: 1, colSpan: 4, rowSpan: 4 }, aspect: 1 },
      { id: 'p2', layout: { col: 9, row: 1, colSpan: 4, rowSpan: 4 }, aspect: 1 },
      ...Array.from({ length: 10 }, (_, i) => auto(`a${i}`)),
    ]);
    expectNoOverlap(placed);
    expect(placed.find((p) => p.id === 'p1')!.placement.row).toBe(1);
    expect(placed.find((p) => p.id === 'p2')!.placement.col).toBe(9);
  });

  /**
   * Manual placements are reserved before any auto item is placed. In document
   * order, `first` would take (1,1) and the pin below it would then collide.
   */
  it('reserves a pin that appears after auto items in the list', () => {
    const placed = packGallery([
      auto('first'),
      auto('second'),
      { id: 'pinned', layout: { col: 1, row: 1, colSpan: 4, rowSpan: 3 }, aspect: 1 },
    ]);
    expect(placed.find((p) => p.id === 'pinned')!.placement.col).toBe(1);
    expect(placed.find((p) => p.id === 'pinned')!.placement.row).toBe(1);
    expectNoOverlap(placed);
  });

  it('is stable — the same input gives the same output', () => {
    const items = [auto('a', 3), auto('b', 0.5), auto('c'), auto('d'), auto('e')];
    expect(packGallery(items)).toEqual(packGallery(items));
  });

  it('returns results in the caller\'s order, not packing order', () => {
    const placed = packGallery([
      auto('x'),
      { id: 'pinned', layout: { col: 1, row: 9, colSpan: 4, rowSpan: 2 }, aspect: 1 },
      auto('y'),
    ]);
    expect(placed.map((p) => p.id)).toEqual(['x', 'pinned', 'y']);
  });

  it('handles an empty gallery', () => {
    expect(packGallery([])).toEqual([]);
    expect(canvasRows([])).toBe(0);
  });

  /** A hand-edited document, or a drag that ended past the edge. */
  it('corrects an out-of-bounds manual placement rather than trusting it', () => {
    const placed = packGallery([
      { id: 'wild', layout: { col: 11, row: 1, colSpan: 8, rowSpan: 2 }, aspect: 1 },
    ]);
    const { placement } = placed[0];
    expect(placement.col + placement.colSpan - 1).toBeLessThanOrEqual(GALLERY_COLUMNS);
  });
});

describe('clampPlacement', () => {
  it('pulls a placement back inside the canvas', () => {
    expect(clampPlacement({ col: 20, row: 1, colSpan: 4, rowSpan: 2 })).toEqual({
      col: 9, row: 1, colSpan: 4, rowSpan: 2,
    });
  });

  it('refuses a zero or negative span', () => {
    expect(clampPlacement({ col: 1, row: 1, colSpan: 0, rowSpan: -3 })).toEqual({
      col: 1, row: 1, colSpan: 1, rowSpan: 1,
    });
  });

  it('caps a span at the full width and keeps it placeable', () => {
    expect(clampPlacement({ col: 5, row: 2, colSpan: 99, rowSpan: 1 })).toEqual({
      col: 1, row: 2, colSpan: GALLERY_COLUMNS, rowSpan: 1,
    });
  });

  it('rounds a drag that landed between cells', () => {
    expect(clampPlacement({ col: 3.4, row: 2.6, colSpan: 5.5, rowSpan: 2.2 })).toEqual({
      col: 3, row: 3, colSpan: 6, rowSpan: 2,
    });
  });
});

describe('collapseToColumn', () => {
  it('stacks in reading order, not document order', () => {
    // `late` sits visually above `early` on the canvas, despite coming second.
    const placed = packGallery([
      { id: 'early', layout: { col: 1, row: 5, colSpan: 6, rowSpan: 2 }, aspect: 1 },
      { id: 'late', layout: { col: 1, row: 1, colSpan: 6, rowSpan: 2 }, aspect: 1 },
    ]);
    expect(collapseToColumn(placed).map((p) => p.id)).toEqual(['late', 'early']);
  });

  it('breaks a tie on the same row by column, left first', () => {
    const placed = packGallery([
      { id: 'right', layout: { col: 7, row: 1, colSpan: 6, rowSpan: 2 }, aspect: 1 },
      { id: 'left', layout: { col: 1, row: 1, colSpan: 6, rowSpan: 2 }, aspect: 1 },
    ]);
    expect(collapseToColumn(placed).map((p) => p.id)).toEqual(['left', 'right']);
  });

  it('gives every item the full width and its own row', () => {
    const collapsed = collapseToColumn(packGallery([auto('a', 3), auto('b', 0.5), auto('c')]));
    collapsed.forEach((item, index) => {
      expect(item.placement).toEqual({ col: 1, row: index + 1, colSpan: GALLERY_COLUMNS, rowSpan: 1 });
    });
  });

  it('loses nothing', () => {
    const placed = packGallery(Array.from({ length: 12 }, (_, i) => auto(`p${i}`)));
    expect(collapseToColumn(placed)).toHaveLength(12);
  });
});

describe('canvasRows', () => {
  it('measures to the bottom of the lowest item', () => {
    const placed = packGallery([
      { id: 'deep', layout: { col: 1, row: 8, colSpan: 4, rowSpan: 3 }, aspect: 1 },
    ]);
    expect(canvasRows(placed)).toBe(10);
  });
});
