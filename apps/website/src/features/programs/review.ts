/**
 * The approval queue's data layer, and the two member-scoped reads beside it.
 *
 * Everything a parishioner sends arrives `pending` and is visible nowhere on the
 * site until somebody here says otherwise. `SubmitPhotos` writes it,
 * `firestore.rules` keeps it unreadable, `storage.rules` keeps the file in a
 * quarantine prefix — and none of those is a decision. This is where the
 * decision happens, which makes it the load-bearing piece of the whole
 * anonymous-upload model.
 *
 * ## Once deleted, and rebuilt narrower
 *
 * Most of this file existed before, served `/admin/galleries`, and went when the
 * whole /admin section did. `git show 678577a -- apps/website/src/features/programs/review.ts`
 * is the original. What comes back is deliberately less: the queue lives on a
 * **ministry's own page** now, so every query here filters `programId`, and the
 * two-strategy fan-out the old one needed is gone.
 *
 * That is not a simplification for its own sake — it is the fix for the hard
 * part. `firestore.rules` allows a read when the document is approved **or** the
 * reader administers its program, and Firestore judges a *list* by what it could
 * return rather than what it does. An unfiltered pending query is therefore
 * provable only by `isSuper()`, and a program lead with a grant on
 * Summercamp was refused the entire query — a flat `permission-denied` that
 * looks exactly like a broken screen. `where('programId','==',…)` is what the
 * rule can prove for both of them, so scoping the queue to a ministry makes one
 * query serve the superadmin and the volunteer alike.
 *
 * The thing that is lost with it: nobody sees a queue across every ministry at
 * once. Somebody who runs three programs visits three pages. That was the
 * trade Tommy chose.
 *
 * ## One prefix nobody else can read
 *
 * Every other image on this site is an unauthenticated `?alt=media` URL built by
 * hand — see gallery/urls.ts. That does not work for a pending item, because
 * `submissions/` is the one prefix on the bucket whose reads are gated, so an
 * anonymous URL 403s there by design. `reviewUrl` uses `getDownloadURL`, which
 * carries credentials.
 *
 * **This used to be the worst gap on the screen and is now closed.**
 * `storage.rules` gated those reads on `hasRole('staff')`, which is not a
 * program grant — so a volunteer holding `programAdmin` over Summercamp could
 * list the queue, could approve from it, and saw "no preview" on every row.
 * Approving from a filename is a decision made blind.
 *
 * The rule is `signedIn()` now, because `storage.rules` cannot read Firestore
 * and therefore cannot ask the question the queue is actually gated on: the path
 * is keyed by `programEventId`, and mapping that to a program takes a lookup
 * this file has no way to make. The property that mattered is unchanged — a
 * submitter is anonymous and still cannot fetch back the file they sent — and
 * *which* submissions somebody may act on is still the program grant, enforced
 * on the `galleryMedia` document. See the long note on that prefix in
 * storage.rules.
 */
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import {
  COLLECTIONS,
  parseProgramAdmin,
  type DocOf,
  type GalleryMedia,
  type ProgramAdmin,
  type ProgramEvent,
} from '@spsm/shared';
import { db, storage } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';

/**
 * How many pending items to fetch at once.
 *
 * A cap rather than pagination, deliberately. The realistic worst case is one
 * camp uploading a few hundred photographs in an evening, and a queue that shows
 * the oldest hundred and says so is more useful than one that pages through
 * them — the work is "clear the queue", which is done from the top.
 */
const QUEUE_LIMIT = 100;

/** A pending item with the name of the level its sender chose for it. */
export interface ReviewItem {
  media: DocOf<GalleryMedia>;
  /** Title of the level it was sent to. Falls back to the id. */
  eventTitle: string;
}

/** The signed-in reviewer's own grants, read from their member document. */
export async function myProgramAdmin(uid: string): Promise<ProgramAdmin> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.members, uid));
  if (!snapshot.exists()) return { programs: [], events: [] };
  return parseProgramAdmin(snapshot.data()['programAdmin']);
}

/**
 * The queue's query. One definition, because the constraints are not a detail.
 *
 * `programId ==` and `status ==` are what make this readable by a program lead
 * rather than only by a superadmin — see the note at the top of this file — and
 * an ordering or a filter that drifted between a read and a listen would be a
 * queue that works until somebody watches it.
 *
 * Oldest first because a queue worked newest-first strands the earliest
 * submissions forever — and the parishioner who sent photographs the night the
 * camp ended is the one most likely to come looking for them.
 *
 * Needs the `[programId, status, submittedAt]` composite index, which is in
 * firestore.indexes.json. A missing index here is not a failed build somebody
 * sees; it is a queue that spins forever on a live page.
 */
function pendingQuery(programId: string) {
  return query(
    collection(db(), COLLECTIONS.galleryMedia),
    where('programId', '==', programId),
    where('status', '==', 'pending'),
    orderBy('submittedAt'),
    limit(QUEUE_LIMIT),
  );
}

/**
 * The same queue, watched.
 *
 * A listener rather than a read because two people work this screen at once
 * during a camp: somebody is uploading an evening's photographs on a phone while
 * somebody else clears the queue on a laptop, and a queue that only tells the
 * truth when reloaded makes the second person work from a list that is wrong in
 * both directions — rows that are already decided, and rows they cannot see.
 *
 * Returns its own unsubscribe. **Call it.** A Firestore listener left running
 * bills for what it delivers, and this one is mounted on a public page.
 *
 * ## The titles arrive after the rows do
 *
 * `withEventTitles` is a second round trip, so each snapshot resolves
 * asynchronously and two snapshots in flight can finish out of order — which
 * would show a queue that flickers backwards. The generation counter is what
 * stops that: a resolution older than the newest snapshot is dropped, not
 * merged. A `Map` keyed by id would not do instead, because the thing being
 * raced is the whole list, including which rows are in it.
 */
export function watchPendingForProgram(
  programId: string,
  onItems: (items: ReviewItem[]) => void,
  onError: (error: unknown) => void,
): () => void {
  let generation = 0;
  let live = true;

  const stop = onSnapshot(
    pendingQuery(programId),
    (snapshot) => {
      const mine = ++generation;
      void withEventTitles(snapshot.docs.map(docOf<GalleryMedia>))
        .then((items) => {
          if (live && mine === generation) onItems(items);
        })
        .catch(onError);
    },
    onError,
  );

  return () => {
    live = false;
    stop();
  };
}

/**
 * Attach the level's title to each item.
 *
 * One `in` query per ten ids rather than one read per item: a queue of a hundred
 * photographs across three days of a camp is one read this way and a hundred the
 * obvious way. Ten is Firestore's ceiling on `in`.
 */
async function withEventTitles(media: DocOf<GalleryMedia>[]): Promise<ReviewItem[]> {
  const ids = [...new Set(media.map((item) => item.programEventId))];
  const titles = new Map<string, string>();

  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    try {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.programEvents), where(documentId(), 'in', batch)),
      );
      for (const document of snapshot.docs) {
        titles.set(document.id, (document.data() as ProgramEvent).title);
      }
    } catch (error) {
      // A title is a nicety. Losing it must not empty the queue.
      console.warn('[galleries] could not read level titles:', error);
    }
  }

  return media.map((item) => ({
    media: item,
    eventTitle: titles.get(item.programEventId) ?? item.programEventId,
  }));
}

/**
 * A URL the reviewer's browser can actually display.
 *
 * Prefers the transcode Function's preview over the original, because the
 * original is very often HEIC — which no browser can decode, so a reviewer would
 * be looking at a broken image icon and approving on faith. Falls back to the
 * original for a video, and for a photograph whose transcode failed.
 *
 * Returns null rather than throwing on a refusal, which is the ordinary outcome
 * for a reviewer whose role is below `staff` — see the note at the top of this
 * file. The row renders "no preview" and stays usable.
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
 * Publish an item, filing it wherever the reviewer says it belongs.
 *
 * Writes only the decision and the filing. Copying the bytes into the public
 * bucket is `onGalleryMediaReviewed`'s job and deliberately not this one: a
 * client that could write `renditionPath` could point an approved document at
 * any object in the bucket, which is the approval gate removed by a different
 * door.
 *
 * ## Re-filing in the same write
 *
 * `programEventId` goes out beside `status` rather than in a write before it,
 * and that ordering is load-bearing twice over.
 *
 * `firestore.rules` checks an update against `resource.data` — the document as
 * it stands *before* the write — so the grant that matters is the one over the
 * level the photograph is on now. One write is therefore one permission check
 * against a known level. Two writes would check the second against the
 * destination, and for an event-scoped volunteer that is a different answer:
 * they can move a photograph out of their week and not back in. See the note on
 * `allow update` in firestore.rules.
 *
 * It also means the Function fires once, on a document that already says where
 * it lives, so the rendition is copied to `galleries/{destination}/…` rather
 * than to the level the submitter guessed. Approving first and re-filing after
 * would leave every re-filed photograph's bytes under the wrong prefix — which
 * renders correctly, because the path is stored, and is quietly wrong for as
 * long as the parish keeps the file.
 *
 * `onPage` and `slideshow` default to true and `homepage` to false: an approved
 * photograph belongs in its own gallery and on the hall screen, and the homepage
 * band is a smaller editorial choice made deliberately. Stated as a default
 * rather than three checkboxes nobody reads.
 *
 * @param programEventId Where to file it. Pass the item's existing level to
 *   accept the submitter's choice.
 */
export async function approveInto(
  mediaId: string,
  programEventId: string,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    programEventId,
    status: 'approved',
    placement: { onPage: true, slideshow: true, homepage: false },
    reviewedAt: serverTimestamp(),
    reviewedBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Approve a whole selection at once, each into wherever its own row says.
 *
 * One `writeBatch` rather than a loop of `approveInto`, which matters at the
 * size this is for: clearing forty photographs one at a time is forty round
 * trips, and on parish wifi that is most of a minute with the screen half
 * decided.
 *
 * ## All or nothing, deliberately
 *
 * A batch that any rule refuses fails whole, and nothing is written. That is the
 * behaviour worth having here: the realistic refusal is "this person does not
 * administer this ministry", which is true of every row at once, and a partial
 * success would leave somebody looking at a queue where some of what they ticked
 * went and some did not, with nothing on screen saying which.
 *
 * Chunked at 400 because Firestore's limit is 500 writes per batch and
 * `QUEUE_LIMIT` is 100 — so today this is always one batch, and the chunking is
 * there so that raising the queue's cap does not quietly break approving.
 *
 * @param filings The id of each item and the level to file it under. The caller
 *   holds those destinations in memory until this moment; see the note on
 *   `approveInto` for why the filing and the decision go out together.
 */
export async function approveMany(
  filings: readonly { mediaId: string; programEventId: string }[],
  uid: string,
): Promise<void> {
  for (let i = 0; i < filings.length; i += APPROVE_BATCH_SIZE) {
    const batch = writeBatch(db());
    for (const { mediaId, programEventId } of filings.slice(i, i + APPROVE_BATCH_SIZE)) {
      batch.update(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
        programEventId,
        status: 'approved',
        placement: { onPage: true, slideshow: true, homepage: false },
        reviewedAt: serverTimestamp(),
        reviewedBy: uid,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
    }
    await batch.commit();
  }
}

/** Firestore's ceiling is 500 writes to a batch. Left short of it on purpose. */
const APPROVE_BATCH_SIZE = 400;

/**
 * Refuse a whole selection, permanently.
 *
 * Every one of these is the same irreversible act as refusing a single row, and
 * the caller is responsible for having asked first.
 *
 * ## It is a batch now, and it could not be before
 *
 * This used to run four at a time through a hand-written worker pool, with a
 * note explaining that refusing "cannot be batched the way approving is, because
 * each one deletes files from Cloud Storage before its document, and a
 * `writeBatch` cannot carry a bucket call". That was true of the old
 * `deleteMediaForever` and is not true of this one: refusing is a single
 * document delete, the files are `onGalleryMediaDeleted`'s job, and forty
 * document deletes is exactly what a batch is for. A camp's worth of refusals is
 * now one round trip instead of forty at a width of four.
 *
 * Unlike `approveMany` a partial failure is still possible across chunks — there
 * is no transaction spanning two batches — and that stays the honest outcome:
 * whatever is still in the queue was not touched, and the queue is what shows
 * which they were.
 */
export async function refuseMany(items: readonly DocOf<GalleryMedia>[]): Promise<void> {
  for (let from = 0; from < items.length; from += APPROVE_BATCH_SIZE) {
    const batch = writeBatch(db());
    for (const item of items.slice(from, from + APPROVE_BATCH_SIZE)) {
      batch.delete(doc(db(), COLLECTIONS.galleryMedia, item.id));
    }
    await batch.commit();
  }
}

/**
 * Delete a photograph and everything it is made of.
 *
 * ## Why this deletes rather than marking
 *
 * The old `reject` set `status: 'rejected'` and left the document, so a
 * resubmission was recognisable and a reversal was possible. Tommy chose the
 * other way — refusing is refusing, and a queue that accumulates a record of
 * every photograph the parish turned down is a list of judgements about
 * parishioners' families that nobody asked to keep.
 *
 * ## One write, and the files follow
 *
 * ---------------------------------------------------------------------------
 * This function used to delete the three Storage objects itself, before the
 * document, and it carried a long note explaining the ordering, a six-second
 * budget to stop a slow bucket freezing the button, and a tolerance for
 * failures. All of that is gone, because underneath it the function did not
 * work.
 *
 * **`galleries/` is `allow write: if false` for every client.** The rendition —
 * the copy in the world-readable prefix, the only one a stranger can actually
 * fetch — was therefore refused every time, logged, and passed over. Deleting an
 * approved photograph took it off the site and left it on the internet at the
 * URL it had been shared under, with no lifecycle rule to catch it: only
 * `submissions/` has one. Tommy: *"when i delete a photo it no longer shows on
 * the app but it stays in the storage it should delete it even if its the only
 * image."*
 *
 * The refusal is right and stays. A client that could write `galleries/` could
 * publish anything into the parish's public bucket with nobody approving it,
 * which is the whole moderation model. What was missing was something on the
 * other side of that wall, and it exists now: `onGalleryMediaDeleted` fires on
 * this delete, reads the paths out of the deleted document, and removes every
 * one of them with the Admin SDK.
 *
 * So the browser does the one thing it is allowed to do, and it is also the
 * thing that matters to the person clicking: the document is what the site
 * reads, so the photograph is gone the moment this returns. The bytes follow a
 * second later, and if the bucket is briefly unreachable the platform retries
 * the trigger — which a browser that has since been closed cannot.
 * ---------------------------------------------------------------------------
 */
export async function deleteMediaForever(media: DocOf<GalleryMedia>): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.galleryMedia, media.id));
}

/** Write a caption, which doubles as the alt text on the public page. */
export async function setCaption(mediaId: string, caption: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    caption: caption.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Refusing a submission *is* deleting it permanently, and always was.
 *
 * Kept as its own name because the two callers mean different things by the same
 * act. The queue refuses a photograph nobody has approved; the picture manager on
 * a ministry's own page deletes one that has been on the website for a year. One
 * implementation is the point, but a manager calling `refuseAndDelete` would read
 * as though it were rejecting a submission.
 *
 * The second caller is why the file deletion had to move to a Function. A pending
 * submission's bytes are all under `submissions/`, which a signed-in reviewer may
 * delete — so refusing from the queue *appeared* to work. The picture manager's
 * photograph has a `renditionPath` under `galleries/`, which no client may touch
 * at all, and that one silently left the file on the internet. Same code, same
 * bug, visible in only one of the two places.
 */
export const refuseAndDelete = deleteMediaForever;
