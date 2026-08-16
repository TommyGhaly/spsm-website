/**
 * Browser-side reads and writes for the events admin.
 *
 * Separate from `data.ts` on purpose. That file is build-time only: it runs
 * unauthenticated during `next build` and every query filters on
 * `published == true`. This one runs in a signed-in browser, reads drafts, and
 * writes. Mixing them would put write helpers one import away from a public
 * page, and put `serverTimestamp` in the static build.
 *
 * Not re-exported from `index.ts`, so importing it is a deliberate act. The
 * admin routes are its only callers.
 *
 * Security lives in `firestore.rules` — `allow write: if hasRole('staff')` —
 * not here. Everything in this file is convenience for a person who already
 * has the claim.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { COLLECTIONS, type DocOf, type Event } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';

/**
 * Every event, drafts included.
 *
 * No `where('published','==',true)` here, and that is exactly what makes this a
 * staff-only query: Firestore judges a list by what it *could* return, so an
 * unfiltered read of `events` is allowed only by the `hasRole('staff')` branch.
 * A member running this gets permission-denied rather than a filtered list,
 * which is the correct and honest failure.
 */
export async function listEventsForAdmin(): Promise<DocOf<Event>[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.events), orderBy('startAt', 'desc')),
  );
  return snapshot.docs.map(docOf<Event>);
}

/** What the form owns. Everything else on `Event` is set here or unused in MVP. */
export type EventDraft = Pick<
  Event,
  | 'slug'
  | 'title'
  | 'summary'
  | 'body'
  | 'allDay'
  | 'timeZone'
  | 'location'
  | 'category'
  | 'tags'
  | 'audience'
  | 'published'
> & {
  startAt: Date;
  endAt: Date | null;
  registrationUrl: string | null;
};

function toDocument(draft: EventDraft) {
  return {
    slug: draft.slug,
    title: draft.title,
    summary: draft.summary,
    body: draft.body,

    startAt: draft.startAt,
    endAt: draft.endAt,
    allDay: draft.allDay,
    timeZone: draft.timeZone,

    location: draft.location,
    heroImagePath: null,

    category: draft.category,
    tags: draft.tags,
    audience: draft.audience,

    // `formId` is deliberately not settable. It points at the `forms`
    // collection, which has rules but no schema and no route — a link to it
    // would send a parishioner to a 404. Only an external URL for now.
    registration: draft.registrationUrl
      ? {
          formId: null,
          externalUrl: draft.registrationUrl,
          opensAt: null,
          closesAt: null,
          capacity: null,
        }
      : null,

    // Out of scope for MVP; see docs/decisions.md #8.
    recurrence: null,

    published: draft.published,

    // Always null. `publishAt` instructs a scheduled Function that does not
    // exist yet, so setting it here would only produce a document that looks
    // scheduled and never publishes. `published` is the switch.
    publishAt: null,

    updatedAt: serverTimestamp(),
  };
}

export async function createEvent(draft: EventDraft, uid: string | null): Promise<string> {
  const created = await addDoc(collection(db(), COLLECTIONS.events), {
    ...toDocument(draft),
    createdAt: serverTimestamp(),
    updatedBy: uid,
  });
  return created.id;
}

export async function updateEvent(
  id: string,
  draft: EventDraft,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.events, id), {
    ...toDocument(draft),
    updatedBy: uid,
  });
}

export async function deleteEvent(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.events, id));
}

/**
 * Title -> URL slug.
 *
 * The slug is the public URL and the value `generateStaticParams` enumerates,
 * so changing one after an event has been shared breaks that link. The form
 * offers this as a starting point and then leaves it alone once set.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
