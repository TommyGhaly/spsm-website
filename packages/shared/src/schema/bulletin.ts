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
   * Who to ask about this event.
   *
   * This used to be `unknown[]`, with a note saying to type it properly once a
   * non-empty one turned up. One has: the High School Bible Study for the week
   * of 2026-08-24 carries
   * `[{ name: 'Servant Michael', phone: '(774) 573-7878' }]`.
   *
   * Still parsed defensively — the source app can put whatever it likes here,
   * and an entry that is not an object with a name is dropped rather than
   * rendered as `[object Object]`.
   */
  contacts: BulletinContact[];
}

/** A name, and a phone number if the editor gave one. */
export interface BulletinContact {
  name: string;
  phone: string | null;
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
 * Contacts, keeping only the entries that are actually a person.
 *
 * A name is the minimum — a contact with only a phone number is a number
 * nobody can attribute, and rendering it would be worse than omitting it.
 */
function contacts(value: unknown): BulletinContact[] {
  return asArray(value)
    .map((entry) => {
      const record = asRecord(entry);
      const name = str(record?.['name']);
      return name === null ? null : { name, phone: str(record?.['phone']) };
    })
    .filter((entry): entry is BulletinContact => entry !== null);
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
    contacts: contacts(record['contacts']),
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

// ---------------------------------------------------------------------------
// Which bulletin is the live one
// ---------------------------------------------------------------------------

/**
 * The document in the announcements project that names the bulletin currently
 * being presented: `{ id: "318bf22a-…" }`, an id in `bulletins`.
 *
 * ---------------------------------------------------------------------------
 * **This pointer is the answer, and nothing derived from the documents is.**
 *
 * The original rule here was "sort by week and take the newest", written when
 * the source was documented as a singleton overwritten weekly. It is not one:
 * the collection holds the week being presented *plus* whichever future week
 * staff have started drafting. Newest-wins therefore showed the draft. Nor can
 * the date be used instead — a bulletin is a schedule somebody publishes, not a
 * calendar range, and the parish is entitled to leave last week's up over a
 * feast or to put next week's up early. Guessing from `days[]` overrides that
 * decision; guessing from `lastPublished` gets the common case right and still
 * silently disagrees with the screen in the narthex.
 *
 * The announcements app writes this document when a bulletin is made active.
 * Following it means the website and that app cannot disagree, by construction.
 * ---------------------------------------------------------------------------
 *
 * Path rather than a configurable value, because it is a fact about the source
 * app's own schema — the same category of thing as the field names in
 * `parseBulletin`, and not something a parish administrator should be invited to
 * change in `config/integrations`.
 */
export const ANNOUNCEMENTS_ACTIVE_BULLETIN_DOC = 'config/active_bulletin';

/** The `id` out of `config/active_bulletin`, or null if it says nothing usable. */
export function activeBulletinId(raw: unknown): string | null {
  const record = asRecord(raw);
  return record ? str(record['id']) : null;
}

/**
 * The most recently published week — the fallback for when the pointer is
 * missing, or names a document that is not there.
 *
 * Deliberately **published**, not newest. An unpublished draft is the one thing
 * that must never reach the homepage, and it is exactly what a naive fallback
 * reaches for: the draft is always the newest document, because drafting next
 * week is what people do with this app.
 *
 * Returns null when nothing has ever been published, rather than falling back
 * again to "any week at all". At that point there is no honest answer and a
 * missing section is better than a wrong schedule.
 */
export function mostRecentlyPublished(bulletins: Bulletin[]): Bulletin | null {
  const published = bulletins.filter((b) => b.source.publishedAt !== null);
  if (published.length === 0) return null;

  return published.reduce((newest, candidate) =>
    // Non-null on both sides, guaranteed by the filter above.
    candidate.source.publishedAt!.getTime() > newest.source.publishedAt!.getTime()
      ? candidate
      : newest,
  );
}

// ---------------------------------------------------------------------------
// Crossing a network
// ---------------------------------------------------------------------------

/**
 * Rebuild a `Bulletin` from its JSON form.
 *
 * The counterpart to sending one over the wire. `JSON.stringify` turns the two
 * `Date` fields into ISO strings and there is no reviver that knows which
 * strings those were, so a response cannot simply be cast — do that and
 * `publishedAt.getTime` is a runtime TypeError in a browser, on a field a
 * type-checked build swears is a Date.
 *
 * Written as a validating parse rather than a conversion for the same reason
 * `parseBulletin` is: this is a value arriving from outside the program. The
 * endpoint is ours, but a response can still be a cached older shape, an error
 * page from a proxy, or half a document — and the caller's fallback is to keep
 * the week already on screen, so returning null is worth more than throwing.
 */
export function reviveBulletin(value: unknown): Bulletin | null {
  const raw = asRecord(value);
  if (!raw) return null;

  const weekLabel = str(raw['weekLabel']);
  const source = asRecord(raw['source']);
  if (weekLabel === null || source === null) return null;

  const days = asArray(raw['days'])
    .map(reviveDay)
    .filter((d): d is BulletinDay => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Same rule as `parseBulletin`: the week's identity is the one thing not
  // worth guessing at. Trust `days` over the transmitted `weekOf` so the two
  // cannot disagree.
  const weekOf = days[0]?.date;
  if (weekOf === undefined) return null;

  return {
    weekOf,
    weekLabel,
    presetName: str(raw['presetName']),
    announcements: asArray(raw['announcements'])
      .map((item, index) => {
        const record = asRecord(item);
        const text = record && str(record['text']);
        if (!record || text === null) return null;
        return {
          sourceId: str(record['sourceId']) ?? `untitled-${index}`,
          text,
          image: str(record['image']),
          addedAt: date(record['addedAt']),
        };
      })
      .filter((a): a is BulletinAnnouncement => a !== null),
    days,
    multiDayEvents: asArray(raw['multiDayEvents'])
      .map((item, index) => {
        const base = reviveEvent(item, index);
        const record = asRecord(item);
        if (!base || !record) return null;
        const startDate = str(record['startDate']);
        const endDate = str(record['endDate']);
        if (startDate === null || endDate === null) return null;
        return { ...base, startDate, endDate };
      })
      .filter((e): e is BulletinMultiDayEvent => e !== null),
    headerNotes: asArray(raw['headerNotes'])
      .map(str)
      .filter((n): n is string => n !== null),
    source: {
      project: str(source['project']) ?? '',
      collection: str(source['collection']) ?? '',
      documentId: str(source['documentId']) ?? '',
      publishedAt: date(source['publishedAt']),
      sourceUpdatedAt: date(source['sourceUpdatedAt']),
    },
  };
}

function reviveEvent(value: unknown, index: number): BulletinEvent | null {
  const record = asRecord(value);
  if (!record) return null;

  const name = str(record['name']);
  if (name === null) return null;

  return {
    sourceId: str(record['sourceId']) ?? `unnamed-${index}`,
    name,
    time: str(record['time']),
    timeTo: str(record['timeTo']),
    notes: str(record['notes']),
    color: str(record['color']),
    image: str(record['image']),
    contacts: contacts(record['contacts']),
  };
}

function reviveDay(value: unknown): BulletinDay | null {
  const record = asRecord(value);
  if (!record) return null;

  const day = str(record['date']);
  if (day === null || !ISO_DATE.test(day)) return null;

  return {
    date: day,
    day: str(record['day']) ?? '',
    events: asArray(record['events'])
      .map(reviveEvent)
      .filter((e): e is BulletinEvent => e !== null),
  };
}
