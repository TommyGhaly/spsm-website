import Link from 'next/link';
import type { DocOf, Event } from '@spsm/shared';
import { dayKey, dayKeysBetween, formatMonth, formatTime, monthShape } from '@/lib/dates';

/**
 * The parish calendar as a month grid.
 *
 * ---------------------------------------------------------------------------
 * A `<table>`, deliberately, and not a CSS grid of `<div>`s.
 *
 * A month view *is* tabular data: each cell is identified by the intersection
 * of a weekday column and a week row. Marked up as a table with column headers,
 * a screen reader announces "Wednesday, 19" when the user arrives in a cell and
 * can be navigated cell by cell. The same thing built from divs is a flat run of
 * numbers with no way to tell which column you are in — which, on a calendar, is
 * the only thing a cell means.
 *
 * The consequence to keep: the layout has to come from `table-layout: fixed` and
 * percentage widths rather than from `grid`, since `display: grid` on a table
 * destroys the semantics it was chosen for.
 * ---------------------------------------------------------------------------
 *
 * No client JavaScript and no month stepper. This site is a static export, so a
 * "current month" would be whatever month the deploy happened to run in, baked
 * into the HTML and wrong from the next month on — the same trap
 * `features/events/data.ts` documents for range filters. Instead the page
 * renders one grid per month that actually has events, and the reader scrolls.
 */

const WEEKDAYS = [
  { short: 'Sun', long: 'Sunday' },
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
];

/** `2026-08-17` → the events touching that day, in start order. */
export type EventsByDay = Map<string, DocOf<Event>[]>;

/**
 * Buckets events into civil days, one entry per day the event covers.
 *
 * Multi-day entries are expanded rather than pinned to their start date: the
 * Coptic Festival runs the 24th to the 26th, and a calendar that shows it only
 * on the 24th is telling someone looking at the 25th that nothing is on.
 */
export function groupEventsByDay(events: DocOf<Event>[]): EventsByDay {
  const byDay: EventsByDay = new Map();

  for (const event of events) {
    const start = dayKey(event.startAt, event.timeZone);
    if (!start) continue;
    const end = dayKey(event.endAt, event.timeZone) ?? start;

    for (const key of dayKeysBetween(start, end)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
  }

  return byDay;
}

/** The `YYYY-MM` keys that have at least one event, earliest first. */
export function monthsWithEvents(byDay: EventsByDay): string[] {
  const months = new Set<string>();
  for (const key of byDay.keys()) months.add(key.slice(0, 7));
  return [...months].sort();
}

export function MonthGrid({ monthKey, byDay }: { monthKey: string; byDay: EventsByDay }) {
  const { days, firstWeekday } = monthShape(monthKey);
  const label = formatMonth(monthKey);

  /*
   * Weeks are built as fixed rows of seven rather than by flowing cells and
   * letting the table wrap, because a table does not wrap — every row has to be
   * a `<tr>` with exactly seven `<td>`s or the columns stop lining up with
   * their headers. `null` is a day outside this month.
   */
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return (
    <table className="calendar">
      <caption className="calendar__caption">{label}</caption>
      <thead>
        <tr>
          {WEEKDAYS.map((day) => (
            <th key={day.long} scope="col">
              {/* The full name for a screen reader, the abbreviation on screen —
                  seven columns of "Wednesday" do not fit a phone. */}
              <abbr title={day.long}>{day.short}</abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, weekIndex) => (
          <tr key={weekIndex}>
            {week.map((day, dayIndex) =>
              day === null ? (
                <td key={dayIndex} className="calendar__cell calendar__cell--empty" />
              ) : (
                <DayCell
                  key={dayIndex}
                  day={day}
                  dayKey={`${monthKey}-${String(day).padStart(2, '0')}`}
                  byDay={byDay}
                />
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DayCell({
  day,
  dayKey: key,
  byDay,
}: {
  day: number;
  dayKey: string;
  byDay: EventsByDay;
}) {
  const events = byDay.get(key) ?? [];

  return (
    <td className={events.length > 0 ? 'calendar__cell calendar__cell--has' : 'calendar__cell'}>
      {/* `<time>` carries the machine-readable date, so the number in the corner
          is not the only thing saying which day this is. */}
      <time className="calendar__day" dateTime={key}>
        {day}
      </time>

      {events.length > 0 && (
        <ul className="calendar__events">
          {events.map((event) => (
            <li key={event.id}>
              <Link className="calendar__event" href={`/events/${event.slug}`}>
                {!event.allDay && (
                  <span className="calendar__time">
                    {formatTime(event.startAt, event.timeZone)}
                  </span>
                )}
                <span className="calendar__title">{event.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </td>
  );
}
