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
}

export function DayGrid({ weeks, weekStarts, days, disabled, onChange, label }: DayGridProps) {
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
    // Whole week on unless it is already entirely on, in which case off. The
    // half-chosen case fills rather than clears: somebody clicking "Week 2"
    // with two days ticked means "all of it", never "none of it".
    if (keys.every((key) => next.has(key))) for (const key of keys) next.delete(key);
    else for (const key of keys) next.add(key);
    onChange([...next]);
  };

  return (
    <fieldset className="camp-days" disabled={disabled}>
      <legend className="visually-hidden">{label}</legend>
      {Array.from({ length: weeks }, (_unused, index) => index + 1).map((week) => {
        const keys = campWeekKeys(week);
        const all = keys.every((key) => chosen.has(key));
        return (
          <div className="camp-days__week" key={week}>
            <div className="camp-days__head">
              <span className="camp-days__title">
                Week {week}
                <span className="camp-days__range">
                  {campWeekRangeLabel(weekStarts, week) === `Week ${week}`
                    ? ''
                    : campWeekRangeLabel(weekStarts, week)}
                </span>
              </span>
              <button
                type="button"
                className="camp-days__all"
                onClick={() => toggleWeek(week)}
                disabled={disabled}
              >
                {all ? 'Clear week' : 'Whole week'}
              </button>
            </div>
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
          </div>
        );
      })}
    </fieldset>
  );
}
