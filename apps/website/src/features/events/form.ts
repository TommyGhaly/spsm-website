/**
 * The shape of the events form, and every pure function that reads or writes it.
 *
 * Split out of the component on purpose: this is the part with the arithmetic in
 * it — wall-clock splitting, validation, what counts as a change — and none of
 * it needs React to be tested or read.
 *
 * ## The one structural decision
 *
 * The old form held two `datetime-local` strings. This one holds a **date and
 * two times**, which is not a cosmetic difference: a `datetime-local` pair makes
 * the everyday case (one day, two clock times) cost two full date entries and
 * makes the mistake it invites — an end date accidentally a month later — look
 * exactly like a correct entry. A date, a start, an end, and an explicit "it
 * runs past midnight" is the same information with the common case free and the
 * rare case named.
 *
 * `startAt` in Firestore is still an instant, and `timeZone` still carries what
 * the parish meant. Only the input shape changed.
 */
import {
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  instantToWallClock,
  toDate,
  wallClockToInstant,
  type DocOf,
  type Event,
  type EventAudience,
  type EventCategory,
} from '@spsm/shared';
import type { EventContentDraft } from './admin';
import { PARISH_TIME_ZONE } from '@/lib/dates';

/* -------------------------------------------------------------------------- */
/* The state                                                                   */
/* -------------------------------------------------------------------------- */

export interface FormState {
  title: string;
  slug: string;
  summary: string;
  body: string;

  /** `YYYY-MM-DD`. The day it starts, in `timeZone`. */
  date: string;
  /** `HH:MM`, 24-hour, as `<input type="time">` gives it. Empty when all-day. */
  startTime: string;
  /** `HH:MM`, or empty for an open-ended event. */
  endTime: string;
  /** `YYYY-MM-DD`, and only when it is *not* the same day as `date`. */
  endDate: string;
  allDay: boolean;
  timeZone: string;

  locationName: string;
  locationAddress: string;
  meetingUrl: string;

  category: EventCategory;
  audience: EventAudience;
  /** A real array, not a comma-separated string. The input adds and removes. */
  tags: string[];
  registrationUrl: string;

  /** A Storage path under `events/`, already uploaded. Never a URL. */
  heroImagePath: string | null;
}

/*
 * There is no `published` in the state above, and no `published` on the document
 * either.
 *
 * It briefly left this state and stayed on the document, on the reasoning that
 * publishing was an act rather than a field somebody types. The act is gone too:
 * an event is on the website because it exists. Nothing here decides whether it
 * is visible, which is why this list is only the words and the dates.
 */

export const BLANK: FormState = {
  title: '',
  slug: '',
  summary: '',
  body: '',
  date: '',
  startTime: '',
  endTime: '',
  endDate: '',
  allDay: false,
  timeZone: PARISH_TIME_ZONE,
  locationName: '',
  locationAddress: '',
  meetingUrl: '',
  category: 'other',
  audience: 'parish',
  tags: [],
  registrationUrl: '',
  heroImagePath: null,
};

/* -------------------------------------------------------------------------- */
/* Wall clock <-> the three fields                                             */
/* -------------------------------------------------------------------------- */

/** `2026-09-06T19:00` -> `['2026-09-06', '19:00']`. */
function splitWall(wall: string): [string, string] {
  const at = wall.indexOf('T');
  return at === -1 ? [wall, ''] : [wall.slice(0, at), wall.slice(at + 1, at + 6)];
}

/**
 * The instant the form's start fields name, or null if they do not name one.
 *
 * All-day starts at midnight. That is the value `dayKey` needs to put the event
 * in the right calendar cell, and `formatEventWhen` never prints it.
 */
export function startWallOf(form: FormState): string {
  if (!form.date) return '';
  return `${form.date}T${form.allDay ? '00:00' : form.startTime || '00:00'}`;
}

/**
 * The end, which is genuinely optional — "open-ended" is a state the schema has
 * and the parish uses.
 *
 * An all-day event that spans days ends at the *end* of its last day rather than
 * the start of it, so a three-day festival reads as three days on the calendar
 * and in `formatDateSpan` rather than as two and a bit.
 */
export function endWallOf(form: FormState): string {
  const day = form.endDate || form.date;
  if (!day) return '';
  if (form.allDay) return form.endDate ? `${form.endDate}T23:59` : '';
  if (!form.endTime) return '';
  return `${day}T${form.endTime}`;
}

export function startInstantOf(form: FormState): Date | null {
  return wallClockToInstant(startWallOf(form), form.timeZone);
}

export function endInstantOf(form: FormState): Date | null {
  const wall = endWallOf(form);
  return wall ? wallClockToInstant(wall, form.timeZone) : null;
}

/* -------------------------------------------------------------------------- */
/* Reading a document in, writing a draft out                                  */
/* -------------------------------------------------------------------------- */

/**
 * The document as the editor's fields.
 *
 * One source now. This briefly read from a `pendingEdit` copy where one existed,
 * so that staff picked up their unpublished words while the page kept showing the
 * parish's — the whole mechanism went with the publish step, and with it the one
 * thing about this editor that could make the fields and the page disagree.
 */
export function fromEvent(event: DocOf<Event>): FormState {
  const content = event;

  const zone = content.timeZone || PARISH_TIME_ZONE;
  const start = toDate(content.startAt);
  const end = toDate(content.endAt);

  const [date, startTime] = start ? splitWall(instantToWallClock(start, zone)) : ['', ''];
  const [endDay, endTime] = end ? splitWall(instantToWallClock(end, zone)) : ['', ''];

  return {
    title: content.title,
    slug: event.slug,
    summary: content.summary,
    body: content.body,

    date,
    startTime: content.allDay ? '' : startTime,
    // Blank when it ends on the day it started, which is nearly always. The
    // field it feeds is hidden until there is something in it, so an event
    // being edited does not sprout a second date input it did not need.
    endDate: endDay && endDay !== date ? endDay : '',
    endTime: content.allDay ? '' : endTime,
    allDay: content.allDay,
    timeZone: zone,

    locationName: content.location?.name ?? '',
    locationAddress: content.location?.address ?? '',
    meetingUrl: content.location?.meetingUrl ?? '',

    category: content.category,
    audience: content.audience,
    tags: [...content.tags],
    registrationUrl: content.registration?.externalUrl ?? '',

    heroImagePath: content.heroImagePath ?? null,
  };
}

/**
 * The form as the thing `./admin` writes, or **null when it does not name a
 * moment in time**.
 *
 * Null rather than a throw, because the caller is autosave. A date field is
 * empty for a keystroke or two while somebody retypes it, and an exception on
 * every one of those would turn an ordinary correction into an error banner. The
 * honest answer is "there is nothing to save yet", and the bar says so.
 */
export function toContentDraft(form: FormState): EventContentDraft | null {
  const startAt = startInstantOf(form);
  if (!startAt) return null;

  return {
    title: form.title.trim(),
    summary: form.summary.trim(),
    body: form.body.trim(),
    startAt,
    endAt: endInstantOf(form),
    allDay: form.allDay,
    timeZone: form.timeZone,
    location: form.locationName.trim()
      ? {
          name: form.locationName.trim(),
          address: form.locationAddress.trim() || null,
          meetingUrl: form.meetingUrl.trim() || null,
        }
      : null,
    category: form.category,
    audience: form.audience,
    tags: form.tags.map((tag) => tag.trim()).filter(Boolean),
    registrationUrl: form.registrationUrl.trim() || null,
    heroImagePath: form.heroImagePath,
  };
}

/** Whether anything has been typed since the form was loaded or last saved. */
export function isDirty(form: FormState, baseline: FormState): boolean {
  return JSON.stringify(form) !== JSON.stringify(baseline);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/** Every field a problem can be attached to. Also what `name=` on the input is. */
export type FieldKey =
  | 'title'
  | 'slug'
  | 'summary'
  | 'body'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'endDate'
  | 'meetingUrl'
  | 'registrationUrl';

export interface Problem {
  field: FieldKey;
  message: string;
  /**
   * True for something the page *wants* rather than something that is wrong.
   *
   * It used to mean "needed to publish, not to save", and gated a Publish button.
   * There is no publish step any more, so nothing is gated by it — but the
   * distinction it draws is the one thing worth keeping from that mechanism:
   * "you have not written a description yet" is a fact about an unfinished event
   * and "it ends before it starts" is a mistake. Marking both in red the moment
   * an editor opens is how a form teaches people to ignore red.
   *
   * So these are advice, drawn quietly in the bar, and the others are errors,
   * drawn on the field. See `mistakes` and `stillMissing`.
   */
  optional?: boolean;
}

export function problemsOf(form: FormState): Problem[] {
  const found: Problem[] = [];

  if (!form.title.trim()) {
    found.push({ field: 'title', message: 'Give the event a name.' });
  }

  if (!form.slug) {
    found.push({ field: 'slug', message: 'The web address cannot be empty.' });
  } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug)) {
    found.push({
      field: 'slug',
      message: 'The web address may only use lowercase letters, numbers, and hyphens.',
    });
  }

  if (!form.date) {
    found.push({ field: 'date', message: 'Say which day it is on.' });
  } else if (!form.allDay && !form.startTime) {
    found.push({
      field: 'startTime',
      message: 'Give a start time, or turn on “all day”.',
    });
  }

  const start = startInstantOf(form);
  if (form.date && !start) {
    found.push({ field: 'date', message: 'That is not a date the calendar can read.' });
  }

  if (form.endDate && !form.allDay && !form.endTime) {
    found.push({
      field: 'endTime',
      message: 'It runs into another day, so it needs an end time as well.',
    });
  }

  const end = endInstantOf(form);
  if (start && end && end.getTime() < start.getTime()) {
    found.push({
      field: form.endDate ? 'endDate' : 'endTime',
      message: 'It ends before it starts.',
    });
  }

  if (form.meetingUrl.trim() && !/^https?:\/\//.test(form.meetingUrl.trim())) {
    found.push({
      field: 'meetingUrl',
      message: 'An online link has to start with http:// or https://',
    });
  }

  if (form.registrationUrl.trim() && !/^https?:\/\//.test(form.registrationUrl.trim())) {
    found.push({
      field: 'registrationUrl',
      message: 'A sign-up link has to start with http:// or https://',
    });
  }

  if (!form.summary.trim()) {
    found.push({
      field: 'summary',
      // A noun phrase, not a sentence: these are only ever read after "Still to
      // write:" in the bar, never on a field, so an imperative there reads as a
      // second instruction after the first one.
      message: 'the one line the calendar shows',
      optional: true,
    });
  }

  if (!form.body.trim()) {
    found.push({
      field: 'body',
      message: 'a description',
      optional: true,
    });
  }

  return found;
}

/**
 * The things that are actually *wrong* — an end before a start, a link that is
 * not a link, a date the calendar cannot read.
 *
 * Drawn on the field, in red, as soon as they are true. Nothing blocks a save,
 * because saving is not an action any more; what these buy is that a mistake is
 * pointed at rather than silently written.
 */
export function mistakes(form: FormState): Problem[] {
  return problemsOf(form).filter((problem) => !problem.optional);
}

/**
 * The things the event has not got round to yet — a summary, a description.
 *
 * Advice, not errors, and shown once in the bar rather than on the fields. An
 * event with neither is a real thing to have on the website for an afternoon
 * while somebody writes them, and it is now on the website the whole time, so
 * nagging in red about it would be nagging about the normal case.
 */
export function stillMissing(form: FormState): Problem[] {
  return problemsOf(form).filter((problem) => problem.optional);
}

/* -------------------------------------------------------------------------- */
/* Words for machine values                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Human labels for the enums.
 *
 * The old form rendered `EVENT_CATEGORIES` straight into `<option>`s, so a
 * volunteer chose between "liturgy", "outreach" and "other" in lower case —
 * which reads as a database field, because it is one. The values are unchanged;
 * only what is drawn over them.
 */
export const CATEGORY_LABELS: Record<EventCategory, string> = {
  liturgy: 'Liturgy or service',
  class: 'Class or study',
  outreach: 'Outreach and service',
  youth: 'Youth',
  seniors: 'Seniors',
  festival: 'Festival',
  camp: 'Camp or retreat',
  meeting: 'Meeting',
  other: 'Something else',
};

export const AUDIENCE_LABELS: Record<EventAudience, string> = {
  parish: 'The whole church',
  servants: 'Servants only',
};

export const CATEGORY_OPTIONS = EVENT_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const AUDIENCE_OPTIONS = EVENT_AUDIENCES.map((value) => ({
  value,
  label: AUDIENCE_LABELS[value],
}));
