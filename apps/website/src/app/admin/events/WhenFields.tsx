'use client';

/**
 * When the event is.
 *
 * The one part of this form worth a file of its own, because it is where every
 * wrong entry the parish has ever made came from. Three things are deliberate:
 *
 *  1. **A date and two clock times**, not two `datetime-local` inputs. Almost
 *     every event is one day long, and the old shape charged for that: two
 *     complete date entries, with no visible difference between "9am to 11am"
 *     and "9am on the 3rd to 11am on the 30th".
 *  2. **The second date only exists when it is needed.** "Runs onto another day"
 *     reveals it. An input that is not on the screen cannot be filled in wrong.
 *  3. **The result is printed underneath, in words**, exactly as the calendar
 *     will print it — by the same function the public page calls. That is the
 *     only honest check on a time-zone conversion: not the offset, but the
 *     sentence a parishioner will read.
 */

import { COMMON_TIME_ZONES, zoneAbbreviation } from '@spsm/shared';
import { PARISH_TIME_ZONE, formatEventWhen } from '@/lib/dates';
import { Icon } from '@/components/Icon';
import { Field, Row } from './fields';
import { endInstantOf, startInstantOf, type FieldKey, type FormState } from './form';

/** How long an event usually is. Enough to cover a class, a liturgy, a festival. */
const DURATIONS: [string, number][] = [
  ['1 hr', 60],
  ['1½ hr', 90],
  ['2 hr', 120],
  ['3 hr', 180],
];

/**
 * `HH:MM` plus some minutes, as civil arithmetic — which is what a person means
 * by "two hours later" even on the night the clocks change.
 *
 * Returns the day offset separately, so an event that runs past midnight sets an
 * end *date* rather than an end time earlier than its start.
 */
function laterBy(time: string, minutes: number): { time: string; dayOffset: number } {
  const parts = time.split(':');
  const total = Number(parts[0]) * 60 + Number(parts[1]) + minutes;
  if (!Number.isFinite(total)) return { time, dayOffset: 0 };
  const dayOffset = Math.floor(total / 1440);
  const within = ((total % 1440) + 1440) % 1440;
  const pad = (value: number) => String(value).padStart(2, '0');
  return { time: `${pad(Math.floor(within / 60))}:${pad(within % 60)}`, dayOffset };
}

/** `2026-09-06` a day or two on. UTC arithmetic, because these are civil dates. */
function dayAfter(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || days === 0) return date;
  const shifted = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return new Date(shifted).toISOString().slice(0, 10);
}

export function WhenFields({
  form,
  set,
  errorOf,
}: {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  errorOf: (field: FieldKey) => string | null;
}) {
  const start = startInstantOf(form);
  const end = endInstantOf(form);
  const zone = start ? zoneAbbreviation(start, form.timeZone) : '';

  /** Set the end from the start, carrying onto the next day if it wraps. */
  function setDuration(minutes: number) {
    if (!form.startTime) return;
    const { time, dayOffset } = laterBy(form.startTime, minutes);
    set('endTime', time);
    if (dayOffset > 0 && form.date) set('endDate', dayAfter(form.date, dayOffset));
    else if (dayOffset === 0 && !form.endDate) set('endDate', '');
  }

  return (
    <div className="ev-when">
      <Row>
        <Field
          label={form.endDate ? 'First day' : 'Day'}
          error={errorOf('date')}
          required
          hint={form.endDate ? undefined : 'The day it happens.'}
        >
          <input
            name="date"
            type="date"
            value={form.date}
            onChange={(e) => set('date', e.target.value)}
          />
        </Field>

        {/* Times disappear entirely for an all-day event rather than being
            disabled. A greyed-out time input still says "there is a time here
            and you may not have it", which is not what all-day means. */}
        {!form.allDay && (
          <>
            <Field label="Starts" error={errorOf('startTime')} required>
              <input
                name="startTime"
                type="time"
                value={form.startTime}
                onChange={(e) => set('startTime', e.target.value)}
              />
            </Field>

            <Field
              label="Ends"
              error={errorOf('endTime')}
              hint={form.endTime ? undefined : 'Optional.'}
            >
              <input
                name="endTime"
                type="time"
                value={form.endTime}
                onChange={(e) => set('endTime', e.target.value)}
              />
            </Field>
          </>
        )}
      </Row>

      {/* The quickest way to fill an end time, and the reason the field can stay
          optional without being a nuisance: nobody has to work out that half
          past seven plus ninety minutes is nine. Hidden until there is a start
          to add to, because "1 hr" after nothing is nothing. */}
      {!form.allDay && form.startTime && (
        <div className="ev-durations">
          <span className="ev-durations__label">Lasts</span>
          {DURATIONS.map(([label, minutes]) => (
            <button
              key={label}
              type="button"
              className="chip"
              onClick={() => setDuration(minutes)}
            >
              {label}
            </button>
          ))}
          {form.endTime && (
            <button
              type="button"
              className="ev-durations__clear"
              onClick={() => {
                set('endTime', '');
                set('endDate', '');
              }}
            >
              Open-ended
            </button>
          )}
        </div>
      )}

      <div className="ev-when__switches">
        <label className="ev-check">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(e) => {
              set('allDay', e.target.checked);
              // The times are cleared rather than kept out of sight. Kept, they
              // come back if all-day is switched off again — which sounds
              // helpful and is how an event ends up with a start time nobody
              // remembers setting.
              if (e.target.checked) {
                set('startTime', '');
                set('endTime', '');
              }
            }}
          />
          <span>All day — don&apos;t show a time</span>
        </label>

        <label className="ev-check">
          <input
            type="checkbox"
            checked={form.endDate !== ''}
            onChange={(e) => {
              if (e.target.checked) {
                set('endDate', dayAfter(form.date, 1));
                return;
              }
              set('endDate', '');
              /*
               * An end time that only made sense on the *next* day goes with it.
               *
               * Without this, unticking a midnight vigil left "11:00 PM to 2:00
               * AM" on one day — which the validator does catch, but as "it ends
               * before it starts" against a field nobody touched. Dropping it
               * back to open-ended says the same thing by not being wrong.
               */
              if (form.endTime && form.startTime && form.endTime < form.startTime) {
                set('endTime', '');
              }
            }}
            disabled={!form.date}
          />
          <span>Runs onto another day</span>
        </label>
      </div>

      {form.endDate !== '' && (
        <Row>
          <Field
            label="Last day"
            error={errorOf('endDate')}
            hint="A camp, a festival, a retreat — it shows in every cell in between."
          >
            <input
              name="endDate"
              type="date"
              value={form.endDate}
              min={form.date || undefined}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </Field>
        </Row>
      )}

      {/*
        What the parish will read.

        Rendered by `formatEventWhen`, the same function the calendar and the
        event page call, so this is not a description of the conversion — it is
        the conversion. A zone mistake shows up here as the wrong sentence, at
        the moment it is made, instead of on the morning of the event.
      */}
      <p className={start ? 'ev-echo' : 'ev-echo ev-echo--empty'}>
        <Icon name="calendar" size={15} />
        {start ? (
          <span>
            {formatEventWhen(start, end, form.allDay, form.timeZone)}
            {!form.allDay && zone && <em> {zone}</em>}
          </span>
        ) : (
          <span>Pick a day, and this will show how it reads on the calendar.</span>
        )}
      </p>

      {/*
        The zone, shown only when it matters.

        Every event the parish has ever held is in its own zone, so a select with
        six options sitting permanently beside the times is six options of noise
        guarding one genuine case — the Cairo pilgrimage. It appears when the
        event is already in another zone, and otherwise behind one link.
      */}
      {form.timeZone === PARISH_TIME_ZONE ? (
        <button
          type="button"
          className="ev-when__zone-link"
          onClick={() => set('timeZone', 'Africa/Cairo')}
        >
          This event is in a different time zone
        </button>
      ) : (
        <Row>
          <Field
            label="Time zone"
            hint="Stored with the event, so the clocks changing never moves it."
          >
            <select
              name="timeZone"
              value={form.timeZone}
              onChange={(e) => set('timeZone', e.target.value)}
            >
              {COMMON_TIME_ZONES.map((option) => (
                <option key={option} value={option}>
                  {option.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
        </Row>
      )}
    </div>
  );
}
