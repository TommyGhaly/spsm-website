import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS, type PrayerRequestInput } from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Submit a prayer request. Browser-side, and deliberately open to anyone.
 *
 * This used to require a signed-in uid, from a time when sign-in was expected
 * to be for everyone. It is not: authentication is Microsoft-only against the
 * parish Entra tenant, so clergy, staff and servants have accounts and a
 * parishioner does not. Requiring one would have meant the only people able to
 * ask for prayer were the people you would ask in person anyway.
 *
 * So this follows `features/parking`: an unauthenticated write straight from
 * the browser, with `firestore.rules` validating every field rather than
 * trusting the form.
 *
 * The one subtlety, and it is the whole privacy model: anonymity is enforced by
 * *omitting* identity, not by a flag. The rules reject a create where
 * `anonymous: true` carries either an `authorUid` or an `authorName`, so an
 * anonymous request genuinely cannot be traced back afterwards — including by
 * us. The cost is that the submitter cannot edit or withdraw it either, because
 * nothing ties it to them. See docs/decisions.md #1.
 *
 * @param signedInUid  uid when a servant or staff member happens to be signed
 *                     in, otherwise null. The rules only ever permit your own
 *                     uid, so this cannot be used to write on someone's behalf.
 */
export async function submitPrayerRequest(
  input: PrayerRequestInput,
  signedInUid: string | null = null,
): Promise<string> {
  const name = input.authorName?.trim() || null;

  const doc = await addDoc(collection(db(), COLLECTIONS.prayerRequests), {
    body: input.body.trim(),
    visibility: input.visibility,
    anonymous: input.anonymous,

    // Both null when anonymous, or the rules reject the write. That is the
    // enforcement; this code merely agrees with it.
    authorUid: input.anonymous ? null : signedInUid,
    authorName: input.anonymous ? null : name,

    // Opt-in, and it survives anonymity: someone can ask for follow-up without
    // their name being attached to the request itself.
    contactEmail: input.contactEmail?.trim() || null,

    status: 'active',
    notifiedAt: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: input.anonymous ? null : signedInUid,
  });

  return doc.id;
}
