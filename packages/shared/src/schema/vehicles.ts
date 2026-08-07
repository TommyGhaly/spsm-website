import type { AuditFields } from './common.js';

/**
 * Parking lot vehicle registration.
 *
 * Guests can register without an account (Open Decision resolved in §3.5:
 * name + contact only), so `ownerUid` is nullable and the rules allow an
 * unauthenticated create. That makes this collection write-open by design —
 * hence: create-only for the public, no public read, and rate limiting handled
 * in a Cloud Function rather than rules.
 */
export interface Vehicle extends AuditFields {
  /** Normalized via `normalizePlate` before write, so lookup is exact-match. */
  plate: string;
  /** Two-letter state code, uppercase. Plates are only unique within a state. */
  plateState: string;

  make: string | null;
  model: string | null;
  color: string | null;

  /** Set when a signed-in member registered it. Null for a guest. */
  ownerUid: string | null;
  /** Always present — for guests this is the only identifier we have. */
  ownerName: string;
  ownerPhone: string | null;
  ownerEmail: string | null;

  /** Free-text note from parking coordinators ("handicap placard", "shuttle"). */
  note: string | null;
  active: boolean;
}

export type VehicleInput = Pick<
  Vehicle,
  'plate' | 'plateState' | 'make' | 'model' | 'color' | 'ownerName' | 'ownerPhone' | 'ownerEmail'
>;

/**
 * Strip everything that varies between how a plate is written down and how it's
 * read off a bumper. Without this, staff lookup during a festival fails on a
 * space or a dash.
 */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function validateVehicle(input: VehicleInput): string[] {
  const errors: string[] = [];
  const plate = normalizePlate(input.plate ?? '');

  if (plate.length < 2) errors.push('Enter a license plate.');
  if (plate.length > 10) errors.push('That plate looks too long — please check it.');
  if (!/^[A-Z]{2}$/.test(input.plateState ?? '')) errors.push('Choose a state.');
  if (!input.ownerName?.trim()) errors.push('Enter the name of the vehicle owner.');
  if (!input.ownerPhone?.trim() && !input.ownerEmail?.trim()) {
    errors.push('Enter a phone number or an email so we can reach you.');
  }
  return errors;
}
