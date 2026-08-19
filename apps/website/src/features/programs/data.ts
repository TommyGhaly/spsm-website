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
  type DocOf,
  type GalleryMedia,
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
 * The occurrences of one program, newest first.
 *
 * Undated events sort to the end rather than the start. An event with no date
 * is one somebody has not finished filling in, and the top of the page belongs
 * to the most recent camp, not to a draft.
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
 * One occurrence, by program and slug.
 *
 * Unlike a program, the id here is generated — two programs may both have a
 * `week-1-2027` — so this is a query, and `programId` is part of it rather than
 * a check afterwards. Filtering after the fetch would let `/events/st-simon/
 * week-1-2027` render Summercamp's gallery under the seniors' URL.
 */
export async function getProgramEvent(
  programId: string,
  slug: string,
): Promise<DocOf<ProgramEvent> | null> {
  return readOrEmpty(
    `event ${programId}/${slug}`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.programEvents),
          where('programId', '==', programId),
          where('published', '==', true),
          where('slug', '==', slug),
          limit(1),
        ),
      );
      const [first] = snapshot.docs;
      return first ? docOf<ProgramEvent>(first) : null;
    },
    null,
  );
}

/** Every approved item in one gallery, in the order an administrator set. */
export async function getGalleryMedia(programEventId: string): Promise<DocOf<GalleryMedia>[]> {
  return readOrEmpty(
    `media for ${programEventId}`,
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.galleryMedia),
          where('programEventId', '==', programEventId),
          APPROVED,
          orderBy('order', 'asc'),
        ),
      );
      return snapshot.docs.map(docOf<GalleryMedia>);
    },
    [],
  );
}

/**
 * Everything approved across a whole program — what "present all of Summercamp"
 * reads.
 *
 * Capped, because a program with ten years of camps behind it is thousands of
 * photographs and a kiosk does not need them all in memory to start showing the
 * first one.
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
