import { describe, it, expect } from 'vitest';
import {
  GALLERY_SUMMARY_MAX,
  pageMode,
  pagePictures,
  subtreeMedia,
  buildGalleryTree,
  childrenOf,
  compareNodes,
  defaultSubmissionNode,
  descendantsOf,
  flattenGalleryTree,
  nodeSummary,
  resolveTrail,
  subtreeIds,
  subtreeSlideshow,
  summariseChildren,
  trailLabel,
  trailSlugs,
  type GalleryTreeNode,
  type SummaryMedia,
} from '../../packages/shared/src/gallery/tree.js';

/**
 * A program's gallery as a tree, and what each level of it shows.
 *
 * Worth real tests for the same reason the URL parser is: **nothing here fails
 * loudly.** A summary that quietly takes twenty photographs of one afternoon
 * still renders a page full of pictures, and looks fine. A trail that resolves
 * one slug too eagerly shows a visitor the wrong camp under a URL that looks
 * right. A subtree count that misses a level says "0 photographs" about a week
 * with two hundred in it. Every one of those is a page nobody reports.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface Node extends GalleryTreeNode {
  id: string;
  parentId?: string | null;
  slug: string;
  title: string;
  order?: number;
  featuredMediaIds?: readonly string[];
}

function node(id: string, parentId: string | null, extra: Partial<Node> = {}): Node {
  return { id, parentId, slug: id, title: id, ...extra };
}

/**
 * The shape the seed builds: ministry → year → week → day → part.
 *
 * Five levels, because the claim being tested is that a level summarises
 * *everything* beneath it, and at two levels "everything beneath it" and "its
 * own children" are the same set.
 */
const TREE = [
  node('2027', null),
  node('week-1', '2027', { order: 10 }),
  node('day-1', 'week-1', { order: 10 }),
  node('day-2', 'week-1', { order: 20 }),
  node('the-hike', 'day-2', { order: 10 }),
  node('week-2', '2027', { order: 20 }),
  node('chapel', 'week-2', { order: 10 }),
];

const ON_PAGE = { onPage: true, slideshow: true, homepage: false };
const SHOWCASE = { onPage: true, slideshow: true, homepage: true };
const HIDDEN = { onPage: false, slideshow: false, homepage: false };

function shot(
  id: string,
  programEventId: string,
  placement = ON_PAGE,
  extra: Partial<SummaryMedia> = {},
): SummaryMedia {
  return {
    id,
    programEventId,
    kind: 'photo',
    renditionPath: `galleries/${id}.webp`,
    posterPath: null,
    placement,
    ...extra,
  };
}

/* -------------------------------------------------------------------------- */

describe('buildGalleryTree', () => {
  it('files every node under its parent, sorted', () => {
    const tree = buildGalleryTree(TREE);
    expect(childrenOf(tree, null).map((one) => one.id)).toEqual(['2027']);
    expect(childrenOf(tree, '2027').map((one) => one.id)).toEqual(['week-1', 'week-2']);
    expect(childrenOf(tree, 'week-1').map((one) => one.id)).toEqual(['day-1', 'day-2']);
    expect(childrenOf(tree, 'the-hike')).toEqual([]);
  });

  /**
   * The important one, and the reason it is not an error case.
   *
   * The public read filters on `published`, so an unpublished year with three
   * published weeks under it is an ordinary shape. Dropping those weeks would
   * make the parish's photographs invisible because of a switch on a document
   * nobody can see; lifting them shows them, one level shallower.
   */
  it('lifts a node whose parent is missing to the top level', () => {
    const tree = buildGalleryTree([node('week-1', 'a-draft-year'), node('week-2', null)]);
    expect(childrenOf(tree, null).map((one) => one.id).sort()).toEqual(['week-1', 'week-2']);
  });

  /** One bad `parentId` away, and every walk here recurses. */
  it('does not hang on a cycle', () => {
    const tree = buildGalleryTree([node('a', 'b'), node('b', 'a')]);
    expect(() => descendantsOf(tree, null)).not.toThrow();
    expect(() => trailSlugs(tree, 'a')).not.toThrow();
    expect(descendantsOf(tree, null).length).toBeLessThanOrEqual(2);
  });
});

describe('compareNodes', () => {
  /**
   * Days want the sequence somebody typed. "Day 2" after "Day 1" and before "Day
   * 10" is neither a date nor alphabetical, so an explicit number has to win.
   */
  it('puts the manual order first', () => {
    const days = [node('c', null, { order: 30 }), node('a', null, { order: 10 })];
    expect([...days].sort(compareNodes).map((one) => one.id)).toEqual(['a', 'c']);
  });

  /**
   * A level nobody has reordered has 0 everywhere, so every comparison ties and
   * the date decides — exactly what this collection did before `order` existed.
   */
  it('falls back to the date, newest first', () => {
    const weeks = [
      node('older', null, { startAt: new Date('2024-07-01') }),
      node('newer', null, { startAt: new Date('2026-07-01') }),
    ];
    expect([...weeks].sort(compareNodes).map((one) => one.id)).toEqual(['newer', 'older']);
  });

  /** An undated level is one somebody has not finished. It does not go on top. */
  it('sorts an undated level after a dated one', () => {
    const mixed = [node('draft', null), node('dated', null, { startAt: new Date('2020-01-01') })];
    expect([...mixed].sort(compareNodes).map((one) => one.id)).toEqual(['dated', 'draft']);
  });
});

describe('resolveTrail', () => {
  const tree = buildGalleryTree(TREE);

  it('walks a URL down to the level it names', () => {
    expect(resolveTrail(tree, ['2027', 'week-1', 'day-2'])?.map((one) => one.id)).toEqual([
      '2027',
      'week-1',
      'day-2',
    ]);
  });

  /**
   * The bug this function exists to prevent. A slug is unique among *siblings*
   * only, so a lookup by the last segment alone would answer
   * `/2027/week-2/day-1` with Week 1's Day 1 — a visitor reading the wrong camp
   * under a URL that looks right.
   */
  it('refuses a slug that exists elsewhere but not here', () => {
    const twoWeeks = buildGalleryTree([
      node('week-1', null),
      node('day-1', 'week-1'),
      node('week-2', null),
    ]);
    expect(resolveTrail(twoWeeks, ['week-2', 'day-1'])).toBeNull();
    expect(resolveTrail(twoWeeks, ['week-1', 'day-1'])?.map((one) => one.id)).toEqual([
      'week-1',
      'day-1',
    ]);
  });

  it('refuses a trail that runs past the bottom', () => {
    expect(resolveTrail(tree, ['2027', 'week-1', 'day-1', 'nothing'])).toBeNull();
  });

  it('round-trips against trailSlugs', () => {
    const slugs = trailSlugs(tree, 'the-hike');
    expect(slugs).toEqual(['2027', 'week-1', 'day-2', 'the-hike']);
    expect(resolveTrail(tree, slugs)?.map((one) => one.id)).toEqual(slugs);
  });

  it('names a level by its whole ancestry', () => {
    expect(trailLabel(tree, 'the-hike')).toBe('2027 · week-1 · day-2 · the-hike');
  });
});

describe('subtreeIds', () => {
  const tree = buildGalleryTree(TREE);

  it('includes the level itself and everything under it', () => {
    expect(subtreeIds(tree, 'week-1').sort()).toEqual(['day-1', 'day-2', 'the-hike', 'week-1']);
  });

  it('is the whole program at the root, without a phantom entry for it', () => {
    expect(subtreeIds(tree, null).sort()).toEqual([...TREE.map((one) => one.id)].sort());
  });

  it('is just the level for a leaf', () => {
    expect(subtreeIds(tree, 'chapel')).toEqual(['chapel']);
  });
});

/* -------------------------------------------------------------------------- */
/* The summaries — the point of the whole file                                 */
/* -------------------------------------------------------------------------- */

describe('flattenGalleryTree', () => {
  const tree = buildGalleryTree(TREE);

  /*
   * The list a `<select>` is built from — the upload form's "which part of this
   * ministry is your photograph of", and the queue's "file it under".
   *
   * Worth testing for the reason the rest of this file is: nothing here fails
   * loudly. A wrong depth renders a picker that is merely badly indented, and a
   * missing row is a level a parishioner simply cannot choose — with no error,
   * no gap, and nothing to report.
   */
  it('lists every level, in reading order', () => {
    expect(flattenGalleryTree(tree).map(({ node: one }) => one.id)).toEqual([
      '2027',
      'week-1',
      'day-1',
      'day-2',
      'the-hike',
      'week-2',
      'chapel',
    ]);
  });

  it('counts depth from the program, not from the deepest branch', () => {
    const depths = new Map(flattenGalleryTree(tree).map(({ node: one, depth }) => [one.id, depth]));
    expect(depths.get('2027')).toBe(0);
    expect(depths.get('week-1')).toBe(1);
    expect(depths.get('day-2')).toBe(2);
    expect(depths.get('the-hike')).toBe(3);
    // A sibling branch is shallower again. A depth carried down from the last
    // row rather than from the parent would make this 4.
    expect(depths.get('week-2')).toBe(1);
    expect(depths.get('chapel')).toBe(2);
  });

  it('is empty for a ministry with no levels yet', () => {
    expect(flattenGalleryTree(buildGalleryTree([]))).toEqual([]);
  });

  /*
   * One mis-set `parentId` is all a cycle takes, and this list is built in a
   * visitor's browser on a public page. Terminating matters more than what it
   * returns.
   */
  it('terminates on a cycle', () => {
    const cyclic = buildGalleryTree([
      node('a', 'b'),
      node('b', 'a'),
      node('free', null),
    ]);
    const rows = flattenGalleryTree(cyclic);
    expect(rows.map(({ node: one }) => one.id)).toContain('free');
    // Every node once, whatever the cycle did to the shape.
    expect(new Set(rows.map(({ node: one }) => one.id)).size).toBe(rows.length);
  });
});

/* -------------------------------------------------------------------------- */

describe('defaultSubmissionNode', () => {
  const tree = buildGalleryTree(TREE);

  /*
   * Which level a parishioner's photograph lands in when they do not choose one.
   *
   * Every branch of this produces a form that looks entirely correct. Get it
   * wrong and forty photographs of Day 3 are filed under Week 2, or under the
   * first level in the ministry, and the only symptom is an administrator moving
   * them all by hand — which is the work the priority section exists to remove.
   */
  it('prefers the parish\'s priority section over the page being looked at', () => {
    expect(defaultSubmissionNode(tree, 'day-2', 'week-2')).toBe('day-2');
  });

  it('falls back to the page when no priority is set', () => {
    expect(defaultSubmissionNode(tree, null, 'week-2')).toBe('week-2');
    expect(defaultSubmissionNode(tree, undefined, 'the-hike')).toBe('the-hike');
  });

  /*
   * The case this function exists for. A level can be deleted long after it was
   * made the priority, and the id is deliberately not cleaned up on delete — so a
   * stale one has to cost a preselection and nothing else. Returning it would
   * file every upload against a document that is gone, which `firestore.rules`
   * refuses with `permission-denied` on a form that looks fine.
   */
  it('ignores a priority section that no longer exists', () => {
    expect(defaultSubmissionNode(tree, 'deleted-last-year', 'week-2')).toBe('week-2');
    expect(defaultSubmissionNode(tree, 'deleted-last-year', null)).toBe('2027');
  });

  it('falls back to the first level on a ministry page with no priority', () => {
    expect(defaultSubmissionNode(tree, null, null)).toBe('2027');
  });

  /* Same reasoning as a stale priority: a page id is no more trustworthy. */
  it('ignores a page id that is not in the tree', () => {
    expect(defaultSubmissionNode(tree, null, 'not-a-level')).toBe('2027');
  });

  it('is null for a ministry with no levels at all', () => {
    expect(defaultSubmissionNode(buildGalleryTree([]), null, null)).toBeNull();
    // Including when a priority is set to something that cannot resolve, which
    // is what a ministry looks like the moment its last level is deleted.
    expect(defaultSubmissionNode(buildGalleryTree([]), 'day-2', null)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('nodeSummary', () => {
  const tree = buildGalleryTree(TREE);

  /**
   * A leaf shows its gallery: everything filed on it, uncapped and unreordered.
   *
   * Uncapped is the part worth asserting. It is the one page whose whole job is
   * showing the parish's photographs, and a cap there hides them.
   */
  it('a leaf shows everything filed on it', () => {
    const media = Array.from({ length: 40 }, (_, at) => shot(`m${at}`, 'chapel'));
    expect(nodeSummary(tree, 'chapel', media)).toHaveLength(40);
  });

  it('a leaf leaves out what is not cleared for a page', () => {
    const media = [shot('a', 'chapel'), shot('b', 'chapel', HIDDEN)];
    expect(nodeSummary(tree, 'chapel', media).map((one) => one.id)).toEqual(['a']);
  });

  /**
   * **The requirement.** Summercamp shows photographs from every year; a week
   * shows photographs from each of its days.
   *
   * Week 1 has nothing filed on it — every picture is in a day or in the part
   * inside a day — and its page is still full. Before the tree, this page would
   * have been empty.
   */
  it('a branch reaches past its children into their children', () => {
    const media = [
      shot('d1a', 'day-1'),
      shot('d2a', 'day-2'),
      shot('hike', 'the-hike'),
    ];
    expect(nodeSummary(tree, 'week-1', media).map((one) => one.id).sort()).toEqual([
      'd1a',
      'd2a',
      'hike',
    ]);
  });

  /**
   * And the reason it spreads rather than taking the newest.
   *
   * Day 1 holds thirty photographs and Day 2 holds one. A flat "first N" would
   * fill the week's page with Day 1 and never mention Day 2 — a summary of an
   * afternoon presented as a summary of a week. Round-robin means every day is
   * represented before any day is represented twice.
   */
  it('spreads across the children instead of draining the first', () => {
    const media = [
      ...Array.from({ length: 30 }, (_, at) => shot(`d1-${at}`, 'day-1')),
      shot('d2-only', 'day-2'),
    ];
    const summary = nodeSummary(tree, 'week-1', media, { max: 6 }).map((one) => one.id);
    expect(summary).toHaveLength(6);
    expect(summary).toContain('d2-only');
    // Day 2 gets its turn in the first round, not after Day 1 is exhausted.
    expect(summary.indexOf('d2-only')).toBeLessThan(2);
  });

  /**
   * Showcase photographs lead an uncurated set: the nearest thing to a choice
   * that exists without asking anybody.
   *
   * These are both filed on Day 1, which is a *leaf* — so this asserts the
   * distinction that caught a real bug. Day 1's own page shows them in `order`,
   * because that page is the gallery. Standing in for Week 1, where only one or
   * two get shown, the flagged one goes first. Before the fix, a week led with
   * whatever was at the top of Day 1's queue and the showcase photograph two rows
   * down appeared nowhere.
   */
  it('leads with the showcase pictures when standing in for a level above', () => {
    const media = [
      shot('plain', 'day-1'),
      shot('showcase', 'day-1', SHOWCASE),
    ];
    expect(nodeSummary(tree, 'week-1', media).map((one) => one.id)).toEqual([
      'showcase',
      'plain',
    ]);
  });

  it('honours a curated list, in the order it was chosen', () => {
    const media = [shot('a', 'day-1'), shot('b', 'day-2'), shot('c', 'the-hike')];
    expect(
      nodeSummary(tree, 'week-1', media, { curated: ['c', 'a'] }).map((one) => one.id),
    ).toEqual(['c', 'a']);
  });

  /**
   * A curated id can stop resolving — rejected since, deleted since, or outside
   * the window that was read. A level must not go blank because one of six
   * pictures went away.
   */
  it('drops a curated id that no longer resolves rather than leaving a gap', () => {
    const media = [shot('a', 'day-1')];
    expect(
      nodeSummary(tree, 'week-1', media, { curated: ['gone', 'a'] }).map((one) => one.id),
    ).toEqual(['a']);
  });

  /**
   * A curated id is honoured even mid-transcode; an automatic pick is not.
   *
   * An administrator who has just approved and featured a photograph should see
   * it appear with its "Processing…" state rather than silently not appear. As
   * one of six pictures standing for a whole ministry, chosen by nobody, a grey
   * box is not a picture of the ministry.
   */
  it('skips a file-less picture automatically but keeps a chosen one', () => {
    const pending = shot('pending', 'day-1', ON_PAGE, { renditionPath: null });
    const ready = shot('ready', 'day-2');
    const media = [pending, ready];

    expect(nodeSummary(tree, 'week-1', media).map((one) => one.id)).toEqual(['ready']);
    expect(
      nodeSummary(tree, 'week-1', media, { curated: ['pending'] }).map((one) => one.id),
    ).toEqual(['pending']);
  });

  /**
   * A branch's own directly-filed pictures are one pool in the rotation, not a
   * block in front of it — otherwise a week with a few pictures of its own would
   * push its days off the page.
   */
  it('gives a branch its own pictures a turn, not a head start', () => {
    const media = [
      shot('own-1', 'week-1'),
      shot('own-2', 'week-1'),
      shot('own-3', 'week-1'),
      shot('from-day', 'day-1'),
    ];
    const summary = nodeSummary(tree, 'week-1', media, { max: 2 }).map((one) => one.id);
    expect(summary).toContain('from-day');
  });

  it('caps a branch and does not repeat a picture', () => {
    const media = Array.from({ length: 50 }, (_, at) =>
      shot(`m${at}`, at % 2 === 0 ? 'day-1' : 'the-hike'),
    );
    const summary = nodeSummary(tree, '2027', media, { max: 10 });
    expect(summary).toHaveLength(10);
    expect(new Set(summary.map((one) => one.id)).size).toBe(10);
  });

  it('is empty rather than throwing when nothing is filed anywhere', () => {
    expect(nodeSummary(tree, null, [])).toEqual([]);
  });
});

describe('summariseChildren', () => {
  const tree = buildGalleryTree(TREE);

  /**
   * The count on a card is of the whole subtree. "Week 1 — 0 photographs" was
   * what a per-document count said about a week whose days held everything, and
   * it read as an empty camp.
   */
  it('counts a child\'s whole subtree, not its own documents', () => {
    const media = [shot('a', 'day-1'), shot('b', 'day-2'), shot('c', 'the-hike')];
    const summaries = summariseChildren(tree, '2027', media);
    expect(summaries.get('week-1')?.photos).toBe(3);
    expect(summaries.get('week-2')?.photos).toBe(0);
  });

  it('says how many levels hang beneath each child', () => {
    const summaries = summariseChildren(tree, '2027', []);
    expect(summaries.get('week-1')?.children).toBe(2);
    expect(summaries.get('week-2')?.children).toBe(1);
  });

  it('counts clips apart from photographs', () => {
    const media = [shot('p', 'day-1'), shot('v', 'day-1', ON_PAGE, { kind: 'video', posterPath: 'p.webp' })];
    expect(summariseChildren(tree, 'week-1', media).get('day-1')).toMatchObject({
      photos: 1,
      videos: 1,
    });
  });

  /**
   * A cover may come from anywhere beneath, which is what makes one choosable
   * for a week that has no photographs of its own.
   */
  it('finds a cover deep in the subtree', () => {
    const summaries = summariseChildren(tree, '2027', [shot('deep', 'the-hike')]);
    expect(summaries.get('week-1')?.cover?.id).toBe('deep');
  });

  /**
   * The card's picture is not chosen any more — `coverMediaId` and both of its
   * panel controls are gone, because a card cross-fades and the pick only decided
   * which lap it opened on. So the cover is the first page-cleared photograph in
   * filing order, and the cycle carries the rest behind it.
   */
  it('takes the first picture in filing order, and cycles the rest', () => {
    const media = [shot('first', 'day-1'), shot('second', 'day-2')];
    const summary = summariseChildren(tree, '2027', media).get('week-1');
    expect(summary?.cover?.id).toBe('first');
    expect(summary?.covers.map((one) => one.id)).toEqual(['first', 'second']);
  });

  /**
   * Without the file check the automatic cover is the first *approved*
   * photograph, which may still be transcoding — and a card cover has no
   * "Processing…" state, so the level renders with the blank ground of one that
   * has no photographs at all. This is what happened to Summercamp Week 1 the
   * first time it ran.
   */
  it('will not make a file-less picture the automatic cover', () => {
    const media = [
      shot('pending', 'day-1', ON_PAGE, { renditionPath: null }),
      shot('ready', 'day-2'),
    ];
    expect(summariseChildren(tree, 'week-1', media).get('day-1')?.cover).toBeNull();
    expect(summariseChildren(tree, 'week-1', media).get('day-2')?.cover?.id).toBe('ready');
  });

  /** A video's poster is a still nobody chose. It is never the odd card out. */
  it('does not choose a clip as an automatic cover', () => {
    const media = [shot('v', 'day-1', ON_PAGE, { kind: 'video', posterPath: 'p.webp' })];
    expect(summariseChildren(tree, 'week-1', media).get('day-1')?.cover).toBeNull();
  });
});

describe('pagePictures', () => {
  const tree = buildGalleryTree(TREE);

  /**
   * The set **one block** draws. Called once per block on a page now: each carries
   * its own picked list and its own list of what was pressed × on, and this is the
   * single resolver for both, so a picked block and an automatic one cannot end up
   * decided by different rules.
   */
  it('honours a curated list first, in the order it was chosen', () => {
    const media = [shot('a', 'day-1'), shot('b', 'day-2'), shot('c', 'the-hike')];
    expect(
      pagePictures(tree, 'week-1', media, { curated: ['c', 'a'], showAll: true }).map(
        (one) => one.id,
      ),
    ).toEqual(['c', 'a']);
  });

  /**
   * "All of them" is the mode the old per-block `source` existed for, moved onto
   * the page where it belongs — every block draws the same set, so it has to be
   * one decision.
   *
   * The property that matters is that it is **uncapped** where the summary is not.
   * That is the whole reason the mode exists: a summary cannot express "everything
   * from every day of this camp" at any setting.
   */
  it('is uncapped in "all of them" where the summary is capped', () => {
    const many = Array.from({ length: GALLERY_SUMMARY_MAX * 3 }, (_, at) =>
      shot(`m${at}`, at % 2 === 0 ? 'day-1' : 'the-hike'),
    );

    expect(pagePictures(tree, 'week-1', many, {})).toHaveLength(GALLERY_SUMMARY_MAX);
    expect(pagePictures(tree, 'week-1', many, { showAll: true })).toHaveLength(many.length);
  });

  /**
   * A curated list is a statement somebody made on purpose, and a switch does not
   * silently overrule it — which is what makes the panel's three-way control
   * honest about what it is showing.
   */
  it('does not let "all of them" override a curated list', () => {
    const media = [shot('a', 'day-1'), shot('b', 'day-2')];
    expect(
      pagePictures(tree, 'week-1', media, { curated: ['b'], showAll: true }).map((one) => one.id),
    ).toEqual(['b']);
  });

  it('falls back to the automatic summary', () => {
    const media = [shot('a', 'day-1'), shot('b', 'the-hike')];
    expect(pagePictures(tree, 'week-1', media, {})).toHaveLength(2);
  });
});

describe('pageMode', () => {
  /** Derived, never stored: the control and the page cannot say different things. */
  it('reads the three states off the document', () => {
    expect(pageMode({})).toBe('auto');
    expect(pageMode({ showAll: false })).toBe('auto');
    expect(pageMode({ showAll: true })).toBe('all');
    expect(pageMode({ curated: ['a'] })).toBe('chosen');
    // A picked list wins, matching `pagePictures`.
    expect(pageMode({ curated: ['a'], showAll: true })).toBe('chosen');

    /*
     * An empty array *is* a choice — somebody picked, and picked nothing — and only
     * `null` is the absence of one. This assertion was the other way round, and
     * flipping it is the whole of Tommy's "adding a new block should add empty": a
     * block that reads as automatic when its list is empty is one that arrives full
     * of the page's photographs and refills itself the moment you press × on the
     * last one.
     */
    expect(pageMode({ curated: [] })).toBe('chosen');
    expect(pageMode({ curated: null })).toBe('auto');
    expect(pageMode({ curated: null, showAll: true })).toBe('all');
  });
});

describe('pagePictures and the three states of a picked list', () => {
  const tree = buildGalleryTree(TREE);
  const MEDIA = [shot('a', 'day-1'), shot('b', 'day-2'), shot('c', 'the-hike')];

  /*
   * The distinction the whole per-block editor rests on. A block just added, and one
   * somebody pressed × on until it was bare, both hold `[]` and must both stay bare
   * — where a block nobody has touched holds `null` and draws the level's own set.
   */
  it('shows nothing for an empty list and the summary for no list', () => {
    expect(pagePictures(tree, 'week-1', MEDIA, { curated: [] })).toEqual([]);
    expect(pagePictures(tree, 'week-1', MEDIA, { curated: null }).length).toBeGreaterThan(0);
    expect(pagePictures(tree, 'week-1', MEDIA, {}).length).toBeGreaterThan(0);
  });

  /** An empty list is not overruled by the page-wide "every photograph" switch. */
  it('keeps an empty list empty even when the page shows everything', () => {
    expect(pagePictures(tree, 'week-1', MEDIA, { curated: [], showAll: true })).toEqual([]);
    expect(
      pagePictures(tree, 'week-1', MEDIA, { curated: null, showAll: true }).length,
    ).toBeGreaterThan(0);
  });
});

describe('subtreeMedia', () => {
  const tree = buildGalleryTree(TREE);

  it('reaches the whole subtree, at any depth', () => {
    const media = [shot('own', 'week-1'), shot('child', 'day-2'), shot('deep', 'the-hike')];
    expect(subtreeMedia(tree, 'week-1', media).map((one) => one.id)).toEqual([
      'own',
      'child',
      'deep',
    ]);
  });

  it('is the whole program at the root', () => {
    const media = [shot('a', 'day-1'), shot('b', 'chapel')];
    expect(subtreeMedia(tree, null, media)).toHaveLength(2);
  });

  it('leaves out what is not cleared for a page', () => {
    const media = [shot('shown', 'day-1'), shot('hidden', 'day-1', HIDDEN)];
    expect(subtreeMedia(tree, 'week-1', media).map((one) => one.id)).toEqual(['shown']);
  });

  /**
   * Not a judgement but physics: a wheel with four grey "Processing…" boxes
   * turning past in it is worse than one with four fewer pictures.
   */
  it('leaves out anything still transcoding', () => {
    const media = [shot('pending', 'day-1', ON_PAGE, { renditionPath: null })];
    expect(subtreeMedia(tree, 'week-1', media)).toEqual([]);
  });
});

describe('subtreeSlideshow', () => {
  const tree = buildGalleryTree(TREE);

  /**
   * Every approved photograph in the subtree, at Tommy's direction. Approving is
   * what puts a photograph on the hall screen — there is no second flag to tick,
   * and the ordinary failure of the one there used to be was a camp approved on
   * Saturday and a blank screen on Sunday.
   */
  it('takes everything approved, whatever its placement says', () => {
    const media = [
      shot('on-page', 'day-1'),
      shot('off-page', 'day-2', HIDDEN),
      shot('deep', 'the-hike', HIDDEN),
    ];
    expect(subtreeSlideshow(tree, 'week-1', media).map((one) => one.id)).toEqual([
      'on-page',
      'off-page',
      'deep',
    ]);
  });

  it('is scoped to the level it was started from', () => {
    const media = [shot('mine', 'chapel'), shot('theirs', 'day-1')];
    expect(subtreeSlideshow(tree, 'week-2', media).map((one) => one.id)).toEqual(['mine']);
  });

  /** Not a filter on intent but on physics: there is no file to put on a screen. */
  it('leaves out a picture that is still transcoding', () => {
    const media = [shot('pending', 'chapel', ON_PAGE, { renditionPath: null })];
    expect(subtreeSlideshow(tree, 'week-2', media)).toEqual([]);
  });
});
