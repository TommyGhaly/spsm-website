import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS, type PrayerRequestInput } from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Submit a prayer request. Browser-side; requires a signed-in user.
 *
 * Not reachable yet — Email/Password sign-in is still disabled on the Firebase
 * project, so nobody can be signed in and `firestore.rules` requires it on
 * create. The submission form is therefore not built. This is the data layer it
 * will use, kept beside the feature so the shape of the write is settled and
 * reviewable now rather than invented under time pressure later.
 *
 * The one subtlety, and it is the whole privacy model: anonymity is enforced by
 * *omitting the uid*, not by a flag. The rules reject a create where
 * `anonymous: true` still carries an `authorUid`, so an anonymous request
 * genuinely cannot be traced back afterwards — including by us. The cost is
 * that the submitter cannot edit or withdraw it either, because there is
 * nothing left tying it to them. See docs/decisions.md #1.
 *
 * @param signedInUid  uid of the signed-in submitter. Required by the rules
 *                     even for an anonymous request: you must be a known member
 *                     to post, you just aren't recorded as the author.
 */
export async function submitPrayerRequest(
  input: PrayerRequestInput,
  signedInUid: string,
): Promise<string> {
  const doc = await addDoc(collection(db(), COLLECTIONS.prayerRequests), {
    body: input.body.trim(),
    visibility: input.visibility,
    anonymous: input.anonymous,

    // Both must be null when anonymous, or the rules reject the write. That is
    // the enforcement — this code merely agrees with it.
    authorUid: input.anonymous ? null : signedInUid,
    authorName: input.anonymous ? null : (input.authorName?.trim() || null),

    // Contact-back is opt-in and survives anonymity: someone can ask for
    // follow-up without their name being attached to the request itself.
    contactEmail: input.contactEmail?.trim() || null,

    status: 'active',
    notifiedAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: input.anonymous ? null : signedInUid,
  });

  return doc.id;
}
