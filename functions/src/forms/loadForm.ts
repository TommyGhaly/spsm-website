/**
 * Finding a form by the slug in a URL.
 *
 * ---------------------------------------------------------------------------
 * Two endpoints resolve a form from an untrusted slug — `formSubmit`, which
 * takes the answers, and `formUploadUrl`, which hands out a signed URL for a
 * photograph attached to one. They must agree, and not approximately: the
 * upload endpoint pins the object path to `form.slug`, and `formSubmit` later
 * refuses any answer whose path is not under that same slug. If one of them
 * resolved a form the other would not, a photograph could be uploaded and then
 * rejected by the submit step, and the person would be told their picture was
 * "misfiled" with no way to act on it.
 *
 * It lived in `submit.ts` until the second caller existed.
 * ---------------------------------------------------------------------------
 */
import { COLLECTIONS, parseFormDefinition, type FormDefinition } from '@spsm/shared';

/**
 * A form by slug: the exact document first, then a query.
 *
 * The id *is* the slug for everything the builder creates, so the `get` almost
 * always answers. The query catches the forms whose slug was edited after
 * creation, which keep their original id.
 */
export async function loadForm(
  db: FirebaseFirestore.Firestore,
  slug: string,
): Promise<{ id: string; form: FormDefinition } | null> {
  const direct = await db.collection(COLLECTIONS.forms).doc(slug).get();
  if (direct.exists) {
    const form = parseFormDefinition(direct.id, direct.data());
    if (form.slug === slug) return { id: direct.id, form };
  }

  const matches = await db
    .collection(COLLECTIONS.forms)
    .where('slug', '==', slug)
    .limit(1)
    .get();

  const first = matches.docs[0];
  return first ? { id: first.id, form: parseFormDefinition(first.id, first.data()) } : null;
}
