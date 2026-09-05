'use client';

import { dayParts, type CalendarView, type ViewRange } from './range';
import { WEEKDAYS } from './MonthView';

/**
 * The calendar before the schedule has arrived.
 *
 * ---------------------------------------------------------------------------
 * The frame is real; only the schedule is a placeholder.
 *
 * Both of the states this replaces were a line of centred grey text — "Working
 * out what week it is…" and "Loading the schedule…" — in a page that is
 * otherwise a 42-cell grid. The calendar therefore appeared in two goes: an
 * empty column of nothing, then, a second later, the whole month at once, with
 * the stepper and the view switch jumping down the page as it landed.
 *
 * What is drawn here instead is the grid itself, at exactly the size it will
 * be, with **the parts we already know filled in for real**: the weekday
 * headers, the dates, which month they belong to, and which one is today. All
 * of that is arithmetic on the browser's clock and none of it is waiting on
 * Breeze. Only the entries — the dots in a month cell, the rows in a week card
 * — are placeholders, because they are the only thing actually in flight.
 *
 * So the reader watches one thing resolve rather than a page assemble itself,
 * and nothing moves when it does.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * `range` is null for one frame, and that frame is a different picture.
 *
 * `ChurchCalendar` deliberately does not know what day it is until the browser
 * says so — see the note on `anchor` there — so the very first render has no
 * dates to draw. That state gets the same geometry with the dates left out
 * rather than a fourth spinner: a six-row grid is a six-row grid whether or not
 * we can number it yet, and the switch from unnumbered to numbered is a fade
 * inside cells that never move.
 * ---------------------------------------------------------------------------
 *
 * The classes are the real views' own — `.sched-month`, `.sched-wheel__card`
 * and the rest — and that is the point of the whole file: the skeleton inherits
 * every measurement from the thing it stands in for, so the two cannot drift
 * apart the way a hand-built grey rectangle would. What is added is
 * `.sched-skel*`, which is only ever the shimmer and the placeholder shapes.
 */

/**
 * How many dots a placeholder day gets, by weekday column.
 *
 * Not invented and not random — these are the counts read off the real grid, a
 * median down each column of a loaded month. The parish week turns out to be
 * almost perfectly regular: four things on a Monday, one on each of Tuesday
 * through Friday, five on a Saturday, three on a Sunday, the same in every row
 * of the month. So the skeleton can be very nearly right rather than merely
 * plausible, and the moment the schedule lands the dots mostly stay where they
 * were and change colour.
 *
 * `Math.random()` was the obvious alternative and is wrong twice over: it
 * re-rolls on every render while the fetch is in flight, so the grid fidgets,
 * and it would be less accurate than this.
 *
 * If the parish schedule changes shape, re-read it rather than adjusting by
 * eye — one `querySelectorAll('.sched-month__dot')` per cell on a loaded month.
 */
const BUSY_BY_WEEKDAY = [4, 1, 1, 1, 1, 5, 3];

/** Mon–Sun as above. Every row alike, because every row really is. */
function placeholderCount(column: number): number {
  return BUSY_BY_WEEKDAY[column] ?? 1;
}

/**
 * How wide a month cell's placeholder bar is, in pixels.
 *
 * ---------------------------------------------------------------------------
 * A bar, not dots — because dots did not read as loading at all.
 *
 * The first version of this drew the placeholder as grey copies of the real
 * dots, one per expected entry. It was pixel-accurate and it failed at the only
 * job a skeleton has: a 6px circle has nowhere for a shimmer to travel, so a
 * month of them looks like a *loaded* calendar whose dots happen to be pale.
 * Tommy read it as no skeleton at all, which is the correct reading.
 *
 * So the dots become one bar per cell — a shape that is obviously a placeholder
 * — and the arithmetic below keeps the geometry: `n` dots occupy `n * 6px` plus
 * `(n - 1) * 3px` of gap, which is exactly what the row is measured at. The bar
 * is that width, so a cell's mark is the same size before and after and the row
 * height (`min-height: 0.5rem` on `.sched-month__dots`) never changes.
 *
 * The floor is the one deliberate inaccuracy. Tuesday through Friday hold a
 * single entry, and a 6px bar is a dot again — invisible as a placeholder. 18px
 * is the narrowest that still reads as one and still shimmers.
 * ---------------------------------------------------------------------------
 */
function placeholderBarWidth(column: number): number {
  const dots = placeholderCount(column);
  return Math.max(dots * 6 + (dots - 1) * 3, 18);
}

export function ScheduleSkeleton({
  view,
  range,
  today,
  label,
}: {
  view: CalendarView;
  /** Null until the browser has told us what day it is. */
  range: ViewRange | null;
  today: string | null;
  /** What a screen reader is told is happening. */
  label: string;
}) {
  return (
    /*
     * `aria-hidden` on the drawing, and the sentence said once, politely.
     *
     * A screen reader has no use for forty-two placeholder cells, and reading
     * them out is actively worse than the paragraph this replaces. The
     * `role="status"` line is the whole of what a non-visual reader gets, which
     * is the same information the picture carries. `.schedule` already sets
     * `aria-busy`, so this is not the only signal either.
     */
    <div className="sched-skel">
      {/*
        The running line, on the rule under the stepper.

        This is the signal that does not depend on anybody recognising a
        placeholder shape: a bar that travels is the one loading convention
        every reader already knows, and it sits at the top of the calendar
        where the eye enters. Absolutely positioned, so it costs no layout and
        its arrival and departure move nothing.
      */}
      <span className="sched-skel__line" aria-hidden="true" />

      <div aria-hidden="true">
        {view === 'month' ? (
          <MonthSkeleton range={range} today={today} />
        ) : (
          <WeekSkeleton range={range} today={today} />
        )}
      </div>

      {/*
        And the sentence, out loud, over the middle of the grid.

        It used to be `visually-hidden`, which meant the only reader actually
        told that anything was loading was the one on a screen reader. Everybody
        else got a grid of pale marks and read it — reasonably — as a month with
        nothing on. The words are the fix; the shimmer was never going to be,
        because a placeholder only reads as a placeholder to somebody who
        already knows the page has two states.

        Over the grid rather than above it, because above it means either
        reserving a strip that is empty for the whole of the calendar's life or
        shifting the grid down when it goes — and not moving is the entire
        reason this file draws a real grid in the first place. What it covers
        is two or three cells of placeholder, which is the one thing on the page
        that has nothing to say.
      */}
      <p className="sched-skel__say" role="status">
        <span className="sched-skel__spin" aria-hidden="true" />
        {label}
      </p>
    </div>
  );
}

/* ---- the month ----------------------------------------------------------- */

function MonthSkeleton({ range, today }: { range: ViewRange | null; today: string | null }) {
  /*
   * Six rows when we do not know the month yet.
   *
   * Not five: a month grid is five or six rows depending on where the 1st
   * falls, and guessing short means the grid *grows* when the real one arrives,
   * which is the reflow this exists to prevent. Guessing long costs a row that
   * fades out, and a row leaving the bottom of a grid moves nothing above it.
   */
  const weeks: (string | null)[][] = [];
  if (range) {
    for (let index = 0; index < range.days.length; index += 7) {
      weeks.push(range.days.slice(index, index + 7));
    }
  } else {
    for (let index = 0; index < 6; index += 1) {
      weeks.push(Array.from({ length: 7 }, () => null));
    }
  }

  // The month this grid is *of*, read from the middle of the range for the same
  // reason MonthView reads it there: the first day often belongs to the one before.
  const monthKey = range ? (range.days[Math.floor(range.days.length / 2)] ?? '').slice(0, 7) : '';

  return (
    <div className="sched-month-frame">
      <div className="sched-month-scroll">
        <table className="sched-month">
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday.long} scope="col">
                  <abbr title={weekday.long}>{weekday.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, row) => (
              <tr key={row}>
                {week.map((day, column) => {
                  const inMonth = day === null || day.slice(0, 7) === monthKey;

                  return (
                    <td
                      key={day ?? `${row}-${column}`}
                      className={[
                        'sched-month__cell',
                        inMonth ? '' : 'sched-month__cell--outside',
                        day !== null && day === today ? 'sched-month__cell--today' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="sched-month__pick sched-month__pick--empty">
                        {day === null ? (
                          /* No date to show yet — a pill the size of one. */
                          <span className="sched-skel__num" />
                        ) : (
                          <span className="sched-month__num">{dayParts(day).dayOfMonth}</span>
                        )}
                        {/*
                          `.sched-month__dots` still, so the row it reserves is
                          the row the real dots will land in.
                        */}
                        <span className="sched-month__dots">
                          <span
                            className="sched-skel__bar sched-skel__bar--dots"
                            style={{ width: `${placeholderBarWidth(column)}px` }}
                          />
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---- the week ------------------------------------------------------------ */

/**
 * The wheel, held still.
 *
 * The real one is a scroll container that snaps, measures its own slot height
 * and scrolls itself to today on the first layout pass. None of that is
 * reproduced here and none of it should be: a placeholder with a tab stop in it
 * that a reader can scroll off the day they wanted is a placeholder that has
 * become a control.
 *
 * So the three visible rows — a strip of the day before, the day itself, a
 * strip of the day after — are laid out as three grid rows of exactly the
 * heights the frame already declares, `--wheel-peek` / `--wheel-slot` /
 * `--wheel-peek`. That is the same arithmetic `.sched-wheel` uses for its own
 * height, which is why the swap does not move anything: the wheel that replaces
 * this is the same box with seven days in it and the right one scrolled into
 * the middle.
 */
function WeekSkeleton({ range, today }: { range: ViewRange | null; today: string | null }) {
  const days = range?.days ?? null;

  /*
   * Centres on today when today is in the week, and on the first day when it is
   * not — which is `opensOn` in `WeekView`, spelled the same way on purpose. A
   * skeleton centred on a different day than the wheel that follows it makes
   * the wheel appear to turn on its own the moment the schedule lands.
   */
  const centred = days === null || today === null ? 3 : Math.max(0, days.indexOf(today));

  const dayAt = (index: number): string | null =>
    days === null || index < 0 || index >= days.length ? null : (days[index] ?? null);

  return (
    <div className="sched-wheel-frame">
      <div className="sched-wheel sched-skel__wheel">
        <PeekSkeleton day={dayAt(centred - 1)} today={today} index={centred - 1} where="above" />

        <div
          className={[
            'sched-wheel__slot',
            'is-centred',
            dayAt(centred) !== null && dayAt(centred) === today ? 'is-today' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="sched-wheel__card">
            <div className="sched-wheel__head">
              <DayHeadSkeleton day={dayAt(centred)} today={today} />
            </div>

            {/*
              Four rows, and four rather than one or two on purpose.

              The wheel measures its slot height from the *first* day of the
              week, and Monday is the parish's heaviest weekday — so four is
              what actually sizes the box this is standing in. A two-row
              placeholder in a slot that is about to be four rows tall is a
              skeleton that causes the reflow it exists to prevent.

              Not "Nothing scheduled" either: a skeleton that says a day is
              empty is telling the reader something it does not know, and it is
              the one sentence here that would be a lie half the time.
            */}
            <div className="sched-skel__entries">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="sched-skel__entry">
                  {/* The time column is two lines in a real entry — the start
                      and an "until" under it — and that is most of what makes a
                      row 39px rather than 25px. */}
                  <span className="sched-skel__stack">
                    <span className="sched-skel__bar sched-skel__bar--time" />
                    <span className="sched-skel__bar sched-skel__bar--until" />
                  </span>
                  <span
                    className="sched-skel__bar sched-skel__bar--title"
                    /* Four different lengths, so the block reads as titles
                       rather than as four copies of one shape. */
                    style={{ width: `${[82, 58, 71, 64][row]}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <PeekSkeleton day={dayAt(centred + 1)} today={today} index={centred + 1} where="below" />
      </div>

      {/* The pips, as plain marks. Not buttons: there is nothing to jump to
          yet, and a disabled button is a promise the skeleton cannot keep. */}
      <div className="sched-pips">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            key={index}
            className={
              index === centred
                ? 'sched-pips__pip sched-skel__pip sched-skel__pip--centred'
                : 'sched-pips__pip sched-skel__pip'
            }
            style={{ '--pip-depth': Math.min(Math.abs(index - centred), 3) } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The head of the centred card: the real weekday, date and Today badge when we
 * have them.
 *
 * The badge is included rather than left for the real card to add, because it
 * is the widest thing in the head — dropping it in a moment later re-wraps the
 * line on a narrow screen, which is a jump in the one part of this that was
 * supposed to be settled from the start.
 */
function DayHeadSkeleton({ day, today }: { day: string | null; today: string | null }) {
  if (day === null) {
    return (
      <>
        <span className="sched-skel__bar sched-skel__bar--weekday" />
        <span className="sched-skel__bar sched-skel__bar--date" />
      </>
    );
  }

  const parts = dayParts(day);
  return (
    <>
      <h3 className="sched-wheel__weekday">
        {parts.weekday}
        {day === today && <span className="sched-wheel__badge">Today</span>}
      </h3>
      <p className="sched-wheel__date">
        <span className="sched-wheel__month">{parts.month}</span>
        <span className="sched-wheel__num">{parts.dayOfMonth}</span>
      </p>
    </>
  );
}

/** A strip of the day above or below: its date, and placeholder dots. */
function PeekSkeleton({
  day,
  today,
  index,
  where,
}: {
  day: string | null;
  today: string | null;
  index: number;
  where: 'above' | 'below';
}) {
  const parts = day === null ? null : dayParts(day);

  return (
    <p className={`sched-wheel__peek sched-skel__peek sched-skel__peek--${where}`}>
      {parts === null ? (
        <span className="sched-skel__bar sched-skel__bar--peek" />
      ) : (
        <span className={day === today ? 'sched-wheel__peek-day is-today' : 'sched-wheel__peek-day'}>
          {parts.weekdayShort} {parts.dayOfMonth}
        </span>
      )}
      <span className="sched-wheel__peek-dots">
        <span
          className="sched-skel__bar sched-skel__bar--dots"
          style={{ width: `${placeholderBarWidth(Math.max(0, index) % 7)}px` }}
        />
      </span>
    </p>
  );
}
