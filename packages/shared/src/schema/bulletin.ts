/**
 * The weekly bulletin, as it exists in the `weeklyannouncements-1d046` project.
 *
 * We do **not** copy this into our own Firestore. The website reads that project
 * directly at build time and bakes the result into static HTML.
 *
 * What that buys and what it costs, so the trade is on the record:
 *
 *   + One source of truth. No mirror to fall behind, no `syncedAt` to reason
 *     about, no scheduled Function to watch.
 *   − No history. The source is a singleton it overwrites every week, so once
 *     it rolls over, that week is gone everywhere. Only a build that ran while
 *     a given week was current has ever seen it.
 *   − The build now needs the announcements service account. Reading another
 *     project requires its credentials, and credentials cannot live in a
 *     browser — so this is build-time only, and `next build` can no longer run
 *     from public config alone.
 *
 * Editor scratch space is deliberately not carried across — `templateId`,
 * `presetId`, `slideDurations`, `slideImages`, `telegramMessageIds`. Those
 * describe how the source app renders a slideshow and mean nothing here.
 */

export interface Bulletin {
  /**
   * Monday's date, `YYYY-MM-DD`. Taken from `days[0].date`, which the source
   * generates, rather than `weekLabel`, which a person types.
   */
  weekOf: string;

  /** As the editor wrote it: "August 3, 2026". Display only. */
  weekLabel: string;

  /** Theme the editor named for the week ("Summer Camp Week"), trimmed. */
  presetName: string | null;

  announcements: BulletinAnnouncement[];
  days: BulletinDay[];
  multiDayEvents: BulletinMultiDayEvent[];

  /** Free-text notes the editor put at the top of the sheet. */
  headerNotes: string[];

  source: BulletinSource;
}

/** One item from the bulletin's announcement list. */
export interface BulletinAnnouncement {
  /** The id the source assigned. */
  sourceId: string;
  text: string;
  /** Image reference exactly as the source stored it; often empty. */
  image: string | null;
  addedAt: Date | null;
}

export interface BulletinDay {
  /** `YYYY-MM-DD`. */
  date: string;
  /** "Monday". Kept as written rather than derived, so it matches the sheet. */
  day: string;
  events: BulletinEvent[];
}

/**
 * Times are kept as the display strings the source holds ("7:30am"), not parsed
 * into instants.
 *
 * Parsing would mean assuming a format the source does not guarantee and a time
 * zone it does not record, then silently producing a wrong instant when either
 * assumption breaks. A bulletin is a human-readable sheet; printing what the
 * parish actually wrote is both simpler and more faithful.
 */
export interface BulletinEvent {
  sourceId: string;
  name: string;
  time: string | null;
  timeTo: string | null;
  notes: string | null;
  /** Hex colour the editor picked for the slide. Useful as a category hint. */
  color: string | null;
  image: string | null;
  /**
   * Shape unknown — every sample observed so far has been empty, so this is
   * passed through rather than modelled. Type it properly once a non-empty one
   * turns up instead of guessing now.
   */
  contacts: unknown[];
}

export interface BulletinMultiDayEvent extends BulletinEvent {
  /** `YYYY-MM-DD`. */
  startDate: string;
  endDate: string;
}

/** Where this came from, and how current it was when we read it. */
export interface BulletinSource {
  project: string;
  collection: string;
  /** Document id in the source project. */
  documentId: string;
  /** When the source app last published — its `lastPublished`. */
  publishedAt: Date | null;
  /** The source's own `updatedAt`. */
  sourceUpdatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Thrown only when the week cannot be identified. Everything else degrades.
 */
export class BulletinShapeError extends Error {
  constructor(message: string) {
    super(`Bulletin from the announcements project is unusable: ${message}`);
    this.name = 'BulletinShapeError';
  }
}

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Trimmed string, or null for anything blank, absent, or the wrong type. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The source stores timestamps as ISO 8601 strings. Parsed to `Date` rather
 * than a Firestore `Timestamp` so this module stays free of any SDK — it runs
 * in the Next build, and could run in the browser or in Functions without
 * change.
 */
function date(value: unknown): Date | null {
  const raw = str(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseEvent(raw: unknown, index: number): BulletinEvent | null {
  const record = asRecord(raw);
  if (!record) return null;

  const name = str(record['name']);
  // An event with no name is a blank row in the editor, not data.
  if (name === null) return null;

  return {
    sourceId: str(record['id']) ?? `unnamed-${index}`,
    name,
    time: str(record['time']),
    timeTo: str(record['timeTo']),
    notes: str(record['notes']),
    color: str(record['color']),
    image: str(record['image']),
    contacts: asArray(record['contacts']),
  };
}

function parseDay(raw: unknown): BulletinDay | null {
  const record = asRecord(raw);
  if (!record) return null;

  const value = str(record['date']);
  if (value === null || !ISO_DATE.test(value)) return null;

  return {
    date: value,
    day: str(record['day']) ?? '',
    events: asArray(record['events'])
      .map(parseEvent)
      .filter((e): e is BulletinEvent => e !== null),
  };
}

function parseMultiDayEvent(raw: unknown, index: number): BulletinMultiDayEvent | null {
  const base = parseEvent(raw, index);
  const record = asRecord(raw);
  if (!base || !record) return null;

  const startDate = str(record['startDate']);
  const endDate = str(record['endDate']);
  if (startDate === null || endDate === null) return null;

  return { ...base, startDate, endDate };
}

function parseAnnouncement(raw: unknown, index: number): BulletinAnnouncement | null {
  const record = asRecord(raw);
  if (!record) return null;

  const text = str(record['text']);
  if (text === null) return null;

  return {
    sourceId: str(record['id']) ?? `untitled-${index}`,
    text,
    image: str(record['image']),
    addedAt: date(record['addedAt']),
  };
}

export interface BulletinOrigin {
  project: string;
  collection: string;
  documentId: string;
}

/**
 * Normalize one source document.
 *
 * Everything is defensive. This document is written by an app we do not own,
 * whose schema was inferred from a single sample and which nobody is obliged to
 * keep stable. A field that changes type degrades to null and keeps the rest of
 * the week, rather than blanking the page — with one exception, `weekOf`, which
 * identifies the week and is not worth guessing at.
 */
export function parseBulletin(raw: Raw, origin: BulletinOrigin): Bulletin {
  const days = asArray(raw['days'])
    .map(parseDay)
    .filter((d): d is BulletinDay => d !== null)
    // The source emits them in order, but the week key depends on the first
    // one, so do not rely on that.
    .sort((a, b) => a.date.localeCompare(b.date));

  const weekOf = days[0]?.date;
  if (weekOf === undefined) {
    throw new BulletinShapeError('no usable date in days[] — cannot tell which week this is');
  }

  const weekLabel = str(raw['weekLabel']);
  if (weekLabel === null) {
    throw new BulletinShapeError('missing or empty "weekLabel"');
  }

  return {
    weekOf,
    weekLabel,
    presetName: str(raw['presetName']),

    announcements: asArray(raw['announcements'])
      .map(parseAnnouncement)
      .filter((a): a is BulletinAnnouncement => a !== null),

    days,

    multiDayEvents: asArray(raw['multiDayEvents'])
      .map(parseMultiDayEvent)
      .filter((e): e is BulletinMultiDayEvent => e !== null),

    headerNotes: asArray(raw['headerNotes'])
      .map(str)
      .filter((n): n is string => n !== null),

    source: {
      project: origin.project,
      collection: origin.collection,
      documentId: origin.documentId,
      publishedAt: date(raw['lastPublished']),
      sourceUpdatedAt: date(raw['updatedAt']),
    },
  };
}
