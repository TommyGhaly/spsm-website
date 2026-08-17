/**
 * Date formatting for a static site.
 *
 * Every formatter here takes an explicit time zone. That is not pedantry: this
 * HTML is generated on a build machine that is very likely UTC, and a liturgy
 * at 9:00am Sunday rendered in UTC reads as 1:00pm — or lands on the wrong day
 * for anything in the evening. `Event.timeZone` exists for exactly this, and
 * the default below is the parish's own zone rather than the host's.
 */
import { partOfDay, toDate, type Timestamped } from '@spsm/shared';

export const PARISH_TIME_ZONE = 'America/New_York';

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
