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
 * `published` used to live in the state above and does not any more.
 *
 * It is not something anybody types — it is what is true of the document, and
 * with autosave the two cannot be the same field: typing writes `pendingEdit`,
 * and if `published` rode along in that payload then every keystroke would carry
 * an opinion about whether the event is on the website. Publishing is an act,
 * so it is a function on `./admin` and a button, and the editor reads the
 * document for the answer.
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
 * The document as the editor's fields, preferring what has been typed but not
 * yet published.
 *
 * `pendingEdit` wins where it exists, and that is the whole point of it: staff
 * pick up where they left off, while the fields underneath stay whatever the
 * parish is currently being shown. The fallback is not a nicety — an event
 * written before `pendingEdit` existed does not have the key at all.
 */
export function fromEvent(event: DocOf<Event>): FormState {
  // Spread rather than branch per field, so a field added to `EventContent`
  // later cannot be silently read from the wrong one of the two.
  const content = event.pendingEdit ? { ...event, ...event.pendingEdit } : event;

  const zone = content.timeZone || PARISH_TIME_ZONE;
  const start = toDate(content.startAt);
  const end = toDate(content.endAt);

  const [date, startTime] = start ? splitWall(instantToWallClock(start, zone)) : ['', ''];
  const [endDay, endTime] = end ? splitWall(instantToWallClock(end, zone)) : ['', ''];

  return {
    title: content.title,
    // From the document, never from the pending edit: the slug is not editable
    // and `EventContent` does not carry it.
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
   * True for something the public page needs and a draft does not.
   *
   * This is the difference that makes the form usable. Somebody standing in the
   * church hall wants to write down "Festival, September 3rd" and finish it at
   * home — and the old form refused to save that at all, because it demanded a
   * summary and a description first. So a draft needs only a name and a date,
   * and the rest is required at the moment it becomes public, which is the
   * moment it is actually true.
   */
  publishOnly?: boolean;
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
      message: 'Write the one-line summary — it is what the calendar shows.',
      publishOnly: true,
    });
  }

  if (!form.body.trim()) {
    found.push({
      field: 'body',
      message: 'Write the description before this goes on the website.',
      publishOnly: true,
    });
  }

  return found;
}

/**
 * Everything that must be true before this event may go on the website.
 *
 * All of them, `publishOnly` included — that flag's whole meaning is "needed to
 * publish, not to save", and this is the one caller for which it is needed.
 */
export function publishProblems(form: FormState): Problem[] {
  return problemsOf(form);
}

/**
 * The problems worth showing while somebody is still typing.
 *
 * Not the `publishOnly` ones. "Write the description" is true of a draft and is
 * not a mistake, and marking an empty field red the moment an editor opens is
 * how a form teaches people to ignore red. These are the entries that are
 * actually *wrong* — an end before a start, a link that is not a link — and
 * saying so immediately is the only time it is useful.
 */
export function liveProblems(form: FormState): Problem[] {
  return problemsOf(form).filter((problem) => !problem.publishOnly);
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
  parish: 'The whole parish',
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
