/**
 * The approval queue's data layer.
 *
 * Everything a parishioner sends arrives `pending` and stays invisible until
 * somebody here says otherwise. This module is what that person's screen reads
 * and writes.
 *
 * ## The one hard part: listing pending items at all
 *
 * `firestore.rules` allows a read when the document is approved **or** the
 * reader administers its program. Firestore judges a *list* by what it could
 * return rather than what it does — so an unfiltered query for pending items is
 * allowed only if the second branch is true independently of any document, and
 * the only thing that satisfies that is `hasRole('admin')`.
 *
 * A program lead with a grant on Summercamp is therefore refused the whole
 * query, not given a filtered slice of it, and the refusal is a flat
 * `permission-denied` that looks exactly like a broken screen. So the strategy
 * is chosen from the reader:
 *
 *   admin        one query across every program
 *   program lead one query per program they hold, which the rule can prove
 *
 * This is the same shape as `listProgramLinkTargets` in features/events/admin.ts
 * and for the same underlying reason. It is written out twice rather than
 * abstracted because the two queries differ in what they are proving, and a
 * shared helper would hide precisely the thing that matters.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import {
  COLLECTIONS,
  buildGalleryTree,
  parseProgramAdmin,
  trailLabel,
  type DocOf,
  type GalleryMedia,
  type ProgramAdmin,
  type ProgramEvent,
  type SpsmClaims,
} from '@spsm/shared';
import { db, storage } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';

/**
 * How many pending items to fetch at once.
 *
 * A cap rather than pagination, deliberately. The realistic worst case is one
 * camp uploading a few hundred photographs in an evening, and a queue that
 * shows the oldest hundred and says so is more useful than one that pages
 * through them — the work is "clear the queue", which is done from the top.
 */
const QUEUE_LIMIT = 100;

/** A pending item with the names a reviewer needs to place it. */
export interface ReviewItem {
  media: DocOf<GalleryMedia>;
  /** Title of the occurrence it was sent to. Falls back to the id. */
  eventTitle: string;
}

/** The signed-in reviewer's own grants, read from their member document. */
export async function myProgramAdmin(uid: string): Promise<ProgramAdmin> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.members, uid));
  if (!snapshot.exists()) return { programs: [], events: [] };
  return parseProgramAdmin(snapshot.data()['programAdmin']);
}

/**
 * Everything awaiting a decision, oldest first.
 *
 * Oldest first because a queue worked newest-first strands the earliest
 * submissions forever — the parishioner who sent photographs the night the camp
 * ended is the one most likely to look for them.
 */
export async function listPending(
  claims: SpsmClaims,
  grants: ProgramAdmin,
): Promise<ReviewItem[]> {
  const media =
    claims.role === 'admin'
      ? await pendingEverywhere()
      : await pendingForGrants(grants);

  return withEventTitles(media);
}

/** The admin's query. Needs the `[status, submittedAt]` composite index. */
async function pendingEverywhere(): Promise<DocOf<GalleryMedia>[]> {
  const snapshot = await getDocs(
    query(
      collection(db(), COLLECTIONS.galleryMedia),
      where('status', '==', 'pending'),
      orderBy('submittedAt'),
      limit(QUEUE_LIMIT),
    ),
  );
  return snapshot.docs.map(docOf<GalleryMedia>);
}

/**
 * One query per program held, merged.
 *
 * Event-level grants are deliberately not queried here. `programEventId` is on
 * the document and there is an index for it, but a volunteer holding a single
 * week is not who the queue is for — and issuing a query per granted event
 * turns a screen into an unbounded fan-out. They see their week's items through
 * the program query when they also hold the program, and otherwise the queue is
 * empty for them, which is honest.
 */
async function pendingForGrants(grants: ProgramAdmin): Promise<DocOf<GalleryMedia>[]> {
  if (grants.programs.length === 0) return [];

  const perProgram = await Promise.all(
    grants.programs.map(async (programId) => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.galleryMedia),
          where('programId', '==', programId),
          where('status', '==', 'pending'),
          orderBy('submittedAt'),
          limit(QUEUE_LIMIT),
        ),
      );
      return snapshot.docs.map(docOf<GalleryMedia>);
    }),
  );

  return perProgram
    .flat()
    .sort((a, b) => millis(a.submittedAt) - millis(b.submittedAt))
    .slice(0, QUEUE_LIMIT);
}

/** Firestore hands back several timestamp shapes; only the ordering matters. */
function millis(value: GalleryMedia['submittedAt']): number {
  if (value && typeof value === 'object' && 'seconds' in value) {
    return (value as { seconds: number }).seconds * 1000;
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate(): Date }).toDate().getTime();
  }
  return 0;
}

/**
 * Say where each item was sent from — by its whole trail, not its own name.
 *
 * "Day 1" on its own is useless to a reviewer now that the galleries are a tree:
 * four camps each have a Day 1, and the one thing this label exists to answer is
 * *which*. "Summercamp 2026 · Week 1 · Day 1" answers it.
 *
 * One query per program rather than an `in` over the level ids, and the change
 * of shape is what the trail costs. An `in` returns the levels the photographs
 * name and nothing above them, so there is no ancestry to walk — and chasing
 * parents would be a query per generation. A queue spans very few programs (a
 * program lead's spans exactly one), so a query each is cheap and gives the
 * whole tree to walk in memory.
 *
 * The read is the administrator's, unfiltered by `published`: a queue is nearly
 * always photographs sent to a level that is still a draft, and labelling those
 * with a bare id would defeat the point.
 */
async function withEventTitles(media: DocOf<GalleryMedia>[]): Promise<ReviewItem[]> {
  const programIds = [...new Set(media.map((item) => item.programId))];
  const labels = new Map<string, string>();

  for (const programId of programIds) {
    try {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.programEvents), where('programId', '==', programId)),
      );
      const tree = buildGalleryTree(snapshot.docs.map(docOf<ProgramEvent>));
      for (const id of tree.byId.keys()) labels.set(id, trailLabel(tree, id));
    } catch (error) {
      // A label is a nicety. Losing it must not empty the queue.
      console.warn('[galleries] could not read level names:', error);
    }
  }

  return media.map((item) => ({
    media: item,
    eventTitle: labels.get(item.programEventId) ?? item.programEventId,
  }));
}

/**
 * A URL the reviewer's browser can actually display.
 *
 * `getDownloadURL` rather than the unauthenticated `?alt=media` form the public
 * gallery uses, and that is forced by where the file is: `submissions/` is the
 * one prefix on the bucket whose reads are gated, so an anonymous media URL
 * 403s there by design. This call carries the caller's credentials and works
 * for staff.
 *
 * Prefers the transcode Function's preview over the original, because the
 * original is very often HEIC — which no browser can decode, so a reviewer
 * would be looking at a broken image icon and approving on faith. Falls back to
 * the original for a video, and for a photograph whose transcode failed.
 */
export async function reviewUrl(media: GalleryMedia): Promise<string | null> {
  const path = media.previewPath ?? media.sourcePath;
  try {
    return await getDownloadURL(ref(storage(), path));
  } catch (error) {
    console.warn(`[galleries] no preview available at ${path}:`, error);
    return null;
  }
}

/**
 * Publish an item.
 *
 * Writes only the decision. Copying the bytes into the public bucket is
 * `onGalleryMediaReviewed`'s job, and deliberately not this one: a client that
 * could write `renditionPath` could point an approved document at any object in
 * the bucket, which is the approval gate removed by a different door.
 *
 * `onPage` defaults to true and `homepage` to false: the common case stated as a
 * default rather than checkboxes nobody reads. An approved photograph belongs in
 * its own gallery; the homepage band is a smaller, editorial choice made
 * deliberately.
 *
 * `slideshow` is still written true, and it is now inert. Nothing filters on it —
 * approving a photograph is what puts it in the presentation — but it is a
 * required field on documents this collection already holds thousands of, so it
 * is written consistently rather than left absent on the new ones. See
 * `subtreeSlideshow`.
 */
export async function approve(mediaId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    status: 'approved',
    placement: { onPage: true, slideshow: true, homepage: false },
    reviewedAt: serverTimestamp(),
    reviewedBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Refuse an item.
 *
 * Kept as a document rather than deleted, per the schema's note — the same file
 * resubmitted later is then recognisable rather than arriving as something new.
 * `onGalleryMediaReviewed` deletes the rendition and the preview; the original
 * stays until the lifecycle rule sweeps it, so a reversal is still possible.
 */
export async function reject(mediaId: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    status: 'rejected',
    placement: { onPage: false, slideshow: false, homepage: false },
    reviewedAt: serverTimestamp(),
    reviewedBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** Write a caption, which doubles as the alt text on the public page. */
export async function setCaption(mediaId: string, caption: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    caption: caption.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
