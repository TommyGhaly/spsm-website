'use client';

import { useRef, useState } from 'react';
import { kindOf, type CalendarOccurrence } from '@spsm/shared';
import { dayParts, formatClock, type ViewRange } from './range';

/**
 * A month, as a grid you scan by date.
 *
 * ---------------------------------------------------------------------------
 * Quiet by default; detail on hover.
 *
 * The cells used to carry the entries as text — four lines of "9 PM / High
 * School Online Bible Study" per day, in a 13px face, across 35 cells. It was
 * complete and it was unreadable: nothing stood out because everything was
 * shouting, and the grid's actual job — telling you the *shape* of the month at
 * a glance — was buried under about four hundred words.
 *
 * So a cell now shows its date and one coloured dot per entry, and nothing
 * else. That is enough to see that Saturdays are heavy and Wednesdays are
 * empty, and enough to see where the liturgies fall, because the dots are
 * coloured by what the thing is. Pointing at a day opens that whole week, which
 * swaps the dots for the entries themselves.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Pointing at a day fills in that whole week, in the squares themselves.
 *
 * The week rather than the day, because the question a month grid gets asked is
 * "what is that week like" far more often than "what is on the 12th".
 *
 * **The open row grows; the closed ones stay compact.** Reserving the open
 * height on every row was tried first, so the grid could never move at all, and
 * it looked abandoned — five weeks of nearly empty boxes with a date adrift in
 * each. Growing is safe anyway: expanding a row only moves the rows *below* it,
 * so the row under the cursor never slides away from it. Enter from above and
 * it grows downward; enter from below and the row you just left collapses above
 * it, moving it further under the pointer rather than out from under it.
 *
 * A floating panel over the grid was the previous attempt at this and is worth
 * not going back to: it covered the dates it was describing, and it had to live
 * outside `.sched-month-scroll` to avoid being clipped by it.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * A `<table>`, deliberately, and not a CSS grid of `<div>`s.
 *
 * Inherited from `features/events/MonthGrid.tsx`, which argued it at length and
 * was right: a month view *is* tabular data. Each cell is identified by the
 * intersection of a weekday column and a week row, and marked up as a table
 * with column headers a screen reader announces "Wednesday, 19" on arrival. The
 * same thing built from divs is a flat run of numbers with no way to tell which
 * column you are in — which, on a calendar, is the only thing a cell means.
 *
 * The consequence to keep: the layout comes from `table-layout: fixed` and
 * percentage widths, never from `display: grid`, which on a table destroys the
 * semantics it was chosen for.
 * ---------------------------------------------------------------------------
 */

/**
 * Monday first, matching `WEEK_STARTS_ON` in @spsm/shared.
 *
 * These two have to agree and there is nothing in the type system that makes
 * them: `monthRange` decides which day each column *is*, and this decides what
 * each column is *called*. Get them out of step and every event silently sits
 * one column from where it belongs, with the grid still looking perfectly
 * plausible.
 */
export const WEEKDAYS = [
  { short: 'Mon', long: 'Monday' },
  { short: 'Tue', long: 'Tuesday' },
  { short: 'Wed', long: 'Wednesday' },
  { short: 'Thu', long: 'Thursday' },
  { short: 'Fri', long: 'Friday' },
  { short: 'Sat', long: 'Saturday' },
  { short: 'Sun', long: 'Sunday' },
];

/*
 * There is no cap on either the dots or the entries any more.
 *
 * Both had one — five dots and three entries, with a "+n" for the rest — and
 * both were wrong for the same reason: a calendar that hides part of a day is
 * a calendar you cannot trust, and "+2 more" on the busiest Saturday of the
 * month is exactly where somebody stops believing it. The row grows to fit
 * whatever the fullest day in it holds, and the seven cells share that height
 * because they are cells in a table row.
 */

export function MonthView({
  range,
  byDay,
  today,
  onOpen,
}: {
  range: ViewRange;
  byDay: Map<string, CalendarOccurrence[]>;
  today: string | null;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  /**
   * Which row is open, by index.
   *
   * Just the index now. The floating version had to carry the row's measured
   * position too, so it could be anchored against the wrapper; opening in place
   * needs nothing but knowing which row it is.
   */
  const [openWeek, setOpenWeek] = useState<number | null>(null);

  /*
   * `range.days` is already padded to whole weeks by `monthRange`, so the rows
   * are a straight slice by seven. Every `<tr>` gets exactly seven `<td>`s —
   * a table does not wrap, and a short row silently unaligns every column from
   * its header.
   */
  const weeks: string[][] = [];
  for (let index = 0; index < range.days.length; index += 7) {
    weeks.push(range.days.slice(index, index + 7));
  }

  // Which month this grid is *of*, so the padding days from the months either
  // side can be dimmed. Taken from the middle of the range rather than from its
  // first day, which by definition often belongs to the previous month.
  const monthKey = (range.days[Math.floor(range.days.length / 2)] ?? '').slice(0, 7);

  return (
    <div className="sched-month-frame" onMouseLeave={() => setOpenWeek(null)}>
      {/*
        The overflow lives on this wrapper and not on the table: a scroll
        container has to be the table's *parent*, and `overflow-x` on a table
        itself does nothing. Seven columns do not fit a 320px phone, and
        squeezing them to fit gives cells one word wide.
      */}
      <div className="sched-month-scroll">
        <table className="sched-month">
          {/*
            The month name as a `<caption>` rather than an `<h2>` above the
            table, so the heading is bound to the table it names and is
            announced on entering the grid — which is exactly when "August 2026"
            is needed. Visually hidden, because the stepper's heading already
            says it and two copies of the same month is not a design.
          */}
          <caption className="visually-hidden">{range.label}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday.long} scope="col">
                  {/* The full name for a screen reader, the abbreviation on
                      screen — seven columns of "Wednesday" do not fit a phone. */}
                  <abbr title={weekday.long}>{weekday.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, index) => {
              const isOpen = openWeek === index;

              return (
                <tr key={week[0]} className={isOpen ? 'is-open' : undefined}>
                  {week.map((day) => (
                    <DayCell
                      key={day}
                      day={day}
                      entries={byDay.get(day) ?? []}
                      inMonth={day.slice(0, 7) === monthKey}
                      isToday={day === today}
                      isOpen={isOpen}
                      onPoint={() => setOpenWeek(index)}
                      onOpen={onOpen}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayCell({
  day,
  entries,
  inMonth,
  isToday,
  isOpen,
  onPoint,
  onOpen,
}: {
  day: string;
  entries: CalendarOccurrence[];
  inMonth: boolean;
  isToday: boolean;
  isOpen: boolean;
  onPoint: () => void;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  const parts = dayParts(day);

  const label = `${parts.weekday} ${parts.month} ${parts.dayOfMonth}${
    isToday ? ', today' : ''
  } — ${entries.length === 0 ? 'nothing scheduled' : `${entries.length} scheduled`}`;

  const date = (
    <span className="sched-month__num" aria-hidden="true">
      {parts.dayOfMonth}
    </span>
  );

  return (
    /*
     * The hover handler is on the cell rather than on whatever is inside it, so
     * it keeps working when the inside stops being a button — see below.
     */
    <td
      className={[
        'sched-month__cell',
        inMonth ? '' : 'sched-month__cell--outside',
        isToday ? 'sched-month__cell--today' : '',
        entries.length > 0 ? 'sched-month__cell--has' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={onPoint}
    >
      {/*
        The cell is a button while its row is *closed*, and a plain box once it
        is open.

        It has to be. A closed cell's one action is "show me this week", which
        wants to be reachable by keyboard and tappable on a phone. An open
        cell's entries are each their own button — and a button inside a button
        is invalid HTML that browsers unnest, which would leave the entries
        unclickable and the markup quietly wrong. Swapping the element with the
        state is the honest version: the affordance changes because the
        available action changed.
      */}
      {isOpen ? (
        <div className="sched-month__pick">
          <span className="visually-hidden">{label}</span>
          {date}
          {entries.length > 0 && (
            <span className="sched-month__entries">
              {entries.map((occurrence) => (
                <button
                  type="button"
                  key={`${occurrence.source}:${occurrence.id}`}
                  className={`sched-month__entry sched-month__entry--${kindOf(occurrence)}`}
                  onClick={() => onOpen(occurrence, day)}
                >
                  <span className="sched-month__entry-time">
                    {occurrence.allDay ? 'All day' : formatClock(occurrence.startTime)}
                  </span>
                  <span className="sched-month__entry-title">{occurrence.title}</span>
                </button>
              ))}
            </span>
          )}
        </div>
      ) : entries.length > 0 ? (
        <button type="button" className="sched-month__pick" aria-label={label} onFocus={onPoint} onClick={onPoint}>
          {date}
          <span className="sched-month__dots" aria-hidden="true">
            {entries.map((occurrence) => (
              <span
                key={`${occurrence.source}:${occurrence.id}`}
                className={`sched-month__dot sched-month__dot--${kindOf(occurrence)}`}
              />
            ))}
          </span>
        </button>
      ) : (
        <span className="sched-month__pick sched-month__pick--empty">
          <span className="visually-hidden">{label}</span>
          {date}
        </span>
      )}
    </td>
  );
}
