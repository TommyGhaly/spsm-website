import { describe, expect, it } from 'vitest';
import {
  MAX_DRIVERS,
  TAKSIS_CHURCH_ID,
  TAKSIS_COLORS,
  normalizeTaksisPlate,
  toTaksisRecord,
  validateVehicleRegistration,
  type VehicleRegistrationInput,
} from '@spsm/shared';

/**
 * The record we hand to another organisation's database.
 *
 * These assertions matter more than most, because of how the integration fails.
 * The service account is scoped create-only, so we cannot read back what we
 * wrote: a misspelled field name produces a document Taksis silently ignores,
 * and nothing on our side ever reports it. Nobody finds out until a parishioner
 * who registered is not recognised at the lot.
 *
 * So the point of this file is to pin the field names, the church string, and
 * the colour values exactly as Taksis expects them. If one of these tests starts
 * failing because somebody "tidied" a name, the tidying is the bug.
 */

const base = (over: Partial<VehicleRegistrationInput> = {}): VehicleRegistrationInput => ({
  plate: '1ABC23',
  make: '',
  model: '',
  color: '',
  drivers: [{ name: 'Mina Bishoy', phone: '5085550134', has_taksis: false }],
  ...over,
});

describe('the record Taksis receives', () => {
  it('uses Taksis’s field names, not ours', () => {
    const record = toTaksisRecord(base());

    // `license`, not `plate`. `has_taksis`, not `hasTaksis`. Theirs, not ours.
    expect(Object.keys(record).sort()).toEqual(
      ['church', 'drivers', 'license', 'present', 'status'].sort(),
    );
    expect(record.drivers[0]).toEqual({
      name: 'Mina Bishoy',
      phone: '5085550134',
      has_taksis: false,
    });
  });

  it('sends the parish name exactly as Taksis spells it', () => {
    // Deliberately not the name used elsewhere in this repo. A record that does
    // not match this string belongs to no church in their system.
    expect(TAKSIS_CHURCH_ID).toBe('St. Philopater and St. Mina, Wayland, MA');
    expect(toTaksisRecord(base()).church).toBe(TAKSIS_CHURCH_ID);
  });

  it('always starts pending and not present', () => {
    const record = toTaksisRecord(base());
    expect(record.status).toBe('pending');
    expect(record.present).toBe(false);
  });

  it('omits optional fields rather than sending empty strings', () => {
    const record = toTaksisRecord(base({ make: '', model: '  ', color: '' }));
    expect('make' in record).toBe(false);
    expect('model' in record).toBe(false);
    expect('color' in record).toBe(false);

    const filled = toTaksisRecord(base({ make: ' Toyota ', model: 'Camry' }));
    expect(filled.make).toBe('Toyota');
    expect(filled.model).toBe('Camry');
  });

  it('sends a colour only when it is one Taksis knows', () => {
    expect(toTaksisRecord(base({ color: 'blue' })).color).toBe('blue');
    // Free text would be a colour their system cannot match on.
    expect('color' in toTaksisRecord(base({ color: 'dark blue' }))).toBe(false);
  });

  it('offers exactly the twelve colours Taksis defines', () => {
    expect(TAKSIS_COLORS.map((c) => c.value)).toEqual([
      'white', 'black', 'silver', 'gray', 'red', 'blue',
      'green', 'brown', 'beige', 'orange', 'yellow', 'gold',
    ]);
  });

  it('uppercases the plate but keeps its punctuation', () => {
    // Deliberately unlike `normalizePlate` in schema/vehicles.ts, which strips
    // spaces and dashes for our own exact-match lookup. Taksis matches against
    // plates read by a camera; re-punctuating somebody's plate is not ours to do.
    expect(normalizeTaksisPlate('  nh-abc1234 ')).toBe('NH-ABC1234');
  });

  it('drops unnamed drivers and caps the list', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `Driver ${i}`,
      phone: '5085550134',
      has_taksis: false,
    }));
    expect(toTaksisRecord(base({ drivers: many })).drivers).toHaveLength(MAX_DRIVERS);

    const withBlank = [
      { name: 'Mina Bishoy', phone: '1', has_taksis: false },
      { name: '   ', phone: '', has_taksis: false },
    ];
    expect(toTaksisRecord(base({ drivers: withBlank })).drivers).toHaveLength(1);
  });
});

describe('validation before the push', () => {
  it('accepts a plain registration', () => {
    expect(validateVehicleRegistration(base())).toEqual([]);
  });

  it('requires a first and last name for the main driver only', () => {
    const oneName = validateVehicleRegistration(
      base({ drivers: [{ name: 'Mina', phone: '5085550134', has_taksis: false }] }),
    );
    expect(oneName).toHaveLength(1);
    expect(oneName[0]).toContain('first and last');

    // A second driver is optional and is not held to the same rule.
    expect(
      validateVehicleRegistration(
        base({
          drivers: [
            { name: 'Mina Bishoy', phone: '5085550134', has_taksis: false },
            { name: 'Sara', phone: '5085550135', has_taksis: false },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('objects to a later driver nobody can ring', () => {
    const errors = validateVehicleRegistration(
      base({
        drivers: [
          { name: 'Mina Bishoy', phone: '5085550134', has_taksis: false },
          { name: 'Sara Youssef', phone: '', has_taksis: false },
        ],
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('driver 2');
  });

  it('rejects a missing or implausible plate', () => {
    expect(validateVehicleRegistration(base({ plate: '' }))).not.toEqual([]);
    expect(validateVehicleRegistration(base({ plate: 'A'.repeat(13) }))).not.toEqual([]);
  });

  it('rejects a colour outside the list', () => {
    const errors = validateVehicleRegistration(base({ color: 'chartreuse' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('colour');
  });
});
