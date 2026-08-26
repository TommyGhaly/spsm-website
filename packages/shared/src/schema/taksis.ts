/**
 * The record Taksis expects, and the only place its shape is written down.
 *
 * ---------------------------------------------------------------------------
 * This unblocks the thing three files still describe as blocked.
 *
 * `docs/integrations.md`, `README.md` and `docs/decisions.md` all say the Taksis
 * push is waiting on "the shape of one `pending_registrations` record", and they
 * were right to refuse to guess: a create-only identity cannot read, so a wrong
 * field name produces a document Taksis silently ignores and nothing anywhere
 * reports an error. Update those three when this ships.
 *
 * The shape below is not inferred. It is taken from a working standalone form
 * that has been writing these records directly through the Firestore REST API,
 * which settles every open question at once:
 *
 *   - The backend is **Firestore**, not Realtime Database. `TAKSIS_BACKEND` was
 *     already set to `firestore`; this confirms it rather than assuming it.
 *   - The collection is top-level `pending_registrations`.
 *   - `church` is a **display string**, not an id — the parish's full name,
 *     spelled the way Taksis spells it. `CHURCH_ID` below is that literal.
 *   - There is **no state field**. Our own `vehicles` collection has
 *     `plateState` and Taksis has nowhere to put it.
 *   - `color` must be one of twelve values Taksis calls `COLOR_OPTIONS`. Free
 *     text does not match, so the form offers the twelve and nothing else.
 * ---------------------------------------------------------------------------
 */

/**
 * The parish, as Taksis names it.
 *
 * Note this is *not* the name used elsewhere in this repo — the parish is
 * "St. Philopater Mercurius & St. Mina" in our own copy. Taksis stores it with
 * "and" spelled out and the town appended, and a record that does not match this
 * string exactly is a record that belongs to no church in their system.
 * Do not tidy it.
 */
export const TAKSIS_CHURCH_ID = 'St. Philopater and St. Mina, Wayland, MA';

export interface TaksisColorOption {
  label: string;
  value: string;
  /** For the swatch on our side. Taksis stores only `value`. */
  hex: string;
}

/** Taksis's `COLOR_OPTIONS`, in its order. Anything else will not match. */
export const TAKSIS_COLORS: readonly TaksisColorOption[] = [
  { label: 'White', value: 'white', hex: '#FFFFFF' },
  { label: 'Black', value: 'black', hex: '#1a1a1a' },
  { label: 'Silver', value: 'silver', hex: '#C0C0C0' },
  { label: 'Gray', value: 'gray', hex: '#808080' },
  { label: 'Red', value: 'red', hex: '#D32F2F' },
  { label: 'Blue', value: 'blue', hex: '#1976D2' },
  { label: 'Green', value: 'green', hex: '#388E3C' },
  { label: 'Brown', value: 'brown', hex: '#795548' },
  { label: 'Beige', value: 'beige', hex: '#D4C5A9' },
  { label: 'Orange', value: 'orange', hex: '#F57C00' },
  { label: 'Yellow', value: 'yellow', hex: '#FBC02D' },
  { label: 'Gold', value: 'gold', hex: '#FFD700' },
] as const;

const COLOR_VALUES = new Set(TAKSIS_COLORS.map((color) => color.value));

/** Most vehicles have one driver; the original form capped the list at five. */
export const MAX_DRIVERS = 5;

export interface TaksisDriver {
  name: string;
  phone: string;
  /** Whether this driver already has the Taksis app. Optional to the person filling it in. */
  has_taksis: boolean;
}

/**
 * A pending registration, in Taksis's own field names.
 *
 * snake_case on `has_taksis` and the bare `license` rather than `plate` are
 * theirs, not ours. This interface deliberately mirrors their spelling instead
 * of translating it, so the mapping happens once, here, where it is visible.
 */
export interface TaksisPendingRegistration {
  church: string;
  license: string;
  drivers: TaksisDriver[];
  /** Whether the car is in the lot right now. Always false on a new registration. */
  present: boolean;
  status: 'pending';
  make?: string;
  model?: string;
  color?: string;
}

export interface VehicleRegistrationInput {
  plate: string;
  make: string;
  model: string;
  /** One of `TAKSIS_COLORS`, or empty. */
  color: string;
  drivers: TaksisDriver[];
}

/**
 * Plates go up, and lose nothing else.
 *
 * Deliberately *not* `normalizePlate` from `./vehicles.ts`, which strips spaces
 * and dashes so our own lookup is exact-match. Taksis stores what it is given
 * and matches it against plates read by a camera at the lot; re-punctuating
 * somebody's plate on the way in would be us changing their data to suit a
 * lookup that is not ours to optimise.
 */
export function normalizeTaksisPlate(plate: string): string {
  return plate.trim().toUpperCase();
}

/**
 * A person's name is first *and* last.
 *
 * Only enforced on the first driver, matching the original form: the lead driver
 * is who the parking team calls, and "Mina" alone identifies a good number of
 * people here. Later drivers are optional entirely, so a half-filled one is
 * dropped rather than rejected.
 */
function hasTwoNames(name: string): boolean {
  return name.trim().split(/\s+/).length >= 2;
}

export function validateVehicleRegistration(input: VehicleRegistrationInput): string[] {
  const errors: string[] = [];

  const plate = normalizeTaksisPlate(input.plate ?? '');
  if (plate.length < 2) errors.push('Enter a license plate.');
  if (plate.length > 12) errors.push('That plate looks too long — please check it.');

  if (input.color && !COLOR_VALUES.has(input.color)) {
    errors.push('Choose a colour from the list.');
  }

  const drivers = input.drivers ?? [];
  const first = drivers[0];
  if (!first?.name?.trim()) {
    errors.push('Enter the name of the main driver.');
  } else if (!hasTwoNames(first.name)) {
    errors.push('Enter the main driver’s first and last name.');
  }
  if (!first?.phone?.trim()) {
    errors.push('Enter a phone number for the main driver.');
  }

  if (drivers.length > MAX_DRIVERS) {
    errors.push(`Up to ${MAX_DRIVERS} drivers can be listed.`);
  }

  // A later driver with a name but no phone is a driver the parking team cannot
  // reach — worth saying, rather than dropping quietly at build time below.
  drivers.slice(1).forEach((driver, index) => {
    if (driver.name?.trim() && !driver.phone?.trim()) {
      errors.push(`Enter a phone number for driver ${index + 2}, or clear their name.`);
    }
  });

  return errors;
}

/**
 * Our form's answers, in Taksis's shape.
 *
 * Optional fields are *omitted* rather than sent as empty strings. The original
 * form did the same, and it matters more than it looks: a create-only identity
 * cannot read back what it wrote, so an empty `make` that Taksis renders as a
 * blank line in their admin is a defect nobody on our side can ever see.
 */
export function toTaksisRecord(input: VehicleRegistrationInput): TaksisPendingRegistration {
  const drivers = (input.drivers ?? [])
    .filter((driver) => driver.name?.trim())
    .slice(0, MAX_DRIVERS)
    .map((driver) => ({
      name: driver.name.trim(),
      phone: (driver.phone ?? '').trim(),
      has_taksis: driver.has_taksis === true,
    }));

  const record: TaksisPendingRegistration = {
    church: TAKSIS_CHURCH_ID,
    license: normalizeTaksisPlate(input.plate),
    drivers,
    present: false,
    status: 'pending',
  };

  const make = (input.make ?? '').trim();
  const model = (input.model ?? '').trim();
  const color = (input.color ?? '').trim();
  if (make) record.make = make;
  if (model) record.model = model;
  if (color && COLOR_VALUES.has(color)) record.color = color;

  return record;
}
