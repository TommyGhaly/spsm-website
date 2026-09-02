/**
 * Sending a photograph to a program gallery, with no account.
 *
 * This is the only write path on the site a stranger can reach that stores a
 * file, so the shape of what it writes is not a detail — it is the thing
 * `firestore.rules` checks field by field before allowing the document. Every
 * literal below (`'pending'`, the three false placements, the empty caption)
 * is there because the rule requires exactly that value. Changing one here
 * without changing it there produces `permission-denied` on a form that looks
 * correct, which is a bad afternoon; the rule is the authority and this file
 * follows it.
 *
 * ## Order of operations
 *
 * The file goes to Cloud Storage **first**, then the Firestore document. Not
 * the other way round, and not in parallel:
 *
 *  - document first would fire `onGalleryMediaCreated` against a `sourcePath`
 *    with nothing behind it, and the transcode would fail on every submission
 *    in a race it loses most of the time
 *  - file first can leave an orphaned object if the document write then fails.
 *    That costs nothing and is swept by the 120-day lifecycle rule in
 *    docs/gallery-console-setup.md §2. An unbacked document is the worse of the
 *    two failures, so this takes the cheaper one.
 */
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import {
  COLLECTIONS,
  DEFAULT_FOCAL,
  type MediaKind,
  type Program,
} from '@spsm/shared';
import { db, storage } from '@/lib/firebase';

/**
 * The ceiling `storage.rules` puts on `submissions/`, repeated for the message.
 *
 * The one bound that still exists on this site, along with the twin on
 * `formUploads/`, and for the same reason: both are paths an *unauthenticated*
 * caller can write to. The staff image paths lost their 8MB ceiling on
 * 2026-09-01 because refusing a trusted volunteer's phone photograph protected
 * nothing; a stranger writing to a billed bucket is a different question.
 *
 * 250MB rather than something tighter because this is a photograph straight off
 * a phone rather than one an administrator chose and exported. A modern phone
 * photograph is routinely 12MB and a short 4K clip is very much larger.
 *
 * Checked here as well as there so somebody who picks a 400MB video is told
 * before they wait for the upload, rather than after it with
 * `storage/unauthorized` — which reads as "you are not allowed" and not as
 * "that one is too big".
 */
export const SUBMISSION_MAX_BYTES = 250 * 1024 * 1024;

/** What one file is doing, for the list the submitter watches. */
export type SubmissionState =
  | { kind: 'waiting' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string };

/**
 * A photograph and a clip are different documents downstream, and the browser
 * already knows which is which.
 *
 * Anything that is neither is refused before it is uploaded. `storage.rules`
 * refuses it too — this is not the enforcement — but a rejection that names the
 * problem is worth the four lines.
 */
function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/**
 * A name no other submission will take.
 *
 * `storage.rules` allows `create` only when `resource == null` — a submitter
 * may not overwrite a file, so that an upload cannot be swapped after an
 * administrator has reviewed it. The consequence is that a colliding name is a
 * hard failure, and two people sending `IMG_0042.HEIC` from the same camp is
 * not a coincidence to guard against but the ordinary case.
 *
 * `randomUUID` rather than a timestamp for that reason: two phones uploading in
 * the same millisecond is rare, and "rare" is the wrong standard when the
 * failure is a parishioner being told their photograph was rejected.
 *
 * The original filename is deliberately **not** carried across. It is
 * uncontrolled input on a path, it is frequently somebody's name, and nothing
 * downstream reads it — the extension is all that is needed, and only so the
 * object is recognisable in the console.
 */
function submissionPath(programEventId: string, file: File): string {
  const dot = file.name.lastIndexOf('.');
  const raw = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  const extension = raw.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `submissions/${programEventId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Send one file.
 *
 * `programId` is passed in rather than looked up per file: the rule compares it
 * against the occurrence's own `programId`, so a wrong value is a refusal, and
 * reading it once for a batch of forty photographs rather than forty times is
 * the difference between one document read and forty.
 *
 * `event` is now **the level the submitter chose**, which need not be the level
 * whose page they are standing on. Nothing here changes for that — the rule
 * already accepted any level in the program, because it checks the `programId`
 * against the target's own rather than against the page — but it is worth saying
 * out loud, because the level in a submission is now a stranger's opinion about
 * where a photograph belongs rather than a fact about where the form was. The
 * queue is what turns it into a fact.
 */
export async function submitOne(
  file: File,
  event: { id: string; programId: string },
): Promise<void> {
  const kind = kindOf(file);
  if (!kind) {
    throw new Error('That file is not a photograph or a video.');
  }
  if (file.size > SUBMISSION_MAX_BYTES) {
    throw new Error(
      `That file is ${(file.size / 1024 / 1024).toFixed(0)}MB. The limit is 250MB.`,
    );
  }

  const sourcePath = submissionPath(event.id, file);
  await uploadBytes(ref(storage(), sourcePath), file, { contentType: file.type });

  await addDoc(collection(db(), COLLECTIONS.galleryMedia), {
    programId: event.programId,
    programEventId: event.id,
    // Legacy, and null forever: the third level is a `programEvents` document of
    // its own now, so "which subgroup" is answered by `programEventId` above.
    groupId: null,

    kind,
    // The only status a public create may carry. See firestore.rules.
    status: 'pending',

    sourcePath,
    // All three written by the transcode Function, never by a client.
    renditionPath: null,
    previewPath: null,
    posterPath: null,

    // Measured from the transcode output rather than guessed here: a browser
    // can read an image's dimensions, but not after EXIF rotation, and a
    // sideways aspect ratio would give the layout packer the wrong shape.
    width: null,
    height: null,
    durationSeconds: null,

    // Both required to be exactly this by the rule. A submitter writes no
    // caption and chooses no placement — approving is what puts a photograph
    // anywhere, and letting the form set either would be publishing past the
    // queue.
    caption: '',
    focal: DEFAULT_FOCAL,
    placement: { onPage: false, slideshow: false, homepage: false },
    layout: null,
    order: 0,

    submittedAt: serverTimestamp(),
    reviewedAt: null,
    reviewedBy: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    // Null rather than absent: this is the anonymous write path, and
    // `AuditFields` says null means exactly that.
    updatedBy: null,
  });
}

/**
 * Whether this ministry is still collecting, read fresh at submit time.
 *
 * The page's copy of the program may be minutes old, and `submissionsOpen` is
 * the flag a program lead turns off when the parish has finished collecting. The
 * rule checks it against the live document, so a stale `true` here means the
 * upload succeeds and the document write then fails — the file is stored, the
 * submission is lost, and the message says "permission denied". Re-reading first
 * turns that into a sentence, at the cost of one document read per batch.
 *
 * The **program**, not the level. It was the level, and it moved up with the
 * flag; see `Program.submissionsOpen` for why. The practical effect here is that
 * one read covers a batch however many levels the submitter files it across.
 *
 * Absent means open, matching `firestore.rules` exactly. A default that
 * disagreed with the rule would be the worse of the two failures in either
 * direction: `false` here hides a form the rules would have accepted, and
 * `false` there refuses a form this one offered.
 */
export async function programAcceptsSubmissions(programId: string): Promise<boolean> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.programs, programId));
  if (!snapshot.exists()) return false;
  return (snapshot.data() as Program).submissionsOpen !== false;
}
