/**
 * Date formatting for a static site.
 *
 * Every formatter here takes an explicit time zone. That is not pedantry: this
 * HTML is generated on a build machine that is very likely UTC, and a liturgy
 * at 9:00am Sunday rendered in UTC reads as 1:00pm — or lands on the wrong day
 * for anything in the evening. `Event.timeZone` exists for exactly this, and
 * the default below is the parish's own zone rather than the host's.
 */
import { toDate, type Timestamped } from '@spsm/shared';

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

/** Machine-readable, for <time dateTime>. */
export function isoOf(value: Timestamped | null | undefined): string | undefined {
  return toDate(value)?.toISOString();
}
