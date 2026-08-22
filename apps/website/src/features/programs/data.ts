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
  buildGalleryTree,
  hasRenderableFile,
  resolveTrail,
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
  const media = await getSubtreeMedia(programId, subtreeIds(tree, node?.id ?? null));

  return { tree, trail: found, node, media };
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
  return [...showcase, ...rest].slice(0, max);
}

/**
 * The one picture that stands for a program, on its tile in the rail on /events.
 *
 * Two bugs' worth of care in three lines.
 *
 * `coverMediaId` is honoured, which it was not: the field has existed since the
 * schema was written, with a note saying that honouring it "lands with the admin
 * screen". The admin screen now exists — the ministry page has a *Choose the
 * tile picture* control that writes this field — so a reader that ignored it
 * would make that control do nothing at all, which is worse than not offering
 * it.
 *
 * And the automatic fallback needs a *file*, not merely an approved document.
 * The previous version asked for one item and used it, so a program whose
 * earliest-ordered photograph was approved-but-not-yet-transcoded showed the
 * blank ground of a program with no photographs — with a dozen behind it. There
 * is no "Processing…" state on a tile to fall back on.
 *
 * @param media a handful from the program, in `order`, not the whole archive.
 */
export function pickProgramCover(
  program: Pick<Program, 'coverMediaId'>,
  media: readonly DocOf<GalleryMedia>[],
): DocOf<GalleryMedia> | undefined {
  const chosen = program.coverMediaId
    ? media.find((item) => item.id === program.coverMediaId)
    : undefined;
  if (chosen && hasRenderableFile(chosen)) return chosen;
  return media.find((item) => item.kind === 'photo' && hasRenderableFile(item));
}

/**
 * How many items the rail reads per program to find a cover.
 *
 * More than one, because the first may be mid-transcode and because the
 * administrator's chosen cover is not necessarily the earliest — but nowhere
 * near the archive, because this runs once per program on the section's front
 * page. Twelve is enough to get past a batch that is still processing.
 */
export const COVER_WINDOW = 12;
