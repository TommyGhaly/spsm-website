/**
 * The randomizer: a page that shows a fresh random handful of everything beneath
 * it on every visit, laid out as a random run of grids and wheels.
 *
 * Asked for on 2026-11-01, the day the camp archive went in and "Summer Camp
 * 2025" became six thousand photographs — which, since the summary lost its
 * ceiling (see the note above `nodeSummary`), it tried to draw all at once and
 * froze the tab. Every page now randomizes by default, at `DEFAULT_RANDOM_COUNT`;
 * an administrator can change the number, ask for so many from each child, or
 * turn it off.
 *
 * Pure, and seeded: the page passes one seed per visit, so a re-render keeps the
 * same pictures while the next visit gets new ones, and a test can pin a seed.
 */
import {
  layoutForLook,
  type GalleryBand,
  type SectionLayout,
  type SectionScale,
  type SectionWidth,
  type WheelSpin,
} from '../schema/sectionLayout.js';
import {
  childrenOf,
  hasRenderableFile,
  subtreeIds,
  type GalleryTree,
  type GalleryTreeNode,
  type SummaryMedia,
} from './tree.js';

/** What a page shows until somebody says otherwise. */
export const DEFAULT_RANDOM_COUNT = 40;

/** The most a randomizer may be asked for — a page, not the archive. */
export const MAX_RANDOM_COUNT = 400;

/**
 * Stored on a program or a level as `randomizer`.
 *
 * `perChild` maps a child level's id to how many of its pictures to take. When
 * any entry is above zero, **those counts replace `count`**: the page shows
 * exactly their sum, each child's share drawn from its own subtree — the
 * parish's choice over "the counts plus a remainder from anywhere".
 */
export interface RandomizerSettings {
  enabled: boolean;
  count: number;
  perChild: Record<string, number>;
}

const clampCount = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_RANDOM_COUNT, Math.round(value)))
    : fallback;

/**
 * Read one back, filling the defaults.
 *
 * Absent means **on when `onByDefault`** — which the page passes for any level
 * nobody has arranged by hand, days included — and off otherwise, so a page with
 * picked pictures or blocks of its own keeps its design.
 */
export function resolveRandomizer(value: unknown, onByDefault: boolean): RandomizerSettings {
  const source =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  const perChild: Record<string, number> = {};
  const rawPerChild = source?.['perChild'];
  if (rawPerChild !== null && typeof rawPerChild === 'object') {
    for (const [id, n] of Object.entries(rawPerChild as Record<string, unknown>)) {
      const count = clampCount(n, 0);
      if (count > 0) perChild[id] = count;
    }
  }
  return {
    enabled: typeof source?.['enabled'] === 'boolean' ? source['enabled'] : onByDefault,
    count: clampCount(source?.['count'], DEFAULT_RANDOM_COUNT),
    perChild,
  };
}

/** How many pictures these settings ask for, per-child counts included. */
export function randomTotal(settings: RandomizerSettings): number {
  const shares = Object.values(settings.perChild);
  return shares.length > 0 ? shares.reduce((sum, n) => sum + n, 0) : settings.count;
}

/** mulberry32: small, fast, and good enough to shuffle photographs with. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` distinct items, uniformly, without shuffling the whole pool. */
function sample<T>(pool: readonly T[], n: number, random: () => number): T[] {
  const copy = [...pool];
  const take = Math.min(n, copy.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy.slice(0, take);
}

/**
 * Whether a picture may be randomly chosen at all.
 *
 * Photographs only — a video's poster is a still nobody chose — cleared for the
 * page, with a file behind them, and not on the program's blacklist.
 */
function eligible(item: SummaryMedia, blacklist: ReadonlySet<string>): boolean {
  return (
    item.kind === 'photo' &&
    item.placement.onPage &&
    hasRenderableFile(item) &&
    !blacklist.has(item.id)
  );
}

/**
 * The pictures this visit shows.
 *
 * Without per-child counts: `count` drawn uniformly from the whole subtree,
 * including anything filed on the level itself (`rootId` for the ministry page,
 * which has no node of its own). With them: each child's share from its own
 * subtree, then all of them shuffled together so the page does not read as
 * "Week 1's, then Week 2's".
 */
export function randomPicks<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  media: readonly M[],
  settings: RandomizerSettings,
  blacklist: readonly string[],
  random: () => number,
  rootId?: string,
): M[] {
  const banned = new Set(blacklist);
  const shares = Object.entries(settings.perChild).filter(([, n]) => n > 0);

  if (shares.length === 0) {
    const ids = new Set(subtreeIds(tree, nodeId));
    const ownId = nodeId ?? rootId;
    if (ownId) ids.add(ownId);
    const pool = media.filter((item) => ids.has(item.programEventId) && eligible(item, banned));
    return sample(pool, settings.count, random);
  }

  const children = new Set(childrenOf(tree, nodeId).map((child) => child.id));
  const picked: M[] = [];
  for (const [childId, n] of shares) {
    // A count left behind for a child that has since been deleted or moved.
    if (!children.has(childId)) continue;
    const ids = new Set(subtreeIds(tree, childId));
    const pool = media.filter((item) => ids.has(item.programEventId) && eligible(item, banned));
    picked.push(...sample(pool, n, random));
  }
  return sample(picked, picked.length, random);
}

/* -------------------------------------------------------------------------- */
/* The layout: rows that fill the page                                         */
/* -------------------------------------------------------------------------- */

/*
 * The page packs blocks into twelve columns like a masonry wall (`packBlocks`),
 * so a random layout only *fits* if two things hold:
 *
 *  1. **Every row's widths add up to the whole page** — full; ½ + ½; ⅓ ⅓ ⅓;
 *     ⅔ + ⅓; ⅓ + ⅔. Then no block is left dangling beside a gap.
 *  2. **Blocks sharing a row are the same height.** A grid is as tall as its
 *     pictures make it, which nothing here can know, so a grid only ever takes a
 *     full row. A shared row is all wheels at one height: an upright wheel takes
 *     any height (`layout.height`), a sideways one only its tile ladder — so a row
 *     whose height is on that ladder may mix the two, and any other row is all
 *     upright wheels.
 *
 * Within those rules everything is random: which row shape, grid or wheel,
 * which way each wheel spins, how big, how tall, and how many pictures each holds.
 */

/** Row shapes, in twelfths of the page, with how often each is drawn. */
const ROW_SHAPES: readonly { widths: readonly SectionWidth[]; weight: number }[] = [
  { widths: ['full'], weight: 7 },
  { widths: ['half', 'half'], weight: 5 },
  { widths: ['third', 'third', 'third'], weight: 4 },
  { widths: ['two-thirds', 'third'], weight: 2 },
  { widths: ['third', 'two-thirds'], weight: 2 },
];

/** A sideways wheel's tile height for each scale, in rem — the stylesheet's ladder. */
const RAIL_TILE_REM: Partial<Record<SectionScale, number>> = { medium: 13, large: 18 };

/** Heights a shared row may take, in rem. The first two are on the rail ladder. */
const ROW_HEIGHTS_REM = [13, 18, 22, 26, 30, 36] as const;

const pick = <T>(options: readonly T[], random: () => number): T =>
  options[Math.floor(random() * options.length)] as T;

const between = (min: number, max: number, random: () => number): number =>
  min + Math.floor(random() * (max - min + 1));

/** One planned block: its layout and how many pictures it wants. */
interface Slot {
  layout: SectionLayout;
  min: number;
  max: number;
}

/** A full-width sideways wheel, which holds any number without growing taller. */
function railRow(random: () => number): Slot[] {
  return [
    {
      layout: layoutForLook(
        'rail',
        pick<SectionScale>(['small', 'medium', 'large'], random),
        'full',
        'hidden',
        pick<WheelSpin>(['left', 'right'], random),
      ),
      min: 1,
      max: Number.POSITIVE_INFINITY,
    },
  ];
}

/**
 * A block that takes a whole row: a grid or a sideways wheel, any size.
 *
 * Never an upright wheel. At full width one portrait photograph draws in the
 * middle of the page with empty paper either side; upright wheels look right in
 * a half or a third, so that is where `sharedRow` puts them.
 */
function fullRow(random: () => number): Slot[] {
  if (random() < 0.5) {
    return [
      {
        // Short, always: a full-width grid gives each picture real room, and
        // sixteen of them made a block three thousand pixels tall.
        layout: layoutForLook('grid', pick<SectionScale>(['small', 'medium'], random)),
        min: 4,
        max: 8,
      },
    ];
  }
  return [
    {
      layout: layoutForLook(
        'rail',
        pick<SectionScale>(['small', 'medium', 'large', 'full'], random),
        'full',
        'hidden',
        pick<WheelSpin>(['left', 'right'], random),
      ),
      min: 8,
      max: 16,
    },
  ];
}

/** Two or three wheels sharing a row, all one height. */
function sharedRow(widths: readonly SectionWidth[], random: () => number): Slot[] {
  const height = pick(ROW_HEIGHTS_REM, random);
  const railScale = (Object.entries(RAIL_TILE_REM) as [SectionScale, number][]).find(
    ([, rem]) => rem === height,
  )?.[0];
  return widths.map((width) => {
    const sideways = railScale !== undefined && random() < 0.5;
    return {
      layout: sideways
        ? layoutForLook('rail', railScale, width, 'hidden', pick<WheelSpin>(['left', 'right'], random))
        : layoutForLook(
            'column',
            'medium',
            width,
            'hidden',
            pick<WheelSpin>(['up', 'down'], random),
            'natural',
            height,
          ),
      min: 5,
      max: width === 'two-thirds' ? 12 : 9,
    };
  });
}

/**
 * Split this visit's pictures into a random layout of rows, as bands.
 *
 * Built as ordinary `GalleryBand`s with `picks` set, so the page draws them
 * through exactly the code it draws a hand-made block with — the randomizer
 * decides what goes in a block and how it is shaped, never how a block renders.
 *
 * Rows are planned until the pictures run out. A row is only started when there
 * are enough pictures left to give every block in it its minimum; whatever is
 * left over at the end goes into the last row's blocks, so no block is starved
 * and none is left empty.
 */
export function randomSections<M extends { id: string }>(
  picks: readonly M[],
  random: () => number,
): { band: GalleryBand; media: M[] }[] {
  const totalWeight = ROW_SHAPES.reduce((sum, shape) => sum + shape.weight, 0);
  const rows: { slot: Slot; count: number }[][] = [];
  let left = picks.length;

  while (left > 0) {
    let roll = random() * totalWeight;
    const shape = ROW_SHAPES.find((one) => (roll -= one.weight) < 0) ?? ROW_SHAPES[0]!;
    const slots = shape.widths.length === 1 ? fullRow(random) : sharedRow(shape.widths, random);
    const needed = slots.reduce((sum, slot) => sum + slot.min, 0);

    if (needed > left) {
      /*
       * The leftovers. Spread over the last row when it is wheels — a wheel
       * holds more without growing — and otherwise given a wheel of their own,
       * so they never pile into a grid and stretch it down the page.
       */
      const last = rows[rows.length - 1];
      const wheels = last?.filter((entry) => entry.slot.layout.display !== 'grid') ?? [];
      if (last && wheels.length === last.length && left < 4 * wheels.length) {
        for (let i = 0; left > 0; i = (i + 1) % wheels.length, left -= 1) wheels[i]!.count += 1;
      } else {
        rows.push(railRow(random).map((slot) => ({ slot, count: left })));
      }
      break;
    }

    const row = slots.map((slot) => ({ slot, count: slot.min }));
    left -= needed;
    // Top each block up towards its own random size while pictures remain.
    for (const entry of row) {
      const extra = Math.min(left, between(entry.slot.min, entry.slot.max, random) - entry.slot.min);
      entry.count += extra;
      left -= extra;
    }
    rows.push(row);
  }

  const sections: { band: GalleryBand; media: M[] }[] = [];
  let at = 0;
  for (const entry of rows.flat()) {
    const media = picks.slice(at, at + entry.count);
    at += entry.count;
    if (media.length === 0) continue;
    sections.push({
      band: {
        id: `random-${sections.length}`,
        title: '',
        layout: entry.slot.layout,
        picks: media.map((item) => item.id),
        hidden: [],
      },
      media,
    });
  }
  return sections;
}
