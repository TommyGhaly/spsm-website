'use client';

import {
  CAMP_WEEKDAYS,
  campDayDateLabel,
  campDayKey,
  campWeekKeys,
  campWeekRangeLabel,
  campWeekdayLabel,
  type CampDayKey,
} from '@spsm/shared';

/**
 * Which days somebody is coming: a row of weekdays per week of camp.
 *
 * ---------------------------------------------------------------------------
 * The one control on the registration form that is worth drawing rather than
 * listing, because "Monday, Tuesday and Thursday of the second week" is a shape
 * and five checkboxes in a column is not.
 *
 * What is new is the **dates**. Each week's row is headed by the days it
 * actually covers — "Jun 29 – Jul 3" — and each box carries the date under the
 * weekday, read from `config/camp.weekStarts`. The parent at the desk is
 * answering a question about their June, not about an abstract "week 2", and
 * every wrong answer this form has ever taken came from that gap. When the camp
 * has no dates set the heading falls back to "Week 2" and the boxes to bare
 * weekdays, which is exactly how it read before.
 *
 * Nothing about what is *stored* changed: these are still `w2-wed` keys. See
 * `CampDayKey` for why, and `config/camp.weekStarts` for why the dates are a
 * reading of them rather than a replacement.
 *
 * ## `weekFirst`, on the servant's own form
 *
 * Tommy, 2 Sep 2026: *"in the servants form they should select which weeks they
 * are going and then which days"*. With `weekFirst` the weeks are the question
 * and the days are the refinement: a week is a switch, turning it on takes the
 * whole week, and its five days only appear once it is on.
 *
 * That is the right order for a servant and the wrong one for the desk. Most
 * servants come for a whole week or not at all, so the day row is five boxes
 * they do not need to look at — and the roles question below reads *which weeks
 * they are attending*, which is a question this control could only answer by
 * implication before. An administrator entering a family is doing the opposite
 * job: correcting a child's Wednesday from a phone call, where a collapsed week
 * is a click in the way. So the flag is off by default.
 *
 * **A week with no days is not a state.** Turning a week on fills it, turning
 * it off clears it, and unticking the last day closes it again — so "on" is
 * always exactly "has a day in it", and there is no second place for the answer
 * to live.
 * ---------------------------------------------------------------------------
 */
export interface DayGridProps {
  weeks: number;
  weekStarts: readonly string[];
  days: readonly CampDayKey[];
  disabled?: boolean;
  onChange: (days: CampDayKey[]) => void;
  /** For the checkbox group's accessible name: "Mariam's days". */
  label: string;
  /** Ask for the weeks first and open a week's days only once it is chosen. */
  weekFirst?: boolean;
}

export function DayGrid({
  weeks,
  weekStarts,
  days,
  disabled,
  onChange,
  label,
  weekFirst,
}: DayGridProps) {
  const chosen = new Set(days);

  const toggle = (key: CampDayKey) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  };

  const toggleWeek = (week: number) => {
    const keys = campWeekKeys(week);
    const next = new Set(chosen);
    /*
     * Whole week on unless it is already on, in which case off.
     *
     * What counts as "already on" differs between the two orders, and it has to
     * — the control means a different thing in each. Under `weekFirst` the tick
     * is *"I am coming that week"*, so a week with two days chosen is on and
     * unticking it must clear those two. Otherwise this is a "Whole week" link
     * beside a row of days, and somebody pressing it with two days ticked means
     * "all of it", never "none of it".
     */
    const on = weekFirst ? keys.some((key) => next.has(key)) : keys.every((key) => next.has(key));
    if (on) for (const key of keys) next.delete(key);
    else for (const key of keys) next.add(key);
    onChange([...next]);
  };

  return (
    <fieldset className="camp-days" disabled={disabled}>
      <legend className="visually-hidden">{label}</legend>
      {Array.from({ length: weeks }, (_unused, index) => index + 1).map((week) => {
        const keys = campWeekKeys(week);
        const all = keys.every((key) => chosen.has(key));
        const any = keys.some((key) => chosen.has(key));
        const range = campWeekRangeLabel(weekStarts, week);
        return (
          <div className="camp-days__week" key={week}>
            <div className="camp-days__head">
              {weekFirst ? (
                /* The week itself is the control, not a heading with a link
                   beside it: "am I coming that week" is the question, and a
                   tick answers it in one place. */
                <label className={`camp-week${any ? ' is-on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={any}
                    onChange={() => toggleWeek(week)}
                    disabled={disabled}
                  />
                  <span className="camp-days__title">
                    Week {week}
                    <span className="camp-days__range">{range === `Week ${week}` ? '' : range}</span>
                  </span>
                </label>
              ) : (
                <>
                  <span className="camp-days__title">
                    Week {week}
                    <span className="camp-days__range">{range === `Week ${week}` ? '' : range}</span>
                  </span>
                  <button
                    type="button"
                    className="camp-days__all"
                    onClick={() => toggleWeek(week)}
                    disabled={disabled}
                  >
                    {all ? 'Clear week' : 'Whole week'}
                  </button>
                </>
              )}
            </div>
            {/* Closed until the week is chosen. Five boxes for a week somebody
                is not coming to is the clutter this order removes. */}
            {weekFirst && !any ? null : (
            <div className="camp-days__row">
              {CAMP_WEEKDAYS.map((weekday) => {
                const key = campDayKey(week, weekday);
                const date = campDayDateLabel(weekStarts, key);
                return (
                  <label
                    key={key}
                    className={`camp-day${chosen.has(key) ? ' is-on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.has(key)}
                      onChange={() => toggle(key)}
                      disabled={disabled}
                    />
                    <span className="camp-day__name">{campWeekdayLabel(weekday)}</span>
                    {/* Just the day of the month: the month is in the heading
                        above and repeating it eleven times is noise. */}
                    <span className="camp-day__date">{date ? date.split(' ').pop() : ''}</span>
                  </label>
                );
              })}
            </div>
            )}
            {weekFirst && any ? (
              <p className="camp-days__note">
                {all ? 'The whole week. Untick any day you cannot make.' : 'Some of the week.'}
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
