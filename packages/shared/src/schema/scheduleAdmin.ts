/**
 * The two things staff may add to a schedule they do not own.
 *
 * ---------------------------------------------------------------------------
 * Why there are two collections and not one.
 *
 * The calendar is assembled from sources the parish maintains elsewhere —
 * Breeze, and the weekly bulletin — plus the site's own `events`. Staff need
 * two different powers over that, and they are genuinely different:
 *
 *   `scheduleEntries`  something the parish is doing that no source knows
 *                      about. Ours entirely, so it can be edited and deleted.
 *   `calendarDetails`  something to *say about* an occurrence that already
 *                      exists. An annotation. It never creates or removes an
 *                      entry, and deleting it leaves the event untouched.
 *
 * Keeping them apart is what makes the editing rule enforceable rather than
 * merely intended: **staff can only remove what staff added.** A delete control
 * appears on a `scheduleEntries` document and nowhere else, because there is
 * nothing else in the calendar we are entitled to delete. Deleting a liturgy
 * from the website would not delete it from Breeze — it would just make the
 * website lie, and the next sync would put it back.
 *
 * One collection with an "is ours" flag would have collapsed that distinction
 * into a boolean somebody could set.
 * ---------------------------------------------------------------------------
 */
import type { AuditFields } from './common.js';
import type { CalendarOccurrence, OccurrenceKind } from './calendar.js';

/** Document ids in these two collections are Firestore-generated. */
export const SCHEDULE_KINDS: readonly OccurrenceKind[] = [
  'liturgy',
  'study',
  'gathering',
  'other',
];

/**
 * Something the parish is doing that no source knows about.
 *
 * Deliberately much lighter than an `Event`: no slug, no body, no hero image,
 * and no page of its own. An `Event` is a thing with a story to tell — summer
 * camp, the festival — and it earns `/events/<slug>`. This is "choir practice
 * moved to Tuesday", which belongs on a calendar and nowhere else, and giving
 * it a page would put it on `/events` next to the festival.
 */
export interface ScheduleEntry extends Partial<AuditFields> {
  title: string;
  /** `YYYY-MM-DD`, the first day. */
  day: string;
  /** `YYYY-MM-DD`, the last day, inclusive. Equals `day` for a single day. */
  endDay: string;
  /** `HH:MM`, 24-hour, parish wall clock. Empty when `allDay`. */
  startTime: string;
  endTime: string;
  allDay: boolean;
  /**
   * Chosen rather than guessed.
   *
   * Every other source has its kind derived from its title, because there is
   * nothing else to go on. Here somebody is typing the thing in, so asking is
   * both more accurate and less work than a classifier.
   */
  kind: OccurrenceKind;
  note: string;
  location: string;
}

export const EMPTY_SCHEDULE_ENTRY: ScheduleEntry = {
  title: '',
  day: '',
  endDay: '',
  startTime: '',
  endTime: '',
  allDay: false,
  kind: 'other',
  note: '',
  location: '',
};

/**
 * Something to say about an occurrence that already exists.
 *
 * Keyed by the occurrence's own id — a Breeze instance id, `bulletin:<id>`,
 * `event:<slug>` — which is why `CalendarOccurrence.id` has to stay stable.
 *
 * A caveat worth knowing rather than discovering: Breeze instance ids are
 * stable, so a note on a liturgy stays put; the bulletin regenerates every
 * week, so a note attached to a bulletin entry is a note about *that week's*
 * copy of it and will not follow the event into next week's sheet. That is
 * usually what somebody writing "we are in the hall this week" meant anyway.
 */
export interface CalendarDetail extends Partial<AuditFields> {
  /** The `CalendarOccurrence.id` this is about. Also the document id. */
  occurrenceId: string;
  note: string;
  /**
   * Where it actually is.
   *
   * Never in conflict with the source: Breeze sends an empty location on every
   * event it has, so this fills a gap rather than overriding anything.
   */
  location: string;
  contactName: string;
  contactPhone: string;
  linkUrl: string;
  /** What to call the link. Falls back to the URL's host if left blank. */
  linkLabel: string;
}

export const EMPTY_CALENDAR_DETAIL: CalendarDetail = {
  occurrenceId: '',
  note: '',
  location: '',
  contactName: '',
  contactPhone: '',
  linkUrl: '',
  linkLabel: '',
};

/* ---- parsing ------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** `HH:MM`, or empty for anything that is not one. */
function time(value: unknown): string {
  const raw = str(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : '';
}

/** `YYYY-MM-DD`, or empty. */
function day(value: unknown): string {
  const raw = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

/** Per-field fallback, in the style of `parseIntegrationsConfig`. Never throws. */
export function parseScheduleEntry(raw: unknown): ScheduleEntry {
  const doc = asRecord(raw);
  const first = day(doc?.['day']);
  const last = day(doc?.['endDay']);
  const startTime = time(doc?.['startTime']);
  const kind = str(doc?.['kind']) as OccurrenceKind;

  return {
    title: str(doc?.['title']),
    day: first,
    // Never before the start. A reversed pair would render a span that
    // `daysBetween` refuses, so the entry would silently appear on no day at all.
    endDay: last !== '' && last >= first ? last : first,
    startTime,
    endTime: time(doc?.['endTime']),
    // An entry with no readable start time is an all-day entry, whatever the
    // stored flag says — there is no hour to print.
    allDay: doc?.['allDay'] === true || startTime === '',
    kind: SCHEDULE_KINDS.includes(kind) ? kind : 'other',
    note: str(doc?.['note']),
    location: str(doc?.['location']),
  };
}

export function parseCalendarDetail(raw: unknown): CalendarDetail {
  const doc = asRecord(raw);

  return {
    occurrenceId: str(doc?.['occurrenceId']),
    note: str(doc?.['note']),
    location: str(doc?.['location']),
    contactName: str(doc?.['contactName']),
    contactPhone: str(doc?.['contactPhone']),
    // Rendered as an `href`, so the same allowlist reasoning as the Breeze
    // embed applies: `javascript:` in a link is a script running as us.
    linkUrl: isSafeLink(str(doc?.['linkUrl'])) ? str(doc?.['linkUrl']) : '',
    linkLabel: str(doc?.['linkLabel']),
  };
}

/**
 * http and https only.
 *
 * An allowlist rather than a blocklist, and not a formality: this value becomes
 * an `href` on a page every parishioner reads, and `javascript:` there is
 * arbitrary script running on our origin. `mailto:` and `tel:` are excluded too
 * — not because they are dangerous but because nothing needs them here, and the
 * narrowest rule that does the job is the one to have.
 */
export function isSafeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** "zoom.us" — what to call a link nobody labelled. */
export function linkLabelFor(detail: CalendarDetail): string {
  if (detail.linkLabel !== '') return detail.linkLabel;
  try {
    return new URL(detail.linkUrl).hostname.replace(/^www\./, '');
  } catch {
    return detail.linkUrl;
  }
}

/* ---- turning both into occurrences -------------------------------------- */

/**
 * A manually added entry, in the schedule's shape.
 *
 * `source: 'manual'` is what the UI keys its delete control off — see the note
 * at the top of this file. It is the only source the parish owns outright.
 */
export function occurrenceOfScheduleEntry(
  entry: ScheduleEntry,
  id: string,
): CalendarOccurrence | null {
  if (entry.title === '' || entry.day === '') return null;

  return {
    id: `manual:${id}`,
    title: entry.title,
    day: entry.day,
    endDay: entry.endDay,
    startTime: entry.allDay ? null : entry.startTime,
    endTime: entry.allDay || entry.endTime === '' ? null : entry.endTime,
    allDay: entry.allDay,
    location: entry.location,
    description: entry.note,
    source: 'manual',
    kind: entry.kind,
    href: null,
    imageUrl: null,
    contact: null,
    link: null,
  };
}

/**
 * Lay the details over the occurrences they belong to.
 *
 * A detail **fills gaps and adds; it does not overwrite a title or a time.**
 * Those come from the source of truth, and a website quietly disagreeing with
 * Breeze about when the Liturgy starts is worse than a website with less on it.
 * What a detail may do is supply a location Breeze left blank, a note nobody
 * else has anywhere to put, a contact, and a link.
 *
 * The note is appended to any description the source already carried rather
 * than replacing it, so annotating a bulletin event does not lose what the
 * bulletin said.
 */
export function applyCalendarDetails(
  occurrences: CalendarOccurrence[],
  details: Map<string, CalendarDetail>,
): CalendarOccurrence[] {
  if (details.size === 0) return occurrences;

  return occurrences.map((occurrence) => {
    const detail = details.get(occurrence.id);
    if (!detail) return occurrence;

    const contact =
      detail.contactName === ''
        ? occurrence.contact
        : [detail.contactName, detail.contactPhone].filter((part) => part !== '').join(' · ');

    return {
      ...occurrence,
      location: occurrence.location !== '' ? occurrence.location : detail.location,
      description:
        detail.note === ''
          ? occurrence.description
          : occurrence.description === ''
            ? detail.note
            : `${occurrence.description} · ${detail.note}`,
      contact,
      link:
        detail.linkUrl === '' ? occurrence.link : { url: detail.linkUrl, label: linkLabelFor(detail) },
      hasDetail: true,
    };
  });
}
