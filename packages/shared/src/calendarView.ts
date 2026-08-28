/**
 * Which days a calendar view is showing.
 *
 * ---------------------------------------------------------------------------
 * In @spsm/shared rather than beside the website's calendar, for two reasons.
 *
 * It is **testable** here. `tests/unit` runs pure functions from this package
 * and nothing else — no path aliases into the app — so a copy of this living in
 * `features/calendar/` could not be tested at all, and the month stepper is
 * exactly the kind of arithmetic that needs to be: stepping "one month" by
 * adding days walks January 31st to March 3rd, and nothing about the symptom
 * points at the cause.
 *
 * It is also **needed twice**. The parish app is part two of the programme and
 * renders the same schedule; this is dependency-free and SDK-free, like
 * `timezones.ts`, so React Native can import it unchanged.
 * ---------------------------------------------------------------------------
 *
 * All of it is arithmetic over `YYYY-MM-DD` strings, for the reason
 * `schema/calendar.ts` sets out at length: a calendar cell is a civil date, not
 * an instant, and the moment one becomes a `Date` the host's zone gets a vote in
 * which day it is.
 *
 * The one place an actual clock is read is `todayIn`, which takes the zone as an
 * argument and is called from a browser, never from a build.
 */
import { addDays, daysBetween } from './schema/calendar.js';

/**
 * Today, as read in a named zone.
 *
 * Not memoised, and deliberately: a tab left open across midnight should get
 * the new day the next time anything asks. The cost is one `Intl` format.
 *
 * `en-CA` is the shortest way to get ISO-ordered parts out of `Intl`; the
 * alternative is picking `formatToParts` apart by hand for the same string.
 * Same trick, and the same reason, as `dayKey` in lib/dates.ts.
 */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date());
}

export type CalendarView = 'week' | 'month';

/** A half-open-free, inclusive span of civil days, plus what to call it. */
export interface ViewRange {
  /** First day shown, `YYYY-MM-DD`. */
  from: string;
  /** Last day shown, inclusive. */
  to: string;
  /** The days in order — 7 for a week, 28–42 for a month grid. */
  days: string[];
  /** "August 24–30, 2026" or "August 2026". */
  label: string;
}

/**
 * Weeks run Monday to Sunday.
 *
 * ---------------------------------------------------------------------------
 * This was Sunday-first, and the note here argued for it: the Liturgy is on
 * Sunday morning, so the week opens on its anchor rather than on its emptiest
 * day. Tommy asked for Monday, and there is a better reason for it than the one
 * that was here.
 *
 * **The parish's own week already runs Monday to Sunday.** The weekly bulletin
 * — the sheet the office publishes and the thing this calendar now merges — is
 * built that way: `weekOf` is a Monday, `days[0]` is Monday, and the week of
 * 2026-08-24 runs to Sunday the 30th. With a Sunday-first grid the bulletin's
 * week straddled two of ours, so "this week" on the site and "this week" on the
 * sheet were never the same seven days.
 *
 * The Liturgy now closes the week instead of opening it, which is also how the
 * bulletin reads.
 * ---------------------------------------------------------------------------
 */
const WEEK_STARTS_ON = 1;

/** `2026-08-26` → `2026-08-23`, the Sunday of that week. */
export function startOfWeek(day: string): string {
  return addDays(day, -weekdayOf(day));
}

/**
 * Which weekday a civil date falls on, 0 = Sunday.
 *
 * `Date.UTC` used as fixed-offset calendar arithmetic — never as a moment. The
 * same trick, and the same warning, as `monthShape` in lib/dates.ts.
 */
export function weekdayOf(day: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return 0;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (at.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
}

/** `2026-08` → how many days it has, and which weekday it opens on. */
function monthShape(monthKey: string): { days: number; firstWeekday: number } {
  const first = `${monthKey}-01`;
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return { days: 30, firstWeekday: 0 };
  const days = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate();
  return { days, firstWeekday: weekdayOf(first) };
}

/**
 * The week containing `anchor`.
 *
 * Seven days, Sunday first, whether or not anything is on. Unlike the month
 * view — where a month with no events is not rendered at all — an empty
 * Wednesday has to keep its place, because the reader is checking *whether*
 * anything is on that day and a missing row answers a different question.
 */
export function weekRange(anchor: string): ViewRange {
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  return { from, to, days: daysBetween(from, to), label: spanLabel(from, to) };
}

/**
 * The month containing `anchor`, padded out to whole weeks.
 *
 * The padding is what makes the grid a grid: a month starting on a Wednesday
 * needs three cells of the previous month to fill its first row. Those days are
 * *shown*, so they have to be *fetched* — otherwise the last three days of July
 * render as reliably empty in the August grid, which is a lie the reader has no
 * way to detect.
 */
export function monthRange(anchor: string): ViewRange {
  const monthKey = anchor.slice(0, 7);
  const { days, firstWeekday } = monthShape(monthKey);

  const from = addDays(`${monthKey}-01`, -firstWeekday);
  // Round the total up to whole weeks: 6 rows for a 31-day month starting on a
  // Friday, 5 for most, and never a ragged final row.
  const cells = Math.ceil((firstWeekday + days) / 7) * 7;
  const to = addDays(from, cells - 1);

  return { from, to, days: daysBetween(from, to), label: monthLabel(monthKey) };
}

export function rangeFor(view: CalendarView, anchor: string): ViewRange {
  return view === 'week' ? weekRange(anchor) : monthRange(anchor);
}

/** One view forward or back: the next week, or the next month. */
export function step(view: CalendarView, anchor: string, delta: number): string {
  if (view === 'week') return addDays(anchor, 7 * delta);

  /*
   * Months are stepped from the *first* of the month, not from the anchor.
   *
   * Stepping "one month" by adding days cannot work — months are not all the
   * same length — and stepping from the 31st lands on a month that has no 31st.
   * The classic version of this bug walks January 31st → March 3rd. Pinning to
   * the first makes every step exact.
   */
  const match = /^(\d{4})-(\d{2})/.exec(anchor);
  if (!match) return anchor;
  const month = Number(match[2]) - 1 + delta;
  const year = Number(match[1]) + Math.floor(month / 12);
  const wrapped = ((month % 12) + 12) % 12;
  return `${year}-${String(wrapped + 1).padStart(2, '0')}-01`;
}

/* ---- labels -------------------------------------------------------------
 *
 * Formatted with `timeZone: 'UTC'` throughout, which looks wrong and is right:
 * the input is a civil date string that was turned into midnight UTC purely so
 * `Intl` would render its parts. Asking for it back in the parish's zone would
 * shift it to 8pm the previous evening and print the day before.
 */

/** `2026-08` → `August 2026`. */
export function monthLabel(monthKey: string): string {
  const at = utcOf(`${monthKey}-01`);
  if (at === null) return monthKey;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at);
}

/**
 * A week's dates, as short as they can honestly be.
 *
 *   within one month   "August 23–29, 2026"
 *   across two         "August 30 – September 5, 2026"
 *   across a new year  "December 27, 2026 – January 2, 2027"
 *
 * Same rules as `formatDateSpan` in lib/dates.ts, including the unspaced en
 * dash for a range inside one month — which is what makes "August 23–29" read
 * as one span rather than as two dates that happen to be adjacent.
 */
export function spanLabel(from: string, to: string): string {
  const start = utcOf(from);
  const end = utcOf(to);
  if (start === null || end === null) return `${from} – ${to}`;

  const part = (at: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(at);

  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);

  if (sameMonth) {
    return `${part(start, { month: 'long', day: 'numeric' })}–${part(end, {
      day: 'numeric',
    })}, ${part(end, { year: 'numeric' })}`;
  }
  if (sameYear) {
    return `${part(start, { month: 'long', day: 'numeric' })} – ${part(end, {
      month: 'long',
      day: 'numeric',
    })}, ${part(end, { year: 'numeric' })}`;
  }
  return `${part(start, { month: 'long', day: 'numeric', year: 'numeric' })} – ${part(end, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

/** `2026-08-24` → "Monday", and `{ weekday, day, month }` for the day rails. */
export function dayParts(day: string): {
  weekday: string;
  weekdayShort: string;
  dayOfMonth: string;
  month: string;
} {
  const at = utcOf(day);
  if (at === null) {
    return { weekday: '', weekdayShort: '', dayOfMonth: day.slice(8), month: '' };
  }
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(at);

  return {
    weekday: part({ weekday: 'long' }),
    weekdayShort: part({ weekday: 'short' }),
    dayOfMonth: part({ day: 'numeric' }),
    month: part({ month: 'short' }),
  };
}

/**
 * `17:00` → `5:00 PM`.
 *
 * String surgery rather than `Intl`, because the input is a wall-clock reading
 * with no date and no zone attached — there is no instant here to format. The
 * alternative is inventing a date to hang it on, which is the conversion the
 * whole module exists to avoid.
 */
export function formatClock(time: string | null): string {
  if (!time) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;

  const hour24 = Number(match[1]);
  const minutes = match[2];
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  // 0 → 12 and 13 → 1. `% 12` alone renders midnight and noon as "0:00".
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  // The minutes are dropped on the hour: "8 AM" rather than "8:00 AM". Six
  // entries in a day column, each carrying ":00" nobody reads, is noise — and
  // the ones that are not on the hour then stand out, which is useful.
  return minutes === '00' ? `${hour12} ${suffix}` : `${hour12}:${minutes} ${suffix}`;
}

function utcOf(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(millis) ? null : new Date(millis);
}
