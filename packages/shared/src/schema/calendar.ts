/**
 * The church schedule, as the website renders it.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `schema/events.ts`
 *
 * `Event` is a page: a title, a body somebody wrote, a hero photograph, a slug.
 * The parish has sixteen of those a year — the festival, summer camp, an
 * iconography class — and staff author them here.
 *
 * This is the *schedule*: eight hundred occurrences a year, every liturgy,
 * vespers, Tasbeha and Bible study, maintained in Breeze ChMS by the office and
 * never retyped. Nobody is ever going to hand-enter a weekly Divine Liturgy
 * into a website admin, which is why `events` has sat empty in production while
 * the real calendar lived in an iframe.
 *
 * Both end up in the same grid, so both reduce to the shape below. The
 * difference that survives is `source`, and `href` — a `feature` occurrence has
 * a page to link to and a Breeze one does not.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Civil dates and wall-clock strings, never instants. This is the whole design.
 *
 * A calendar cell is "August 24th in Wayland" and a liturgy is "8:00 in the
 * morning" — neither is an instant, and converting them into one is how an
 * hour goes missing. Breeze hands back `2026-08-24 17:00:00` with no offset
 * attached; it means five in the afternoon in the parish's zone, and that is
 * *also* exactly what we want to print. Parsing it into a `Date` and formatting
 * it back out again is two conversions that can only cancel out if both are
 * right, on a build machine that is very likely UTC, across two DST
 * transitions a year.
 *
 * So the strings stay strings. `day` sorts lexicographically, `startTime` sorts
 * lexicographically, grouping by day is a `Map` lookup, and there is no
 * arithmetic anywhere for a zone to be wrong in. `lib/dates.ts` on the website
 * takes the same position for the month grid and says so at more length.
 *
 * The one conversion that does happen is `occurrenceOfEvent`, which turns a
 * Firestore `Event`'s instant into this shape — once, explicitly, through
 * `dayKey` and `instantToWallClock`, both of which take the zone as an
 * argument.
 * ---------------------------------------------------------------------------
 */
import { dayKey, instantToWallClock } from '../timezones.js';

/**
 * Which calendar an occurrence came from.
 *
 * - `parish` — the church calendar. Public: liturgies, vespers, classes.
 * - `servants` — the servants calendar, and **not public**. Internal logistics,
 *   tentative plans, which van is out. Only ever served to a verified `servant`;
 *   see the Function.
 * - `feature` — an `Event` document, authored on this site, with its own page.
 * - `bulletin` — this week's sheet from the announcements project. Only ever
 *   covers one week, carries photographs and a contact, and is the parish's own
 *   published statement of what is on — which is why it wins a collision.
 * - `manual` — added by staff on the calendar itself. The **only** source the
 *   parish owns outright, and therefore the only one anything may delete; see
 *   `schema/scheduleAdmin.ts`.
 */
export type CalendarSource = 'parish' | 'servants' | 'feature' | 'bulletin' | 'manual';

/** Which calendars a request is asking for. `servants` implies `parish` too. */
export type CalendarScope = 'parish' | 'servants';

/**
 * One thing on one or more days.
 *
 * `endDay` is **inclusive** — the last day the occurrence actually covers — and
 * that is a deliberate departure from what Breeze sends. See
 * `breezeOccurrence`, where the correction happens and where the off-by-one it
 * prevents is described.
 */
export interface CalendarOccurrence {
  /** Stable within a source. Breeze's instance id, or `event:<slug>`. */
  id: string;
  title: string;
  /** `YYYY-MM-DD`, the first day. */
  day: string;
  /** `YYYY-MM-DD`, the last day, inclusive. Equals `day` for a single day. */
  endDay: string;
  /** `HH:MM`, 24-hour, parish wall clock. Null when `allDay`. */
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  /** Plain text. Empty rather than absent — see `plainText`. */
  location: string;
  description: string;
  source: CalendarSource;
  /** A path on this site, for the sources that have a page. Null otherwise. */
  href: string | null;
  /**
   * A photograph, hotlinked from wherever the source keeps it.
   *
   * Only the bulletin has these, and they are hotlinked rather than copied —
   * the bulletin is read through and never mirrored, and that applies to its
   * images too.
   */
  imageUrl: string | null;
  /** "Servant Michael · (508) 555-0142". From the bulletin, or from a detail. */
  contact: string | null;
  /** Somewhere to go — a Zoom room, a sign-up. Only ever from a detail. */
  link: { url: string; label: string } | null;
  /**
   * The kind, when the source knows it rather than leaving it to be guessed.
   *
   * Null for everything read from Breeze or the bulletin, where the title is
   * all there is; set on a manual entry, where somebody chose it from a list.
   * Read it through `kindOf`, never directly.
   */
  kind: OccurrenceKind | null;
  /** Whether staff have annotated this occurrence. Set by `applyCalendarDetails`. */
  hasDetail?: boolean;
}

/** What `/api/calendar` answers with. */
export interface CalendarFeed {
  /** `YYYY-MM-DD`, echoed back so a stale response can be told from a fresh one. */
  from: string;
  to: string;
  /** The zone every `startTime` in here is a reading of. */
  timeZone: string;
  occurrences: CalendarOccurrence[];
  /**
   * Whether the servants calendar is included.
   *
   * Echoed rather than inferred from the occurrences, because "no servants
   * entries this week" and "you were not shown the servants calendar" look
   * identical in the data and mean completely different things to the person
   * reading it.
   */
  includesServants: boolean;
}

/**
 * The widest range one request may ask for, in days.
 *
 * A month view needs 42 days (six weeks) and a week needs 7, so 62 covers every
 * view with room to pad. The cap exists because the alternative is a bulk
 * export: a year of the parish calendar is 816 occurrences and 728KB from
 * Breeze, measured, and an endpoint that will serve that on demand is a
 * scraping tool with our name on it. It also keeps the response small enough
 * that the page does not stall on a phone.
 */
export const MAX_CALENDAR_RANGE_DAYS = 62;

/* ---- Breeze -------------------------------------------------------------
 *
 * Everything below parses what Breeze's embedded calendar sends. It lives in
 * @spsm/shared rather than in the Function so that it can be tested against
 * captured fixtures without a deploy — the two quirks it corrects for were both
 * found by reading real responses, and neither is something a type would catch.
 */

/** One `eventSources` entry from the embed page's inline script. */
export interface BreezeEventSource {
  /** Path on the Breeze origin, query string included. */
  path: string;
  /** The category's colour in Breeze, `#b2cd92`. Informational only. */
  color: string;
  /** `0` is the parish's main calendar; anything else is an extra category. */
  categoryId: string;
}

/**
 * Pull the event sources out of an embed page.
 *
 * The embed is a FullCalendar 2.7.1 host page whose inline script builds an
 * `event_sources` array, one entry per calendar category the token grants. We
 * read them out rather than hardcoding category ids, so adding a category in
 * Breeze does not need a code change here — and so that the *token* stays the
 * thing that decides what a given URL can see, which is what makes the parish
 * and servants URLs meaningfully different.
 *
 * Regex rather than an HTML parser on purpose: the target is a JavaScript
 * assignment inside a `<script>`, which is not something a DOM parser reaches
 * any more directly, and pulling in a parser to read two string literals is a
 * dependency @spsm/shared does not need (it has to stay importable from React
 * Native).
 *
 * Returns an empty array for a page that has no sources, which the caller must
 * treat as "the token is wrong or Breeze changed its template" — never as "the
 * calendar is empty". An empty calendar and an unreadable one look the same
 * downstream, and only one of them should blank the page.
 */
export function parseBreezeEventSources(html: string): BreezeEventSource[] {
  const sources: BreezeEventSource[] = [];

  /*
   * `event_source.url` then, up to 200 characters later, `event_source.color`.
   *
   * The gap is bounded rather than greedy so that a source with no colour set
   * cannot swallow the *next* source's colour — with `[\s\S]*?` and a missing
   * assignment the match runs on into the following block and reports two
   * sources sharing one colour. 200 characters is comfortably more than the
   * template puts between them and comfortably less than one full block.
   */
  const pattern =
    /event_source\.url\s*=\s*'([^']+)'[\s\S]{0,200}?event_source\.color\s*=\s*'([^']*)'/g;

  for (const match of html.matchAll(pattern)) {
    const path = match[1];
    if (path === undefined) continue;

    sources.push({
      path,
      color: match[2] ?? '',
      categoryId: /[?&]category_id=([^&']*)/.exec(path)?.[1] ?? '',
    });
  }

  return sources;
}

/** The raw shape of one entry in a Breeze `/ajax/events/details` response. */
export interface BreezeRawEvent {
  id?: unknown;
  title?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  location?: unknown;
  description?: unknown;
  /**
   * Present, large, and never read.
   *
   * Breeze ships roughly 47 keys of internal state on every event, including
   * the full name and email address of whichever member of staff last saved it.
   * It is dropped in `breezeOccurrence` rather than merely ignored, because this
   * data is on its way to a public JSON endpoint and "we do not use that field"
   * is not the same protection as "that field is not in the response".
   */
  metadata?: unknown;
}

/**
 * One Breeze event, reduced to a `CalendarOccurrence`.
 *
 * Returns null for anything without a title and a readable start, which is the
 * only shape that cannot be rendered. Everything else degrades: no end, no
 * location and no description are all ordinary.
 */
export function breezeOccurrence(
  raw: BreezeRawEvent,
  source: CalendarSource,
): CalendarOccurrence | null {
  const title = plainText(raw.title);
  const start = breezeDateTime(raw.start);
  if (title === '' || start === null) return null;

  const allDay = raw.allDay === true;
  const end = breezeDateTime(raw.end);

  return {
    id: typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : `${start.day}-${title}`,
    title,
    day: start.day,
    endDay: breezeEndDay(start.day, end?.day ?? null, allDay),
    startTime: allDay ? null : start.time,
    endTime: allDay ? null : (end?.time ?? null),
    allDay,
    location: plainText(raw.location),
    /*
     * Breeze writes the literal string "No Description" into this field for
     * every event nobody described, which is most of them. Rendering it puts
     * "No Description" under eight hundred liturgies a year.
     */
    description: plainText(raw.description) === 'No Description' ? '' : plainText(raw.description),
    source,
    href: null,
    imageUrl: null,
    contact: null,
    link: null,
    kind: null,
  };
}

/**
 * The last day an occurrence actually covers.
 *
 * ---------------------------------------------------------------------------
 * Breeze's all-day end is **exclusive**, and correcting it is the whole reason
 * this is a function rather than a field copy.
 *
 * Measured against the parish's live calendar:
 *
 *   "Tentative KRISPY Competition"   start 2026-08-22   end 08/23/2026
 *   "Summer Camp Week 2"             start 2026-08-03   end 08/08/2026
 *
 * The competition is one day and the camp is five (the 3rd to the 7th) — which
 * is also what Breeze's own `date_description` says. Taken literally the end
 * dates would render a two-day competition and a six-day camp, so every
 * multi-day entry in the calendar would be one day too long, and a trip that
 * ends on a Sunday would claim the Monday as well.
 *
 * Timed events are not exclusive and are not adjusted: a liturgy from 08:00 to
 * 11:00 ends on the day it says.
 * ---------------------------------------------------------------------------
 */
function breezeEndDay(startDay: string, endDay: string | null, allDay: boolean): string {
  if (endDay === null || endDay < startDay) return startDay;
  if (!allDay) return endDay;

  const previous = addDays(endDay, -1);
  // An all-day event whose exclusive end is the day after its start is a single
  // day, and the subtraction lands back on `startDay`. Guarded anyway so a
  // malformed pair can never produce an `endDay` before `day`.
  return previous < startDay ? startDay : previous;
}

/**
 * A Breeze date-time string, split into a civil day and a wall clock.
 *
 * ---------------------------------------------------------------------------
 * Two formats, from the same field, in the same response.
 *
 *   timed events     `2026-08-24 17:00:00`   ISO-ish, year first
 *   all-day `end`    `08/31/2026 00:00:00`   US, month first
 *
 * Both were observed in one payload — `start` in the first form and `end` in
 * the second, on the same event. A parser that handles only the ISO form drops
 * every multi-day all-day entry's end date and silently renders each of them as
 * one day; a `new Date()` that accepts both hands back an instant in the host's
 * zone, which is the conversion this module exists to avoid.
 * ---------------------------------------------------------------------------
 */
function breezeDateTime(value: unknown): { day: string; time: string } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(trimmed);
  if (iso) return { day: `${iso[1]}-${iso[2]}-${iso[3]}`, time: `${iso[4]}:${iso[5]}` };

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(trimmed);
  if (us) {
    const month = us[1]!.padStart(2, '0');
    const day = us[2]!.padStart(2, '0');
    return {
      day: `${us[3]}-${month}-${day}`,
      time: `${us[4] ?? '00'}:${us[5] ?? '00'}`,
    };
  }

  return null;
}

/**
 * Whatever Breeze put in a text field, as text a page can print.
 *
 * Descriptions come back as HTML — pasted out of Word, complete with
 * `<span style="color:#242424;font-family:…">` — and a title is not guaranteed
 * to be plain either. This is on its way into React, which escapes what it
 * renders, so the markup would be *shown* rather than executed: the reader gets
 * a wall of tag soup instead of a sentence. Stripping is for legibility.
 *
 * It is emphatically **not** what makes this safe to render. That is React's
 * escaping, plus the fact that nothing here is ever passed to
 * `dangerouslySetInnerHTML`. A regex is not an HTML sanitiser and this one is
 * not trying to be; if a description ever needs to keep its formatting, the
 * answer is a real sanitiser, not a longer regex.
 */
function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    // The five named entities that actually turn up in pasted text, plus the
    // numeric forms. Deliberately not a full entity table: an unrecognised
    // entity is left as-is, which reads oddly, where a half-built decoder that
    // resolves `&amp;lt;` into `<` would reintroduce markup this just removed.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---- civil-date arithmetic ---------------------------------------------
 *
 * The same fixed-offset-calendar trick `apps/website/src/lib/dates.ts` uses and
 * documents: `Date.UTC` as arithmetic over `YYYY-MM-DD` strings, never as a
 * moment in time. Duplicated rather than imported because @spsm/shared cannot
 * depend on the website, and the Function needs it too.
 */

/** `2026-08-31` + `-1` → `2026-08-30`. Returns the input if it is not a day. */
export function addDays(day: string, delta: number): string {
  const millis = utcOf(day);
  if (millis === null) return day;
  return new Date(millis + delta * 86_400_000).toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive. Capped, like `dayKeysBetween`. */
export function daysBetween(from: string, to: string): string[] {
  const start = utcOf(from);
  const end = utcOf(to);
  if (start === null || end === null || end < start) return [];

  const days: string[] = [];
  for (let cursor = start; cursor <= end && days.length <= MAX_CALENDAR_RANGE_DAYS + 1; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

/** How many days `from`..`to` spans, inclusive. -1 for input that is not a pair. */
export function rangeLength(from: string, to: string): number {
  const start = utcOf(from);
  const end = utcOf(to);
  if (start === null || end === null || end < start) return -1;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** `2026-08-24` → the epoch millis of that civil day at midnight UTC. */
function utcOf(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const millis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(millis) ? null : millis;
}

/* ---- the site's own events ---------------------------------------------- */

/**
 * The minimum of `Event` this module needs, so @spsm/shared does not have to
 * decide whether a Firestore `Timestamp` or a `Date` is arriving.
 *
 * Both do, depending on the caller: the website reads through the client SDK
 * and gets a `Timestamp`, the Function reads through the Admin SDK and gets
 * another, and a test passes a `Date`. `toInstant` is the caller's problem.
 */
export interface FeatureEventLike {
  slug: string;
  title: string;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  location?: string;
  summary?: string;
  timeZone?: string;
}

/**
 * An authored `Event` in the schedule's shape, so one grid can render both.
 *
 * This is the one place an instant becomes a civil date, and it is explicit
 * about the zone on both calls. `Event.timeZone` is what the parish meant when
 * staff typed a time; falling back to the argument rather than to the host's
 * zone is the difference between a correct grid and a build-machine-dependent
 * one.
 */
export function occurrenceOfEvent(
  event: FeatureEventLike,
  timeZone: string,
): CalendarOccurrence {
  const zone = event.timeZone ?? timeZone;
  const day = dayKey(event.startAt, zone);
  const endDay = event.endAt ? dayKey(event.endAt, zone) : day;

  return {
    id: `event:${event.slug}`,
    title: event.title,
    day,
    endDay: endDay < day ? day : endDay,
    startTime: event.allDay ? null : instantToWallClock(event.startAt, zone).slice(11, 16),
    endTime:
      event.allDay || !event.endAt ? null : instantToWallClock(event.endAt, zone).slice(11, 16),
    allDay: event.allDay,
    location: event.location ?? '',
    description: event.summary ?? '',
    source: 'feature',
    // The reason a feature event is worth merging in at all: it has somewhere
    // to go. Breeze occurrences are dead text by comparison.
    href: `/events/${event.slug}`,
    imageUrl: null,
    contact: null,
    link: null,
    kind: null,
  };
}

/* ---- assembling a feed -------------------------------------------------- */

/**
 * Sort into reading order: by day, then all-day entries first, then by time.
 *
 * All-day before timed is the order a day is actually read — "Summer Camp Week
 * 2" is the frame the rest of Monday sits inside, so it belongs at the top of
 * the cell rather than sorted to 00:00 among the timed entries by accident.
 */
export function sortOccurrences(occurrences: CalendarOccurrence[]): CalendarOccurrence[] {
  return [...occurrences].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const at = a.startTime ?? '';
    const bt = b.startTime ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Drop repeats of the same entry, keyed on `id` alone.
 *
 * ---------------------------------------------------------------------------
 * The key is `id` and **not** `source:id`, which it was, and that was a bug.
 *
 * The servants embed's Breeze token grants the parish category as well as its
 * own, so reading both embeds returns every liturgy twice. The two copies are
 * byte-for-byte the same event — measured against the real week of 2026-08-23,
 * all 25 parish occurrences came back from the servants embed under *identical*
 * instance ids, with only 6 entries genuinely servants-only.
 *
 * Keying on `source:id` gave those two copies different keys (`parish:404577147`
 * and `servants:404577147`), so nothing collapsed and a signed-in servant saw
 * the whole parish calendar twice — the one duplicate a servant, and only a
 * servant, would ever see.
 *
 * `id` alone is safe because every other source namespaces its own: a feature
 * event is `event:<slug>` and a bulletin entry is `bulletin:<sourceId>`, so the
 * only ids that can ever collide are two readings of the same Breeze instance,
 * which is exactly what should collapse. It is Breeze's *instance* id and not
 * its series id, so a weekly liturgy's fifty-two occurrences stay fifty-two.
 *
 * Callers must order the input by precedence — the first of each id survives.
 * ---------------------------------------------------------------------------
 *
 * This handles *identical* entries. Two systems describing the same service in
 * different words is a different problem — see `mergeCalendarSources`.
 */
export function dedupeOccurrences(occurrences: CalendarOccurrence[]): CalendarOccurrence[] {
  const seen = new Set<string>();
  const kept: CalendarOccurrence[] = [];

  for (const occurrence of occurrences) {
    if (seen.has(occurrence.id)) continue;
    seen.add(occurrence.id);
    kept.push(occurrence);
  }

  return kept;
}

/* ---- reconciling sources that describe the same week --------------------
 *
 * ---------------------------------------------------------------------------
 * Why this is hard, stated plainly, because the code below looks like
 * over-engineering until you see the data.
 *
 * The parish maintains its schedule in two places by hand: Breeze, which is the
 * standing calendar, and the weekly bulletin, which is the sheet published each
 * week in the announcements app. They describe the same services and they do
 * not agree — not on names, and not on times. Measured against the real week of
 * 2026-08-24:
 *
 *   bulletin                              Breeze                              
 *   ------------------------------------  ------------------------------------
 *   Mon 5:30pm Arabic Tasbeha             Mon 5:00pm Midnight Tasbeha Arabic  
 *   Mon 7:00pm St. Maurice & St. Verina   Mon 6:00pm St. Maurice & St. Verina 
 *   Mon 6:30pm Online Middle School …     Mon 6:30pm St Philopater & St Mina … 
 *   Sat 8:00am Saturday Liturgy           Sat 8:00am Divine Liturgy           
 *   Sat 7:30pm Midnight Praises (Tesbeha) Sat 7:30pm Tasbeha                  
 *   Fri 7:00pm College & YP Bible Study   Fri 7:00pm Mother of Mercy Meals    
 *
 * Every row but the last is one service written twice. The last row is two
 * genuinely different things that happen at the same hour. So:
 *
 *   - matching on **title** misses five of the six;
 *   - matching on **time** merges the sixth, hiding the homeless meals;
 *   - matching on **title AND exact time** misses the two Monday rows, whose
 *     times disagree by thirty and sixty minutes.
 *
 * What separates the five from the one is that the five *are about the same
 * thing* — they share the words that carry the meaning. So the rule is: same
 * day, times close enough to be the same slot, and titles that overlap on at
 * least half of the shorter one's significant words. Every row above comes out
 * right, and the tests pin each of them.
 *
 * Two guard rails on the ambition here. It only ever merges **across** sources,
 * never within one — Breeze runs two different Mahragan classes at 7pm on the
 * same Tuesday, and those must both survive. And when it is unsure it keeps
 * both: a visible duplicate is a wart somebody can report, where a wrong merge
 * silently deletes a service and nobody finds out until they turn up to it.
 * ---------------------------------------------------------------------------
 */

/**
 * Which source wins when two describe the same thing.
 *
 * `feature` first because it is the only one with a page to link to. Then
 * `bulletin`, because it is what the parish actually published for that week —
 * hand-written for those seven days, with the photograph and the contact on it
 * — where Breeze is the standing calendar that the bulletin is derived from and
 * corrects. Then the parish calendar, then the servants one.
 */
const SOURCE_RANK: Record<CalendarSource, number> = {
  /*
   * `manual` first. Somebody typed it in on this website, knowing what was
   * already on the calendar, so if it collides with a Breeze entry the typed
   * one is the correction and the read one is what it corrects.
   */
  manual: 0,
  feature: 1,
  bulletin: 2,
  parish: 3,
  servants: 4,
};

/** How far apart two start times can be and still be the same slot, in minutes. */
const SAME_SLOT_MINUTES = 60;

/**
 * Merge every source into one schedule, collapsing the entries that are the
 * same service described twice.
 *
 * Order within the result is `sortOccurrences`'s. The input order does not
 * matter; precedence decides which of a colliding pair survives.
 */
export function mergeCalendarSources(
  groups: CalendarOccurrence[][],
): CalendarOccurrence[] {
  // Highest precedence first, so the survivor of a collision is already in
  // `kept` by the time its lesser twin is considered.
  const all = dedupeOccurrences(
    groups.flat().sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]),
  );

  const kept: CalendarOccurrence[] = [];
  for (const candidate of all) {
    const twin = kept.find((existing) => sameOccurrence(existing, candidate));
    if (twin) {
      // The loser can still carry something the winner lacks. A bulletin entry
      // that wins keeps its photograph; a Breeze entry it displaced may have
      // had the only end time, and dropping that would shorten the service on
      // screen for no reason.
      if (twin.endTime === null && candidate.endTime !== null) twin.endTime = candidate.endTime;
      if (twin.location === '' && candidate.location !== '') twin.location = candidate.location;
      if (twin.description === '' && candidate.description !== '') {
        twin.description = candidate.description;
      }
      if (twin.imageUrl === null && candidate.imageUrl !== null) twin.imageUrl = candidate.imageUrl;
      if (twin.href === null && candidate.href !== null) twin.href = candidate.href;
      continue;
    }
    // Copied, because the block above mutates survivors and the caller's arrays
    // must not change under it — `features` is a prop that outlives one render.
    kept.push({ ...candidate });
  }

  return sortOccurrences(kept);
}

/** Two entries, from different sources, that are the same thing. */
function sameOccurrence(a: CalendarOccurrence, b: CalendarOccurrence): boolean {
  // Never within a source. Breeze's two 7pm Mahragan classes are two classes.
  if (a.source === b.source) return false;

  /*
   * Overlapping spans, not equal start days.
   *
   * The bulletin states the High School Bible Study as one entry running Monday
   * to Thursday at 9pm; Breeze holds the identical thing as four separate
   * nightly instances. Comparing `day` to `day` matched only the Monday and
   * left Tuesday, Wednesday and Thursday showing it twice — which is exactly
   * the duplicate this is here to remove.
   */
  // Two inclusive spans overlap unless one ends before the other begins.
  if (a.endDay < b.day || b.endDay < a.day) return false;

  // An all-day entry and a timed one are not the same slot, whatever they are
  // called: "Summer Camp Week 2" running all Monday is not the 7pm meeting.
  if (a.allDay !== b.allDay) return false;

  if (!a.allDay && !withinSlot(a.startTime, b.startTime)) return false;

  return titlesAgree(a.title, b.title);
}

function withinSlot(a: string | null, b: string | null): boolean {
  const at = minutesOf(a);
  const bt = minutesOf(b);
  if (at === null || bt === null) return at === bt;
  return Math.abs(at - bt) <= SAME_SLOT_MINUTES;
}

function minutesOf(time: string | null): number | null {
  const match = time === null ? null : /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Words that carry no meaning for telling two service names apart.
 *
 * `st` earns its place: half the parish's events are named after a saint, so
 * leaving it in makes "St. Maurice & St. Verina Arabic Meeting" and "St Mary
 * Nahda" look related. Weekday names likewise — "Saturday Liturgy" and
 * "Tuesday Liturgy" are different services, and the day is already matched on
 * exactly, so the word adds nothing but a false point of agreement.
 */
const IGNORED_WORDS = new Set([
  'the', 'and', 'for', 'of', 'a', 'an', 'in', 'at', 'to', 'with', 'on',
  'st', 'saint', 'spsm', 'church',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/**
 * Do these two names describe the same thing?
 *
 * At least half the *shorter* name's significant words must appear in the
 * longer one. Anchoring on the shorter is what lets "Tasbeha" match "Midnight
 * Praises (Tesbeha)" — a short name is usually an abbreviation of the long one,
 * and requiring the long one to be mostly covered would reject every such pair.
 *
 * Half rather than any-overlap is what keeps "Bible Study for College and Young
 * Professionals" apart from "High School Online Bible Study": they share two
 * words out of five, which is 40%, and they are not the same study.
 */
function titlesAgree(a: string, b: string): boolean {
  const first = significantWords(a);
  const second = significantWords(b);
  if (first.length === 0 || second.length === 0) return false;

  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  const matched = shorter.filter((word) => longer.some((other) => wordsAgree(word, other))).length;

  return matched * 2 >= shorter.length;
}

/**
 * Exact, or one edit apart.
 *
 * The edit distance is not cleverness for its own sake — it is "Tesbeha" and
 * "Tasbeha", which is how the parish's two systems transliterate the same
 * Coptic word. Bounded at one, and only for words of four letters or more, so
 * "9am" and "8am" or "Vespers" and "Vesper" are the sort of thing it catches
 * and "hymn"/"hymns" is as far as it reaches.
 */
function wordsAgree(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  return editDistanceIsOne(a, b);
}

/** True for exactly one substitution, insertion, or deletion. Never computes more. */
function editDistanceIsOne(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    // Same length means the only possible edit is a substitution, so both
    // cursors advance; otherwise skip the extra character in the longer word.
    if (shorter.length === longer.length) i += 1;
    j += 1;
  }

  return edits + (longer.length - j) <= 1;
}

/** Lowercased words with the punctuation and the noise words taken out. */
function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !IGNORED_WORDS.has(word));
}

/* ---- the weekly bulletin ------------------------------------------------- */

/** The slice of `Bulletin` this needs, so the schemas stay uncoupled. */
export interface BulletinLike {
  days: {
    date: string;
    events: BulletinEventLike[];
  }[];
  multiDayEvents: (BulletinEventLike & { startDate: string; endDate: string })[];
}

export interface BulletinEventLike {
  sourceId: string;
  name: string;
  time: string | null;
  timeTo: string | null;
  notes: string | null;
  image: string | null;
  contacts: { name: string; phone: string | null }[];
}

/**
 * This week's bulletin, in the schedule's shape.
 *
 * The bulletin is the parish's own sheet for one week, so it is both the most
 * current description of that week and the only source with photographs and a
 * person to ring. It is read through and never mirrored — which is why the
 * image is carried as the source's own URL rather than copied anywhere.
 *
 * `multiDayEvents` become one occurrence spanning their dates rather than one
 * per day, which is also how the bulletin itself states them. That matters
 * beyond tidiness: Breeze holds the same High School Bible Study as four
 * separate Monday-to-Thursday instances, and the four collapse against this one
 * span.
 */
export function occurrencesOfBulletin(bulletin: BulletinLike): CalendarOccurrence[] {
  const occurrences: CalendarOccurrence[] = [];

  for (const day of bulletin.days) {
    for (const event of day.events) {
      const occurrence = bulletinOccurrence(event, day.date, day.date);
      if (occurrence) occurrences.push(occurrence);
    }
  }

  for (const event of bulletin.multiDayEvents) {
    const occurrence = bulletinOccurrence(event, event.startDate, event.endDate);
    if (occurrence) occurrences.push(occurrence);
  }

  return occurrences;
}

function bulletinOccurrence(
  event: BulletinEventLike,
  day: string,
  endDay: string,
): CalendarOccurrence | null {
  const title = event.name.trim();
  if (title === '' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const startTime = bulletinTime(event.time);
  const contact = event.contacts[0];

  return {
    id: `bulletin:${event.sourceId}`,
    title,
    day,
    endDay: endDay >= day ? endDay : day,
    startTime,
    endTime: bulletinTime(event.timeTo),
    // A bulletin entry with no time is an all-day item: the sheet lists a time
    // for everything that has one, so its absence is information rather than a
    // gap.
    allDay: startTime === null,
    location: '',
    description: event.notes?.trim() ?? '',
    source: 'bulletin',
    href: null,
    imageUrl: event.image?.trim() || null,
    contact: contact ? [contact.name, contact.phone].filter(Boolean).join(' · ') : null,
    link: null,
    kind: null,
  };
}

/**
 * `"5:30pm"` → `"17:30"`.
 *
 * The bulletin stores what a person typed, and `schema/bulletin.ts` deliberately
 * keeps it that way — it will not guarantee a format. So this parses the shapes
 * that actually occur and returns null for anything else, which renders as an
 * all-day entry rather than as a wrong hour.
 */
export function bulletinTime(value: string | null): string | null {
  if (value === null) return null;

  const match = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i.exec(value.trim());
  if (!match) return null;

  let hour = Number(match[1]);
  if (hour < 1 || hour > 12) return null;

  // 12am is 00 and 12pm is 12 — the two the obvious arithmetic gets backwards.
  if (match[3]!.toLowerCase() === 'p') hour = hour === 12 ? 12 : hour + 12;
  else hour = hour === 12 ? 0 : hour;

  return `${String(hour).padStart(2, '0')}:${match[2] ?? '00'}`;
}

/** `2026-08-24` → the occurrences touching that day, in reading order. */
export type OccurrencesByDay = Map<string, CalendarOccurrence[]>;

/**
 * Bucket occurrences into every civil day they cover.
 *
 * Multi-day entries are expanded rather than pinned to their start, for the
 * reason `groupEventsByDay` gives: the camp runs Monday to Friday, and a
 * calendar that shows it only on Monday tells someone looking at Wednesday that
 * nothing is on.
 */
export function groupByDay(occurrences: CalendarOccurrence[]): OccurrencesByDay {
  const byDay: OccurrencesByDay = new Map();

  for (const occurrence of occurrences) {
    for (const day of daysBetween(occurrence.day, occurrence.endDay)) {
      const bucket = byDay.get(day);
      if (bucket) bucket.push(occurrence);
      else byDay.set(day, [occurrence]);
    }
  }

  /*
   * Sorted per bucket, and *after* grouping rather than before it.
   *
   * Sorting the flat list first orders every occurrence by its own start day,
   * which is the wrong key for any day it merely passes through: a Bible study
   * running Monday to Thursday at 9pm carries `day = Monday`, so inside
   * Tuesday's bucket it sorted above Tuesday's 7am Liturgy. Within a day the
   * only thing that orders entries is the clock.
   */
  for (const bucket of byDay.values()) bucket.sort(withinDay);

  return byDay;
}

/** All-day first, then by clock, then by title. See `sortOccurrences`. */
function withinDay(a: CalendarOccurrence, b: CalendarOccurrence): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const at = a.startTime ?? '';
  const bt = b.startTime ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/* ---- what kind of thing an occurrence is --------------------------------- */

/**
 * The four sorts of thing on this parish's calendar.
 *
 * ---------------------------------------------------------------------------
 * Derived from the title, which is a heuristic, and that is acceptable *here*
 * for a reason worth stating: the only thing this decides is a colour.
 *
 * Neither source carries a usable category. Breeze has one — cat 0 is the
 * parish calendar and 104099 is the youth ministry — but that is a distinction
 * about *who maintains the entry*, not about what it is, and it puts the Divine
 * Liturgy and a volleyball tournament in the same bucket. The bulletin has a hex
 * colour the editor picked per slide, which means nothing (see the note in
 * `docs/`).
 *
 * So the words are all there is. When they are not enough the answer is `other`
 * and the entry gets no colour claim at all — a wrong colour is worse than none,
 * and the reader can still read the title. Compare `mergeCalendarSources`, where
 * a wrong guess deletes a service and the bar is correspondingly much higher.
 * ---------------------------------------------------------------------------
 */
export type OccurrenceKind = 'liturgy' | 'study' | 'gathering' | 'other';

/**
 * Words that place an entry, most specific first.
 *
 * Order matters within a kind only in that the first hit wins overall, so
 * anything ambiguous between two kinds has to be resolved by which list it is
 * in. "Sunday School" is teaching rather than a service even though the parish
 * holds it between two liturgies; "Servants Meeting" is a gathering even though
 * only servants attend.
 */
const KIND_WORDS: [OccurrenceKind, readonly string[]][] = [
  [
    'liturgy',
    // Both transliterations of Tasbeha, because both are in use — Breeze writes
    // one and the bulletin the other. See `mergeCalendarSources`.
    ['liturgy', 'vespers', 'tasbeha', 'tesbeha', 'praises', 'matins', 'feast', 'nahda'],
  ],
  ['study', ['class', 'school', 'study', 'lesson', 'catechism', 'mahragan', 'keraza', 'hymns']],
  [
    'gathering',
    [
      'meeting',
      'fellowship',
      'tournament',
      'trip',
      'camp',
      'meals',
      'retreat',
      'festival',
      'competition',
      'outing',
      'visit',
      'picnic',
    ],
  ],
];

/**
 * Which kind an occurrence is, from its title.
 *
 * Matches on whole words rather than substrings: "class" must not be found
 * inside "classical", and more to the point "mass" inside "Christmas".
 */
/**
 * An occurrence's kind: the one it was given, or the one its title implies.
 *
 * Everything that renders a colour goes through here rather than calling
 * `occurrenceKind` on the title directly — otherwise a manual entry filed as a
 * gathering would still come out gold because somebody called it "Class".
 */
export function kindOf(occurrence: Pick<CalendarOccurrence, 'title' | 'kind'>): OccurrenceKind {
  return occurrence.kind ?? occurrenceKind(occurrence.title);
}

export function occurrenceKind(title: string): OccurrenceKind {
  const words = new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );

  for (const [kind, markers] of KIND_WORDS) {
    if (markers.some((marker) => words.has(marker))) return kind;
  }
  return 'other';
}
