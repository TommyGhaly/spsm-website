import { describe, it, expect } from 'vitest';
import {
  normalizePlate,
  validateVehicle,
  validatePrayerRequest,
  PRAYER_BODY_MAX_LENGTH,
  type VehicleInput,
  type PrayerRequestInput,
} from '@spsm/shared';

/**
 * These validators are shared by the browser form and (eventually) the Function
 * that accepts the write, so the two cannot disagree about what counts as
 * valid. They are also the closest thing the repo has to business rules.
 */

function vehicle(overrides: Partial<VehicleInput> = {}): VehicleInput {
  return {
    plate: 'ABC1234',
    plateState: 'MA',
    make: null,
    model: null,
    color: null,
    ownerName: 'Mina Boutros',
    ownerPhone: '555-0100',
    ownerEmail: null,
    ...overrides,
  };
}

describe('normalizePlate', () => {
  it('strips everything that varies between how a plate is written and read', () => {
    // Staff lookup during a festival must not fail on a space or a dash.
    expect(normalizePlate('abc 1234')).toBe('ABC1234');
    expect(normalizePlate('ABC-1234')).toBe('ABC1234');
    expect(normalizePlate(' a-b c1 ')).toBe('ABC1');
  });

  it('is idempotent', () => {
    expect(normalizePlate(normalizePlate('abc 1234'))).toBe(normalizePlate('abc 1234'));
  });

  it('returns empty for a plate of pure punctuation', () => {
    expect(normalizePlate('---')).toBe('');
  });
});

describe('validateVehicle', () => {
  it('accepts a guest registration with a phone and no account', () => {
    expect(validateVehicle(vehicle())).toEqual([]);
  });

  it('accepts an email instead of a phone, but requires one of them', () => {
    expect(validateVehicle(vehicle({ ownerPhone: null, ownerEmail: 'a@b.org' }))).toEqual([]);
    expect(validateVehicle(vehicle({ ownerPhone: null, ownerEmail: null }))).toHaveLength(1);
    expect(validateVehicle(vehicle({ ownerPhone: '  ', ownerEmail: '  ' }))).toHaveLength(1);
  });

  it('measures plate length AFTER normalizing', () => {
    // "A-B" is 3 characters written down and 2 on the bumper. The rule is about
    // the bumper, and firestore.rules bounds the normalized value the same way.
    expect(validateVehicle(vehicle({ plate: 'A-B' }))).toEqual([]);
    expect(validateVehicle(vehicle({ plate: 'A-' }))).toHaveLength(1);
  });

  it('rejects a plate longer than the rules will accept', () => {
    // firestore.rules caps this at 10; the client must fail first with a
    // readable message rather than eating a permission-denied.
    expect(validateVehicle(vehicle({ plate: 'ABCDEFGHIJK' }))).toHaveLength(1);
    expect(validateVehicle(vehicle({ plate: 'ABCDEFGHIJ' }))).toEqual([]);
  });

  it('requires a two-letter uppercase state code', () => {
    expect(validateVehicle(vehicle({ plateState: 'Ma' }))).toHaveLength(1);
    expect(validateVehicle(vehicle({ plateState: 'MASS' }))).toHaveLength(1);
    expect(validateVehicle(vehicle({ plateState: '' }))).toHaveLength(1);
  });

  it('requires an owner name that is not just whitespace', () => {
    expect(validateVehicle(vehicle({ ownerName: '   ' }))).toHaveLength(1);
  });

  it('reports every problem at once rather than one at a time', () => {
    const errors = validateVehicle(
      vehicle({ plate: '', plateState: '', ownerName: '', ownerPhone: null, ownerEmail: null }),
    );
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

function prayer(overrides: Partial<PrayerRequestInput> = {}): PrayerRequestInput {
  return {
    body: 'Please pray for my mother.',
    visibility: 'public',
    anonymous: false,
    authorName: 'Mina',
    contactEmail: null,
    ...overrides,
  };
}

describe('validatePrayerRequest', () => {
  it('accepts a normal request', () => {
    expect(validatePrayerRequest(prayer())).toEqual([]);
  });

  it('rejects an empty or whitespace-only body', () => {
    expect(validatePrayerRequest(prayer({ body: '' }))).toHaveLength(1);
    expect(validatePrayerRequest(prayer({ body: '    ' }))).toHaveLength(1);
  });

  it('bounds the body at PRAYER_BODY_MAX_LENGTH', () => {
    expect(validatePrayerRequest(prayer({ body: 'x'.repeat(PRAYER_BODY_MAX_LENGTH) }))).toEqual([]);
    expect(
      validatePrayerRequest(prayer({ body: 'x'.repeat(PRAYER_BODY_MAX_LENGTH + 1) })),
    ).toHaveLength(1);
  });

  it('refuses an anonymous request that still carries a name', () => {
    // `anonymous: true` means the uid genuinely is not stored, so it cannot be
    // un-anonymized later. A name attached to it defeats the entire point.
    expect(validatePrayerRequest(prayer({ anonymous: true, authorName: 'Mina' }))).toHaveLength(1);
    expect(validatePrayerRequest(prayer({ anonymous: true, authorName: null }))).toEqual([]);
  });

  it('rejects a visibility outside the allowed set', () => {
    expect(
      validatePrayerRequest(prayer({ visibility: 'clergy-only' as unknown as 'clergy' })),
    ).toHaveLength(1);
    expect(validatePrayerRequest(prayer({ visibility: 'clergy' }))).toEqual([]);
  });
});
