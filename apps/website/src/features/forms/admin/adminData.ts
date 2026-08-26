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
  toFormSlug,
  type FormAnswers,
  type FormDefinition,
  type FormDraft,
  type FormField,
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
  await deleteDoc(doc(db(), COLLECTIONS.forms, id));
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

/* ---------------------------------------------------------------------------
 * Breeze import
 * ------------------------------------------------------------------------ */

export interface BreezeForm {
  id: string;
  name: string;
  url: string;
  archived: boolean;
}

/**
 * The parish's Breeze forms, through the Function that holds the API key.
 *
 * Never called directly from the browser and never could be. A Breeze API key is
 * a bearer credential that reads the whole member database — addresses, giving
 * records — so it lives in the Functions runtime and this asks a Function that
 * returns only the forms.
 */
export async function listBreezeForms(): Promise<
  { ok: true; forms: BreezeForm[] } | { ok: false; reason: string }
> {
  const idToken = await auth().currentUser?.getIdToken();
  if (!idToken) return { ok: false, reason: 'You are not signed in.' };

  const response = await fetch('/api/forms/breeze-list', {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return { ok: false, reason: String(body['error'] ?? 'Breeze could not be reached.') };
  }
  return { ok: true, forms: (body['forms'] as BreezeForm[]) ?? [] };
}

/**
 * One Breeze form's fields, mapped onto ours.
 *
 * The mapping is done in the Function rather than here because it needs the same
 * `FormField` shape the validator uses, and because Breeze's field types do not
 * line up one to one — some of theirs (`name`, `address`) are compound and
 * become several of ours.
 */
export async function importBreezeForm(
  breezeFormId: string,
): Promise<{ ok: true; fields: FormField[]; title: string } | { ok: false; reason: string }> {
  const idToken = await auth().currentUser?.getIdToken();
  if (!idToken) return { ok: false, reason: 'You are not signed in.' };

  const response = await fetch('/api/forms/breeze-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ breezeFormId }),
  });

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return { ok: false, reason: String(body['error'] ?? 'That form could not be imported.') };
  }
  return {
    ok: true,
    fields: (body['fields'] as FormField[]) ?? [],
    title: String(body['title'] ?? 'Imported form'),
  };
}

export type { WithId };
