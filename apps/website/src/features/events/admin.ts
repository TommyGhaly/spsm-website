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
  where,
} from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import {
  COLLECTIONS,
  type DocOf,
  type Event,
  type Program,
  type ProgramEvent,
} from '@spsm/shared';
import { db, storage } from '@/lib/firebase';
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
  | 'heroImagePath'
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
    heroImagePath: draft.heroImagePath,

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

/* -------------------------------------------------------------------------- */
/* Hero images                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The ceiling `storage.rules` enforces on `events/`, repeated here.
 *
 * Duplicated on purpose. The rule is the enforcement and this is not — but
 * without it a volunteer picks a 14MB photograph straight off a phone, waits for
 * the whole upload, and is then told `storage/unauthorized`, which reads as "you
 * are not allowed" rather than "that file is too big". Checking first turns an
 * incomprehensible rejection into a sentence. Keep the two numbers in step.
 */
export const HERO_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Where an event's photograph lives.
 *
 * Under the event's slug, and stamped, rather than a fixed `events/{slug}/hero`:
 *
 *  - a fixed name means replacing a photograph overwrites the old object, and
 *    the new bytes then sit behind the *same* URL — which every CDN, browser
 *    cache, and Facebook link preview already has. The parish would swap the
 *    picture and keep seeing the old one.
 *  - the stamp makes each upload a new URL, so a replacement is visible
 *    immediately. `deleteEventHero` is what stops the old ones accumulating.
 *
 * The extension is carried across because Storage serves the object back with
 * the content type it was given, and the suffix is what a human sees in the
 * console when they go looking for a file.
 */
function heroPath(slug: string, file: File): string {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'jpg';
  return `events/${slug}/hero-${Date.now()}.${extension || 'jpg'}`;
}

/**
 * Put a photograph in the bucket and return its path.
 *
 * A *path*, never a URL — the same rule the rest of the schema follows, and for
 * the same reason: a URL baked into a document is a URL that cannot be changed
 * when the bucket moves. `lib/storage.ts` turns it into one at render time.
 *
 * Uploaded rather than queued: `events/` is public-read and staff-write in
 * `storage.rules`, with no transcode step and no approval queue. That is the
 * difference from a gallery submission, which lands in quarantine and is copied
 * out by a Function — staff are trusted with the parish's own event photograph
 * in a way an anonymous submitter is not.
 */
export async function uploadEventHero(file: File, slug: string): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That file is not an image. Use a JPEG, PNG, or WebP.');
  }
  if (file.size > HERO_MAX_BYTES) {
    throw new Error(
      `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 8MB — ` +
        'most photo apps can export a smaller copy.',
    );
  }
  if (!slug) {
    throw new Error('Give the event a title first, so the photograph has somewhere to go.');
  }

  const path = heroPath(slug, file);
  await uploadBytes(ref(storage(), path), file, { contentType: file.type });
  return path;
}

/**
 * Remove a photograph that is no longer referenced.
 *
 * Failures are swallowed, and that is deliberate. This is called when somebody
 * replaces or clears an image, *after* the document has stopped pointing at the
 * old object — so the visible outcome has already happened. A leftover file in
 * the bucket costs pennies; an error dialog saying the event did not save, when
 * it did, costs a support call.
 */
export async function deleteEventHero(path: string): Promise<void> {
  try {
    await deleteObject(ref(storage(), path));
  } catch (error) {
    console.warn('[events] could not delete the old hero image:', error);
  }
}

/* -------------------------------------------------------------------------- */
/* Linking a calendar event to a program gallery                               */
/* -------------------------------------------------------------------------- */

/**
 * One program occurrence, as an option in the events form.
 *
 * Carries the program's name because the picker groups by it, and a second
 * lookup per option to find that name would be a query per row.
 */
export interface ProgramLinkTarget {
  programEventId: string;
  programId: string;
  programName: string;
  title: string;
  /** The calendar event this occurrence already points at, if any. */
  calendarEventId: string | null;
}

/**
 * Everything an event could be filed under.
 *
 * ## Why the fallback exists
 *
 * `programEvents` reads as `isPublished(resource.data) || adminsProgramEvent(…)`.
 * Firestore judges a list by what it *could* return, so an unfiltered read is
 * allowed only when the second branch is true independently of any document —
 * which is `hasRole('admin')`, and nothing else. A `staff` user with no program
 * grant gets `permission-denied` on the whole query rather than a filtered list.
 *
 * So: ask for everything, and on a refusal ask again for the published ones,
 * which any signed-in reader may have. An administrator sees drafts too; a staff
 * user sees the published occurrences, which is all they could link to anyway.
 * The alternative — always filtering on `published` — would quietly hide a camp
 * that has been created but not yet published, which is exactly the one somebody
 * is most likely to be setting up.
 */
export async function listProgramLinkTargets(): Promise<ProgramLinkTarget[]> {
  const programs = await getDocs(collection(db(), COLLECTIONS.programs)).catch(() =>
    getDocs(query(collection(db(), COLLECTIONS.programs), where('published', '==', true))),
  );
  const names = new Map(programs.docs.map((snapshot) => [snapshot.id, (snapshot.data() as Program).name]));

  const events = await getDocs(collection(db(), COLLECTIONS.programEvents)).catch(() =>
    getDocs(query(collection(db(), COLLECTIONS.programEvents), where('published', '==', true))),
  );

  return events.docs
    .map(docOf<ProgramEvent>)
    .map((programEvent) => ({
      programEventId: programEvent.id,
      programId: programEvent.programId,
      // A program the reader cannot see is still a real program — the
      // occurrence names itself, so the group falls back rather than vanishing.
      programName: names.get(programEvent.programId) ?? programEvent.programId,
      title: programEvent.title,
      calendarEventId: programEvent.calendarEventId ?? null,
    }))
    .sort(
      (a, b) =>
        a.programName.localeCompare(b.programName) || a.title.localeCompare(b.title),
    );
}

/**
 * Point a program occurrence at a calendar event, and unpoint the old one.
 *
 * **The link is stored on `programEvents`, not on `events`.** That direction is
 * the schema's, not a convenience: "the calendar knows nothing about the
 * gallery" (see `ProgramEvent.calendarEventId`). An event can therefore be
 * edited, republished, or deleted without the calendar ever having to know a
 * gallery exists, and this is the one place that has to reach across.
 *
 * Two writes when the link moves, because a calendar event belongs to at most
 * one occurrence: clearing the previous holder is what stops "Summercamp 2027"
 * and "Summercamp 2028" both claiming the same Liturgy.
 *
 * Throws on refusal rather than swallowing it. Writing a `programEvent` needs a
 * grant on its program — `staff` alone is not enough — so this genuinely fails
 * for some of the people who can otherwise edit an event, and the caller has to
 * be able to say so without pretending the event itself did not save.
 */
export async function setProgramLink(
  eventId: string,
  programEventId: string | null,
  previousProgramEventId: string | null,
): Promise<void> {
  if (previousProgramEventId && previousProgramEventId !== programEventId) {
    await updateDoc(doc(db(), COLLECTIONS.programEvents, previousProgramEventId), {
      calendarEventId: null,
      updatedAt: serverTimestamp(),
    });
  }

  if (programEventId) {
    await updateDoc(doc(db(), COLLECTIONS.programEvents, programEventId), {
      calendarEventId: eventId,
      updatedAt: serverTimestamp(),
    });
  }
}
