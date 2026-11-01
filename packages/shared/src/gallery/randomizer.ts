/**
 * The randomizer: a page that shows a fresh random handful of everything beneath
 * it on every visit, laid out as a random run of grids and wheels.
 *
 * Asked for on 2026-11-01, the day the camp archive went in and "Summer Camp
 * 2025" became six thousand photographs — which, since the summary lost its
 * ceiling (see the note above `nodeSummary`), it tried to draw all at once and
 * froze the tab. A page with levels inside it now randomizes by default, at
 * `DEFAULT_RANDOM_COUNT`; an administrator can change the number, ask for so many
 * from each child, turn it off, or turn it on for a leaf.
 *
 * Pure, and seeded: the page passes one seed per visit, so a re-render keeps the
 * same pictures while the next visit gets new ones, and a test can pin a seed.
 */
import {
  layoutForLook,
  type GalleryBand,
  type GalleryDisplay,
  type SectionScale,
} from '../schema/sectionLayout.js';
import {
  childrenOf,
  hasRenderableFile,
  subtreeIds,
  type GalleryTree,
  type GalleryTreeNode,
  type SummaryMedia,
} from './tree.js';

/** What a page with levels inside it shows until somebody says otherwise. */
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
 * Absent means **on when `onByDefault`** — which the page passes for a level with
 * levels inside it that nobody has arranged by hand — and off otherwise. A day
 * page shows its whole day, which is what it is for; a year left alone would
 * otherwise try to draw its entire subtree.
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

/** The looks a random section may take, and how many pictures each holds. */
const SECTION_LOOKS: readonly {
  display: GalleryDisplay;
  scales: readonly SectionScale[];
  min: number;
  max: number;
}[] = [
  { display: 'grid', scales: ['small', 'medium', 'large'], min: 6, max: 12 },
  { display: 'rail', scales: ['medium', 'large'], min: 8, max: 16 },
];

/**
 * Split this visit's pictures into a run of random sections, as bands.
 *
 * Each section is a grid or a sideways wheel at a random size, holding a random
 * share of the pictures. Built as ordinary `GalleryBand`s with `picks` set, so
 * the page draws them through exactly the code it draws a hand-made block with
 * — the randomizer decides what goes in a block, never how a block renders.
 *
 * Never two wheels in a row: two rails back to back read as one broken rail.
 */
export function randomSections<M extends { id: string }>(
  picks: readonly M[],
  random: () => number,
): { band: GalleryBand; media: M[] }[] {
  const sections: { band: GalleryBand; media: M[] }[] = [];
  let at = 0;
  let last: GalleryDisplay | null = null;
  while (at < picks.length) {
    const options = SECTION_LOOKS.filter((look) => !(look.display === 'rail' && last === 'rail'));
    const look = options[Math.floor(random() * options.length)] ?? SECTION_LOOKS[0]!;
    const scale = look.scales[Math.floor(random() * look.scales.length)] ?? 'medium';
    const size = look.min + Math.floor(random() * (look.max - look.min + 1));
    // Fold a short tail into this section rather than leaving a block of two.
    const end = picks.length - (at + size) < look.min ? picks.length : at + size;
    const media = picks.slice(at, end);
    sections.push({
      band: {
        id: `random-${sections.length}`,
        title: '',
        layout: layoutForLook(look.display, scale),
        picks: media.map((item) => item.id),
        hidden: [],
      },
      media,
    });
    last = look.display;
    at = end;
  }
  return sections;
}
