import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RANDOM_COUNT,
  randomPicks,
  randomSections,
  randomTotal,
  resolveRandomizer,
  seededRandom,
} from '../../packages/shared/src/gallery/randomizer.js';
import {
  buildGalleryTree,
  subtreeSlideshow,
  type GalleryTreeNode,
  type SummaryMedia,
} from '../../packages/shared/src/gallery/tree.js';

/**
 * The randomizer picks what a year or a week page shows on each visit. Like the
 * rest of the gallery, nothing here fails loudly: a blacklisted photograph that
 * slips through, or a per-child count quietly ignored, still renders a page full
 * of pictures.
 */

interface Node extends GalleryTreeNode {
  id: string;
  parentId?: string | null;
  slug: string;
  title: string;
}

const node = (id: string, parentId: string | null): Node => ({ id, parentId, slug: id, title: id });

const tree = buildGalleryTree([
  node('2025', null),
  node('week-1', '2025'),
  node('monday', 'week-1'),
  node('tuesday', 'week-1'),
  node('week-2', '2025'),
]);

const shot = (id: string, programEventId: string, extra: Partial<SummaryMedia> = {}): SummaryMedia => ({
  id,
  programEventId,
  kind: 'photo',
  renditionPath: `galleries/${id}.webp`,
  posterPath: null,
  placement: { onPage: true, slideshow: true, homepage: false },
  ...extra,
});

const many = (prefix: string, level: string, n: number) =>
  Array.from({ length: n }, (_, i) => shot(`${prefix}${i}`, level));

const media = [...many('m', 'monday', 30), ...many('t', 'tuesday', 30), ...many('w', 'week-2', 30)];

describe('resolveRandomizer', () => {
  it('is on by default for a page with levels inside it, off for a leaf', () => {
    expect(resolveRandomizer(undefined, true)).toEqual({
      enabled: true,
      count: DEFAULT_RANDOM_COUNT,
      perChild: {},
    });
    expect(resolveRandomizer(undefined, false).enabled).toBe(false);
  });

  it('keeps an explicit choice and drops zero or junk per-child counts', () => {
    const settings = resolveRandomizer(
      { enabled: false, count: 12, perChild: { 'week-1': 5, 'week-2': 0, x: 'lots' } },
      true,
    );
    expect(settings).toEqual({ enabled: false, count: 12, perChild: { 'week-1': 5 } });
  });

  it('per-child counts replace the total', () => {
    expect(randomTotal({ enabled: true, count: 50, perChild: { a: 20, b: 10 } })).toBe(30);
    expect(randomTotal({ enabled: true, count: 50, perChild: {} })).toBe(50);
  });
});

describe('randomPicks', () => {
  const settings = { enabled: true, count: 40, perChild: {} };

  it('draws the count from the whole subtree, without repeats', () => {
    const picks = randomPicks(tree, '2025', media, settings, [], seededRandom(1));
    expect(picks).toHaveLength(40);
    expect(new Set(picks.map((p) => p.id)).size).toBe(40);
  });

  it('never picks a blacklisted, hidden, unfinished or video item', () => {
    const extra = [
      shot('banned', 'monday'),
      shot('off', 'monday', { placement: { onPage: false, slideshow: false, homepage: false } }),
      shot('processing', 'monday', { renditionPath: null }),
      shot('clip', 'monday', { kind: 'video' }),
    ];
    const picks = randomPicks(
      tree,
      'week-1',
      extra,
      { enabled: true, count: 10, perChild: {} },
      ['banned'],
      seededRandom(2),
    );
    expect(picks).toEqual([]);
  });

  it('takes exactly each child’s share from that child’s subtree', () => {
    const picks = randomPicks(
      tree,
      '2025',
      media,
      { enabled: true, count: 99, perChild: { 'week-1': 7, 'week-2': 3 } },
      [],
      seededRandom(3),
    );
    expect(picks).toHaveLength(10);
    expect(picks.filter((p) => p.programEventId === 'week-2')).toHaveLength(3);
  });

  it('is the same for the same seed and different for another', () => {
    const a = randomPicks(tree, '2025', media, settings, [], seededRandom(5)).map((p) => p.id);
    const b = randomPicks(tree, '2025', media, settings, [], seededRandom(5)).map((p) => p.id);
    const c = randomPicks(tree, '2025', media, settings, [], seededRandom(6)).map((p) => p.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('randomSections', () => {
  const COLUMNS = { full: 12, 'two-thirds': 8, half: 6, third: 4 } as const;
  const RAIL_REM = { small: 9, medium: 13, large: 18, full: 34, fit: 18 } as const;
  const heightOf = (layout: { display: string; scale: keyof typeof RAIL_REM; height: number | null }) =>
    layout.display === 'column' ? layout.height : RAIL_REM[layout.scale];

  /** The sections cut into rows by their widths. */
  const rowsOf = (sections: ReturnType<typeof randomSections>) => {
    const rows: (typeof sections)[] = [];
    let used = 12;
    for (const section of sections) {
      if (used === 12) {
        rows.push([]);
        used = 0;
      }
      used += COLUMNS[section.band.layout.width];
      rows[rows.length - 1]!.push(section);
      expect(used).toBeLessThanOrEqual(12);
    }
    expect(used).toBe(12);
    return rows;
  };

  it('puts every pick in exactly one section', () => {
    for (let seed = 1; seed < 60; seed += 1) {
      const picks = media.slice(0, 40);
      const sections = randomSections(picks, seededRandom(seed));
      expect(sections.flatMap((s) => s.media)).toEqual(picks);
      expect(sections.every((s) => s.media.length > 0)).toBe(true);
    }
  });

  it('fills every row, and blocks that share a row are wheels of one height', () => {
    for (let seed = 1; seed < 200; seed += 1) {
      for (const row of rowsOf(randomSections(media.slice(0, 40), seededRandom(seed)))) {
        if (row.length === 1) continue;
        const heights = row.map((s) => {
          expect(s.band.layout.display).not.toBe('grid');
          return heightOf(s.band.layout);
        });
        expect(new Set(heights).size).toBe(1);
      }
    }
  });

  it('uses every direction and every width', () => {
    const spins = new Set<string>();
    const widths = new Set<string>();
    for (let seed = 1; seed < 200; seed += 1) {
      for (const { band } of randomSections(media.slice(0, 40), seededRandom(seed))) {
        if (band.layout.display !== 'grid') spins.add(band.layout.spin);
        widths.add(band.layout.width);
      }
    }
    expect([...spins].sort()).toEqual(['down', 'left', 'right', 'up']);
    expect([...widths].sort()).toEqual(['full', 'half', 'third', 'two-thirds']);
  });

  it('still lays out a handful of pictures', () => {
    const sections = randomSections(media.slice(0, 3), seededRandom(1));
    expect(sections).toHaveLength(1);
    expect(sections[0]!.band.layout.width).toBe('full');
  });
});

describe('the blacklist', () => {
  it('keeps a picture out of the randomizer but not out of the presentation', () => {
    const items = [shot('banned', 'monday'), shot('kept', 'monday')];
    const picks = randomPicks(
      tree,
      'week-1',
      items,
      { enabled: true, count: 10, perChild: {} },
      ['banned'],
      seededRandom(7),
    );
    expect(picks.map((p) => p.id)).toEqual(['kept']);
    expect(subtreeSlideshow(tree, 'week-1', items).map((p) => p.id)).toContain('banned');
  });
});
