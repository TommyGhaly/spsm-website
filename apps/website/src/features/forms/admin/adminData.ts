'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  isBuiltInForm,
  toFormSlug,
  type FormAnswers,
  type FormDefinition,
  type FormDraft,
  type SubmissionStatus,
} from '@spsm/shared';
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import type { WithId } from '../data';

/**
 * The writes only staff can make.
 *
 * A separate module from `../data.ts` so the public form page never imports it.
 * Everything here is refused by `firestore.rules` without the `staff` claim, and
 * the point of the split is bundle size rather than security: the builder is
 * behind a `lazy` and this is what it pulls in.
 */

/* ---------------------------------------------------------------------------
 * Form definitions
 * ------------------------------------------------------------------------ */

/**
 * Create or overwrite a form.
 *
 * The document id is the slug at creation and never changes afterwards.
 * `readFormBySlug` is built around that: an exact `get` first, falling back to a
 * query for the forms whose slug was edited later.
 */
export async function writeForm(id: string, draft: FormDraft): Promise<void> {
  const ref = doc(db(), COLLECTIONS.forms, id);

  /*
   * One extra read per save, to carry `createdAt` across.
   *
   * `setDoc` replaces rather than merges, so a field absent from the object is
   * a field deleted — which is exactly what makes removing a question work, and
   * exactly what would silently destroy the creation date on every edit. Firestore
   * has no "set this field only if absent" for a replacing write, so the honest
   * options are to read it back or to have the caller carry it. Reading it here
   * means no caller can forget, and a builder save is not a hot path.
   */
  const existing = await getDoc(ref);
  const createdAt = existing.exists() ? existing.data()?.['createdAt'] : undefined;

  await setDoc(ref, {
    ...draft,
    slug: toFormSlug(draft.slug) || id,
    createdAt: createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: auth().currentUser?.uid ?? null,
  });
}

/**
 * Delete a form definition. Its submissions are left alone.
 *
 * Deliberately: a registration somebody sent in is a record of something that
 * happened, and taking down the form it arrived through is not a reason to
 * destroy it. The submissions panel reads by `formId` and shows them under the
 * title stored on each one, so they remain legible after the form is gone.
 */
export async function deleteForm(id: string): Promise<void> {
  /*
   * The two forms the church always has cannot be deleted from here, and
   * `firestore.rules` refuses the delete as well.
   *
   * Two checks for one rule is not belt and braces for its own sake. This one
   * exists so the failure is a sentence in the drawer rather than a
   * `permission-denied` in the console — the list already withholds the button,
   * so anything that reaches here has come from a caller that did not know, and
   * telling it plainly is more useful than letting Firestore answer. The rule is
   * the one that actually holds.
   */
  if (isBuiltInForm(id)) {
    throw new Error(
      'The contact form and the vehicle registration are permanent — the church’s own ' +
        'links and the car park tags point at them. Close it to submissions instead.',
    );
  }
  await deleteDoc(doc(db(), COLLECTIONS.forms, id));
}

/**
 * Put the forms in this order, top to bottom.
 *
 * ---------------------------------------------------------------------------
 * Renumbers everything, rather than swapping two.
 *
 * A swap is the obvious implementation and it does nothing here. `blankForm`
 * creates every form with `order: 100`, so most of the collection shares one
 * value and the hub falls back to sorting those by title — exchanging the
 * numbers of two forms that both read 100 changes nothing on screen, and the
 * arrow looks broken.
 *
 * So a reorder assigns 10, 20, 30 … down the list the administrator is looking
 * at. Gaps of ten so a future "insert here" has somewhere to go, and only the
 * documents whose number actually changed are written — reordering the last two
 * of nine forms costs two writes, not nine.
 *
 * One `updateDoc` each rather than a `writeBatch`: the rule on `forms` is
 * evaluated per document either way, the counts are single digits, and a batch
 * would make a partial failure invisible. If one write is refused the rest still
 * land, the list refreshes from the server, and the arrow that did not take
 * simply looks like it did not take.
 * ---------------------------------------------------------------------------
 */
export async function setFormOrder(
  ids: string[],
  current: Map<string, number>,
): Promise<void> {
  const writes = ids
    .map((id, index) => ({ id, order: (index + 1) * 10 }))
    .filter((entry) => current.get(entry.id) !== entry.order)
    .map((entry) => setFormFlags(entry.id, { order: entry.order }));

  await Promise.all(writes);
}

/** Publish/unpublish and open/close, without a full rewrite of the document. */
export async function setFormFlags(
  id: string,
  flags: Partial<Pick<FormDefinition, 'published' | 'open' | 'order'>>,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.forms, id), {
    ...flags,
    updatedAt: serverTimestamp(),
    updatedBy: auth().currentUser?.uid ?? null,
  });
}

/* ---------------------------------------------------------------------------
 * Submissions
 * ------------------------------------------------------------------------ */

export interface SubmissionRow {
  id: string;
  formId: string;
  formTitle: string;
  answers: FormAnswers;
  submitterName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  status: SubmissionStatus;
  staffNote: string | null;
  totalCents: number;
  paymentId: string | null;
  submittedAt: Date | null;
}

/**
 * Recent submissions, newest first.
 *
 * Capped rather than paged. The parish's whole forms volume is a few hundred a
 * year, and a cap with a visible "showing the most recent N" is a smaller, more
 * honest thing than a pager nobody will reach the second page of. Revisit when
 * that stops being true.
 */
export async function readSubmissions(
  formId: string | null,
  cap = 200,
): Promise<SubmissionRow[]> {
  const base = collection(db(), COLLECTIONS.formSubmissions);
  /*
   * The composite index this needs — `formId` + `submittedAt desc` — is in
   * firestore.indexes.json. Without it the filtered query fails at runtime with
   * a console link and the unfiltered one keeps working, which is a confusing
   * pair of symptoms to debug from the panel.
   */
  const q = formId
    ? query(base, where('formId', '==', formId), orderBy('submittedAt', 'desc'), limit(cap))
    : query(base, orderBy('submittedAt', 'desc'), limit(cap));

  const snapshot = await getDocs(q);
  return snapshot.docs.map((entry) => {
    const data = entry.data() as Record<string, unknown>;
    const at = data['submittedAt'] as { toDate?: () => Date } | undefined;

    return {
      id: entry.id,
      formId: String(data['formId'] ?? ''),
      formTitle: String(data['formTitle'] ?? 'Form'),
      answers: (data['answers'] ?? {}) as FormAnswers,
      submitterName: (data['submitterName'] as string | null) ?? null,
      submitterEmail: (data['submitterEmail'] as string | null) ?? null,
      submitterPhone: (data['submitterPhone'] as string | null) ?? null,
      status: (data['status'] as SubmissionStatus) ?? 'new',
      staffNote: (data['staffNote'] as string | null) ?? null,
      totalCents: typeof data['totalCents'] === 'number' ? data['totalCents'] : 0,
      paymentId: (data['paymentId'] as string | null) ?? null,
      // A `serverTimestamp()` reads back null on the writer's own first
      // snapshot; here it is always a real value, but the guard costs nothing
      // and a crash in a staff panel over a missing date is not worth it.
      submittedAt: typeof at?.toDate === 'function' ? at.toDate() : null,
    };
  });
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  staffNote?: string,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.formSubmissions, id), {
    status,
    ...(staffNote === undefined ? {} : { staffNote }),
  });
}

export async function deleteSubmission(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.formSubmissions, id));
}

export type { WithId };
