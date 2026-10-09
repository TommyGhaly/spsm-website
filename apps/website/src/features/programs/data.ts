import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  UNFILED_PROGRAM_ID,
  buildGalleryTree,
  hasRenderableFile,
  resolveTrail,
  spreadAcross,
  subtreeIds,
  type DocOf,
  type Event,
  type GalleryMedia,
  type GalleryTree,
  type Program,
  type ProgramEvent,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';

/**
 * Reads for the program galleries.
 *
 * **Every one of these runs in the browser, not at build time.** That is the
 * exception these pages exist to make — see docs/program-galleries.md §2 — and
 * it changes what a failure means. A build-time read that fails costs a build,
 * loudly, in front of a developer. These fail in front of a visitor, so each one
 * returns an empty result and lets the caller render a state rather than
 * throwing into a blank screen.
 *
 * ## The filter that is not optional
 *
 * `where('status', '==', 'approved')` appears in every public query below and
 * must never be dropped as a tidy-up. Firestore evaluates a list against what
 * it *could* return, so without it the rules cannot prove no pending item comes
 * back and the whole query is **denied** — not filtered. The gallery goes empty
 * and the console says `permission-denied`, which reads like a broken page
 * rather than a missing clause. This is decision #10 in a new collection;
 * tests/rules/program-galleries.test.ts asserts both directions.
 */

/** Everything a public reader is allowed to see, and nothing else. */
const APPROVED = where('status', '==', 'approved');

/**
 * Local, rather than `safely` from `@/lib/firestore`, and the difference is the
 * point rather than an oversight.
 *
 * That helper **re-throws** on permission-denied, deliberately: it runs during
 * `next build`, where a rules rejection means the built page would 403 for the
 * public, and failing the build is the correct, loud outcome.
 *
 * These reads run in a visitor's browser. There is no build to fail — a throw
 * here unmounts the page and leaves a stranger looking at nothing. So the same
 * error is logged and swallowed, and the caller renders "this gallery could not
 * be loaded" instead. Same condition, opposite right answer, because the
 * audience is a parishioner rather than a developer.
 */
async function readOrEmpty<T>(what: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[programs] ${what} failed:`, error);
    return fallback;
  }
}

export async function getPrograms(): Promise<DocOf<Program>[]> {
  return readOrEmpty(
    'programs',
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.programs),
          where('published', '==', true),
          orderBy('order', 'asc'),
        ),
      );
      return snapshot.docs.map(docOf<Program>);
    },
    [],
  );
}

/**
 * A program by its slug.
 *
 * The slug is also the document id — programs are created by a superadmin from
 * a name they typed, so there is no reason for the two to differ, and a direct
 * `getDoc` costs one read where a query costs a query. `getPrograms` is
 * therefore not the way to find one.
 */
export async function getProgram(slug: string): Promise<DocOf<Program> | null> {
  return readOrEmpty(
    `program ${slug}`,
    async () => {
      const snapshot = await getDoc(doc(db(), COLLECTIONS.programs, slug));
      if (!snapshot.exists()) return null;
      // `docOf` takes a QueryDocumentSnapshot; a single-document read yields a
      // DocumentSnapshot, which is the same shape once existence is proven.
      const program = { id: snapshot.id, ...(snapshot.data() as Program) };
      return program.published ? program : null;
    },
    null,
  );
}

/**
 * Every level under one program, in one query.
 *
 * The whole tree, not one generation. That is not a convenience — it is what
 * every page in this section needs, because a page here shows a summary of
 * everything beneath it and cannot know what that is from its children alone.
 * "Summercamp" has to reach the days inside the weeks to count them; "Week 1"
 * has to reach its days to spread its summary across them.
 *
 * One query for the tree rather than one per level is also the only shape that
 * does not fan out with the parish's history. A generation-at-a-time read is a
 * query per level per page, and it gets slower every year the parish runs camp.
 *
 * Sorted client-side by `compareNodes`, which reads the administrator's manual
 * order before the date — see that function. The `orderBy` here is only what the
 * index and the rules require; it is not the order anything renders in.
 *
 * Undated levels come back last from Firestore, which is the convention this
 * collection has always used: a level with no date is one somebody has not
 * finished filling in.
 */
export async function getProgramEvents(programId: string): Promise<DocOf<ProgramEvent>[]> {
  return readOrEmpty(
    `events for ${programId}`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.programEvents),
          where('programId', '==', programId),
          where('published', '==', true),
          orderBy('startAt', 'desc'),
        ),
      );
      return snapshot.docs.map(docOf<ProgramEvent>);
    },
    [],
  );
}

/**
 * The calendar entry a gallery is filed against, if there is one.
 *
 * Reaches into the `events` collection, which is otherwise none of this file's
 * business — `features/events/data.ts` owns it. It is here rather than there
 * because of *when* it runs: that file uses `safely`, which re-throws on
 * permission-denied so a build fails loudly, and this runs in a visitor's
 * browser where a throw leaves a stranger looking at nothing.
 *
 * `ProgramEvent.calendarEventId` holds an id, not a slug — ids are stable and
 * slugs are the public URL somebody may rename — so the document has to be read
 * to find out where it lives. One `getDoc`, on a page that has already made
 * three.
 *
 * Null is ordinary rather than exceptional: the event may have been deleted since
 * it was linked, and a gallery must not stop rendering because the calendar moved
 * on. The link simply disappears.
 *
 * There used to be a `published` check here as well. Events have no published
 * state now — one exists or it does not — so existence is the whole test.
 */
export async function getLinkedCalendarEvent(eventId: string): Promise<DocOf<Event> | null> {
  return readOrEmpty(
    `calendar event ${eventId}`,
    async () => {
      const snapshot = await getDoc(doc(db(), COLLECTIONS.events, eventId));
      if (!snapshot.exists()) return null;
      return { id: snapshot.id, ...(snapshot.data() as Event) };
    },
    null,
  );
}

/**
 * How many nodes' worth of media one query may ask for.
 *
 * Firestore's ceiling on the values in an `in` filter. It is not a number this
 * file chose, and it is why `getSubtreeMedia` has two branches rather than one.
 */
const IN_FILTER_MAX = 30;

/**
 * How much of a program's archive one read pulls when the subtree is too wide
 * for an exact query.
 *
 * The fallback in `getSubtreeMedia`, and the read a ministry page makes. Such a
 * page needs three things — the pictures it shows, a cover for each level under
 * it, and the counts beside them — and every one of those is a *summary* of the
 * whole program, so one capped query answers all three.
 *
 * The cost of the cap is honest and small: a level with nothing inside this
 * window shows no cover and no count, which is the same thing it shows when it
 * genuinely has no photographs. 300 is several years of camps.
 */
const PROGRAM_PAGE_WINDOW = 300;

/**
 * Every approved photograph under one level of a program — it and everything
 * beneath it.
 *
 * **The read the whole section is built on.** A gallery page shows a summary of
 * its subtree, so "the photographs of this page" is never one node's worth; it
 * is one node's *and its descendants'*, at whatever depth.
 *
 * Two shapes, chosen by how wide the subtree is, and the reason for two is
 * accuracy rather than speed:
 *
 *  - **Up to thirty nodes**, which is nearly every real subtree — a week and its
 *    days, a day and its parts — is one `in` query, exact and uncapped. Every
 *    photograph in that week comes back, however many years of camp sit beside
 *    it in the collection.
 *  - **Wider than that** — a ministry with a decade of camps, days and outings
 *    under it — falls back to one capped `programId` query, filtered here. That
 *    is a genuine approximation and the cap is the cost of it: a level with
 *    nothing inside the window shows no cover and no count, which is the same
 *    thing it shows when it truly has no photographs.
 *
 * The alternative to both was a query per node, which is a fan-out that grows
 * with the parish's history on a page a visitor opens first.
 *
 * `where('status','==','approved')` is in both branches and must never be
 * dropped as a tidy-up — see the note at the top of this file. Without it the
 * rules deny the query outright rather than filtering it, and the gallery goes
 * empty with `permission-denied` in a console nobody is reading.
 */
export async function getSubtreeMedia(
  programId: string,
  nodeIds: readonly string[],
): Promise<DocOf<GalleryMedia>[]> {
  // A level with nothing under it — an empty ministry, or a node whose children
  // are all unpublished. No query, rather than a query that cannot match.
  if (nodeIds.length === 0) return [];

  if (nodeIds.length <= IN_FILTER_MAX) {
    return readOrEmpty(
      `media for ${nodeIds.length} level(s) of ${programId}`,
      async () => {
        const snapshot = await getDocs(
          query(
            collection(db(), COLLECTIONS.galleryMedia),
            where('programEventId', 'in', [...nodeIds]),
            APPROVED,
            orderBy('order', 'asc'),
          ),
        );
        return snapshot.docs.map(docOf<GalleryMedia>);
      },
      [],
    );
  }

  const wanted = new Set(nodeIds);
  const everything = await getProgramMedia(programId, PROGRAM_PAGE_WINDOW);
  return everything.filter((item) => wanted.has(item.programEventId));
}

/**
 * Everything approved across a whole program — what a ministry page and "present
 * all of Summercamp" read.
 *
 * Capped, because a program with ten years of camps behind it is thousands of
 * photographs and neither a ministry page nor a kiosk needs them all in memory
 * to draw the first twenty.
 */
export async function getProgramMedia(
  programId: string,
  max = 500,
): Promise<DocOf<GalleryMedia>[]> {
  return readOrEmpty(
    `media for program ${programId}`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.galleryMedia),
          where('programId', '==', programId),
          APPROVED,
          orderBy('order', 'asc'),
          limit(max),
        ),
      );
      return snapshot.docs.map(docOf<GalleryMedia>);
    },
    [],
  );
}

/**
 * The showcase set, across every program — what the homepage band will read.
 *
 * Built now because the flag it filters on is set from day one in the admin
 * screen, and a flag nothing reads is a flag nobody trusts. Where these appear
 * on the homepage is still open.
 */
export async function getHomepageMedia(max = 24): Promise<DocOf<GalleryMedia>[]> {
  return readOrEmpty(
    'homepage media',
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.galleryMedia),
          APPROVED,
          where('placement.homepage', '==', true),
          orderBy('order', 'asc'),
          limit(max),
        ),
      );
      return snapshot.docs.map(docOf<GalleryMedia>);
    },
    [],
  );
}

/* -------------------------------------------------------------------------- */
/* Deriving what a page shows from one read                                    */
/* -------------------------------------------------------------------------- */

export function getProgramPageMedia(programId: string): Promise<DocOf<GalleryMedia>[]> {
  return getProgramMedia(programId, PROGRAM_PAGE_WINDOW);
}

/**
 * Everything one gallery page needs, from two queries.
 *
 * The tree and the photographs of the subtree the URL names, resolved together
 * because they are not independent: which photographs to read is a question only
 * the tree can answer, and the tree is the thing that says whether the URL names
 * a level at all.
 *
 * `trail` empty is the ministry page — the whole program, the subtree rooted at
 * nothing. Anything else walks the slugs down and refuses the lot if one of them
 * does not resolve, rather than rendering the nearest level it found: showing
 * Week 1 for a URL ending `/day-7` when there is no Day 7 tells a visitor the
 * link worked.
 *
 * The two queries run in sequence rather than in parallel, and that is forced
 * rather than lazy — the second one's filter is `subtreeIds` of the first one's
 * result. It is the one place in this file where a page waits on a read it could
 * not have started earlier.
 */
export interface GalleryLevel {
  tree: GalleryTree<DocOf<ProgramEvent>>;
  /** Outermost first, including the level itself. Empty for the ministry page. */
  trail: DocOf<ProgramEvent>[];
  /** The level being looked at, or null for the ministry page. */
  node: DocOf<ProgramEvent> | null;
  /** Approved items in this level's subtree, in `order`. */
  media: DocOf<GalleryMedia>[];
}

export async function getGalleryLevel(
  programId: string,
  trail: readonly string[],
  /**
   * The tree to resolve against, when the caller has a fuller one than the
   * public read would give — an administrator's list, which includes the drafts.
   * Without this an administrator cannot open the unpublished level they just
   * made, which is the one they most need to open.
   */
  nodes?: readonly DocOf<ProgramEvent>[],
): Promise<GalleryLevel | null> {
  const all = nodes ?? (await getProgramEvents(programId));
  const tree = buildGalleryTree(all);

  const found = trail.length === 0 ? [] : resolveTrail(tree, trail);
  if (found === null) return null;

  const node = found[found.length - 1] ?? null;

  /*
   * A level reads its subtree. The ministry reads the whole program, and the
   * difference is not an optimisation.
   *
   * `subtreeIds` returns nodes, and the ministry is not one — so a photograph
   * filed on the ministry itself (`programEventId === programId`, which is what
   * dropping one on the top row of `PictureManager` writes) was in no page's
   * read at all. It was still in Firestore and still approved; it simply had
   * nowhere left to appear, including the manager it was moved from, so filing a
   * picture there looked exactly like deleting it.
   *
   * Adding the program's own id to the `in` list fixed that and could not fix
   * the other half: a photograph left on a level that has since been deleted
   * names an id that is in no list, so no query built out of the tree can ever
   * return it. Reading the program instead returns everything in it — filed,
   * on the ministry, or orphaned — which is what `healOrphans` below then needs.
   *
   * The cost is the cap. The `in` branch is exact and uncapped for a ministry of
   * thirty levels or fewer; this is capped at `PROGRAM_PAGE_WINDOW`. That is the
   * same approximation a wider ministry already lives with, on the same page,
   * and it buys the guarantee that a photograph in this ministry appears
   * *somewhere* — which nothing else here provides.
   */
  const media =
    node === null
      ? healOrphans(await getProgramPageMedia(programId), tree, programId)
      : await getSubtreeMedia(programId, subtreeIds(tree, node.id));

  return { tree, trail: found, node, media };
}

/**
 * A photograph whose level was deleted reads as one filed on the ministry.
 *
 * Deleting a level now moves its pictures up first — see `deleteProgramEvent` —
 * so nothing new becomes an orphan. This is for the ones already out there,
 * stranded by a delete that happened before that was true, and for any that
 * arrive by a route nobody has thought of: a level removed in the Firestore
 * console, a half-finished migration.
 *
 * **Rewritten in the objects this function returns, not in Firestore.** A read
 * that repairs the database is a read that needs write permission, and this one
 * runs for every visitor on a public page. So the document keeps its dead id and
 * every surface behaves as though it says the ministry's — which is enough,
 * because the moment an administrator drags the picture anywhere at all the fix
 * becomes permanent through the ordinary write.
 *
 * A draft level counts as live. An administrator's tree includes unpublished
 * nodes and a visitor's does not, so a picture filed on a level nobody has
 * published yet would otherwise be "orphaned" for the public and correctly filed
 * for staff — two different answers about one document, differing by who is
 * looking. Reading it as its own level's in both cases keeps it off the ministry
 * page either way, which is what an unpublished level is *for*.
 */
function healOrphans(
  media: readonly DocOf<GalleryMedia>[],
  tree: GalleryTree<DocOf<ProgramEvent>>,
  programId: string,
): DocOf<GalleryMedia>[] {
  const live = new Set(subtreeIds(tree, null));
  return media.map((item) =>
    live.has(item.programEventId) || item.programEventId === programId
      ? item
      : { ...item, programEventId: programId },
  );
}

/**
 * Photographs whose ministry was deleted — the parish's loose pictures.
 *
 * One equality query on the sentinel `deleteProgram` writes, riding the same
 * `(programId, status, order)` index as every ordinary program read. See
 * `UNFILED_PROGRAM_ID` for why it is a sentinel and not a dangling id.
 *
 * Approved only, and that is both a permission fact and a design one. The rules
 * let anybody read an approved photograph, so this read needs no special grant
 * to *return* — while a pending one is readable only through
 * `adminsProgramEvent`, which no longer matches anybody once the program is
 * gone. It is also the only kind this is for: the screen that shows these files
 * pictures into galleries, and a submission whose queue no longer exists is a
 * different problem with a different answer.
 */
export async function getUnfiledMedia(max = 200): Promise<DocOf<GalleryMedia>[]> {
  return readOrEmpty(
    'unfiled media',
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.galleryMedia),
          where('programId', '==', UNFILED_PROGRAM_ID),
          APPROVED,
          orderBy('order', 'asc'),
          limit(max),
        ),
      );
      return snapshot.docs.map(docOf<GalleryMedia>);
    },
    [],
  );
}

/**
 * The pictures a ministry's *tile* cycles through, on /events.
 *
 * Deliberately not `nodeSummary`, and the difference is worth stating because
 * the two are meant to agree.
 *
 * When somebody has curated the ministry page, they agree exactly: the ids are
 * the ids, in the order they were chosen, and the tile previews the page.
 *
 * When nobody has, the page spreads its summary across the gatherings — which
 * needs the whole tree — and this does not, because the rail draws five
 * ministries and reading a tree for each would put five extra queries on the
 * page that opens this section. It takes the showcase photographs and then
 * anything cleared for a page, which is the same *pool* the spread draws from
 * and usually the same first few pictures out of it. A tile shows five of
 * twenty-four; the cases where the two disagree are ones where both answers are
 * "a recent photograph of this ministry", which is all a tile claims.
 *
 * Videos are eligible. A clip of the talent show is as much a picture of the
 * ministry as a photograph of it.
 */
export function programTileMedia(
  program: Pick<Program, 'featuredMediaIds'>,
  media: readonly DocOf<GalleryMedia>[],
  max = 9,
): DocOf<GalleryMedia>[] {
  // `Array.isArray` rather than `?? []`: the field is new, so every program
  // document written before it exists has no such key at all, and Firestore
  // hands back an object that the cast to `Program` merely claims is complete.
  const chosen = Array.isArray(program.featuredMediaIds) ? program.featuredMediaIds : [];

  if (chosen.length > 0) {
    const byId = new Map(media.map((item) => [item.id, item]));
    return chosen
      .map((id) => byId.get(id))
      .filter((item): item is DocOf<GalleryMedia> => item !== undefined)
      .slice(0, max);
  }

  /*
   * Automatic mode requires a file, which curated mode does not.
   *
   * An approved item with no rendition is a real and ordinary state — the
   * transcode runs seconds after approval — and a gallery page rightly renders it
   * as "Processing…", because it is one photograph among twenty and saying so
   * beats a broken image. On a tile it is the only thing there, and a grey box
   * that says "Processing…" is not a picture of the ministry. So the automatic
   * set skips them and picks the next one along.
   */
  const ready = media.filter(hasRenderableFile);
  const showcase = ready.filter((item) => item.placement.homepage);
  const rest = ready.filter((item) => !item.placement.homepage && item.placement.onPage);
  /*
   * Spread through the set rather than its first few, so the tile is an
   * overview of the ministry and not its opening morning — see
   * `gallery/sample.ts`. Showcase pictures still come first in priority: they
   * fill the tile when there are enough of them, and the rest top it up.
   */
  const fromShowcase = spreadAcross(showcase, max);
  return [...fromShowcase, ...spreadAcross(rest, max - fromShowcase.length)];
}

/**
 * Something — anything — for a tile whose cycle came out empty.
 *
 * Not a "cover". It used to be one: `Program.coverMediaId` was a picture an
 * administrator chose in the panel, and this honoured it. That field is gone,
 * because the tile it was supposed to speak for stopped reading it the moment the
 * tile started cycling — `programTileMedia` takes `featuredMediaIds` in the order
 * they were chosen, and this was reached only when that returned nothing. So the
 * control offered a second answer to a question the featured set had already
 * answered, and the answer was discarded. A *level's* card is the one that honours
 * its pick, by opening on it; see `summariseChildren`.
 *
 * What is left is the fallback, which is worth keeping on its own terms: it can
 * find a picture where `programTileMedia` finds none, because it does not ask for
 * `placement.homepage` or `placement.onPage` — only for a photograph with a file.
 * A ministry whose photographs are all approved but none cleared for a page draws
 * one of them rather than a blank plate.
 *
 * The `hasRenderableFile` guard is the other half, and the one that bit: asking
 * for one approved document and using it showed the blank ground of a program with
 * no photographs — with a dozen behind it — whenever the earliest was
 * approved-but-not-yet-transcoded. There is no "Processing…" state on a tile.
 *
 * @param media a handful from the program, in `order`, not the whole archive.
 */
export function programFallbackShot(
  media: readonly DocOf<GalleryMedia>[],
): DocOf<GalleryMedia> | undefined {
  return media.find((item) => item.kind === 'photo' && hasRenderableFile(item));
}

/**
 * How many items the rail reads per program to fill an uncurated tile.
 *
 * More than one, because the first may be mid-transcode — but nowhere near the
 * archive, because this runs once per program on the section's front page.
 * Forty-eight, so the tile's handful is spread across a real stretch of the
 * ministry (`spreadAcross`) instead of being its first twelve — the reads are
 * small documents, and only the pictures the tile picks are ever downloaded.
 *
 * It used to need slack for a second reason as well: an administrator's chosen
 * cover was not necessarily the earliest, so the window had to be wide enough to
 * contain it. `Program.coverMediaId` is gone — see `programFallbackShot` — and a
 * ministry that *is* curated no longer uses this window at all; it gets the same
 * read its own page does, because a featured id can point anywhere under it.
 */
export const COVER_WINDOW = 48;
