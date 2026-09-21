/**
 * The shape of the event editor's fields, and every pure function over them.
 *
 * ## One implementation, two editors
 *
 * The parish edits an event in two places now — in a browser, on the event's
 * own page, and in the mobile app, on the same page — and both are writing the
 * same document through the same rules. This is the part with the arithmetic in
 * it: wall-clock splitting, what counts as a mistake, and what a category is
 * called in English. None of it needs React, a browser, a phone or Firestore to
 * be read or tested, and none of it is allowed to differ between the two
 * surfaces: an event whose end time is accepted in one and refused in the other
 * is one document with two opinions about itself.
 *
 * It began as `apps/website/src/features/events/form.ts` and moved here when
 * the app grew its editor, at Tommy's direction — one implementation both
 * import, rather than a copy in the app repo kept in step by a comment. What
 * stays on each side is the *drawing*: `<input type="date">` in a browser,
 * typed `YYYY-MM-DD` fields on a phone, because React Native has no date input
 * and the community picker is a native dependency for two build targets, one of
 * them an App Clip with a 15MB budget.
 *
 * ## The one structural decision
 *
 * A **date and two times**, not two datetimes. Almost every event the parish
 * runs is one day long, and a pair of full date entries makes "9am to 11am" and
 * "9am on the 3rd to 11am on the 30th" look identical — which is how a festival
 * ends up listed as lasting a month. A date, a start, an end, and an end *date*
 * that exists only when the thing runs past midnight is the same information
 * with the common case free and the rare case named.
 *
 * `startAt` on the document is still an instant and `timeZone` still carries
 * what the parish meant. Only the input shape differs.
 *
 * ## There is no `published`, here or on the document
 *
 * An event is on the website because it exists. Nothing in this state decides
 * whether it is visible, which is why the list below is only the words and the
 * dates. See the header of `schema/events.ts` for what that costs.
 *
 * ## The slug is carried and never validated
 *
 * It used to be checked here, back when the same form created events. Nothing
 * on either surface creates one now — a new event has no page for an in-place
 * editor to be in place *on* — so the slug is settled in the Firestore console,
 * shown by both editors, and editable by neither. A rule for a field nobody can
 * type is a rule that can only ever be wrong about a document somebody else
 * wrote.
 */
import {
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  type Event,
  type EventAudience,
  type EventCategory,
  type EventLocation,
} from './schema/events.js';
import { toDate } from './schema/common.js';
import {
  PARISH_TIME_ZONE,
  instantToWallClock,
  wallClockToInstant,
} from './timezones.js';

/* -------------------------------------------------------------------------- */
/* The state                                                                  */
/* -------------------------------------------------------------------------- */

export interface EventFormState {
  title: string;
  /** Shown, never edited. The public address, and the photograph's folder. */
  slug: string;
  summary: string;
  body: string;

  /** `YYYY-MM-DD`. The day it starts, in `timeZone`. */
  date: string;
  /** `HH:MM`, 24-hour. Empty when all-day. */
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
  /** A real array, not a comma-separated string. The editors add and remove. */
  tags: string[];
  registrationUrl: string;

  /** A Storage path under `events/`, already uploaded. Never a URL. */
  heroImagePath: string | null;
}

/**
 * What the writers write: the form in the document's own units.
 *
 * `Date` and a bare URL string rather than the document's `Timestamped` and
 * `registration` object, because this is the boundary. Everything above it
 * thinks in wall clocks and text fields; everything below thinks in the shapes
 * `schema/events.ts` describes. `slug` is absent for the reason in the header.
 */
export interface EventDraft {
  title: string;
  summary: string;
  body: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timeZone: string;
  location: EventLocation | null;
  heroImagePath: string | null;
  category: EventCategory;
  audience: EventAudience;
  tags: string[];
  registrationUrl: string | null;
}

export const BLANK_EVENT_FORM: EventFormState = {
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
/* Wall clock <-> the four fields                                             */
/* -------------------------------------------------------------------------- */

/** `2026-09-06T19:00` -> `['2026-09-06', '19:00']`. */
function splitWall(wall: string): [string, string] {
  const at = wall.indexOf('T');
  return at === -1 ? [wall, ''] : [wall.slice(0, at), wall.slice(at + 1, at + 6)];
}

/**
 * The wall clock the start fields name.
 *
 * All-day starts at midnight. That is the value `dayKey` needs to put the event
 * in the right calendar cell, and `formatEventWhen` never prints it.
 */
export function startWallOf(form: EventFormState): string {
  if (!form.date) return '';
  return `${form.date}T${form.allDay ? '00:00' : form.startTime || '00:00'}`;
}

/**
 * The end, which is genuinely optional — open-ended is a state the schema has
 * and the parish uses.
 *
 * An all-day event spanning days ends at the *end* of its last day rather than
 * the start of it, so a three-day festival reads as three days in
 * `formatDateSpan` and on the calendar rather than as two and a bit.
 */
export function endWallOf(form: EventFormState): string {
  const day = form.endDate || form.date;
  if (!day) return '';
  if (form.allDay) return form.endDate ? `${form.endDate}T23:59` : '';
  if (!form.endTime) return '';
  return `${day}T${form.endTime}`;
}

export function startInstantOf(form: EventFormState): Date | null {
  return wallClockToInstant(startWallOf(form), form.timeZone);
}

export function endInstantOf(form: EventFormState): Date | null {
  const wall = endWallOf(form);
  return wall ? wallClockToInstant(wall, form.timeZone) : null;
}

/* -------------------------------------------------------------------------- */
/* Reading a document in, writing a draft out                                 */
/* -------------------------------------------------------------------------- */

/**
 * The document as the editor's fields.
 *
 * Takes the `Event` itself rather than a `DocOf<Event>`, so the id stays the
 * caller's business — the website holds one and the app holds one, and neither
 * puts it in a form.
 */
export function eventToForm(event: Event): EventFormState {
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
    /*
     * Blank when it ends on the day it started, which is nearly always. The
     * field it feeds is drawn only when there is something in it, so an event
     * being edited does not sprout a second date input it never needed.
     */
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

    heroImagePath: event.heroImagePath ?? null,
  };
}

/**
 * The form as the thing the writers take, or **null when it does not name a
 * moment in time**.
 *
 * Null rather than a throw, because the caller is autosave. A date field is
 * empty for a keystroke or two while somebody retypes it, and an exception on
 * every one of those would turn an ordinary correction into an error banner.
 * The honest answer is "there is nothing to save yet", and both editors say so.
 */
export function formToDraft(form: EventFormState): EventDraft | null {
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

/**
 * The draft as the document's fields — everything a write sends, and nothing
 * else.
 *
 * `slug` and `recurrence` are absent: the first is settled at creation and the
 * second is out of scope for the whole schema. The audit fields are the
 * writer's to stamp, because only the writer knows which SDK's
 * `serverTimestamp` it is holding.
 *
 * This is an overwrite rather than a patch, deliberately. A field left out of
 * an autosave would be a field silently keeping an older value while the editor
 * showed the new one.
 */
export function draftToDocument(draft: EventDraft): Omit<
  Event,
  'slug' | 'recurrence' | 'createdAt' | 'updatedAt' | 'updatedBy'
> {
  return {
    title: draft.title,
    summary: draft.summary,
    body: draft.body,

    startAt: draft.startAt,
    endAt: draft.endAt,
    allDay: draft.allDay,
    timeZone: draft.timeZone,

    location: draft.location,
    heroImagePath: draft.heroImagePath,

    category: draft.category,
    tags: draft.tags,
    audience: draft.audience,

    /*
     * `formId` is deliberately not settable, and the whole `registration`
     * object is rebuilt from one field rather than merged. Both editors offer
     * an external URL and nothing else; a merge would preserve an `opensAt` or
     * a `capacity` that no editor on either surface can see or clear, which is
     * a value nobody can account for.
     *
     * The reason only the URL is offered: `formId` points at the `forms`
     * collection, and the website has no `/forms/[slug]` route — a link built
     * from it would send a parishioner to a 404. The app does have that screen,
     * which makes honouring it a real and reasonable change, but one to make on
     * both surfaces at once.
     */
    registration: draft.registrationUrl
      ? {
          formId: null,
          externalUrl: draft.registrationUrl,
          opensAt: null,
          closesAt: null,
          capacity: null,
        }
      : null,
  };
}

/**
 * An event with a just-saved draft applied.
 *
 * For the page underneath the editor, which owns the copy it draws and would
 * otherwise still be showing what was read on the way in. Written here rather
 * than spelled out at each call site because the awkward part — that
 * `registrationUrl` is the editor's shape and must not ride along into the
 * document as a stray key — is exactly the part that is easy to get wrong
 * twice.
 */
export function applyDraft<T extends Event>(event: T, draft: EventDraft): T {
  return { ...event, ...draftToDocument(draft) };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/** Every field a problem can be attached to. Also what `name=` on the input is. */
export type EventFieldKey =
  | 'title'
  | 'summary'
  | 'body'
  | 'date'
  | 'startTime'
  | 'endTime'
  | 'endDate'
  | 'meetingUrl'
  | 'registrationUrl';

export interface EventProblem {
  field: EventFieldKey;
  message: string;
  /**
   * True for something the page *wants* rather than something that is wrong.
   *
   * It used to mean "needed to publish, not to save", and gated a Publish
   * button. There is no publish step any more, so nothing is gated by it — but
   * the distinction it draws is the one thing worth keeping from that
   * mechanism: "you have not written a description yet" is a fact about an
   * unfinished event, and "it ends before it starts" is a mistake. Marking both
   * in red the moment an editor opens is how a form teaches people to ignore
   * red.
   *
   * So these are advice, drawn quietly and once, and the others are errors,
   * drawn on the field. See `eventMistakes` and `eventStillMissing`.
   */
  optional?: boolean;
}

/*
 * The shapes are checked rather than assumed.
 *
 * A browser's date and time inputs cannot produce anything else, so on the
 * website these two never fire. The app's fields are typed text — see the
 * header — and there they are the difference between "Write the day as
 * 2026-09-06" and a save that silently does nothing because
 * `wallClockToInstant` could not read `2026-9-6`.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function eventProblems(form: EventFormState): EventProblem[] {
  const found: EventProblem[] = [];

  if (!form.title.trim()) {
    found.push({ field: 'title', message: 'Give the event a name.' });
  }

  if (!form.date) {
    found.push({ field: 'date', message: 'Say which day it is on.' });
  } else if (!DAY.test(form.date)) {
    found.push({ field: 'date', message: 'Write the day as 2026-09-06.' });
  } else if (!startInstantOf(form)) {
    found.push({ field: 'date', message: 'That is not a date the calendar can read.' });
  }

  if (!form.allDay && form.startTime && !CLOCK.test(form.startTime)) {
    found.push({ field: 'startTime', message: 'Write the time as 19:00.' });
  } else if (form.date && !form.allDay && !form.startTime) {
    found.push({ field: 'startTime', message: 'Give a start time, or turn on “all day”.' });
  }

  if (!form.allDay && form.endTime && !CLOCK.test(form.endTime)) {
    found.push({ field: 'endTime', message: 'Write the time as 21:00.' });
  }

  if (form.endDate && !DAY.test(form.endDate)) {
    found.push({ field: 'endDate', message: 'Write the day as 2026-09-06.' });
  } else if (form.endDate && !form.allDay && !form.endTime) {
    found.push({
      field: 'endTime',
      message: 'It runs into another day, so it needs an end time as well.',
    });
  }

  const start = startInstantOf(form);
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

  /*
   * Noun phrases, not sentences: these are only ever read after "Still to
   * write:", never on a field, and an imperative there reads as a second
   * instruction after the first one.
   */
  if (!form.summary.trim()) {
    found.push({
      field: 'summary',
      message: 'the one line the calendar shows',
      optional: true,
    });
  }

  if (!form.body.trim()) {
    found.push({ field: 'body', message: 'a description', optional: true });
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
export function eventMistakes(form: EventFormState): EventProblem[] {
  return eventProblems(form).filter((problem) => !problem.optional);
}

/**
 * The things the event has not got round to yet — a summary, a description.
 *
 * Advice, not errors, and shown once rather than on the fields. An event with
 * neither is a real thing to have on the website for an afternoon while
 * somebody writes them, and it is on the website that whole time, so nagging in
 * red about it would be nagging about the normal case.
 */
export function eventStillMissing(form: EventFormState): EventProblem[] {
  return eventProblems(form).filter((problem) => problem.optional);
}

/* -------------------------------------------------------------------------- */
/* Words for machine values                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Human labels for the enums.
 *
 * The first version of the form rendered `EVENT_CATEGORIES` straight into
 * `<option>`s, so a volunteer chose between "liturgy", "outreach" and "other"
 * in lower case — which reads as a database field, because it is one. The
 * stored values are unchanged; only what is drawn over them.
 */
export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
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

export const EVENT_AUDIENCE_LABELS: Record<EventAudience, string> = {
  parish: 'The whole church',
  servants: 'Servants only',
};

export const EVENT_CATEGORY_OPTIONS = EVENT_CATEGORIES.map((value) => ({
  value,
  label: EVENT_CATEGORY_LABELS[value],
}));

export const EVENT_AUDIENCE_OPTIONS = EVENT_AUDIENCES.map((value) => ({
  value,
  label: EVENT_AUDIENCE_LABELS[value],
}));
