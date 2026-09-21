'use client';

/**
 * When the event is: the page's own date line, which opens its controls.
 *
 * ## Why this one field is a popover and the others are not
 *
 * Every wrong entry the parish has ever made came from here, so it gets the most
 * room — and it is the one part of an event that cannot be edited in place. The
 * title is a word and the description is a paragraph, so an input standing where
 * they stand is the same shape as the thing it replaces. "When" is not: it is a
 * day, two clock times, two switches, a set of shortcuts and possibly a time
 * zone, and there is no arrangement of those that is the same shape as the one
 * small-caps line the page prints.
 *
 * The previous version put all of it inline. That is what made pressing Edit
 * move the top of the page by several hundred pixels — the exact thing the
 * in-place editor exists to avoid.
 *
 * So the line stays the line, rendered by the same function the public page
 * calls, and the controls come to it.
 *
 * ## Three things are kept from the version this replaces
 *
 *  1. **A date and two clock times**, not two `datetime-local` inputs. Almost
 *     every event is one day long, and a pair of full date entries makes "9am to
 *     11am" and "9am on the 3rd to 11am on the 30th" look identical.
 *  2. **The second date exists only when it is needed.** An input that is not on
 *     the screen cannot be filled in wrong.
 *  3. **The result is printed in words**, by the function the calendar uses.
 *     That is the only honest check on a time-zone conversion: not the offset,
 *     but the sentence a parishioner will read.
 *
 * The sentence is printed twice now — on the trigger, and at the top of the open
 * panel — because the panel can cover the line it hangs from.
 */

import {
  COMMON_TIME_ZONES,
  endInstantOf,
  startInstantOf,
  zoneAbbreviation,
  type EventFieldKey,
  type EventFormState,
} from '@spsm/shared';
import { PARISH_TIME_ZONE, formatEventWhen } from '@/lib/dates';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import { Check, Group } from './EditorParts';


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

type Setter = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) => void;

/** The sentence, or a prompt when the fields do not yet name a moment. */
function sentenceOf(form: EventFormState): { text: string; missing: boolean } {
  const start = startInstantOf(form);
  if (!start) return { text: 'Say when it is', missing: true };
  return {
    text: formatEventWhen(start, endInstantOf(form), form.allDay, form.timeZone),
    missing: false,
  };
}

export function WhenLine({
  form,
  set,
  errorOf,
}: {
  form: EventFormState;
  set: Setter;
  errorOf: (field: EventFieldKey) => string | null;
}) {
  const { text, missing } = sentenceOf(form);

  /* The worst kind of error to bury in a closed panel. Drawn on the line. */
  const problem = errorOf('date') ?? errorOf('startTime') ?? errorOf('endTime') ?? errorOf('endDate');

  return (
    <p className="ee-when">
      <Popover
        className={
          missing || problem ? 'ee-when__trigger ee-when__trigger--bad' : 'ee-when__trigger'
        }
        label="Change when this event is"
        panel={() => <WhenPanel form={form} set={set} errorOf={errorOf} />}
      >
        <Icon name="calendar" size={14} />
        <span className="ee-when__text">{text}</span>
        <Icon name="chevron" size={12} className="ee-when__caret" />
      </Popover>
      {problem && <strong className="ee-when__error">{problem}</strong>}
    </p>
  );
}

function WhenPanel({
  form,
  set,
  errorOf,
}: {
  form: EventFormState;
  set: Setter;
  errorOf: (field: EventFieldKey) => string | null;
}) {
  const start = startInstantOf(form);
  const { text, missing } = sentenceOf(form);
  const zone = start ? zoneAbbreviation(start, form.timeZone) : '';

  /** Set the end from the start, carrying onto the next day if it wraps. */
  function setDuration(minutes: number) {
    if (!form.startTime) return;
    const { time, dayOffset } = laterBy(form.startTime, minutes);
    set('endTime', time);
    if (dayOffset > 0 && form.date) set('endDate', dayAfter(form.date, dayOffset));
    else if (dayOffset === 0 && form.endDate) set('endDate', '');
  }

  return (
    <div className="ee-when-panel">
      {/*
        The sentence again, at the top of the panel. The line it hangs from is
        often behind the panel, and this is the value being edited — reading the
        result is the whole reason the controls are worth having.
      */}
      <p className={missing ? 'ee-echo ee-echo--empty' : 'ee-echo'} role="status">
        {text}
        {zone && !form.allDay && <em> {zone}</em>}
      </p>

      <Group label={form.endDate ? 'First day' : 'Day'} error={errorOf('date')}>
        <input
          name="date"
          type="date"
          value={form.date}
          onChange={(event) => set('date', event.target.value)}
        />
      </Group>

      {/* Times disappear entirely for an all-day event rather than being
          disabled. A greyed-out time input still says "there is a time here and
          you may not have it", which is not what all day means. */}
      {!form.allDay && (
        <>
          <div className="ee-cols">
            <Group label="Starts" error={errorOf('startTime')}>
              <input
                name="startTime"
                type="time"
                value={form.startTime}
                onChange={(event) => set('startTime', event.target.value)}
              />
            </Group>
            <Group
              label="Ends"
              error={errorOf('endTime')}
              hint={form.endTime ? undefined : 'Optional'}
            >
              <input
                name="endTime"
                type="time"
                value={form.endTime}
                onChange={(event) => set('endTime', event.target.value)}
              />
            </Group>
          </div>

          {/* The shortcuts, and they are shortcuts rather than a control: the
              end time is a real field above, and these only fill it in. */}
          <div className="ee-durations">
            <span className="ee-durations__label">Lasts</span>
            {DURATIONS.map(([label, minutes]) => (
              <button
                key={minutes}
                type="button"
                className="ee-chip"
                disabled={!form.startTime}
                onClick={() => setDuration(minutes)}
              >
                {label}
              </button>
            ))}
            {form.endTime && (
              <button
                type="button"
                className="ee-chip ee-chip--quiet"
                onClick={() => {
                  set('endTime', '');
                  set('endDate', '');
                }}
              >
                Open-ended
              </button>
            )}
          </div>
        </>
      )}

      <div className="ee-when-panel__switches">
        <Check
          checked={form.allDay}
          onChange={(on) => {
            set('allDay', on);
            // The times are cleared rather than kept and hidden. A hidden value
            // that comes back when somebody unticks the box is a value nobody
            // remembers setting.
            if (on) {
              set('startTime', '');
              set('endTime', '');
            }
          }}
        >
          All day — don&apos;t show a time
        </Check>

        <Check
          checked={Boolean(form.endDate)}
          onChange={(on) => set('endDate', on ? dayAfter(form.date || '', 1) : '')}
        >
          Runs onto another day
        </Check>
      </div>

      {form.endDate && (
        <Group label="Last day" error={errorOf('endDate')}>
          <input
            name="endDate"
            type="date"
            value={form.endDate}
            min={form.date || undefined}
            onChange={(event) => set('endDate', event.target.value)}
          />
        </Group>
      )}

      {/*
        The zone, last and quiet. Almost every event is in the parish's own zone,
        and a select nobody needs sitting above the times is a decision offered
        to everybody to serve the festival that is in Cairo.
      */}
      {form.timeZone === PARISH_TIME_ZONE ? (
        <button
          type="button"
          className="ee-when-panel__zone"
          onClick={() => set('timeZone', 'Africa/Cairo')}
        >
          This event is in a different time zone
        </button>
      ) : (
        <Group label="Time zone">
          <select
            name="timeZone"
            value={form.timeZone}
            onChange={(event) => set('timeZone', event.target.value)}
          >
            {COMMON_TIME_ZONES.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Group>
      )}
    </div>
  );
}
