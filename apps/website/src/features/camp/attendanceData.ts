'use client';

import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  attendanceDocId,
  parseCampAttendanceDay,
  type CampAttendanceDay,
  type CampDayKey,
  type CampPersonKey,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Reading and ticking one day of the camp's register.
 *
 * `firestore.rules` refuses every call here without a program grant on the
 * camp's ministry, exactly as `./data.ts` and `../data.ts` are refused, so this
 * module is only ever reached from behind `useCampAdmin`.
 *
 * Two things here are different from every other write on the camp screens, and
 * both are because of who is holding the device.
 */

/** What a subscriber is handed. `null` means the day has not been opened yet. */
export interface AttendanceSnapshot {
  day: CampAttendanceDay | null;
  /** True while a tick of ours is still in flight. Drawn as a quiet dot. */
  pending: boolean;
}

/**
 * Listen to one day's register.
 *
 * ---------------------------------------------------------------------------
 * A live listener rather than a read, and it is the whole reason the register
 * works at a gate.
 *
 * Two servants take the morning: one at the door with a phone, one in the hall
 * with a tablet. A `getDoc` would give each of them a picture of the register
 * as it was when they arrived, and the hall would spend twenty minutes calling
 * names that were ticked at the door. `onSnapshot` means the second tick lands
 * on both screens in about a second, and the afternoon's "who is still here"
 * is one list rather than two that have to be compared.
 *
 * `serverTimestamps: 'estimate'` is not a nicety. Every `at` is written as
 * `serverTimestamp()`, which is a sentinel until the server acknowledges it —
 * the default read of a pending write hands back `null`, so a child would be
 * ticked in and show no time for as long as the round trip takes, which on a
 * phone at the edge of the parish wifi is not always quick. The estimate is the
 * local clock standing in for a value that is about to arrive, and the moment
 * it does the listener fires again with the real one.
 * ---------------------------------------------------------------------------
 */
export function subscribeAttendance(
  programId: string,
  season: string,
  day: CampDayKey,
  onChange: (snapshot: AttendanceSnapshot) => void,
  onError: (error: Error) => void,
): () => void {
  const ref = doc(db(), COLLECTIONS.campAttendance, attendanceDocId(programId, season, day));

  return onSnapshot(
    ref,
    (snapshot) => {
      const data = snapshot.data({ serverTimestamps: 'estimate' });
      onChange({
        day: data ? parseCampAttendanceDay(data) : null,
        pending: snapshot.metadata.hasPendingWrites,
      });
    },
    (cause) => onError(cause),
  );
}

/**
 * Tick one child in, or out, or take a tick back.
 *
 * ---------------------------------------------------------------------------
 * A merging `setDoc` of one nested field, and every other camp write is the
 * opposite — `writeRegistration` and `writeAllocation` both read the document
 * back and replace it whole, because removing a child or a payment line is only
 * expressible as a replacement.
 *
 * This one must not. A register is written by several people in the same five
 * minutes, and a replacing write is a read-modify-write: the tablet that read
 * the day at 8:59 and writes at 9:04 would put back a register missing every
 * tick the door made in between, silently, with no conflict to report. Merging
 * one field path per tap makes that impossible — Firestore merges them
 * server-side and neither device needs to know the other exists.
 *
 * The key is a `registrationId/childId` string, which is a legal Firestore
 * *field name* even with the slash in it. It is passed as an object key and
 * never as a dotted path, because the SDK builds the merge mask out of the
 * object's own structure; `updateDoc` with a template-literal path would try to
 * parse the slash and is the one way to get this wrong.
 *
 * ## Undo writes null rather than deleting
 *
 * A mistap has to be undoable — a servant taps the row below the one they
 * meant, and the child is marked as having gone home. Writing `null` back
 * clears the mark, and `parseCampAttendanceDay` drops an entry whose marks are
 * both null on read, so an undone tick leaves no trace in the register while
 * `updatedBy` and `updatedAt` still record that somebody touched the day. A
 * `deleteField()` would do the same and reads worse at the call site for no
 * gain: the entry is one small map either way.
 * ---------------------------------------------------------------------------
 */
export async function markAttendance(params: {
  programId: string;
  season: string;
  day: CampDayKey;
  key: CampPersonKey;
  which: 'arrived' | 'collected';
  /** False takes the tick back. */
  on: boolean;
  uid: string | null;
  /** Whether the day's document is known to exist, from the live snapshot.
      Wrong in either direction costs nothing: `createdAt` is set on a document
      that has one already, or the first tick of the day writes without one. */
  exists: boolean;
}): Promise<void> {
  const { programId, season, day, key, which, on, uid, exists } = params;
  const ref = doc(db(), COLLECTIONS.campAttendance, attendanceDocId(programId, season, day));

  await setDoc(
    ref,
    {
      // Sent on every tick, not only the first. They are what the rules read to
      // decide the write — `adminsProgram(request.resource.data.programId)` on
      // a create — and a merge that omitted them on the day's first tap would
      // be refused rather than defaulted.
      programId,
      season,
      day,
      entries: {
        [key]: {
          [which]: on ? { at: serverTimestamp(), by: uid } : null,
        },
      },
      ...(exists ? {} : { createdAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
      // The rule requires this to equal the caller's uid, so every tick — and
      // every untick — is attributable to whoever was holding the phone.
      updatedBy: uid,
    },
    { merge: true },
  );
}
