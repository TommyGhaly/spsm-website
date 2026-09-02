'use client';

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  acceptedServantRegistration,
  parseCampRegistration,
  parseCampServantRequest,
  sortRegistrations,
  toDate,
  type CampRegistration,
  type CampRegistrationDraft,
  type CampConfig,
  type CampServantRequest,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Reading and writing camp registrations.
 *
 * Every function here is refused outright by `firestore.rules` without a
 * program grant on the camp's ministry, so this module is only ever reached
 * from behind `useCampAdmin`. There is no public counterpart to it and there is
 * not meant to be one — the whole collection is administrator-only, which is
 * what makes it acceptable for it to hold a child's medical notes.
 */

export type WithId<T> = T & { id: string };

/**
 * Every registration for one season.
 *
 * ---------------------------------------------------------------------------
 * Two equality filters and no `orderBy`, deliberately.
 *
 * `where('programId','==',…)` is not a convenience — it is what makes the query
 * *provable*. Firestore judges a list by what it could return rather than what
 * it did, and the rule allows a read when the reader administers the document's
 * program. Without the constraint the only reader who could satisfy that is a
 * superadmin, and the camp administrator the screen was built for would be
 * refused the whole thing with a flat `permission-denied`. That is decision #10
 * again; the galleries hit it and the rules tests caught it.
 *
 * The absent `orderBy` is the other half. Two equality filters need no composite
 * index — Firestore merges the single-field ones — but adding a sort would, and
 * a missing index is not a failed build somebody sees, it is a screen that
 * spins forever on a live page. A camp season is a few hundred rows, so
 * `sortRegistrations` does it in memory, where it can also sort by a name
 * assembled from two fields.
 * ---------------------------------------------------------------------------
 */
export async function readRegistrations(
  programId: string,
  season: string,
): Promise<WithId<CampRegistration>[]> {
  const snapshot = await getDocs(
    query(
      collection(db(), COLLECTIONS.campRegistrations),
      where('programId', '==', programId),
      where('season', '==', season),
    ),
  );

  return sortRegistrations(
    snapshot.docs.map((entry) => ({ id: entry.id, ...parseCampRegistration(entry.data()) })),
  );
}

/**
 * The same season, kept live.
 *
 * ---------------------------------------------------------------------------
 * The query is the one above, letter for letter — the two equality filters are
 * what make the *list* provable, and a listener is judged by the same rule as a
 * read, so relaxing either constraint here would fail exactly as it fails
 * there.
 *
 * A listener rather than a read because both screens that hold this roster are
 * held open for hours by more than one person. The allocation board is arranged
 * at a table with two laptops the week before camp; the register is taken at a
 * door and in a hall at the same moment. A registration typed at the desk on
 * the Monday morning has to reach the phone at the gate without anybody being
 * told to refresh, and a child moved between groups on one laptop has to stop
 * being draggable on the other.
 *
 * `serverTimestamps: 'estimate'` for the same reason `subscribeAttendance` uses
 * it: a registration saved on this device echoes back locally before the server
 * has resolved its `updatedAt`, and the default read of that pending sentinel
 * is `null`.
 * ---------------------------------------------------------------------------
 */
export function subscribeRegistrations(
  programId: string,
  season: string,
  onChange: (rows: WithId<CampRegistration>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db(), COLLECTIONS.campRegistrations),
      where('programId', '==', programId),
      where('season', '==', season),
    ),
    (snapshot) => {
      onChange(
        sortRegistrations(
          snapshot.docs.map((entry) => ({
            id: entry.id,
            ...parseCampRegistration(entry.data({ serverTimestamps: 'estimate' })),
          })),
        ),
      );
    },
    (cause) => onError(cause),
  );
}

/**
 * Create or overwrite one registration.
 *
 * `setDoc` replaces rather than merges, which is what makes removing a child,
 * a discount, or a payment line actually work — and what would silently destroy
 * `createdAt` on every edit. So it is read back first, exactly as `writeForm`
 * does next door: reading it here means no caller can forget, and a save at a
 * registration desk is not a hot path.
 */
export async function writeRegistration(
  id: string,
  draft: CampRegistrationDraft,
  uid: string | null,
): Promise<void> {
  const ref = doc(db(), COLLECTIONS.campRegistrations, id);
  const existing = await getDoc(ref);

  await setDoc(ref, {
    ...draft,
    createdAt: existing.exists() ? (existing.data()?.['createdAt'] ?? serverTimestamp()) : serverTimestamp(),
    updatedAt: serverTimestamp(),
    // The rule requires this to equal the caller's uid, so a write is always
    // attributable. Passing null would be refused rather than stored.
    updatedBy: uid,
  });
}

/**
 * Delete a registration outright.
 *
 * For a row typed twice at a desk, and nothing else. A family that pulled out
 * is `status: 'withdrawn'` — they paid, or they did not, and either way the
 * camp needs to be able to answer for it in six months. The screen says as
 * much before it calls this.
 */
export async function deleteRegistration(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.campRegistrations, id));
}

/**
 * A fresh document id.
 *
 * Time-ordered so ids sort roughly by when the registration was taken, which
 * makes a console listing legible without opening anything. Not the family's
 * name: names repeat, get corrected, and are not ours to put in a URL.
 */
export function newRegistrationId(): string {
  return `reg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------------------
 * Servants who signed themselves up
 * ------------------------------------------------------------------------ */

/**
 * The sign-ups waiting to be accepted, kept live.
 *
 * ---------------------------------------------------------------------------
 * The same two equality filters as the register above, for the same reason.
 *
 * `where('programId','==',…)` is what makes the query *provable*: Firestore
 * judges a list by what it could return, and the rule allows the read when the
 * reader administers the document's program. Without the constraint only a
 * superadmin could satisfy it and the camp administrator this queue was built
 * for would be refused the lot with a flat `permission-denied`.
 *
 * A listener rather than a read because these arrive while the screen is open —
 * that is the whole difference between this collection and the register beside
 * it, which changes only when somebody at the desk changes it. A sign-up sent
 * from a phone in the car park should appear without anybody being told to
 * refresh.
 * ---------------------------------------------------------------------------
 */
export function subscribeServantRequests(
  programId: string,
  season: string,
  onChange: (rows: WithId<CampServantRequest>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db(), COLLECTIONS.campServantRequests),
      where('programId', '==', programId),
      where('season', '==', season),
    ),
    (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...parseCampServantRequest(entry.data({ serverTimestamps: 'estimate' })),
      }));
      /*
       * Oldest first, and sorted here rather than by Firestore.
       *
       * An `orderBy` beside two equality filters needs a composite index, and a
       * missing index is not a failed build somebody sees — it is a screen that
       * spins forever on a live page. A queue is a few rows.
       *
       * Oldest first because this is a queue: somebody who signed up in March
       * should not be under everybody who signed up since.
       */
      rows.sort((a, b) => timeOf(a.submittedAt) - timeOf(b.submittedAt));
      onChange(rows);
    },
    (cause) => onError(cause),
  );
}

/** Milliseconds, from whatever Firestore handed back. Unresolved server
    timestamps sort last, which is right — they were written a moment ago. */
function timeOf(value: unknown): number {
  return toDate(value as Parameters<typeof toDate>[0])?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Accept a sign-up: write the registration, then drop the request.
 *
 * ---------------------------------------------------------------------------
 * Two writes, in this order, and not a transaction.
 *
 * They are in different collections with different rules, and the failure modes
 * are not symmetric. Registration first means the worst case is a request that
 * was accepted and is still in the queue — visible, and accepting it again
 * writes the same registration to the same id, which is idempotent. The other
 * order's worst case is a sign-up deleted and never registered: a real person
 * who filled in a form and vanished, with nothing left to notice.
 *
 * A transaction would remove even that, and cannot be used: `deleteDoc` and
 * `setDoc` across two collections is fine in one, but the registration id is
 * derived here and the queue is a listener — the added complexity buys nothing
 * over an order chosen so that the survivable failure is the one that happens.
 * ---------------------------------------------------------------------------
 */
export async function acceptServantRequest(
  requestId: string,
  request: CampServantRequest,
  input: { uid: string | null; waiverInForce: boolean },
): Promise<string> {
  const id = newRegistrationId();
  const draft = acceptedServantRegistration(request, {
    takenByUid: input.uid,
    waiverInForce: input.waiverInForce,
  });

  await writeRegistration(id, draft, input.uid);
  await deleteServantRequest(requestId);
  return id;
}

/**
 * Dismiss a sign-up without registering anybody.
 *
 * A real delete, unlike a registration, which is withdrawn rather than removed.
 * The difference is what the document is: a withdrawn registration is a record
 * of somebody the camp dealt with and may have taken money from, and a
 * dismissed request is a message that was not acted on. Keeping a permanent
 * refusal list of people who asked to serve is not something the camp asked for
 * and not something this should build by accident.
 */
export async function deleteServantRequest(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.campServantRequests, id));
}

/**
 * Change the camp's own settings.
 *
 * ---------------------------------------------------------------------------
 * Writes into `config/camp`, which is otherwise superadmin-only:
 * `firestore.rules` has a second match on that one document allowing a camp
 * administrator everything on it **except `programId`**, and the reasoning is
 * there. This function cannot send `programId` — the type will not let a caller
 * name it — so the refusal is a rule and a compile error rather than only a
 * rule.
 *
 * `updateDoc` rather than `setDoc`, for two reasons that both matter. It merges,
 * so saving the week dates cannot blank the waiver text somebody typed on
 * another device a minute ago; and it fails loudly on a document that does not
 * exist, which is the right answer for a parish whose `config/camp` has never
 * been created — the screen says to run `npm run camp -- --write` rather than
 * quietly creating a settings document with half a shape.
 *
 * A partial is deliberate. The settings panel saves the field somebody changed
 * and nothing else, so two people editing different settings at the same moment
 * do not overwrite each other — which is exactly the case the old single-key
 * write got right by accident and a whole-document save would have got wrong.
 * ---------------------------------------------------------------------------
 */
export type CampSettingsPatch = Partial<Omit<CampConfig, 'programId'>>;

export async function writeCampSettings(
  patch: CampSettingsPatch,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_CAMP), {
    ...patch,
    updatedAt: serverTimestamp(),
    // The rule requires this to equal the caller's uid when it is sent at all.
    updatedBy: uid,
  });
}
