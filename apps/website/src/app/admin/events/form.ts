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
import type { EventDraft } from '@/features/events/admin';
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

  published: boolean;
  /** A Storage path under `events/`, already uploaded. Never a URL. */
  heroImagePath: string | null;
}

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
  published: false,
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

export function fromEvent(event: DocOf<Event>): FormState {
  const zone = event.timeZone || PARISH_TIME_ZONE;
  const start = toDate(event.startAt);
  const end = toDate(event.endAt);

  const [date, startTime] = start ? splitWall(instantToWallClock(start, zone)) : ['', ''];
  const [endDay, endTime] = end ? splitWall(instantToWallClock(end, zone)) : ['', ''];

  return {
    title: event.title,
    slug: event.slug,
    summary: event.summary,
    body: event.body,

    date,
    startTime: event.allDay ? '' : startTime,
    // Blank when it ends on the day it started, which is nearly always. The
    // field it feeds is hidden until there is something in it, so an event
    // being edited does not sprout a second date input it did not need.
    endDate: endDay && endDay !== date ? endDay : '',
    endTime: event.allDay ? '' : endTime,
    allDay: event.allDay,
    timeZone: zone,

    locationName: event.location?.name ?? '',
    locationAddress: event.location?.address ?? '',
    meetingUrl: event.location?.meetingUrl ?? '',

    category: event.category,
    audience: event.audience,
    tags: [...event.tags],
    registrationUrl: event.registration?.externalUrl ?? '',

    published: event.published,
    heroImagePath: event.heroImagePath ?? null,
  };
}

/**
 * A copy of an event, ready to be saved as a new one.
 *
 * Here because it is the parish's most common act of authorship: the festival,
 * the camp and the classes come round every year with the same description and
 * a different date. Without it that is a re-type; with it, it is a date.
 *
 * The date is deliberately *cleared* rather than moved a year on. A blank date
 * is a field somebody has to fill; a plausible wrong date is a field somebody
 * skips.
 */
export function duplicateOf(form: FormState): FormState {
  return {
    ...form,
    title: `${form.title} (copy)`,
    slug: '',
    date: '',
    endDate: '',
    // Published is never inherited. A copy is a draft until somebody says
    // otherwise, or duplicating an event puts a half-finished one on the site.
    published: false,
    // The photograph belongs to the original's Storage path. Sharing it would
    // mean clearing one event's picture deletes the other's.
    heroImagePath: null,
  };
}

export function toDraft(form: FormState): EventDraft {
  const startAt = startInstantOf(form);
  if (!startAt) throw new Error('The start date and time are not valid.');

  return {
    slug: form.slug,
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
    published: form.published,
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

/** The subset that actually stops a save, given whether this is going public. */
export function blockingProblems(form: FormState): Problem[] {
  return problemsOf(form).filter((problem) => form.published || !problem.publishOnly);
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

/**
 * Which fold a field lives in, so a problem can open the section it is in
 * before trying to focus the input.
 *
 * A collapsed section's inputs are not in the document, and `.focus()` on
 * nothing is a save button that reports two problems and then appears to do
 * nothing about them.
 */
export type SectionId = 'essentials' | 'photograph' | 'more' | 'address';

export const SECTION_OF: Record<FieldKey, SectionId> = {
  title: 'essentials',
  summary: 'essentials',
  body: 'essentials',
  date: 'essentials',
  startTime: 'essentials',
  endTime: 'essentials',
  endDate: 'essentials',
  meetingUrl: 'more',
  registrationUrl: 'more',
  slug: 'address',
};
