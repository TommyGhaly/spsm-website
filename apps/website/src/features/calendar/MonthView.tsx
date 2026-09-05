'use client';

import { useEffect, useState } from 'react';
import { kindOf, type CalendarOccurrence } from '@spsm/shared';
import { dayParts, formatClock, type ViewRange } from './range';
import { Entry } from './Entry';

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

/*
 * One panel on the page, so a fixed id is honest and `useId` would only make it
 * unreadable. The month grid is rendered once — `Grid` in ChurchCalendar.tsx
 * picks either this or the week view, never both.
 */
const DAY_PANEL_ID = 'sched-month-day';

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

  /**
   * Which single day is selected, for the narrow-screen panel below the grid.
   *
   * Held apart from `openWeek` rather than derived from it, because the two are
   * driven by different gestures and cleared by different things: the row opens
   * on hover and closes when the pointer leaves the grid, and the day is chosen
   * by a tap and stays chosen until it is tapped again. A phone never fires the
   * mouseleave that closes the row, and a pointer never needs the panel — so
   * folding them into one piece of state means one of the two behaves wrongly.
   */
  const [picked, setPicked] = useState<string | null>(null);

  const narrow = useNarrow();

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
                      /* `narrow &&`, so a window dragged wider does not leave
                         a ring round a day whose panel is no longer there. */
                      isPicked={narrow && day === picked}
                      narrow={narrow}
                      /* Nothing at all when the cells are too narrow to hold
                         the entries: opening a row that cannot show anything
                         only turns its seven cells from buttons into boxes,
                         and takes the tap target for the day with them. */
                      onPoint={narrow ? undefined : () => setOpenWeek(index)}
                      /* Tapping the day it is already on puts it away again,
                         which is the only way to close the panel from the grid
                         — there is no hovering out of it on a touch screen. */
                      onPick={
                        narrow
                          ? () => setPicked((current) => (current === day ? null : day))
                          : () => setOpenWeek(index)
                      }
                      onOpen={onOpen}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        The chosen day, at the full width of the page.

        Outside `.sched-month-scroll` on purpose: that wrapper is
        `overflow-x: auto`, which resolves the other axis to `auto` as well, so
        anything of any height put inside it gets a scrollbar of its own rather
        than pushing the page down.

        Only below 64rem — see the note at the top of this file, and `useNarrow`
        below for why asking the viewport is safe here.
      */}
      {narrow && picked && (
        <DayPanel
          id={DAY_PANEL_ID}
          day={picked}
          entries={byDay.get(picked) ?? []}
          isToday={picked === today}
          onShut={() => setPicked(null)}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}

/**
 * Whether the cells are too narrow to hold an entry — 64rem, measured.
 *
 * ---------------------------------------------------------------------------
 * A media query in JavaScript, and why that is not the hydration trap it looks
 * like.
 *
 * The usual objection is right: the server has no viewport, so a component that
 * renders differently by width renders differently on the server than on the
 * client and React throws. This one does not, because `narrow` is false on the
 * first render on *both* sides, and nothing it controls is visible until
 * somebody has touched the grid — no row is open and no day is picked, so the
 * two behaviours produce byte-identical markup. The effect then corrects it
 * before any of it can matter.
 *
 * It is done here rather than in CSS because the difference is not cosmetic. A
 * cell stops being a `<button>` when its row opens (a button inside a button is
 * invalid HTML), so a CSS-only split would leave a narrow screen with an opened
 * row it cannot see and seven cells it can no longer tap. The two arrangements
 * have to disagree about behaviour, not just about paint.
 *
 * The listener stays subscribed: a phone that turns landscape crosses this
 * boundary, and a laptop window is dragged across it all the time.
 * ---------------------------------------------------------------------------
 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 64rem)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return narrow;
}

/**
 * One day's entries, listed under the grid, for screens too narrow to hold them
 * in the cells.
 *
 * The week view's `Entry` rather than the month grid's own chip. The chip exists
 * to survive a 171px column — it drops the end time, the location, the note and
 * the contact to do it — and none of that is worth giving up here, where the
 * list has the whole width of the page. Two renderings of an entry is already
 * one more than ideal; a third, for a panel that has room for the real one,
 * would be indefensible.
 */
function DayPanel({
  id,
  day,
  entries,
  isToday,
  onShut,
  onOpen,
}: {
  id: string;
  day: string;
  entries: CalendarOccurrence[];
  isToday: boolean;
  onShut: () => void;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  const parts = dayParts(day);

  return (
    <section id={id} className="sched-month__day" aria-label={`${parts.weekday} ${parts.month} ${parts.dayOfMonth}`}>
      <div className="sched-month__day-head">
        <h3 className="sched-month__day-date">
          {parts.weekday} {parts.month} {parts.dayOfMonth}
          {isToday && <span className="sched-month__day-badge">Today</span>}
        </h3>
        {/*
          A close button, because the other way out is tapping the same date a
          second time and nothing on the grid says so. The grid keeps that
          gesture; this is the one anybody finds.
        */}
        <button type="button" className="sched-month__day-shut" onClick={onShut}>
          <span className="visually-hidden">Close {parts.weekday} {parts.month} {parts.dayOfMonth}</span>
          <span aria-hidden="true">&times;</span>
        </button>
      </div>

      {/* Said, not left blank — an empty day and a day that failed to load look
          the same if the answer is white space. */}
      {entries.length === 0 ? (
        <p className="sched-month__day-none">Nothing scheduled</p>
      ) : (
        <ul className="sched-month__day-list">
          {entries.map((occurrence) => (
            <li key={`${occurrence.source}:${occurrence.id}`}>
              <Entry occurrence={occurrence} day={day} onOpen={() => onOpen(occurrence, day)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DayCell({
  day,
  entries,
  inMonth,
  isToday,
  isOpen,
  isPicked,
  narrow,
  onPoint,
  onPick,
  onOpen,
}: {
  day: string;
  entries: CalendarOccurrence[];
  inMonth: boolean;
  isToday: boolean;
  isOpen: boolean;
  isPicked: boolean;
  narrow: boolean;
  onPoint: (() => void) | undefined;
  onPick: () => void;
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
        isPicked ? 'sched-month__cell--picked' : '',
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
        <button
          type="button"
          className="sched-month__pick"
          aria-label={label}
          /*
           * Only on a narrow screen is this a disclosure. On a wide one the
           * button's action is "open this week in the grid", which is not the
           * button expanding — and claiming otherwise would have a screen
           * reader announce a collapsed state for something with no panel.
           */
          aria-expanded={narrow ? isPicked : undefined}
          aria-controls={narrow && isPicked ? DAY_PANEL_ID : undefined}
          onFocus={onPoint}
          onClick={onPick}
        >
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
