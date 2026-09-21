/**
 * How this parish writes a date, for every surface that writes one.
 *
 * These lived in `apps/website/src/lib/dates.ts` and were the website's alone
 * for as long as the website was the only thing that rendered an event. It is
 * not: the mobile app has an event page now, and the two print the same
 * sentence about the same document — so the sentence is defined once, here,
 * rather than copied and kept in step by hand.
 *
 * `lib/dates.ts` re-exports these, exactly as it already did for
 * `PARISH_TIME_ZONE`, so the eleven files over there that import from it are
 * untouched by the move.
 *
 * ## Every formatter takes an explicit zone, and that is not pedantry
 *
 * The website's HTML is generated on a build machine that is very likely UTC,
 * and a 9:00am Sunday liturgy rendered in UTC reads as 1:00pm — or lands on the
 * wrong day for anything in the evening. A phone is worse rather than better:
 * it carries whatever zone the person is standing in, so a parishioner reading
 * an event page on holiday in California would be told their church's feast
 * starts at 6:00 AM. `Event.timeZone` exists for exactly this, and the default
 * below is the parish's own zone rather than the host's.
 */
import { PARISH_TIME_ZONE } from './timezones.js';
import { toDate, type Timestamped } from './schema/common.js';

export function formatDate(
  value: Timestamped | null | undefined,
  timeZone = PARISH_TIME_ZONE,
): string {
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

export function formatTime(
  value: Timestamped | null | undefined,
  timeZone = PARISH_TIME_ZONE,
): string {
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
  startAt: Timestamped | null | undefined,
  endAt: Timestamped | null | undefined,
  allDay: boolean,
  timeZone = PARISH_TIME_ZONE,
): string {
  const start = toDate(startAt);
  if (!start) return '';

  const day = formatDate(start, timeZone);
  if (allDay) return day;

  const end = toDate(endAt);
  const startTime = formatTime(start, timeZone);
  if (!end) return `${day} · ${startTime}`;

  // A same-day range only needs the day printed once.
  const sameDay = formatDate(end, timeZone) === day;
  return sameDay
    ? `${day} · ${startTime} – ${formatTime(end, timeZone)}`
    : `${day}, ${startTime} – ${formatDate(end, timeZone)}, ${formatTime(end, timeZone)}`;
}
