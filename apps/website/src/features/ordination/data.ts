'use client';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
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
  PARISH_TIME_ZONE,
  ordinationAccepting,
  parseOrdination,
  parseOrdinationApplication,
  todayIn,
  parseOrdinationSignatureProfile,
  toDate,
  type Ordination,
  type OrdinationApplication,
  type OrdinationReview,
  type OrdinationSignature,
  type OrdinationSignatureProfile,
  type OrdinationStatus,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Firestore for the ordination screens, and nothing else's.
 *
 * Every read here except `watchOpenOrdinations` is refused by firestore.rules
 * without the `ordination` screen, so these are only called from behind
 * `OrdinationShell`'s guard. The guard decides what to draw; the rules decide
 * what arrives.
 */

export type WithId<T> = T & { id: string };

/** The church name the cover page prints when an ordination is created. */
export const DEFAULT_CHURCH_NAME = 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church';

/** Soonest first, so the next ordination is the top of the list. */
function byDate(a: WithId<Ordination>, b: WithId<Ordination>): number {
  return a.date.localeCompare(b.date);
}

/**
 * The ordinations the public form offers: open, and not past their last day to
 * apply. The day is checked on each snapshot, so a tab left open overnight
 * drops one on the next change rather than at midnight; the Function refuses
 * a late nomination either way.
 */
export function watchOpenOrdinations(
  onChange: (rows: WithId<Ordination>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db(), COLLECTIONS.ordinations), where('open', '==', true)),
    (snapshot) =>
      onChange(
        snapshot.docs
          .map((entry) => ({ id: entry.id, ...parseOrdination(entry.data()) }))
          .filter((row) => ordinationAccepting(row, todayIn(PARISH_TIME_ZONE)))
          .sort(byDate),
      ),
    (cause) => onError(cause),
  );
}

export function watchOrdinations(
  onChange: (rows: WithId<Ordination>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(db(), COLLECTIONS.ordinations),
    (snapshot) =>
      onChange(
        snapshot.docs.map((entry) => ({ id: entry.id, ...parseOrdination(entry.data()) })).sort(byDate),
      ),
    (cause) => onError(cause),
  );
}

export function watchOrdination(
  id: string,
  onChange: (row: WithId<Ordination> | null) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    doc(db(), COLLECTIONS.ordinations, id),
    (snapshot) => onChange(snapshot.exists() ? { id, ...parseOrdination(snapshot.data()) } : null),
    (cause) => onError(cause),
  );
}

export async function createOrdination(
  input: Pick<Ordination, 'date' | 'closesOn' | 'churchName' | 'churchAddress'>,
  uid: string,
): Promise<string> {
  const written = await addDoc(collection(db(), COLLECTIONS.ordinations), {
    ...input,
    open: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  return written.id;
}

export async function updateOrdination(
  id: string,
  patch: Partial<Pick<Ordination, 'date' | 'open' | 'closesOn' | 'churchName' | 'churchAddress'>>,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.ordinations, id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function deleteOrdination(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.ordinations, id));
}

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

function timeOf(value: unknown): number {
  return toDate(value as Parameters<typeof toDate>[0])?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

/** Every application for one ordination, oldest first — the order they arrived in. */
export function watchApplications(
  ordinationId: string,
  onChange: (rows: WithId<OrdinationApplication>[]) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    query(
      collection(db(), COLLECTIONS.ordinationApplications),
      where('ordinationId', '==', ordinationId),
    ),
    (snapshot) => {
      const rows = snapshot.docs.map((entry) => ({
        id: entry.id,
        ...parseOrdinationApplication(entry.data({ serverTimestamps: 'estimate' })),
      }));
      rows.sort((a, b) => timeOf(a.submittedAt) - timeOf(b.submittedAt));
      onChange(rows);
    },
    (cause) => onError(cause),
  );
}

/**
 * Writes an admin's decision. The rules allow these four fields and refuse a
 * write that touches the nominee's own details.
 */
/** Every nomination for one ordination, read once (for printing). */
export async function readApplications(ordinationId: string): Promise<WithId<OrdinationApplication>[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.ordinationApplications), where('ordinationId', '==', ordinationId)),
  );
  return snapshot.docs.map((entry) => ({ id: entry.id, ...parseOrdinationApplication(entry.data()) }));
}

export async function saveReview(
  id: string,
  input: {
    status: OrdinationStatus;
    review: OrdinationReview | null;
    signatures: OrdinationSignature[];
  },
  uid: string,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.ordinationApplications, id), {
    status: input.status,
    review: input.review,
    signatures: input.signatures,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function deleteApplication(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.ordinationApplications, id));
}

/* -------------------------------------------------------------------------- */
/* Signatures                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every signature on file, so whoever prepares a nomination can put any of
 * them on it. The rules let anybody with the screen read them all.
 */
export async function listSignatureProfiles(): Promise<WithId<OrdinationSignatureProfile>[]> {
  const snapshot = await getDocs(collection(db(), COLLECTIONS.ordinationSignatures));
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...parseOrdinationSignatureProfile(entry.data(), entry.id) }))
    .filter((profile) => profile.image)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Adds a new signature owned by `uid`, or replaces one of theirs when `id` is given. */
export async function saveSignatureProfile(
  uid: string,
  input: Pick<OrdinationSignatureProfile, 'name' | 'role' | 'image'>,
  id?: string,
): Promise<string> {
  const ref = id ? doc(db(), COLLECTIONS.ordinationSignatures, id) : doc(collection(db(), COLLECTIONS.ordinationSignatures));
  await setDoc(ref, {
    name: input.name,
    role: input.role,
    image: input.image,
    ownerUid: uid,
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteSignatureProfile(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTIONS.ordinationSignatures, id));
}

/** How many applications each ordination has, by status — the counts on the list. */
export function watchApplicationCounts(
  onChange: (counts: Map<string, Record<OrdinationStatus, number>>) => void,
  onError: (error: Error) => void,
): () => void {
  return onSnapshot(
    collection(db(), COLLECTIONS.ordinationApplications),
    (snapshot) => {
      const counts = new Map<string, Record<OrdinationStatus, number>>();
      for (const entry of snapshot.docs) {
        const row = parseOrdinationApplication(entry.data());
        const tally = counts.get(row.ordinationId) ?? { pending: 0, approved: 0, rejected: 0 };
        tally[row.status] += 1;
        counts.set(row.ordinationId, tally);
      }
      onChange(counts);
    },
    (cause) => onError(cause),
  );
}
