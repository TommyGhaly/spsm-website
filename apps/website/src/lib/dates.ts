/**
 * Date formatting for a static site.
 *
 * Every formatter here takes an explicit time zone. That is not pedantry: this
 * HTML is generated on a build machine that is very likely UTC, and a liturgy
 * at 9:00am Sunday rendered in UTC reads as 1:00pm — or lands on the wrong day
 * for anything in the evening. `Event.timeZone` exists for exactly this, and
 * the default below is the parish's own zone rather than the host's.
 */
import { PARISH_TIME_ZONE, partOfDay, toDate, type Timestamped } from '@spsm/shared';

/*
 * Re-exported, not redeclared. It moved to `@spsm/shared` when the mobile app
 * became a second reader of the same calendar feed; the nine files here that
 * import it from this module keep working, and there is still only one value.
 */
export { PARISH_TIME_ZONE };

export function formatDate(value: Timestamped | null | undefined, timeZone = PARISH_TIME_ZONE): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  }).format(date);
}

export function formatTime(value: Timestamped | null | undefined, timeZone = PARISH_TIME_ZONE): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/** "Sunday, August 3, 2025 · 9:00 AM – 11:30 AM" */
export function formatEventWhen(
  startAt: Timestamped,
  endAt: Timestamped | null,
  allDay: boolean,
  timeZone = PARISH_TIME_ZONE,
): string {
  const start = toDate(startAt);
  if (!start) return '';

  const day = formatDate(startAt, timeZone);
  if (allDay) return day;

  const end = toDate(endAt);
  const startTime = formatTime(startAt, timeZone);
  if (!end) return `${day} · ${startTime}`;

  // A same-day range only needs the day printed once.
  const sameDay = formatDate(endAt, timeZone) === day;
  return sameDay
    ? `${day} · ${startTime} – ${formatTime(endAt, timeZone)}`
    : `${day}, ${startTime} – ${formatDate(endAt, timeZone)}, ${formatTime(endAt, timeZone)}`;
}

/**
 * A gathering's dates, as short as they can honestly be.
 *
 *   one day        "July 14, 2027"
 *   same month     "July 14–18, 2027"
 *   same year      "July 14 – August 2, 2027"
 *   otherwise      "December 28, 2027 – January 2, 2028"
 *
 * Separate from `formatEventWhen`, which is for a service: that one leads with
 * the weekday and prints clock times, both of which are right for "come to this
 * on Sunday" and wrong for "this camp ran for five days three years ago". Asked
 * to describe a five-day camp it names the first day only, and the fact that it
 * was five days — the thing somebody looking at an archive wants — disappears.
 *
 * The weekday is dropped for the same reason. Nobody needs to know which day of
 * the week a camp in 2024 started on.
 */
export function formatDateSpan(
  startAt: Timestamped | null | undefined,
  endAt: Timestamped | null | undefined,
  timeZone = PARISH_TIME_ZONE,
): string {
  const start = toDate(startAt);
  if (!start) return '';

  const parts = (date: Date) => ({
    month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone }).format(date),
    day: new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone }).format(date),
    year: new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(date),
  });

  const from = parts(start);
  const end = toDate(endAt);

  // No end date, or an end on the same day. A one-day gathering is the common
  // case for everything that is not a camp.
  if (!end) return `${from.month} ${from.day}, ${from.year}`;

  const to = parts(end);
  if (from.month === to.month && from.day === to.day && from.year === to.year) {
    return `${from.month} ${from.day}, ${from.year}`;
  }

  // An en dash, unspaced, for a range within one month — the typographic
  // convention, and it is what makes "July 14–18" read as one span rather than
  // as two dates that happen to be adjacent.
  if (from.month === to.month && from.year === to.year) {
    return `${from.month} ${from.day}\u2013${to.day}, ${from.year}`;
  }

  if (from.year === to.year) {
    return `${from.month} ${from.day} \u2013 ${to.month} ${to.day}, ${from.year}`;
  }

  return `${from.month} ${from.day}, ${from.year} \u2013 ${to.month} ${to.day}, ${to.year}`;
}

/**
 * "Morning" / "Afternoon" / "Evening" / "Night", in the parish's zone.
 *
 * For naming a past service, where a clock time is false precision — see
 * `partOfDay` in @spsm/shared.
 */
export function formatPartOfDay(
  value: Timestamped | null | undefined,
  timeZone = PARISH_TIME_ZONE,
): string {
  const date = toDate(value);
  return date ? partOfDay(date, timeZone) : '';
}

/** Machine-readable, for <time dateTime>. */
export function isoOf(value: Timestamped | null | undefined): string | undefined {
  return toDate(value)?.toISOString();
}

/* ---- civil dates, for the month grid ------------------------------------
 *
 * Everything below deals in `YYYY-MM-DD` strings rather than `Date` objects,
 * and that is the whole point. A calendar cell is a *civil date* — "August 17th
 * in Wayland" — not an instant. Keeping them as strings means none of the grid
 * arithmetic can pick up the build machine's time zone, which is the failure
 * this file exists to prevent.
 */

/** The civil date an instant falls on, in the given zone. `2026-08-17`. */
export function dayKey(
  value: Timestamped | null | undefined,
  timeZone = PARISH_TIME_ZONE,
): string | null {
  const date = toDate(value);
  if (!date) return null;
  // `en-CA` is the shortest way to get ISO-ordered parts out of Intl; the
  // alternative is picking `formatToParts` apart by hand for the same string.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * The inverse of `dayKey`: a civil date from a form back into a `Date`.
 *
 * `<input type="date">` hands over `"2026-07-22"` — a calendar day with no zone
 * attached — and the obvious `new Date(value)` parses that as **midnight UTC**,
 * which in the parish's zone is eight in the evening on the 21st. So the naive
 * version stores the day *before* the one somebody typed, for everybody west of
 * Greenwich, and reads back wrong the moment `dayKey` renders it again.
 *
 * Noon, therefore. It keeps the civil date intact for every offset from UTC-11 to
 * UTC+11 — which is not quite every zone on earth (Kiribati is UTC+14 and would
 * read the next day) but is every zone the parish's own dates are ever rendered
 * in, and it has seven hours of margin on the one that matters. The time of day is
 * not information here — these fields are a span of days on a camp — so there is
 * nothing lost by pinning it.
 *
 * The exception is stated rather than engineered away on purpose. Making this
 * exact for UTC+14 means resolving the *reader's* offset for the date being
 * written, which is a different and much larger problem — the reader is not known
 * at write time — for a case that cannot arise: `dayKey` is called with
 * `PARISH_TIME_ZONE` everywhere on the site.
 *
 * Here rather than beside the form because it is exactly `dayKey` backwards, and
 * a round trip that lives in two files is a round trip that will stop being one.
 * `tests/unit/dates.test.ts` asserts they compose.
 *
 * @returns null for an empty field, which is a real choice — "this has no fixed
 *   date" — and has to reach the document as null rather than being ignored.
 */
export function fromDayKey(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Every civil date from `from` to `to`, inclusive, so a three-day festival
 * appears in all three of its cells rather than only the one it starts in.
 *
 * The walk is done in UTC on purpose. These keys are already civil dates with
 * no zone attached, so `Date.UTC` is being used here as fixed-offset calendar
 * arithmetic — never as a moment in time. Doing the same walk with a local
 * `new Date(y, m, d)` would land on the host's zone and could drop or repeat a
 * day across a DST boundary.
 *
 * Capped at 366 iterations. A malformed pair — or an `endAt` a decade after its
 * `startAt` because someone typed the year wrong in the admin — should render a
 * wrong calendar, not hang the build in an unbounded loop.
 */
export function dayKeysBetween(from: string, to: string): string[] {
  const start = utcOf(from);
  const end = utcOf(to);
  if (start === null || end === null) return [];

  const keys: string[] = [];
  for (let cursor = start; cursor <= end && keys.length < 366; cursor += 86_400_000) {
    keys.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return keys;
}

/** `2026-08` → the days of that month, and which weekday it opens on (0 = Sunday). */
export function monthShape(monthKey: string): { days: number; firstWeekday: number } {
  const first = utcOf(`${monthKey}-01`);
  if (first === null) return { days: 0, firstWeekday: 0 };

  const date = new Date(first);
  return {
    // Day 0 of the next month is the last day of this one.
    days: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate(),
    firstWeekday: date.getUTCDay(),
  };
}

/** `2026-08` → `August 2026`. */
export function formatMonth(monthKey: string): string {
  const first = utcOf(`${monthKey}-01`);
  if (first === null) return monthKey;

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(first));
}

/**
 * `2026-08-17` → the UTC epoch millis of that civil date at midnight, or null
 * if the string is not one.
 *
 * Every caller above needs the same three numbers out of the same shape of
 * string, and each one of them doing its own `split('-').map(Number)` is three
 * places to forget that `Number('')` is `0` and `Number('xx')` is `NaN`. The
 * guard is here once instead.
 */
function utcOf(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(millis) ? null : millis;
}
