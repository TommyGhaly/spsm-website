/**
 * Wall-clock time in a named zone, to and from an instant.
 *
 * `Event.startAt` is an instant and `Event.timeZone` is the IANA zone the parish
 * *meant*. Staff type "9:00 AM" into a form; nobody types an offset, and nobody
 * should have to think about whether September is EDT or EST. So the admin has
 * to convert between the two, in both directions, and get DST right — a liturgy
 * entered in October and displayed in November is exactly where an hour goes
 * missing.
 *
 * `Intl.DateTimeFormat` already knows every zone rule, so there is no need for
 * a date library. It only formats, though — it will not parse — hence the
 * fixed-point trick in `wallClockToInstant`.
 *
 * Deliberately dependency-free and SDK-free: the mobile app needs the same
 * conversion, and `@spsm/shared` must stay importable from React Native.
 */

/** Zones a parish in Massachusetts plausibly needs. Not the full IANA list. */
export const COMMON_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Africa/Cairo',
  'UTC',
] as const;

/**
 * How far ahead of UTC `timeZone` was at `instant`, in milliseconds.
 * `America/New_York` in July is -4h, so this returns -14_400_000.
 */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');

  // `hour` comes back as 24 rather than 0 at midnight under hour12:false.
  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour') % 24,
    at('minute'),
    at('second'),
  );

  return asIfUtc - instant.getTime();
}

/**
 * `"2026-09-01T16:00"` in `America/New_York` -> the instant it names.
 *
 * The input is what an `<input type="datetime-local">` produces: a wall-clock
 * reading with no zone attached.
 *
 * Two passes, not one. The offset depends on the instant, and the instant is
 * what we are solving for — so the first pass guesses using the offset at the
 * naive time and the second corrects it. That second pass is what makes the
 * hour after a DST transition come out right; with one pass, an event entered
 * for 1:30am on a fall-back night lands an hour off.
 *
 * Returns null for input it cannot read, rather than an Invalid Date that
 * propagates silently into Firestore.
 */
export function wallClockToInstant(wallClock: string, timeZone: string): Date | null {
  // Accept "YYYY-MM-DDTHH:MM" and "YYYY-MM-DDTHH:MM:SS".
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(wallClock)) return null;

  const naive = Date.parse(`${wallClock}${wallClock.length === 16 ? ':00' : ''}Z`);
  if (Number.isNaN(naive)) return null;

  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    guess = naive - offsetAt(new Date(guess), timeZone);
  }
  return new Date(guess);
}

/**
 * The inverse: an instant -> `"YYYY-MM-DDTHH:MM"` as read in `timeZone`, ready
 * to hand back to a `datetime-local` input for editing.
 */
export function instantToWallClock(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);

  const at = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = String(Number(at('hour')) % 24).padStart(2, '0');

  return `${at('year')}-${at('month')}-${at('day')}T${hour}:${at('minute')}`;
}

/**
 * "EDT" / "EST" — for showing staff which offset their entry actually landed
 * in, so a DST mistake is visible at the moment they make it rather than on the
 * morning of the event.
 */
export function zoneAbbreviation(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(instant);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}
