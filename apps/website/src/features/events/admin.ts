/**
 * Browser-side reads and writes for editing an event.
 *
 * Separate from `data.ts` on purpose. That file is build-time only: it runs
 * unauthenticated during `next build` and every query filters on
 * `published == true`. This one runs in a signed-in browser, reads drafts, and
 * writes. Mixing them would put write helpers one import away from a public
 * page, and put `serverTimestamp` in the static build.
 *
 * Not re-exported from `index.ts`, so importing it is a deliberate act, and
 * every import of it is dynamic — see the note in EventArticle.tsx. It was
 * named for the `/admin/events` screen that used to be its only caller; that
 * screen is gone and the in-place editor on the event's own page is now what
 * calls this.
 *
 * ## `listEventsForAdmin` and `createEvent` have no caller
 *
 * They sat unused once `/admin/events` was deleted, got one back at
 * `/staff/events`, and lost it again when that screen was removed on 28 Aug
 * 2026 — a new event has no page to be in place on, so the only thing that can
 * call them is a screen that is not an event's page, and there is not one.
 *
 * They are kept rather than deleted because the gap they fill is still real and
 * still has no other answer: nothing on the site can make an event. `deleteEvent`
 * is live — the in-place editor calls it.
 *
 * `setProgramLink` is still uncalled. Pointing a calendar event at a ministry
 * gallery has no home in the editor yet; leave it.
 *
 * ## Typing is the only save, and it writes live
 *
 * There is no `publishEvent`, no `unpublishEvent` and no `discardPendingEdit` in
 * here any more, and no `published` field on the document for them to have moved.
 * `updateEventContent` writes the parish's copy directly, a second after somebody
 * stops typing. See its own note for what that trade gives up.
 *
 * Security lives in `firestore.rules` — `allow write: if hasScreen('events')` —
 * not here. Everything in this file is convenience for a person who has already
 * been given the parish calendar at /access.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import {
  COLLECTIONS,
  type DocOf,
  type Event,
  type EventLocation,
  type Program,
  type ProgramEvent,
} from '@spsm/shared';
import { db, storage } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';

/**
 * Every event.
 *
 * Identical in effect to `getAllEvents` in ./data now that there is no
 * `published` field to filter on and no reader that could be refused — the two
 * are kept apart because that one runs unauthenticated inside `next build` and
 * this one runs in a signed-in browser, and mixing them would put write helpers
 * one import away from a public page.
 */
export async function listEventsForAdmin(): Promise<DocOf<Event>[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.events), orderBy('startAt', 'desc')),
  );
  return snapshot.docs.map(docOf<Event>);
}

/**
 * One event, read fresh, drafts included.
 *
 * For the in-place editor on the event's own page. That page's HTML is baked at
 * build time, so what it shows may be hours or days old — and editing from a
 * stale copy silently reverts whatever somebody else changed in between, because
 * the write sends every field. So pressing Edit re-reads the document first.
 *
 * Returns null for a document that has since been deleted, which the caller has
 * to say out loud rather than letting a save re-create it.
 */
export async function readEvent(id: string): Promise<DocOf<Event> | null> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.events, id));
  return snapshot.exists() ? docOf<Event>(snapshot) : null;
}

/**
 * What the editor owns, in the editor's own units.
 *
 * `Date` and a bare URL string rather than the document's `Timestamped` and
 * `registration` object, because this is the boundary: everything above it
 * thinks in wall clocks and text fields, everything below it thinks in the
 * shapes `schema/events.ts` describes. `slug` and `published` are absent on
 * purpose — see `EventContent` for why neither is something you type.
 */
export interface EventContentDraft {
  title: string;
  summary: string;
  body: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timeZone: string;
  location: EventLocation | null;
  heroImagePath: string | null;
  category: Event['category'];
  tags: string[];
  audience: Event['audience'];
  registrationUrl: string | null;
}

/** The draft as the document wants it. Never includes `slug` or `published`. */
function toContent(draft: EventContentDraft) {
  return {
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
  };
}

/**
 * Autosave. Writes what has been typed, straight onto the event.
 *
 * Called every second or two while somebody types, which is the whole interface:
 * there is no Save button and no Publish button. Tommy: *"get rid of the
 * publishing logic it should just autosave much less confusing."*
 *
 * ## What this replaced, and what it gave up
 *
 * It used to write a `pendingEdit` copy that a separate Publish promoted, so a
 * half-typed sentence was never the parish's copy. That is gone, and the trade is
 * worth being blunt about: **this writes live, and there is no undo.** The mobile
 * app reads this document directly, so a mistyped title is the parish's title
 * about a second later. What is bought for it is that the editor cannot ever show
 * different words than the page — which is the confusion that was being paid for.
 *
 * `updatedAt` is stamped, unlike the pending-edit version that deliberately left
 * it alone: this *is* a change to the parish's copy now, so the field means what
 * it says again.
 */
export async function updateEventContent(
  id: string,
  draft: EventContentDraft,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.events, id), {
    ...toContent(draft),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * A new event, with nothing filled in but its slug and its day.
 *
 * **It is on the website from this moment**, because there is no other state for
 * it to be in. That is the direct consequence of dropping the publish step, and
 * it is the one thing to keep in mind when creating one: an event named and dated
 * now appears on the parish calendar at the next build with an empty description.
 * The editor says what is still missing; nothing stops it being public meanwhile.
 *
 * The slug is settled here and never again. It is the public URL, the value
 * `generateStaticParams` enumerates, and the folder the photograph is filed
 * under, so the editor shows it and does not offer to change it.
 */
export async function createEvent(
  slug: string,
  draft: EventContentDraft,
  uid: string | null,
): Promise<string> {
  const created = await addDoc(collection(db(), COLLECTIONS.events), {
    ...toContent(draft),
    slug,
    // Out of scope for MVP; see docs/decisions.md #8.
    recurrence: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  return created.id;
}

/**
 * Is this slug free?
 *
 * Asked before creating, because two events sharing a slug emit the same route
 * twice and `generateStaticParams` de-duplicates them — so one of the two
 * silently stops having a page. The read is a query rather than a `getDoc`
 * because the slug is a field, not the document id.
 */
export async function slugTaken(slug: string): Promise<boolean> {
  const found = await getDocs(
    query(collection(db(), COLLECTIONS.events), where('slug', '==', slug)),
  );
  return !found.empty;
}

/**
 * Delete the event, handing back everything needed to put it back.
 *
 * The returned data is what makes the undo window honest. Firestore has no
 * trash and no soft delete here, so "undo" can only mean *write it again* —
 * which needs every field, read before the delete rather than after.
 *
 * `id` is preserved on restore, so anything that already links to this event by
 * id still resolves. That is why this pairs with `restoreEvent` and a `setDoc`
 * rather than with `createEvent`.
 */
export async function deleteEvent(id: string): Promise<Record<string, unknown> | null> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.events, id));
  const data = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : null;
  await deleteDoc(doc(db(), COLLECTIONS.events, id));
  return data;
}

/**
 * Put back an event that was just deleted, under its original id.
 *
 * Only meaningful within the undo window, and only with the exact data
 * `deleteEvent` returned. Restoring stamps neither `createdAt` nor `updatedAt`:
 * an undone delete should leave the event as it was, not look like an edit.
 */
export async function restoreEvent(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(db(), COLLECTIONS.events, id), data);
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
 * There is no size limit any more, and the note that used to be here explained
 * one: "without it a volunteer picks a 14MB photograph straight off a phone,
 * waits for the whole upload, and is then told `storage/unauthorized`". The
 * answer to that turned out not to be a friendlier refusal — a 14MB photograph
 * off a phone is a normal photograph, and `isImage()` in storage.rules stopped
 * carrying a size on 2026-09-01. What is left is the type, which the rules
 * still enforce and which this still checks first so the message is a sentence.
 */

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
 * which is `isSuper()`, and nothing else. Somebody holding the Parish calendar
 * grant but no program grant gets `permission-denied` on the whole query rather
 * than a filtered list.
 *
 * So: ask for everything, and on a refusal ask again for the published ones,
 * which any reader may have. The superadmin sees drafts too; everybody else sees
 * the published occurrences, which is all they could link to anyway.
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
