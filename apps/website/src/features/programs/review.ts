/**
 * The two member-scoped reads and writes the galleries' edit mode makes.
 *
 * This file used to be the approval queue's data layer, and most of it was:
 * `listPending`, `approve`, `reject` and `reviewUrl` served the screen at
 * `/admin/galleries`. That screen and the whole /admin section were deleted —
 * editing happens on the pages themselves now — and those four went with it.
 * `git show 678577a -- apps/website/src/features/programs/review.ts` has them,
 * including the reasoning about why a pending-items *list* can only be proved to
 * `firestore.rules` by an `admin` and has to be fanned out per program for
 * anyone below. That reasoning still holds and is worth reading before any
 * pending queue is built again, in place or otherwise.
 *
 * **Submissions still arrive `pending` and there is nothing left that approves
 * them.** `SubmitPhotos` writes them, `firestore.rules` keeps them unreadable,
 * and the queue that used to make the decision is gone — so anything a
 * parishioner sends now waits until an approval surface exists again.
 *
 * The name is kept because both survivors are about review even so: who may
 * review a program, and the caption a reviewer writes.
 */
import { doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, parseProgramAdmin, type ProgramAdmin } from '@spsm/shared';
import { db } from '@/lib/firebase';

/** The signed-in reviewer's own grants, read from their member document. */
export async function myProgramAdmin(uid: string): Promise<ProgramAdmin> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.members, uid));
  if (!snapshot.exists()) return { programs: [], events: [] };
  return parseProgramAdmin(snapshot.data()['programAdmin']);
}

/** Write a caption, which doubles as the alt text on the public page. */
export async function setCaption(mediaId: string, caption: string, uid: string): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    caption: caption.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
