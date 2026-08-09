import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { COLLECTIONS, normalizePlate, type VehicleInput } from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Register a vehicle. Runs in the browser, not at build time.
 *
 * This is the one collection the public can write to without an account —
 * guests park at the festival too, and requiring a sign-up to register a plate
 * would mean nobody registers. `firestore.rules` bounds that deliberately:
 * create-only, no read at all, and every field validated server-side.
 *
 * The rules are the real check. Everything validated here is validated again
 * there, because anything in this file can be skipped by anyone willing to open
 * a console.
 */
export async function registerVehicle(input: VehicleInput, ownerUid: string | null): Promise<string> {
  // Normalize before writing so staff lookup during an event is an exact match.
  // Without it, a plate written "ABC 123" never matches one read "ABC-123" off
  // a bumper — which is precisely when the lookup matters.
  const plate = normalizePlate(input.plate);

  const doc = await addDoc(collection(db(), COLLECTIONS.vehicles), {
    plate,
    plateState: input.plateState.toUpperCase(),
    make: input.make?.trim() || null,
    model: input.model?.trim() || null,
    color: input.color?.trim() || null,

    ownerUid,
    ownerName: input.ownerName.trim(),
    ownerPhone: input.ownerPhone?.trim() || null,
    ownerEmail: input.ownerEmail?.trim() || null,

    note: null,
    // Required by firestore.rules — a create with active:false is rejected, so
    // there is no way to slip an inactive record past the parking team.
    active: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: ownerUid,
  });

  return doc.id;
}
