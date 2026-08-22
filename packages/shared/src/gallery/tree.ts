/**
 * A program's gallery as a tree, and what each level of it shows.
 *
 * Pure, dependency-free, and shared rather than living in the website — the
 * mobile app renders the same levels from the same documents, and "which
 * photographs does Week 1 2026 show" must not be a question the two answer
 * differently. This is the same argument the design tokens make: a rule that
 * exists twice is a rule that will disagree with itself.
 *
 * ## The one idea worth reading before the code
 *
 * **A level summarises everything beneath it.** Summercamp shows photographs
 * drawn from every year of camp; Week 1 2026 shows photographs drawn from each
 * of its days; Day 1 shows Day 1. So no page here renders "its own"
 * photographs — every page renders a summary of a *subtree*, and the deepest
 * level is only special in that its subtree is one node.
 *
 * Which photographs is an editorial choice at each level
 * (`featuredMediaIds`), and the automatic fallback is not "the first twenty of
 * whatever is newest". It spreads across the children — see `nodeSummary`. The
 * distinction matters: a Summercamp page filled with twenty photographs of the
 * same afternoon of the most recent camp is a summary of that afternoon, not of
 * Summercamp, and it is what a naive "newest first" produces every time.
 *
 * ## Depth is unbounded on purpose
 *
 * There was a fixed three levels — program, gathering, inline subgroup — and
 * the third had no page and there was no fourth. A parish that wants Summercamp
 * → 2026 → Week 1 → Day 1 → The hike has five, and nothing here counts.
 * `parentId` is the only thing that records the shape, and the guards below
 * (`GALLERY_MAX_DEPTH`, the seen-set in every walk) exist because a cycle —
 * which one mis-set `parentId` creates — would otherwise be an infinite loop in
 * a visitor's browser rather than a mis-drawn page.
 */
import type { Timestamped } from '../schema/common.js';
import { toDate } from '../schema/common.js';

/**
 * The least a node has to be for anything here to work.
 *
 * Structural rather than `ProgramEvent`, so the walks can be exercised in a
 * test with four-line fixtures and so the mobile app can hand over whatever
 * shape it holds. Every function below is generic in the node type and returns
 * the caller's own objects, never copies — an id that came in comes back out.
 */
export interface GalleryTreeNode {
  id: string;
  /** `null`/absent ⇒ a direct child of the program. See `ProgramEvent.parentId`. */
  parentId?: string | null;
  slug: string;
  title: string;
  order?: number;
  startAt?: Timestamped | null;
  /**
   * This node's own curated summary, read when a level above it summarises
   * itself by spreading across its children — each child contributes the head of
   * *its* summary, and if somebody has curated that child, the curated set is
   * what it contributes. Optional, because the walks are also run over fixtures
   * that carry nothing but a shape.
   */
  featuredMediaIds?: readonly string[] | undefined;
  /** The picture chosen for this node's card. See `summariseChildren`. */
  coverMediaId?: string | null | undefined;
}

/**
 * How deep a walk will go before it decides the data is wrong.
 *
 * Not a limit on the parish — nobody is filing photographs sixteen levels down —
 * but a stop on a cycle. `parentId` is written by a client, so `A → B → A` is one
 * bad drag away, and every function here walks parents or children. Without a
 * ceiling that is a hung tab on a public page; with one it is a level that
 * renders in the wrong place, which somebody can see and fix.
 */
export const GALLERY_MAX_DEPTH = 16;

/** `null` for a direct child of the program. Normalises absent and null alike. */
export function parentOf(node: GalleryTreeNode): string | null {
  return node.parentId ?? null;
}

/**
 * Sibling order: the number an administrator set, then the date, then the name.
 *
 * Both orderings are right at different levels and that is why this reads two
 * fields rather than one. Weeks and years want their dates, newest first. Days
 * want the sequence somebody typed — "Day 2" after "Day 1" and before "Day 10"
 * is neither a date nor alphabetical, and no machine can infer it — so an
 * explicit number has to win where there is one.
 *
 * A level nobody has reordered has 0 everywhere, every comparison ties, and the
 * date decides: exactly what the collection did before `order` existed.
 *
 * Undated nodes sort *last* among equals rather than first. A node with no date
 * is one somebody has not finished filling in, and the top of a page belongs to
 * the most recent camp rather than to a draft.
 */
export function compareNodes(a: GalleryTreeNode, b: GalleryTreeNode): number {
  const byOrder = (a.order ?? 0) - (b.order ?? 0);
  if (byOrder !== 0) return byOrder;

  const at = toDate(a.startAt ?? null)?.getTime();
  const bt = toDate(b.startAt ?? null)?.getTime();
  if (at !== undefined && bt !== undefined && at !== bt) return bt - at;
  if (at !== undefined && bt === undefined) return -1;
  if (at === undefined && bt !== undefined) return 1;

  // Locale-independent: the same document order in Node, in a browser, and in
  // the app. `localeCompare` here would sort a gallery differently per device.
  const byTitle = a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  if (byTitle !== 0) return byTitle;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A flat list of nodes, indexed for walking.
 *
 * Built once per page and passed around, because the alternative — a `filter`
 * over every node for every child lookup — is quadratic, and the walks below
 * call it once per level of the tree per card on the page.
 */
export interface GalleryTree<N extends GalleryTreeNode> {
  byId: Map<string, N>;
  /** Children, sorted. Keyed by parent id; `''` holds the program's own. */
  byParent: Map<string, N[]>;
}

/** The key `byParent` uses for a direct child of the program. */
const ROOT = '';

export function buildGalleryTree<N extends GalleryTreeNode>(nodes: readonly N[]): GalleryTree<N> {
  const byId = new Map<string, N>();
  const byParent = new Map<string, N[]>();

  for (const node of nodes) byId.set(node.id, node);

  for (const node of nodes) {
    const parent = parentOf(node);
    /*
     * A node whose parent is not in the list is treated as a direct child of the
     * program rather than dropped, and that is the important line in this file.
     *
     * It is the ordinary state, not an error: the public read filters on
     * `published`, so an unpublished "2026" with three published weeks under it
     * is a real and common shape. Dropping those weeks would make the parish's
     * photographs invisible because of a switch on a document nobody can see —
     * the most confusing outcome available. Lifting them to the top level shows
     * them, in the right ministry, one level shallower than intended.
     */
    const key = parent !== null && byId.has(parent) ? parent : ROOT;
    const siblings = byParent.get(key);
    if (siblings) siblings.push(node);
    else byParent.set(key, [node]);
  }

  for (const siblings of byParent.values()) siblings.sort(compareNodes);

  return { byId, byParent };
}

/** The children of a node, sorted. `null` asks for the program's own. */
export function childrenOf<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string | null,
): N[] {
  return tree.byParent.get(nodeId ?? ROOT) ?? [];
}

/** Whether anything hangs beneath this node. A leaf renders its own gallery. */
export function isLeaf<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string | null,
): boolean {
  return childrenOf(tree, nodeId).length === 0;
}

/**
 * Every node beneath this one, depth first, excluding itself.
 *
 * Depth first and in sibling order, so the result reads like the page does —
 * Week 1, then its days, then Week 2. `nodeId: null` walks the whole program.
 */
export function descendantsOf<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string | null,
): N[] {
  const found: N[] = [];
  // Cycles are one bad `parentId` away and this is a public page; see
  // GALLERY_MAX_DEPTH.
  const seen = new Set<string>();

  const walk = (parent: string | null, depth: number): void => {
    if (depth > GALLERY_MAX_DEPTH) return;
    for (const child of childrenOf(tree, parent)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child);
      walk(child.id, depth + 1);
    }
  };

  walk(nodeId, 0);
  return found;
}

/**
 * The ids whose photographs this level accounts for: itself and everything
 * beneath it.
 *
 * This is the set every read and every count on a gallery page is scoped to.
 * `null` gives the whole program, which is what the ministry page uses.
 */
export function subtreeIds<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string | null,
): string[] {
  const ids = descendantsOf(tree, nodeId).map((node) => node.id);
  return nodeId === null ? ids : [nodeId, ...ids];
}

/**
 * Walk a URL's slugs down the tree.
 *
 * `/events/summercamp/2026-week-1/day-1` gives `['2026-week-1', 'day-1']` and
 * this returns both nodes, outermost first — the trail, which is also the
 * breadcrumbs and also how the page knows what it is looking at.
 *
 * `null` when any segment does not resolve, and the page renders "no such
 * gallery" rather than the nearest thing it could find. Rendering Week 1 for
 * `/2026-week-1/day-7` when there is no Day 7 would tell a visitor the link
 * worked.
 *
 * Slugs are unique among *siblings* only, so this genuinely has to walk: two
 * different weeks may each have a `day-1`, and a lookup by slug alone would
 * pick whichever came back first.
 */
export function resolveTrail<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  slugs: readonly string[],
): N[] | null {
  const trail: N[] = [];
  let parent: string | null = null;

  for (const slug of slugs) {
    if (trail.length >= GALLERY_MAX_DEPTH) return null;
    const found: N | undefined = childrenOf(tree, parent).find((node) => node.slug === slug);
    if (!found) return null;
    trail.push(found);
    parent = found.id;
  }

  return trail;
}

/**
 * The trail down to a node, outermost first, including it.
 *
 * The inverse of `resolveTrail` — for building a link to a node whose id is
 * known, which is what every card, every menu entry and every re-file control
 * has to do. Walks parents, so a node whose ancestor is missing from the list
 * yields the part of the trail that exists, which is exactly the URL that will
 * resolve for it (see the lifting rule in `buildGalleryTree`).
 */
export function trailOf<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string,
): N[] {
  const trail: N[] = [];
  const seen = new Set<string>();
  let at: string | null = nodeId;

  while (at !== null && trail.length <= GALLERY_MAX_DEPTH) {
    if (seen.has(at)) break;
    seen.add(at);
    const node: N | undefined = tree.byId.get(at);
    if (!node) break;
    trail.unshift(node);
    const parent = parentOf(node);
    at = parent !== null && tree.byId.has(parent) ? parent : null;
  }

  return trail;
}

/** The slugs of that trail — the tail of the URL, ready to be joined. */
export function trailSlugs<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string,
): string[] {
  return trailOf(tree, nodeId).map((node) => node.slug);
}

/**
 * A node's ancestry as one line — "Summercamp Week 1 2026 · Day 1".
 *
 * For the places that show a photograph out of its context and have to say
 * where it came from: the picker, the re-file control, the properties panel. A
 * bare "Day 1" there means nothing, because four camps have one.
 */
export function trailLabel<N extends GalleryTreeNode>(
  tree: GalleryTree<N>,
  nodeId: string,
  separator = ' · ',
): string {
  const trail = trailOf(tree, nodeId);
  return trail.length > 0 ? trail.map((node) => node.title).join(separator) : nodeId;
}

/* -------------------------------------------------------------------------- */
/* What a level shows                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The least a photograph has to be for the summary rules to apply to it.
 *
 * Structural for the same reason `GalleryTreeNode` is, and narrow on purpose:
 * the three fields that decide whether a picture may stand for a level are
 * where it is filed, whether it has a file yet, and where it is allowed to
 * appear. Nothing here reads a caption or a date.
 */
export interface SummaryMedia {
  id: string;
  /** The node it is filed against, at whatever depth. */
  programEventId: string;
  kind: 'photo' | 'video';
  renditionPath: string | null;
  posterPath: string | null;
  placement: { onPage: boolean; slideshow: boolean; homepage: boolean };
}

/**
 * Whether there is something to actually draw for this item yet.
 *
 * An approved photograph with no rendition is a real and ordinary state — the
 * transcode runs seconds after approval — and a gallery page rightly draws it as
 * "Processing…", because it is one picture among twenty and saying so beats a
 * broken image. As one of six pictures standing for a whole ministry, a grey box
 * that says "Processing…" is not a picture of the ministry. So the automatic
 * summaries skip them and take the next one along, and a curated id is honoured
 * either way: an administrator who has just approved and featured a photograph
 * should see it appear, with its processing state, rather than silently not.
 */
export function hasRenderableFile(item: SummaryMedia): boolean {
  return (item.kind === 'video' ? item.posterPath : item.renditionPath) !== null;
}

/** Eligible to stand for a level: it has a file and it is cleared for a page. */
function canSummarise(item: SummaryMedia): boolean {
  return hasRenderableFile(item) && (item.placement.onPage || item.placement.homepage);
}

/**
 * Showcase photographs first, then the rest, each keeping the order it came in.
 *
 * `placement.homepage` is already the flag for "good enough for the front of the
 * site", so it is the closest thing to an editorial judgement that exists
 * without asking anybody — which makes it the right thing to lead an
 * uncurated summary with.
 */
function showcaseFirst<M extends SummaryMedia>(items: readonly M[]): M[] {
  const showcase: M[] = [];
  const rest: M[] = [];
  for (const item of items) (item.placement.homepage ? showcase : rest).push(item);
  return [...showcase, ...rest];
}

/**
 * How many pictures an automatic summary of a level may run to.
 *
 * A page summary rather than a gallery: past two dozen it stops summarising and
 * starts being the archive, which is what the levels beneath it are for. A
 * *curated* set is held to the same ceiling — see `MAX_FEATURED` in the website's
 * adminData — because it is the same page.
 *
 * Does not apply to a leaf, which shows everything filed on it. That is the
 * gallery, and capping it would hide the parish's photographs on the one page
 * whose whole job is showing them.
 */
export const GALLERY_SUMMARY_MAX = 24;

/**
 * The photographs one level of a program shows, in the order it shows them.
 *
 * `nodeId: null` is the ministry page. Anything else is a node, at any depth.
 *
 * Three cases, in the order they are decided:
 *
 *  1. **Curated.** `featuredMediaIds` names them, and they are shown in that
 *     order. Ids that no longer resolve — rejected since, deleted since, or
 *     simply outside the window that was read — are dropped rather than drawn as
 *     a gap. A level must not go blank because one of six pictures went away.
 *  2. **A leaf, uncurated.** Everything filed on it that is cleared for a page,
 *     in `order`. This is the gallery, and it is why the deepest level is worth
 *     opening without anybody having curated anything.
 *  3. **A branch, uncurated.** A spread across the children, described below.
 *
 * ## Why a branch spreads rather than taking the newest
 *
 * Because "newest first" does not summarise. A Summercamp page filled from a
 * flat newest-first list is twenty photographs of one afternoon of the most
 * recent camp — a summary of that afternoon. Taking the head of each child's own
 * summary in turn, round by round, gives a page where every camp is represented
 * before any camp is represented twice, and the recursion means each of those
 * children summarised itself the same way. That is the property the parish
 * actually asked for: the top of the tree shows the whole tree.
 *
 * The node's own directly-filed photographs are one more pool in that rotation
 * rather than a block in front of it, so a branch that has a few pictures of its
 * own does not push its children off the page.
 */
export function nodeSummary<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  /** Everything known under this level. Filtering is this function's job. */
  media: readonly M[],
  options: {
    /** `featuredMediaIds` from the node, or from the program at the root. */
    curated?: readonly string[] | undefined;
    max?: number | undefined;
  } = {},
): M[] {
  const max = options.max ?? GALLERY_SUMMARY_MAX;

  // `Array.isArray` rather than `?? []`: the field is new, so a document written
  // before it exists has no such key at all, and the cast that produced this
  // object merely claims otherwise.
  const curated = Array.isArray(options.curated) ? options.curated : [];
  if (curated.length > 0) {
    const byId = new Map(media.map((item) => [item.id, item]));
    return curated
      .map((id) => byId.get(id))
      .filter((item): item is M => item !== undefined)
      .slice(0, max);
  }

  const own = nodeId === null ? [] : media.filter((item) => item.programEventId === nodeId);
  const children = childrenOf(tree, nodeId);

  if (children.length === 0) {
    /*
     * A leaf, uncurated: the gallery itself, uncapped, in `order`.
     *
     * `canSummarise` is not applied here and that is deliberate — this is the
     * page the photograph was filed on, so an item still transcoding belongs on
     * it with its "Processing…" state. Only the standing-for-something-else
     * summaries skip those.
     */
    return own.filter((item) => item.placement.onPage);
  }

  /*
   * One pool per child, each summarised by the same rules, plus the node's own.
   * Recursion depth is the tree's depth, which `buildGalleryTree` and
   * `descendantsOf` have already bounded.
   */
  const pools: M[][] = [
    showcaseFirst(own.filter(canSummarise)),
    ...children.map((child) => {
      const curatedChild = Array.isArray(child.featuredMediaIds) && child.featuredMediaIds.length > 0;
      const pool = nodeSummary(tree, child.id, media, {
        curated: child.featuredMediaIds,
        max,
      }).filter(canSummarise);
      /*
       * Showcase-first, but only for a child nobody has curated.
       *
       * The distinction is the difference between two kinds of order. A leaf's
       * own page shows its photographs in `order`, which is right — that is the
       * gallery. But when its photographs stand in for the *level above it*, only
       * the first one or two get shown, and "the first two that happened to be
       * uploaded" is a worse pick than "the two somebody flagged as good enough
       * for the front of the site". Without this, a week's page led with whatever
       * was at the top of Day 1's queue while the showcase photograph two rows
       * down never appeared anywhere.
       *
       * A curated child is left exactly as it was chosen. Its order *is* an
       * editorial statement, and re-sorting it would overrule the person who made
       * it with a flag they may have set for another reason entirely.
       */
      return curatedChild ? pool : showcaseFirst(pool);
    }),
  ].filter((pool) => pool.length > 0);

  const picked: M[] = [];
  const taken = new Set<string>();

  for (let round = 0; picked.length < max; round += 1) {
    let added = false;
    for (const pool of pools) {
      const item = pool[round];
      if (!item || taken.has(item.id)) continue;
      taken.add(item.id);
      picked.push(item);
      added = true;
      if (picked.length >= max) break;
    }
    if (!added) break;
  }

  return picked;
}

/**
 * What a child's card says about itself.
 *
 * Every number here counts the child's whole subtree, not the documents filed
 * directly on it. "Week 1 2026 — 214 photographs" is the fact somebody wants
 * before they click; "Week 1 2026 — 0 photographs, but there are four days
 * inside it with fifty each" is the fact the old per-document count gave them,
 * and it read as an empty camp.
 */
export interface NodeSummary<M extends SummaryMedia> {
  cover: M | null;
  /**
   * A handful from the same subtree, `cover` first, for a tile that cycles.
   *
   * The side menu on a gallery page shows its levels the way `/events` shows the
   * ministries — a photograph with the name over it, cross-fading to the next
   * one — and a single cover cannot do that. Everything here is already in
   * `mine`, so this costs a slice and no extra reads.
   *
   * Capped at `SUMMARY_COVERS`. `cover` is kept beside it rather than being
   * replaced by `covers[0]`, because the cards elsewhere on the page want
   * exactly one and should not have to know about the cap.
   */
  covers: M[];
  photos: number;
  videos: number;
  /** How many levels hang directly beneath. Zero for a leaf. */
  children: number;
}

/**
 * How many pictures a cycling tile is given.
 *
 * Five, for the reason `CYCLE_MAX` in `ProgramTile` is five: every one of them is
 * an `<img>` in the DOM at once — that is what makes it a cross-fade rather than
 * a cut — so the count is a page-weight decision, not a taste one. A level with
 * fewer cycles between however many it has.
 */
export const SUMMARY_COVERS = 5;

/**
 * Summarise every child of a level, for the cards on its page.
 *
 * The cover is the child's own `coverMediaId` when an administrator chose one —
 * honoured even mid-transcode, because a chosen cover that silently does not
 * appear makes the control look broken — and otherwise the first photograph in
 * the child's subtree that is cleared for a page and has a file.
 *
 * A video is never an automatic cover. Its poster frame is a still nobody chose,
 * and one of those beside three chosen photographs is always the odd card out.
 * Chosen explicitly, it is honoured.
 */
export function summariseChildren<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  media: readonly M[],
): Map<string, NodeSummary<M>> {
  const summaries = new Map<string, NodeSummary<M>>();

  for (const child of childrenOf(tree, nodeId)) {
    const ids = new Set(subtreeIds(tree, child.id));
    const mine = media.filter((item) => ids.has(item.programEventId));

    const chosen = child.coverMediaId
      ? mine.find((item) => item.id === child.coverMediaId)
      : undefined;

    /*
     * `hasRenderableFile` is the part that is easy to leave out and impossible
     * to miss once it bites: without it the automatic cover is the first
     * approved photograph, which may be one whose transcode has not finished —
     * and a card cover has no "Processing…" state to fall back on, so the level
     * renders with the blank ground of one that has no photographs at all.
     */
    const cover =
      chosen ??
      mine.find(
        (item) =>
          item.kind === 'photo' && item.placement.onPage && hasRenderableFile(item),
      ) ??
      null;

    /*
     * The cycle's pictures: the cover first, then the rest of the subtree's
     * page-cleared photographs in order.
     *
     * Same `hasRenderableFile` guard as the cover above, and for the same
     * reason — a mid-transcode file in the cycle is a tile that blinks to blank
     * once per lap. The cover is put at the head rather than deduplicated after,
     * so the picture an administrator chose is the one the tile opens on.
     */
    const rest = mine.filter(
      (item) =>
        item.id !== cover?.id &&
        item.kind === 'photo' &&
        item.placement.onPage &&
        hasRenderableFile(item),
    );
    const covers = (cover ? [cover, ...rest] : rest).slice(0, SUMMARY_COVERS);

    summaries.set(child.id, {
      cover,
      covers,
      photos: mine.filter((item) => item.kind === 'photo').length,
      videos: mine.filter((item) => item.kind === 'video').length,
      children: childrenOf(tree, child.id).length,
    });
  }

  return summaries;
}

/**
 * The set of photographs **one block** shows, whichever way it was decided.
 *
 * Called once per block on a page, and that is the change — it used to be called
 * once *for* a page, with every block drawing the result. A block now carries its
 * own two lists (see `GalleryBand.picks` and `.hidden`) and the page's own first
 * block carries the same pair as `featuredMediaIds` and `hiddenMediaIds` on the
 * program or the node. Same shape, two homes, one resolver — so a picked block and
 * an automatic one cannot end up resolved by different rules.
 *
 * Three modes, in the order they are resolved, and they are exclusive:
 *
 *  1. **Picked** — `curated` names them, in that order. Somebody chose these while
 *     looking at this block. Capped, and ids that no longer resolve are dropped
 *     rather than drawn as a gap.
 *  2. **All of them** — `showAll`, uncapped: every approved picture in the
 *     subtree, in `order`. Wants a wheel; see `subtreeMedia`.
 *  3. **Chosen for you** — the automatic summary, which spreads across the
 *     children rather than taking the newest twenty. See `nodeSummary`.
 *
 * The order matters where the states overlap: a block somebody has picked for
 * ignores `showAll`, because a list of pictures chosen by hand is a statement made
 * on purpose and does not get silently overruled by a page-wide switch. The
 * control for that switch says so.
 *
 * ## `curated: []` shows nothing; `curated: null` is automatic
 *
 * An *empty array* is a real answer here and not the absence of one: a block just
 * added is empty on purpose, and one somebody pressed × on until it was bare
 * should stay bare rather than silently refill with two dozen photographs.
 *
 * Which means the distinction cannot be made from the emptiness of the array, and
 * the caller has to say. A band passes `GalleryBand.picks` straight through, which
 * is `null` until somebody picks. The page's own first block reads
 * `featuredMediaIds`, where empty has meant "automatic" since long before any of
 * this, so its caller passes `null` for an empty one. Two states there and three
 * here, resolved by one function, with the call sites carrying the difference —
 * which is better than a second resolver that could disagree with this one.
 */
export function pagePictures<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  media: readonly M[],
  page: {
    /** The picked list. `null` — not `[]` — is "nobody has picked". */
    curated?: readonly string[] | null | undefined;
    showAll?: boolean | undefined;
    /** Pressed × on, in this block. Applied last, to whichever mode won. */
    hidden?: readonly string[] | undefined;
    max?: number | undefined;
  },
): M[] {
  const curated = Array.isArray(page.curated) ? page.curated : null;
  const chosen =
    curated === null
      ? page.showAll === true
        ? subtreeMedia(tree, nodeId, media)
        : nodeSummary(tree, nodeId, media, { max: page.max })
      : // Empty short-circuits rather than reaching `nodeSummary`, which reads an
        // empty `curated` as "no list" and would answer with the automatic spread.
        curated.length === 0
        ? []
        : nodeSummary(tree, nodeId, media, { curated, max: page.max });

  /*
   * The hidden ones come off last, whichever mode chose the set.
   *
   * Last rather than first, and that is not arbitrary: taking them out before the
   * summary runs would let the automatic spread quietly *replace* each one with
   * another picture, so removing a photograph you did not want would produce a
   * different photograph you had not asked for. Applied afterwards, a removal
   * leaves a page of one fewer, which is what pressing × on a picture looks like
   * it should do.
   */
  const hidden = Array.isArray(page.hidden) ? page.hidden : [];
  if (hidden.length === 0) return chosen;
  const off = new Set(hidden);
  return chosen.filter((item) => !off.has(item.id));
}

/**
 * Which of those three a block is in, for a control that has to show it.
 *
 * Derived rather than stored, so the label on a block and the pictures in it
 * cannot say different things — the bug that had a level reporting "chosen" about
 * a cover nobody had chosen for it.
 */
export type PageMode = 'chosen' | 'all' | 'auto';

export function pageMode(page: {
  /** `null` — not `[]` — is "nobody has picked". Same contract as `pagePictures`. */
  curated?: readonly string[] | null | undefined;
  showAll?: boolean | undefined;
}): PageMode {
  // An empty array is still `chosen`: somebody picked, and picked nothing.
  if (Array.isArray(page.curated)) return 'chosen';
  return page.showAll === true ? 'all' : 'auto';
}

/**
 * Every photograph on a page, uncapped — the other thing a page's set can be.
 *
 * `nodeSummary` is *chosen and capped*: a selection, either an administrator's or
 * one made for them, because a ministry page cannot open with two thousand
 * photographs on it. This is the opposite, and it exists because "show everything
 * from every day of this camp, on this page" is a real thing to want and a summary
 * is by definition not that.
 *
 * It is a property of the **page**, not of one block — `ProgramEvent.showAllPictures`
 * — and that placement is the whole design. Every block on a page draws the same
 * set, so "all of them" has to be a decision the page makes once. As a per-block
 * setting (which it briefly was) it let a wheel disagree with the grid above it
 * about what the page was for.
 *
 * A scroll wheel is what makes the mode usable at all: four hundred pictures in a
 * grid is a page nobody reaches the bottom of, and four hundred in a wheel is one
 * strip the height of a photograph that turns for as long as somebody watches. So
 * the honest advice, which the panel gives, is that "all of them" wants a wheel.
 *
 * No round-robin and no showcase-first: this is a set, in `order`, not a summary.
 * `hasRenderableFile` still applies, and here it is not a judgement but physics —
 * a wheel with four grey "Processing…" boxes turning past in it is worse than one
 * with four fewer pictures.
 */
export function subtreeMedia<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  media: readonly M[],
): M[] {
  const ids = new Set(subtreeIds(tree, nodeId));
  return media.filter(
    (item) =>
      (nodeId === null || ids.has(item.programEventId)) &&
      item.placement.onPage &&
      hasRenderableFile(item),
  );
}

/**
 * Everything in a subtree that the hall screen runs — which is **everything
 * approved in it**.
 *
 * The reason `?present=all` needs no level of its own in the URL any more:
 * "present Day 2", "present Week 1" and "present all of Summercamp" are one
 * operation over three different subtrees.
 *
 * ## Why this does not read `placement.slideshow`
 *
 * At Tommy's direction: approving a photograph puts it in the presentation, full
 * stop. The flag is still on the documents and the schema still describes it —
 * see `MediaPlacement` — but nothing filters on it, and the switch that set it is
 * off the properties panel, because a control that changes nothing is worse than
 * no control.
 *
 * The argument it was built on is real and was still wrong here: a page tells its
 * story in twenty photographs and a hall screen fills an evening with two
 * hundred, so the two sets should not be one. But the *page* set is already
 * chosen — `featuredMediaIds` at every level, and `placement.onPage` under it —
 * and the hall screen wanting "everything" needs no second flag to say so. What
 * the flag actually bought was a third thing to remember to tick before a
 * photograph appeared anywhere, and the ordinary failure was a camp approved on
 * Saturday and a blank screen in the hall on Sunday.
 *
 * `hasRenderableFile` still applies, and it is not a filter on intent but on
 * physics: an item whose transcode has not finished has no file to put on a
 * screen.
 */
export function subtreeSlideshow<N extends GalleryTreeNode, M extends SummaryMedia>(
  tree: GalleryTree<N>,
  nodeId: string | null,
  media: readonly M[],
): M[] {
  const ids = new Set(subtreeIds(tree, nodeId));
  return media.filter(
    (item) => hasRenderableFile(item) && (nodeId === null || ids.has(item.programEventId)),
  );
}
