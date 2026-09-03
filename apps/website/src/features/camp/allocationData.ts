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
  allocationDocId,
  countPlacements,
  blankAllocation,
  parseCampAllocation,
  type CampAllocation,
  type CampAllocationDraft,
  type GroupNameUpdate,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Reading and writing the one allocation document for a season.
 *
 * `firestore.rules` refuses every call here without a program grant on the
 * camp's ministry, so this module is only ever reached from behind
 * `useCampAdmin` — the same arrangement as `../data.ts` next door, which reads
 * the registrations this one points at.
 *
 * There is deliberately no one-shot read of the allocation. Both screens that
 * open it — the board and the register — are held open for hours by more than
 * one person, so a picture of the arrangement taken when the page loaded is
 * already wrong on the two days of the year it matters most. Every reader goes
 * through `subscribeAllocation`.
 */

/** The editable part of a stored allocation — everything but the audit stamps. */
function toDraft(stored: CampAllocation): CampAllocationDraft {
  return {
    programId: stored.programId,
    season: stored.season,
    weeks: stored.weeks,
    archivedAt: stored.archivedAt,
    archivedBy: stored.archivedBy,
    note: stored.note,
  };
}

/** One version of the allocation as the server currently has it. */
export interface AllocationUpdate {
  draft: CampAllocationDraft;
  /** Null when the season has never been allocated. */
  stored: CampAllocation | null;
  /**
   * The server's `updatedAt` in milliseconds, and the identity of this version.
   * Null while `pending`, and null for a season that does not exist yet.
   */
  readAt: number | null;
  /** True while one of this browser's own writes has not been acknowledged. */
  pending: boolean;
  /** uid of whoever wrote this version. */
  updatedBy: string | null;
}

/**
 * Listen to the season's allocation.
 *
 * ---------------------------------------------------------------------------
 * The live counterpart to `readAllocation`, and the reason the board no longer
 * has to be reloaded to see somebody else's evening.
 *
 * The board is arranged by two or three people at once — that is stated as the
 * reason `writeAllocation` bothers to check for a conflict at all. A one-shot
 * read made that check the *only* thing either of them ever heard from the
 * other: two laptops at the same table would each show the arrangement as it
 * was when the page opened, drift apart for twenty minutes, and then one of
 * them would be told their work collided at the moment they tried to save it.
 * Listening turns the common case — one person edits, the other is looking —
 * into the board simply changing, and leaves the conflict for the case that
 * genuinely is one.
 *
 * ## `readAt` is the version, and is withheld while pending
 *
 * `includeMetadataChanges` is on so the transition from "our write is local" to
 * "the server has it" is delivered rather than inferred. During that window
 * `updatedAt` is a `serverTimestamp()` sentinel, and `serverTimestamps:
 * 'estimate'` reads it as this device's clock — a number that is close to, but
 * never equal to, the one the server will store. Handing that estimate out as
 * `readAt` would make it the base of the next save's conflict check, which
 * would then compare a guess against the real stamp. So the estimate is used
 * for the *content* (nothing renders as null mid-write) and `readAt` is null
 * until the acknowledgement arrives with the true value.
 * ---------------------------------------------------------------------------
 */
export function subscribeAllocation(
  programId: string,
  season: string,
  onChange: (update: AllocationUpdate) => void,
  onError: (error: Error) => void,
): () => void {
  const ref = doc(db(), COLLECTIONS.campAllocations, allocationDocId(programId, season));

  return onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (snapshot) => {
      const pending = snapshot.metadata.hasPendingWrites;

      if (!snapshot.exists()) {
        onChange({
          draft: blankAllocation(programId, season),
          stored: null,
          readAt: null,
          pending,
          updatedBy: null,
        });
        return;
      }

      const data = snapshot.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
      const stored = parseCampAllocation(data);
      onChange({
        draft: toDraft(stored),
        stored,
        readAt: pending ? null : stampMillis(data['updatedAt']),
        pending,
        updatedBy: typeof data['updatedBy'] === 'string' ? data['updatedBy'] : null,
      });
    },
    (cause) => onError(cause),
  );
}

/**
 * Every season this ministry has an allocation for, newest first.
 *
 * A query rather than a guess at the last few years, because the answer is
 * "whatever is there" — a parish that skipped 2029 should not have an empty
 * year offered, and one that ran a winter season under its own name should see
 * it. Reads only the fields the year list draws.
 */
export interface AllocationSeason {
  season: string;
  archived: boolean;
  /** Placements across every week, for the one line under each year. */
  placed: number;
}

export async function readSeasons(programId: string): Promise<AllocationSeason[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.campAllocations), where('programId', '==', programId)),
  );

  const seasons = snapshot.docs.map((entry) => {
    const parsed = parseCampAllocation(entry.data());
    return {
      season: parsed.season,
      archived: parsed.archivedAt != null,
      placed: countPlacements(parsed),
    };
  });

  // Lexical descending is right for four-digit years and is honest about
  // anything else — a season called "2027 winter" sorts beside 2027 rather than
  // being silently dropped by a Number() that returns NaN.
  return seasons.sort((a, b) => b.season.localeCompare(a.season));
}

/**
 * Stamp a season as archived, so the board opens read-only from now on.
 *
 * Deliberately not a delete and deliberately not a copy into a second
 * collection. The document *is* the record; archiving is one field, and the
 * board that renders it is the same board, which is the only way to be sure
 * that what somebody sees next June is what was actually arranged.
 *
 * Rolling `config/camp.season` forward is a separate write by the caller, and
 * they are separate on purpose: a parish that wants to freeze this summer
 * without opening next summer's registrations yet can do exactly that.
 */
export async function archiveAllocation(
  programId: string,
  season: string,
  uid: string | null,
): Promise<void> {
  const ref = doc(db(), COLLECTIONS.campAllocations, allocationDocId(programId, season));
  const existing = await getDoc(ref);
  if (!existing.exists()) return;

  await updateDoc(ref, {
    archivedAt: serverTimestamp(),
    archivedBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Undo an archive: the season is arranged again from where it was left.
 *
 * ---------------------------------------------------------------------------
 * The counterpart to `archiveAllocation`, and it exists because archiving is
 * one field and one click. Somebody freezing summer 2027 the week before camp
 * because they read "clear the board for next year" as "clear the waiting
 * list" should not need an administrator, a console or a support call to get
 * their board back — nothing was destroyed, so nothing has to be rebuilt.
 *
 * The stamps are set to `null` rather than removed. `parseCampAllocation`
 * treats a missing field and a null one the same way, but a null is what
 * `writeAllocation` will send on the next ordinary save — it spreads the whole
 * draft — and having the two paths write the same shape is worth more than the
 * two bytes.
 *
 * `archivedBy` goes with it. Keeping the uid of whoever archived it on a board
 * that is no longer archived would put a name against a state that is not true
 * any more, which is exactly the sort of thing somebody reads off a screen in
 * three years and believes.
 * ---------------------------------------------------------------------------
 */
export async function unarchiveAllocation(
  programId: string,
  season: string,
  uid: string | null,
): Promise<void> {
  const ref = doc(db(), COLLECTIONS.campAllocations, allocationDocId(programId, season));
  const existing = await getDoc(ref);
  if (!existing.exists()) return;

  await updateDoc(ref, {
    archivedAt: null,
    archivedBy: null,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Delete a season's allocation document.
 *
 * ---------------------------------------------------------------------------
 * The one irreversible thing on this screen. It removes the arrangement — the
 * panels, the groups, the stations and who was in them — and nothing else:
 * registrations live in `campRegistrations` and the register in
 * `campAttendance`, and neither is touched by this. A parish that deletes the
 * 2027 board still knows who came to camp in 2027 and who was collected on the
 * Thursday.
 *
 * `firestore.rules` allows it on a program grant rather than reserving it for
 * an administrator, and the reason is stated there: a season allocated by
 * mistake — a typo in the year, a board built against the wrong ministry — has
 * to be removable by the people who made it. The confirmation is the screen's
 * job, and the hub asks for the season to be typed out.
 *
 * There is no soft delete and no second collection to recover it from. That is
 * what archiving is for, and it is why the hub only offers this on a season
 * the camp has already moved off.
 * ---------------------------------------------------------------------------
 */
export async function deleteAllocation(programId: string, season: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.campAllocations, allocationDocId(programId, season)));
}

/** Thrown when the stored document moved on since it was read. */
export class AllocationConflict extends Error {
  constructor(readonly updatedBy: string | null) {
    super('Somebody else saved this allocation while you were working on it.');
    this.name = 'AllocationConflict';
  }
}

/**
 * Write the allocation back.
 *
 * ---------------------------------------------------------------------------
 * `setDoc` replaces rather than merges, which is what makes deleting a band, a
 * group or a station actually work — and what would destroy `createdAt` on
 * every save. So the document is read back first, exactly as `writeRegistration`
 * does next door.
 *
 * That read is not only for `createdAt`. It is also the conflict check. This
 * screen is the one place on the site where two people plausibly work on the
 * same document at the same time — the week before camp, at a table, with two
 * laptops — and last-write-wins on a document holding the entire arrangement is
 * not "the later edit sticks", it is "one of them loses everything". Comparing
 * the stamp costs nothing on top of a read that had to happen anyway, and turns
 * that into a message.
 *
 * `expectedAt` of `null` means "I read a document that did not exist". If one
 * exists now, somebody created it in between, and overwriting it is exactly the
 * case worth stopping.
 * ---------------------------------------------------------------------------
 */
export async function writeAllocation(
  draft: CampAllocationDraft,
  uid: string | null,
  expectedAt: number | null,
  options: { force?: boolean } = {},
): Promise<{ readAt: number | null }> {
  const ref = doc(db(), COLLECTIONS.campAllocations, allocationDocId(draft.programId, draft.season));
  const existing = await getDoc(ref);

  if (!options.force) {
    const storedAt = existing.exists() ? stampMillis(existing.data()?.['updatedAt']) : null;
    const storedBy = existing.exists() ? (existing.data()?.['updatedBy'] ?? null) : null;
    /*
     * Only a *different* uid is a conflict.
     *
     * The same person in a second tab is a nuisance, not a data loss — they can
     * see both screens. Stopping on it would also stop the ordinary case where
     * this browser's own last save is what moved the stamp, which happens
     * whenever a save lands while a drag is in progress.
     */
    if (storedAt !== expectedAt && storedBy !== uid) {
      throw new AllocationConflict(typeof storedBy === 'string' ? storedBy : null);
    }
  }

  await setDoc(ref, {
    ...draft,
    createdAt: existing.exists()
      ? (existing.data()?.['createdAt'] ?? serverTimestamp())
      : serverTimestamp(),
    updatedAt: serverTimestamp(),
    // The rule requires this to equal the caller's uid, so a write is always
    // attributable. Passing null would be refused rather than stored.
    updatedBy: uid,
  });

  // Read the stamp the server actually wrote, so the next save compares against
  // the right value. Without this the very next save conflicts with itself.
  const after = await getDoc(ref);
  return { readAt: stampMillis(after.data()?.['updatedAt']) };
}

/**
 * Copy the arrangement onto the registrations' `groupName` fields.
 *
 * ---------------------------------------------------------------------------
 * A separate, explicit action rather than part of every save, and the reason is
 * cost. `groupNameUpdates` returns one entry per child whose stored name
 * disagrees; on the first run of a season that is every child in the camp, and
 * running it after every drag would be two hundred document writes in the
 * middle of somebody rearranging a group.
 *
 * The write is an `updateDoc` on `children` — the whole array, because Firestore
 * cannot update one element of one — plus `updatedAt` and `updatedBy`, which
 * the rule on `campRegistrations` requires to equal the caller. It deliberately
 * does *not* go through `writeRegistration`: that one replaces the document,
 * and replacing a registration to change one string is how a payment somebody
 * recorded thirty seconds ago disappears.
 *
 * Registrations are re-read one at a time immediately before each write for the
 * same reason. The list this screen is holding was read when the page opened
 * and may be minutes old; merging into it would write back a stale payment
 * ledger along with the group name.
 * ---------------------------------------------------------------------------
 */
export async function applyGroupNames(
  updates: readonly GroupNameUpdate[],
  uid: string | null,
): Promise<number> {
  const byRegistration = new Map<string, Map<string, string>>();
  for (const update of updates) {
    let children = byRegistration.get(update.registrationId);
    if (!children) {
      children = new Map();
      byRegistration.set(update.registrationId, children);
    }
    children.set(update.childId, update.groupName);
  }

  let written = 0;
  for (const [registrationId, names] of byRegistration) {
    const ref = doc(db(), COLLECTIONS.campRegistrations, registrationId);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) continue;

    const children = snapshot.data()['children'];
    if (!Array.isArray(children)) continue;

    const next = children.map((child: unknown) => {
      const record = child && typeof child === 'object' ? (child as Record<string, unknown>) : null;
      const id = typeof record?.['id'] === 'string' ? record['id'] : '';
      if (!record || !names.has(id)) return child;
      return { ...record, groupName: names.get(id) };
    });

    await updateDoc(ref, { children: next, updatedAt: serverTimestamp(), updatedBy: uid });
    written += 1;
  }

  return written;
}

/**
 * A Firestore timestamp as milliseconds, from whatever shape it arrives in.
 *
 * A `Timestamp` from the SDK, a plain `{ seconds, nanoseconds }` from a REST
 * read or the emulator, a `Date`, or nothing. Returns null rather than 0 for
 * the last case: 0 is a real instant and would compare equal to a document
 * genuinely stamped at the epoch, whereas null is "no stamp" and is treated as
 * such by the conflict check.
 */
function stampMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    const record = value as { toMillis?: () => number; seconds?: unknown };
    if (typeof record.toMillis === 'function') return record.toMillis();
    if (typeof record.seconds === 'number') return record.seconds * 1000;
  }
  return null;
}

/**
 * Point the camp at a new season.
 *
 * ---------------------------------------------------------------------------
 * The other half of "clear the board for next year". Archiving freezes summer
 * 2027; this is what makes 2028 the season every camp screen reads, at which
 * point the allocation board opens on a document that does not exist yet and
 * is therefore empty. Nothing is deleted by either step.
 *
 * **Only the superadmin can call this**, because `firestore.rules` guards the
 * whole `config` collection with `isSuper()` and the camp's permission is a
 * program grant on the member document. `config` is in `ADMIN_SCREENS` and
 * /access deliberately does not offer the row, so there is not even a flag to
 * hand out. That is not an oversight to route around: one document in `config`
 * points the site at its backends and another holds its integrations, and
 * opening the collection to every program lead so the camp can change a year
 * would be a much larger grant than the thing being asked for. The hub shows
 * this control only to the superadmin and says who to ask otherwise.
 * ---------------------------------------------------------------------------
 */
export async function rollCampSeason(season: string, uid: string | null): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_CAMP), {
    season,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
