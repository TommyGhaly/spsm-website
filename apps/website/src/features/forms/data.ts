'use client';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  parseFormDefinition,
  type FormAnswers,
  type FormDefinition,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Reading form definitions, and sending one back.
 *
 * Definitions are read straight from Firestore in the browser — they are public
 * once published, and `firestore.rules` says so. Submissions are not written
 * from here at all; they go to a Cloud Function. The long version of why is in
 * `firestore.rules` above `formSubmissions`, but the short one is that the total
 * charged has to be computed somewhere the submitter cannot edit.
 */

/**
 * Every form the public may see, ordered for the hub.
 *
 * A live subscription rather than a one-off read, because staff build forms in a
 * drawer on this very page: publishing one should make its card appear behind
 * the drawer, not on the next reload. The hub renders whatever this last
 * yielded, so a dropped connection leaves the previous list on screen rather
 * than emptying the page.
 */
export function watchPublishedForms(
  onForms: (forms: FormDefinition[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const forms = query(collection(db(), COLLECTIONS.forms), where('published', '==', true));

  return onSnapshot(
    forms,
    (snapshot) => {
      onForms(sortForms(snapshot.docs.map((entry) => withId(entry.id, entry.data()))));
    },
    (error) => onError(error),
  );
}

/**
 * Every form including drafts. Staff only — the rules refuse this read to
 * anyone else, so it is called only from behind `useFormsAdmin`.
 */
export async function readAllForms(): Promise<WithId<FormDefinition>[]> {
  const snapshot = await getDocs(collection(db(), COLLECTIONS.forms));
  return sortForms(snapshot.docs.map((entry) => withId(entry.id, entry.data())));
}

export type WithId<T> = T & { id: string };

function withId(id: string, raw: unknown): WithId<FormDefinition> {
  return { id, ...parseFormDefinition(id, raw) };
}

/** Lower `order` first, then alphabetical — so two forms left at the default
    order still come out in a stable, explicable sequence rather than Firestore's. */
function sortForms<T extends FormDefinition>(forms: T[]): T[] {
  return [...forms].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
}

/**
 * One form by its URL slug.
 *
 * Two reads, and the fallback is the point. The document id *is* the slug for
 * everything the builder creates, so the `get` almost always answers — but a
 * form whose slug was edited after creation keeps its original id, and a query
 * is the only thing that finds it. Doing the cheap exact read first means the
 * normal case costs one document rather than a collection query.
 */
export async function readFormBySlug(slug: string): Promise<WithId<FormDefinition> | null> {
  const direct = await getDoc(doc(db(), COLLECTIONS.forms, slug));
  if (direct.exists()) {
    const form = withId(direct.id, direct.data());
    if (form.slug === slug) return form;
  }

  const matches = await getDocs(
    query(collection(db(), COLLECTIONS.forms), where('slug', '==', slug)),
  );
  const first = matches.docs[0];
  return first ? withId(first.id, first.data()) : null;
}

/* ---------------------------------------------------------------------------
 * Submitting
 * ------------------------------------------------------------------------ */

export type SubmitResult =
  | { ok: true; submissionId: string; totalCents: number; paymentId: string | null }
  | { ok: false; errors: string[] };

/**
 * Send a completed form to the Function.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately absent from this request body.
 *
 * There is no amount. Not a total, not a line item, not a price per option — the
 * body carries the form's slug, the answers, and (when the form charges) a
 * single-use Square card token. The Function loads the definition from Firestore
 * and prices the answers itself with the same `computeTotalCents` the page used
 * to draw the running total.
 *
 * So the figure on screen is a *preview*. If someone edits the page to halve it,
 * the preview changes and the charge does not. This is the bookstore's property
 * rebuilt for a collection that has no Square catalog behind it to lean on.
 *
 * The card token is safe to send: it is minted inside Square's own iframe, is
 * good for one charge, and card details never reach this origin.
 * ---------------------------------------------------------------------------
 */
export async function submitForm(input: {
  slug: string;
  answers: FormAnswers;
  /** Square's single-use token. Null on a free form. */
  cardToken: string | null;
  /** Square requires this for 3-D Secure. Null when not challenged. */
  verificationToken: string | null;
}): Promise<SubmitResult> {
  let response: Response;
  try {
    response = await fetch('/api/forms/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    // A network failure, not a rejection — worth saying differently, because
    // "check your connection" is actionable and "submission failed" is not.
    return {
      ok: false,
      errors: ['Could not reach the church server. Check your connection and try again.'],
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    /*
     * Not JSON. In production this is Hosting serving the 404 page because the
     * rewrite is missing; locally it is the Next dev proxy with no Functions
     * emulator behind it. Both are configuration, not something the person
     * filling in the form can fix, so the console gets the detail and they get
     * a plain sentence.
     */
    console.error(
      `[forms] ${response.status} from /api/forms/submit, and the body was not JSON. ` +
        'In production that means the Hosting rewrite for this path is missing; ' +
        'locally it means the Functions emulator is not running. See docs/local-dev.md.',
    );
    return { ok: false, errors: ['Could not submit the form. Please try again shortly.'] };
  }

  const payload = (body ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    const errors = Array.isArray(payload['errors'])
      ? (payload['errors'] as unknown[]).map(String).filter(Boolean)
      : [];
    return {
      ok: false,
      errors: errors.length > 0 ? errors : ['Could not submit the form. Please try again.'],
    };
  }

  return {
    ok: true,
    submissionId: String(payload['submissionId'] ?? ''),
    totalCents: typeof payload['totalCents'] === 'number' ? payload['totalCents'] : 0,
    paymentId: typeof payload['paymentId'] === 'string' ? payload['paymentId'] : null,
  };
}
