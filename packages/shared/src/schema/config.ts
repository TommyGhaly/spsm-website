/**
 * Runtime configuration, stored in Firestore rather than in env files.
 *
 * Why the database and not `.env`: these values describe *where the parish's
 * data lives*, and that changes for reasons that have nothing to do with the
 * code — a project gets renamed, a collection moves, the bulletin section needs
 * turning off for a week. Putting them in Firestore means those are edits, not
 * deploys, and there is exactly one copy instead of one per environment file.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NEVER GO IN HERE
 *
 * Credentials. `config` is world-readable (see firestore.rules) because the
 * website build reads it as an anonymous client, so anything written here is
 * public. That is fine for a project id and a collection name — neither
 * authorizes anything, and IAM on the other project is what actually restricts
 * access. It would be catastrophic for a service-account key or an API token.
 *
 * Secrets stay in Secret Manager (`firebase functions:secrets:set`) and in the
 * gitignored root `.env`.
 * ---------------------------------------------------------------------------
 *
 * Bootstrap note: the Firebase connection itself cannot live here, for the
 * obvious reason that you need it to read this. The six `NEXT_PUBLIC_FIREBASE_*`
 * values stay in the environment; everything else moves here.
 */

import {
  CAMP_ROLE_SUGGESTIONS,
  campWeekRoleKey,
  type CampSection,
  DEFAULT_CAMP_WEEKS,
  MAX_CAMP_WEEKS,
  MAX_LINE as MAX_CAMP_LINE,
  parseCampWeekRoleKey,
} from './camp.js';

/** Document id of the single integrations config document. */
export const CONFIG_DOC_INTEGRATIONS = 'integrations';

/** Document id of the parish details document. */
export const CONFIG_DOC_PARISH = 'parish';

/** Document id of the `/events` page's own settings. */
export const CONFIG_DOC_EVENTS = 'events';

export interface IntegrationsConfig {
  announcements: AnnouncementsConfig;
  livestream: LivestreamConfig;
}

/**
 * How the parish streams its liturgies.
 *
 * `platform` decides the embed, because the three are not interchangeable —
 * YouTube takes a video or channel id, Facebook wraps a page URL in its plugin,
 * and anything else needs the iframe URL given verbatim. Modelling it as one
 * "url" field and guessing from the hostname works right up until the parish
 * switches provider mid-Lent.
 */
export interface LivestreamConfig {
  enabled: boolean;
  platform: LivestreamPlatform;
  /**
   * YouTube: a channel id (`UC…`) for "whatever is live now", or a video id.
   * Facebook: the full page or video URL.
   * Custom: the iframe `src` exactly as the provider gives it.
   */
  target: string;
  /** Shown beside the player — "Sundays, 8:00am" and the like. */
  scheduleNote: string;
  /** Where to watch if the embed fails or is blocked. */
  fallbackUrl: string;
  /**
   * YouTube channel id (`UC…`) whose past streams are listed under the player,
   * or `''` for no archive.
   *
   * Separate from `target` on purpose, and the separation is the point: the
   * parish broadcasts through Castr and *restreams* to YouTube, so the thing
   * playing live and the thing holding the back catalogue are two different
   * services. Reusing `target` would tie them together and break the moment the
   * live provider changes again — which it already has once.
   *
   * A channel id is public information, so it is safe in a world-readable
   * document. It is also the only form that works: the archive is read from
   * `youtube.com/feeds/videos.xml?channel_id=…`, which does not accept an
   * `@handle`.
   */
  archiveChannelId: string;
}

/**
 * A past broadcast.
 *
 * Note there is no `title`. Every stream on the parish's channel is published
 * under the identical name — "St Philopater & St Mina Coptic Orthodox Church
 * Live Stream" — so a list led by title is fifteen identical rows. When it
 * happened is the only thing that distinguishes one liturgy from another, so
 * that is what the list is built on.
 */
export interface PastStream {
  /** YouTube video id. */
  id: string;
  /**
   * When the broadcast **began**, as an ISO 8601 instant.
   *
   * ---------------------------------------------------------------------------
   * This is emphatically not the feed's `<published>`, and the difference is
   * the whole reason this field is named the way it is.
   *
   * `<published>` is when YouTube published the *recording*, which happens when
   * the stream ends and the VOD is processed — hours after the liturgy. Built on
   * that, this list showed the Sunday morning liturgy of 2026-08-16 as "11:36
   * PM", and showed Saturday evening's service under Sunday's date. Every row
   * was wrong, in both the time and often the day.
   *
   * The real start time comes from `startTimestamp` on the video's watch page.
   * See `parseWatchPageStart`.
   * ---------------------------------------------------------------------------
   */
  startedAt: string;
  /** Thumbnail URL, or `''` if the feed gave none. */
  thumbnailUrl: string;
}

/** One entry of the channel feed, before its true start time is known. */
export interface FeedVideo {
  id: string;
  /** When the *recording* was published — a fallback, not the air time. */
  publishedAt: string;
  thumbnailUrl: string;
}

/**
 * True for something shaped like a YouTube channel id.
 *
 * `UC` followed by 22 characters of base64url. Checked rather than trusted
 * because the realistic mistake is someone pasting `@WaylandCopticChurch` or a
 * full channel URL into this field, and both of those produce a feed request
 * that returns 404 — a silent empty archive that looks like "the parish has no
 * past streams" rather than like a typo.
 */
export function isYouTubeChannelId(value: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(value);
}

export const LIVESTREAM_PLATFORMS = ['youtube', 'facebook', 'custom'] as const;
export type LivestreamPlatform = (typeof LIVESTREAM_PLATFORMS)[number];

/**
 * Parish contact details and service times.
 *
 * Structured rather than prose, unlike everything in the `content` collection.
 * An address has parts, a phone number is dialable, a service time repeats
 * weekly — flattening those into a paragraph loses the structure that lets the
 * page render a `tel:` link, a map link, and a schedule table. It is also the
 * information most likely to be wrong on an old website, so it lives somewhere
 * staff can fix in thirty seconds without a deploy.
 */
export interface ParishConfig {
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
  };
  /**
   * Where the address actually is.
   *
   * Stored rather than derived, and `null` rather than a guess — the same rule
   * the address itself follows. Geocoding the address at build time would put a
   * network call and a third-party rate limit on the critical path of every
   * deploy, and would silently move the point the day a geocoder changes its
   * mind about which building on Rice Road is the church. A pair of numbers
   * somebody checked once is the honest version. Fill it in with
   * `npm run parish:geo`.
   *
   * **Nothing on the website reads this today.** The `/contact` map was a
   * Leaflet map centred on this pair until Aug 27 2026; it is now a Google
   * Maps embed built from the street address, which is what Google needs to
   * find its own listing for the church. The field stays because it is the
   * parish's checked coordinate and part two of the program — the mobile app —
   * wants a point rather than a string. Do not delete it as dead, and do not
   * assume moving it moves anything on the site.
   */
  geo: ParishGeo | null;
  phone: string;
  email: string;
  /** Free text — "Tuesday–Friday, 9am–3pm". */
  officeHours: string;
  /** Regular weekly services, in the order they should be listed. */
  serviceTimes: ServiceTime[];
  /** Anything that doesn't fit the fields above. Markdown. */
  notes: string;
  /** Where the parish is on social platforms. Any or all may be empty. */
  social: ParishSocial;
}

/**
 * A point on the earth, in the only projection anything here uses.
 *
 * Degrees, WGS-84 — what every maps app, every tile server, and every `geo:`
 * URI already expects. Deliberately not a Firestore `GeoPoint`: this document is
 * read by the website, by the Functions, and (part two of the program) by the
 * mobile app, and a plain pair of numbers is the one shape all three can parse
 * without the Firestore SDK in the way. Same argument as the design tokens.
 */
export interface ParishGeo {
  /** −90 … 90. */
  lat: number;
  /** −180 … 180. */
  lng: number;
}

/**
 * The parish's social accounts, as full profile URLs.
 *
 * URLs rather than handles, and that is the decision to keep. A handle needs
 * the site to know how to build a URL for each platform, which puts a mapping
 * in code that changes when a platform changes its URL shape — and it cannot
 * express the ones that do not fit, like a YouTube channel that has `/@handle`
 * on one account and `/channel/UC…` on another. A URL is what the parish can
 * copy out of their own address bar, which is also the only form they can check
 * is right.
 *
 * Empty string means "no account", not "unknown": every renderer omits the icon
 * entirely rather than linking somewhere broken.
 */
export interface ParishSocial {
  instagram: string;
  facebook: string;
  youtube: string;
}

export interface ServiceTime {
  /** "Sunday", "Saturday", "Wednesday" — or "First Saturday of the month". */
  day: string;
  /** "8:00am – 11:00am". Kept as written, for the same reason bulletin times are. */
  time: string;
  /** "Divine Liturgy", "Vespers", "Midnight Praises (Tasbeha)". */
  name: string;
}

export interface AnnouncementsConfig {
  /**
   * Lets staff hide the weekly bulletin from the site without a deploy — for a
   * week the bulletin is not ready, or if the source app breaks.
   */
  enabled: boolean;

  /** GCP/Firebase project id holding the bulletins. */
  projectId: string;

  /** Collection within that project. */
  collectionPath: string;

  /**
   * Named Firestore database, or empty for `(default)`.
   *
   * Empty is correct for this project and worth leaving that way. Its display
   * name is "weeklyAnnouncements", which is *not* a database id — putting that
   * here produces a bare `5 NOT_FOUND` that reads like a missing collection
   * rather than a missing database.
   */
  databaseId: string;
}

/**
 * Used when the config document is missing or unreadable.
 *
 * A parish website should not go blank because someone deleted a settings
 * document. These are the values in use as of 2026-08-07; treat them as a
 * fallback, not as the source of truth.
 */
export const DEFAULT_INTEGRATIONS_CONFIG: IntegrationsConfig = {
  announcements: {
    enabled: true,
    projectId: 'weeklyannouncements-1d046',
    collectionPath: 'bulletins',
    databaseId: '',
  },
  livestream: {
    /*
     * The parish's own Castr player, given by the parish on 2026-08-15. It was
     * `enabled: false` with an empty target before that, on the principle that
     * an empty player reads as broken rather than as absent — which no longer
     * applies, because there is a real stream behind this one.
     *
     * `custom` rather than `youtube`: Castr gives an iframe `src` and it is used
     * verbatim. See `embedUrl` in LivestreamPlayer.
     *
     * NOTE this is only the fallback for a *missing* `config/integrations`
     * document. Where the document exists, `enabled` is read from it and
     * nothing else — `parseIntegrationsConfig` requires an explicit `true` and
     * deliberately does not fall back for that one field, so a stream cannot be
     * switched on by accident.
     */
    enabled: true,
    platform: 'custom',
    target: 'https://player.castr.com/d_4b4563208a1c11ee85ae0f1e19e13368',
    scheduleNote: '',
    fallbackUrl: '',
    /*
     * The parish's own YouTube channel, resolved from the `@WaylandCopticChurch`
     * handle in `DEFAULT_PARISH_CONFIG.social` on 2026-08-17 and confirmed
     * against the feed, which returns "St Philopater & St Mina Coptic Orthodox
     * Church" and a stream most days.
     *
     * The handle is not usable here — the feed endpoint takes a channel id only —
     * which is why this is stored resolved rather than derived at build time.
     */
    archiveChannelId: 'UC6xlDBsD02-k7M5o-51CUQw',
  },
};

/**
 * Blank on purpose.
 *
 * These are facts about a real parish — an address people will drive to, a
 * phone number they will call. Guessing them and shipping the guess is worse
 * than shipping nothing, because a plausible wrong address is one nobody thinks
 * to check. Every consumer of this renders an honest "ask the office" state
 * when a field is empty; fill it in via `npm run config`.
 */
export const DEFAULT_PARISH_CONFIG: ParishConfig = {
  address: { line1: '', line2: '', city: '', state: '', postalCode: '' },
  /*
   * Blank for the same reason the address is, and more so. A wrong address is at
   * least legible as wrong once somebody reads it; a wrong coordinate is a
   * confident marker on a map, three streets away, that looks exactly as
   * authoritative as a right one.
   */
  geo: null,
  phone: '',
  email: '',
  officeHours: '',
  serviceTimes: [],
  notes: '',
  /*
   * The only fields in this default that are not blank.
   *
   * Everything else here stays empty because a plausible wrong address is one
   * nobody thinks to check. These three are different in kind: they were given
   * by the parish directly, they are public pages anyone can verify in a
   * second, and unlike an address there is no half-right version of a profile
   * URL — it either opens the parish's account or it obviously does not.
   *
   * `config/parish` still overrides them, so the parish can move an account
   * without a deploy.
   */
  social: {
    instagram: 'https://www.instagram.com/spsmchurch',
    facebook: 'https://www.facebook.com/waylandcopticchurch',
    // Supplied as `http://`. Normalised to https here rather than at render
    // time: YouTube redirects http → https anyway, and shipping an http link
    // means every visitor pays a redirect and any middlebox sees the request.
    youtube: 'https://www.youtube.com/@WaylandCopticChurch',
  },
};

/**
 * Coerce whatever is in the document into a usable config.
 *
 * Staff can edit this document by hand in the Firebase console, so a missing
 * or mistyped field is an ordinary occurrence rather than an exceptional one.
 * Each field falls back independently, so one bad edit does not discard the
 * others.
 */
export function parseIntegrationsConfig(raw: unknown): IntegrationsConfig {
  const doc = asRecord(raw);
  const announcements = asRecord(doc?.['announcements']);
  const livestream = asRecord(doc?.['livestream']);
  const fallback = DEFAULT_INTEGRATIONS_CONFIG;

  const platform = str(livestream?.['platform']);

  return {
    announcements: {
      // Only an explicit `false` disables it. A missing field means "on",
      // which is the safer default for a section that is normally present.
      enabled: announcements?.['enabled'] !== false,
      projectId: str(announcements?.['projectId']) ?? fallback.announcements.projectId,
      collectionPath:
        str(announcements?.['collectionPath']) ?? fallback.announcements.collectionPath,
      // Note the `??` rather than `||`: an empty string is a meaningful value
      // here — it means the (default) database — and must not fall back.
      databaseId: str(announcements?.['databaseId']) ?? fallback.announcements.databaseId,
    },
    livestream: {
      // Opposite default to announcements, deliberately: a stream must be
      // switched on explicitly, because showing a player for a stream that
      // isn't configured looks broken rather than absent.
      enabled: livestream?.['enabled'] === true,
      platform: isPlatform(platform) ? platform : fallback.livestream.platform,
      target: str(livestream?.['target']) ?? fallback.livestream.target,
      scheduleNote: str(livestream?.['scheduleNote']) ?? fallback.livestream.scheduleNote,
      fallbackUrl: str(livestream?.['fallbackUrl']) ?? fallback.livestream.fallbackUrl,
      archiveChannelId: channelId(
        livestream?.['archiveChannelId'],
        fallback.livestream.archiveChannelId,
      ),
    },
  };
}

/**
 * A usable channel id, or `''`.
 *
 * Same absent-versus-invalid split as `socialUrl` above, for the same reason: a
 * key that is not in the document falls back to the parish's own channel, which
 * is how the archive survives a config document written before this field
 * existed. A key that *is* there and is not a channel id returns `''`, hiding
 * the archive — whoever typed a handle or a full URL was trying to change which
 * channel is listed, and quietly listing the old one instead conceals that.
 * An explicit empty string is a deliberate "no archive" and is honoured.
 */
function channelId(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null) return fallback;

  const value = str(raw);
  if (!value) return '';

  return isYouTubeChannelId(value) ? value : '';
}

export function parseParishConfig(raw: unknown): ParishConfig {
  const doc = asRecord(raw);
  const address = asRecord(doc?.['address']);
  const social = asRecord(doc?.['social']);
  const blank = DEFAULT_PARISH_CONFIG;

  return {
    address: {
      line1: str(address?.['line1']) ?? blank.address.line1,
      line2: str(address?.['line2']) ?? blank.address.line2,
      city: str(address?.['city']) ?? blank.address.city,
      state: str(address?.['state']) ?? blank.address.state,
      postalCode: str(address?.['postalCode']) ?? blank.address.postalCode,
    },
    geo: parseGeo(doc?.['geo']),
    phone: str(doc?.['phone']) ?? blank.phone,
    email: str(doc?.['email']) ?? blank.email,
    officeHours: str(doc?.['officeHours']) ?? blank.officeHours,
    serviceTimes: parseServiceTimes(doc?.['serviceTimes']),
    notes: str(doc?.['notes']) ?? blank.notes,
    social: {
      instagram: socialUrl(social?.['instagram'], blank.social.instagram),
      facebook: socialUrl(social?.['facebook'], blank.social.facebook),
      youtube: socialUrl(social?.['youtube'], blank.social.youtube),
    },
  };
}

/**
 * A social profile URL, or `''` if it is not one we will link to.
 *
 * Staff edit `config/parish` by hand in the Firebase console, so the realistic
 * failure is not an attack — it is someone pasting `@spsmchurch`, or
 * `www.instagram.com/…` with no scheme, and the footer then emitting a relative
 * link that resolves to a 404 on this site. Requiring an absolute `http(s)` URL
 * makes that fail visibly here rather than quietly in the markup.
 *
 * `javascript:` and `data:` are excluded by the same check, which matters
 * because this value goes straight into an `href`.
 *
 * **Absent and invalid are different, and that is the whole shape of this
 * function.** A key that is not in the document at all falls back to the parish
 * default — that is how three accounts survive a document, like the live one,
 * that has never had a `social` field written to it. A key that *is* there and
 * is unusable returns `''`, hiding the icon: whoever typed `@spsmchurch` was
 * trying to change the link, and quietly showing the old one instead conceals
 * the mistake. An explicit empty string is a deliberate "remove this icon" and
 * is honoured the same way.
 */
function socialUrl(raw: unknown, fallback: string): string {
  if (raw === undefined || raw === null) return fallback;

  const value = str(raw);
  if (!value) return '';

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function parseServiceTimes(raw: unknown): ServiceTime[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      const name = str(record?.['name']);
      // A row with no service name is a half-finished edit, not a service.
      if (!name) return null;
      return {
        name,
        day: str(record?.['day']) ?? '',
        time: str(record?.['time']) ?? '',
      };
    })
    .filter((entry): entry is ServiceTime => entry !== null);
}

/**
 * A stored `geo`, or null.
 *
 * Both numbers or neither: a document with a latitude and no longitude is a
 * half-finished edit, and pairing the missing one with 0 would put the marker in
 * the Gulf of Guinea. The range check is a second, weaker net — it catches a
 * degrees-times-1e7 integer or a decimal point in the wrong place.
 *
 * What it explicitly does **not** catch is the two being swapped, which is the
 * likeliest mistake of all: this parish reversed is (−71.33, 42.35), a perfectly
 * legal point off the coast of Antarctica. No amount of validation can tell that
 * from a deliberate one. The defence against it is that somebody looks at the
 * map on /contact once after setting the field, which is a thing a person has to
 * do rather than a thing this function can do for them.
 */
function parseGeo(raw: unknown): ParishGeo | null {
  const point = asRecord(raw);
  if (!point) return null;

  const lat = point['lat'];
  const lng = point['lng'];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

/** True when the parish has filled in enough for a contact page to be useful. */
export function hasParishDetails(config: ParishConfig): boolean {
  return Boolean(config.phone || config.email || config.address.line1);
}

/** One-line address, skipping the parts that are blank. */
export function formatAddress(address: ParishConfig['address']): string {
  const street = [address.line1, address.line2].filter(Boolean).join(', ');
  const region = [address.city, address.state].filter(Boolean).join(', ');
  return [street, region, address.postalCode].filter(Boolean).join(' · ');
}

/* -------------------------------------------------------------------------- */
/* The /events page                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Settings that belong to the `/events` page itself rather than to any one
 * ministry on it.
 *
 * A document rather than a field on the five programs, because these are answers
 * the *parish* gives once. "Which ministry is the current one" is not a property
 * of Summercamp — it is a property of this moment, and next month it is a
 * different ministry.
 *
 * `config` is world-readable and admin-writable (see firestore.rules), which is
 * the right pair here: the page that reads this is public, and only a superadmin
 * may set it — the same person who already holds `canManagePrograms` and is the
 * only one the `/events` editing controls appear for.
 */
export interface EventsPageConfig {
  /**
   * The section of `/events` the parish is pointing at right now: a `programs`
   * document id, or `null` for none.
   *
   * The same *kind* of setting as an event's `heroImagePath` — one chosen thing,
   * on the page, stored where every surface can read it. What reads it is what
   * makes it worth a field rather than a convention:
   *
   *  - **the NFC tags, next.** A tag by the door means "the thing happening now",
   *    and the tag itself cannot be reprogrammed every week. It points at a
   *    route; the route reads this; the parish changes it here.
   *  - **the forms behind those tags**, which have to file what they collect
   *    somewhere. A photograph submitted from a tap belongs to the section the
   *    parish has named, not to whichever page the form happened to open on.
   *
   * Not a display setting. Nothing on the public page is arranged differently
   * because of it, and nothing should be: a visitor reading `/events` sees the
   * ministries in the parish's order either way.
   *
   * ## A ministry, not a level inside one
   *
   * This held a `{ programId, programEventId }` pair for about an hour, so that
   * it could name Week 1 2026 or Day 3 of it. Narrowed to a program at Tommy's
   * direction, and the narrower field is the better one for what reads it: a tag
   * screwed to a wall wants an answer that stays true for a season, and "Day 3"
   * is stale by Thursday. The parish sets Summercamp once in June.
   *
   * It is also the id that is already a URL — `programs` documents are keyed by
   * their slug (see `createProgram`), so this value is `/events/<mainSection>`
   * without a lookup, which is exactly what a tag has to turn it into.
   *
   * If a level ever needs naming, that is a second field rather than a wider one:
   * a pointer that *may* be a program or *may* be a level is one every reader has
   * to branch on, and the reason to widen it will come with its own answer about
   * what happens when the level is deleted mid-week.
   *
   * ## A stale pointer is expected, not an error
   *
   * The ministry this names can be deleted at any time, by somebody who has never
   * seen this setting. Every reader therefore resolves it against the collection
   * and treats "does not resolve" as "not set" — the rule `defaultSubmissionNode`
   * already states for `Program.prioritySubmissionNodeId`, for the same reason: a
   * form that refuses to send because a ministry was removed is worse than a form
   * that files where it stands.
   */
  mainSection: string | null;
}

/**
 * Nothing chosen.
 *
 * Blank rather than a guess — "the first ministry" would be a plausible default
 * and a wrong one, because the whole value of this field is that a person picked
 * it. Every consumer has a defined behaviour for null already (fall back to the
 * page it is on), so an unset setting costs a preselection and never a feature.
 */
export const DEFAULT_EVENTS_PAGE_CONFIG: EventsPageConfig = {
  mainSection: null,
};

/**
 * Coerce whatever is in `config/events` into a usable setting.
 *
 * The empty string is *not* preserved here, unlike most fields read through
 * `str` — a blank pointer and a missing one both mean nothing is chosen, and
 * carrying two spellings of that would put the same `|| null` in every reader.
 *
 * Not checked against the `programs` collection, which this cannot see. A
 * pointer at a deleted ministry is a real state every reader tolerates; see the
 * field's note.
 */
export function parseEventsPageConfig(raw: unknown): EventsPageConfig {
  const doc = asRecord(raw);
  return { mainSection: str(doc?.['mainSection']) || null };
}

function isPlatform(value: string | null): value is LivestreamPlatform {
  return value !== null && (LIVESTREAM_PLATFORMS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Preserves the empty string; rejects non-strings. */
function str(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

/* ==========================================================================
   The bookstore's own settings
   ========================================================================== */

/** Document id of the bookstore settings document. */
export const CONFIG_DOC_BOOKSTORE = 'bookstore';

/**
 * The handful of things about the shop that are a parish decision, not a code
 * decision.
 *
 * ---------------------------------------------------------------------------
 * Why these moved out of the Functions runtime.
 *
 * `deliveryCents` and `orderEmail` were `defineString` parameters in
 * `functions/src/checkout.ts` — which meant changing what the parish charges for
 * postage required a redeploy by somebody who can deploy. That contradicts the
 * whole reason this collection exists, stated in `collections.ts`: config is for
 * "feature switches that staff can change without a code deploy". A price the
 * parish sets is the most obvious member of that set there is.
 *
 * The Functions parameters remain as the fallback, so a missing document is a
 * working checkout rather than free postage.
 *
 * ## Integer cents, never a formatted string
 *
 * The same rule as everywhere else money appears here, and the same rule the
 * design tokens follow: store the number, format at the edge. `"$7.00"` in
 * Firestore is a value the phone app would have to parse back out of a currency
 * string, and a value somebody can make mean nothing by typing "seven dollars".
 * ---------------------------------------------------------------------------
 */
/**
 * One division of the shop — "Books", "Icons for the home", "Gifts".
 *
 * `id` is what a product's `section` field holds and never changes; `label` is
 * what the shop prints and can be renamed freely. Keeping them separate is what
 * makes renaming a section a one-field edit rather than a migration across every
 * product in it.
 */
export interface BookstoreSection {
  id: string;
  label: string;
}

export interface BookstoreConfig {
  /** Flat delivery charge, in integer minor units. 0 means free delivery. */
  deliveryCents: number;
  /**
   * Where a buyer is told to write about a wrong order. Empty is fine — the
   * confirmation email then says "contact the parish office" rather than naming
   * an address that does not exist.
   */
  orderEmail: string;
  /** The line above the shelf about collection and delivery. */
  fulfilmentNote: string;
  /** The returns policy, shown before anyone reaches the card form. */
  returnsNotice: string;

  /**
   * The shop's divisions, in the order they appear.
   *
   * The array *is* the order — no `position` field to keep in step with itself.
   * Reordering is a reordered array, which is the one representation that cannot
   * develop two sections claiming the same slot.
   *
   * Empty is a valid and normal state: a parish that has not sorted anything
   * gets one undivided shelf, exactly as before this existed.
   */
  sections: BookstoreSection[];

  /** How delivered orders are priced — see `BookstoreShipping`. */
  shipping: BookstoreShipping;
}

/** The USPS services the shop can offer, by USPS's own `mailClass` names. */
export const SHIPPING_SERVICES = ['USPS_GROUND_ADVANTAGE', 'PRIORITY_MAIL', 'MEDIA_MAIL'] as const;
export type ShippingService = (typeof SHIPPING_SERVICES)[number];

/**
 * Live postage, and the switch back to the flat charge.
 *
 * ---------------------------------------------------------------------------
 * `mode: 'flat'` is today's behaviour — `deliveryCents` on every delivery — and
 * it is the default, so deploying this changes nothing until the parish has
 * weighed its books and turned it on. It stays the fallback afterwards: a
 * basket with an unweighed item, or a USPS outage, is charged `deliveryCents`
 * rather than refused.
 *
 * One box for every parcel. The parish posts a few books at a time, and asking
 * staff to choose a carton per order is a decision nobody at the bookstore table
 * wants to make. USPS prices Ground Advantage and Priority on weight and zone at
 * these sizes, so the box mostly matters through its own weight.
 * ---------------------------------------------------------------------------
 */
export interface BookstoreShipping {
  mode: 'usps' | 'flat';
  /** Where parcels are posted from. Five digits. */
  originZip: string;
  /** Added to every live quote, once per order — packing, the drive to the post office. */
  handlingCents: number;
  box: { lengthIn: number; widthIn: number; heightIn: number; tareOz: number };
  /** Offered in this order. Media Mail only ever appears for an all-media basket. */
  services: ShippingService[];
}

/** Section ids are generated from the label and then frozen. */
export const MAX_SECTIONS = 12;
export const MAX_SECTION_LABEL = 40;

/**
 * A storable id for a new section, from whatever was typed.
 *
 * Falls back to a timestamp rather than to an empty string: two sections both
 * called "Icons — الأيقونات" would otherwise both reduce to `""` and become the
 * same section, silently merging their products.
 */
export function sectionId(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || `section-${Date.now().toString(36)}`;
}

/**
 * What the shop says when nothing has been configured.
 *
 * These are the exact strings that were hard-coded into `Shop.tsx` and
 * `checkout.ts` before this document existed, so seeding it changes nothing on
 * screen — which is the property that makes the migration safe to deploy on its
 * own.
 */
export const DEFAULT_BOOKSTORE_CONFIG: BookstoreConfig = {
  deliveryCents: 700,
  orderEmail: '',
  fulfilmentNote: 'Collect your order at the church, or have it delivered to you.',
  returnsNotice:
    'Sales are final. If a book reaches you damaged, or is not the one you ordered, ' +
    'write to the church office within 14 days and it will be put right.',
  /*
   * No sections by default, and none invented.
   *
   * Seeding "Books" and "Gifts" would put two headings on a shop that has
   * eleven titles and no opinion about them yet, and somebody would have to
   * delete them before the page looked right. An unsorted shop renders exactly
   * as it did before sections existed.
   */
  sections: [],
  shipping: {
    mode: 'flat',
    originZip: '01778',
    handlingCents: 150,
    box: { lengthIn: 12, widthIn: 9, heightIn: 4, tareOz: 6 },
    services: ['USPS_GROUND_ADVANTAGE', 'PRIORITY_MAIL', 'MEDIA_MAIL'],
  },
};

/** Guards on the shipping settings, against a typo becoming a charge. */
export const MAX_HANDLING_CENTS = 20_00;
export const MAX_BOX_INCHES = 36;
export const MAX_BOX_TARE_OZ = 80;

/** The most the parish can charge for postage, as a guard against a typo. */
export const MAX_DELIVERY_CENTS = 100_00;

/**
 * Coerce whatever is in `config/bookstore` into usable settings.
 *
 * Every field falls back individually rather than the document falling back as
 * a whole: a half-written document — one field edited in place before the others
 * existed — should contribute the field it has, not be discarded.
 *
 * `deliveryCents` is the one that is range-checked rather than merely typed.
 * It is read by the checkout Function and turned into a charge, so a negative
 * number is a discount nobody authorised and a number with a stray zero is a
 * $700 delivery fee. Out of range falls back to the default rather than being
 * clamped: clamping silently charges something nobody chose, and the default is
 * at least a figure the parish once agreed on.
 */
export function parseBookstoreConfig(raw: unknown): BookstoreConfig {
  const doc = asRecord(raw);
  const fallback = DEFAULT_BOOKSTORE_CONFIG;

  const delivery = doc?.['deliveryCents'];
  const usableDelivery =
    typeof delivery === 'number' &&
    Number.isInteger(delivery) &&
    delivery >= 0 &&
    delivery <= MAX_DELIVERY_CENTS;

  return {
    deliveryCents: usableDelivery ? (delivery as number) : fallback.deliveryCents,
    // `?? fallback` rather than `|| fallback`, so a parish that deliberately
    // cleared the address gets an empty string and the email says "the parish
    // office" — not the default, which is also empty, but only by coincidence.
    orderEmail: str(doc?.['orderEmail']) ?? fallback.orderEmail,
    fulfilmentNote: str(doc?.['fulfilmentNote']) || fallback.fulfilmentNote,
    returnsNotice: str(doc?.['returnsNotice']) || fallback.returnsNotice,
    sections: parseSections(doc?.['sections']),
    shipping: parseShipping(doc?.['shipping']),
  };
}

/**
 * The shipping block, each field falling back on its own — the same rule as the
 * document around it, and for the same reason. Out-of-range numbers fall back
 * rather than clamp: `handlingCents` becomes part of a charge.
 */
export function parseShipping(raw: unknown): BookstoreShipping {
  const doc = asRecord(raw);
  const fallback = DEFAULT_BOOKSTORE_CONFIG.shipping;

  const inRange = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

  const handling = doc?.['handlingCents'];
  const zip = str(doc?.['originZip']);
  const box = asRecord(doc?.['box']);
  const dimension = (key: 'lengthIn' | 'widthIn' | 'heightIn'): number => {
    const value = box?.[key];
    return inRange(value, 1, MAX_BOX_INCHES) ? value : fallback.box[key];
  };
  const tare = box?.['tareOz'];

  const listed = doc?.['services'];
  const services = Array.isArray(listed)
    ? SHIPPING_SERVICES.filter((service) => listed.includes(service))
    : fallback.services;

  return {
    mode: doc?.['mode'] === 'usps' ? 'usps' : 'flat',
    originZip: zip && /^\d{5}$/.test(zip) ? zip : fallback.originZip,
    handlingCents:
      inRange(handling, 0, MAX_HANDLING_CENTS) && Number.isInteger(handling)
        ? handling
        : fallback.handlingCents,
    box: {
      lengthIn: dimension('lengthIn'),
      widthIn: dimension('widthIn'),
      heightIn: dimension('heightIn'),
      tareOz: inRange(tare, 0, MAX_BOX_TARE_OZ) ? tare : fallback.box.tareOz,
    },
    // An emptied list is "no live services", which means flat — not "all of them".
    services,
  };
}

/**
 * The sections array, with anything unusable dropped rather than the lot.
 *
 * One malformed entry — a hand edit in the console, a half-written document —
 * must not take the other five headings off the shop with it. Duplicated ids are
 * dropped too: two sections sharing an id means products land in whichever one
 * renders first, which looks like products going missing.
 */
export function parseSections(raw: unknown): BookstoreSection[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const sections: BookstoreSection[] = [];

  for (const entry of raw) {
    const record = asRecord(entry);
    const id = str(record?.['id']);
    const label = str(record?.['label']);
    if (!id || !label) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    sections.push({ id, label: label.slice(0, MAX_SECTION_LABEL) });
    if (sections.length >= MAX_SECTIONS) break;
  }

  return sections;
}

/* ==========================================================================
   The camp's own settings
   ========================================================================== */

/** Document id of the camp settings document. */
export const CONFIG_DOC_CAMP = 'camp';

/**
 * The handful of things about summer camp that are a parish decision.
 *
 * ---------------------------------------------------------------------------
 * Why these are config and not fields on a screen.
 *
 * There is no settings UI anywhere on this site and there is not one here
 * either — `config/*` is edited in the Firebase console or by `npm run config`,
 * which is the arrangement `config/bookstore` settled after an in-place editor
 * was built for the shop and rejected. The camp fee, the season and the waiver
 * are exactly that kind of value: set once a year by whoever runs the camp,
 * read by every registration, and wrong to expose on the same screen a
 * volunteer is typing a family's phone number into.
 *
 * `config` is world-readable. Everything here is fine to be public — a fee, a
 * season name, and a waiver the parish hands to parents anyway. Nothing about a
 * registered family goes anywhere near this document.
 * ---------------------------------------------------------------------------
 */
export interface CampConfig {
  /**
   * The ministry the camp belongs to. Decides the program grant that opens the
   * registration screen — see `packages/shared/src/programAdmin.ts`.
   *
   * Configurable because the id is whatever `npm run programs` created, and a
   * parish that renamed the ministry should not lose the camp screen with it.
   */
  programId: string;

  /**
   * The season being registered for right now: `2027`.
   *
   * One current season rather than a list, because the screen only ever writes
   * to one. Past seasons are still readable — they are just rows with a
   * different `season` — and rolling over to next year is editing this string.
   */
  season: string;

  /**
   * The fee for one child for one **week**, in integer minor units.
   *
   * Per week, not per child: a child registered for both weeks is charged
   * twice. The field is named `baseCents` rather than something that says so,
   * because it is stored on every existing registration and renaming it in code
   * without rewriting those documents is how a fee silently reads as zero. See
   * `campBill`.
   *
   * Copied onto each registration when it is created; changing it never
   * re-bills anyone already registered.
   */
  baseCents: number;

  /**
   * What a servant is charged, once, in integer minor units. Zero means free.
   *
   * ---------------------------------------------------------------------------
   * The shirt money, and the one thing on the public form that takes a card.
   *
   * Servants are not billed for weeks — `campBill` gives them no lines at all —
   * but the camp does buy them a shirt, and asking two hundred teenagers for
   * twenty dollars in cash at a door is how a camp ends up with an envelope and
   * an argument. So: a flat amount the camp sets here, charged **once** however
   * many weeks somebody serves, and taken by card at the bottom of
   * `/forms/summer-camp` before the sign-up will send.
   *
   * Flat rather than per week, because it is not a rate: one servant, one
   * shirt. And required rather than optional to the servant, because a form
   * with a "would you like a shirt" tick is a shirt order the camp then has to
   * reconcile against a roster — Tommy chose the flat, required reading.
   *
   * **Zero switches the whole thing off.** No charge is shown, no card field is
   * rendered, Square is never loaded, and the form sends exactly as it did
   * before this existed. That is the default and it is what a camp that has not
   * thought about this gets.
   *
   * Copied onto each sign-up as `billing.chargeCents` when it is taken, so
   * raising it in July never re-bills a servant who paid in May.
   * ---------------------------------------------------------------------------
   */
  servantChargeCents: number;

  /**
   * What the charge is for, in the camp's words: "Servant shirt".
   *
   * Shown beside the amount on the form and used as the note on the Square
   * payment, which is what a treasurer reading the parish's Square dashboard
   * sees. Empty reads as "Servant charge" rather than as nothing — a card
   * screen asking for twenty dollars for an unnamed reason is one nobody
   * completes.
   */
  servantChargeLabel: string;

  /**
   * How many weeks the camp runs this year. Normally two.
   *
   * Read by the day grid on the registration form, which draws Monday to Friday
   * for each. Lowering it hides a week from the form but does not touch the days
   * anybody has already been registered for — deleting somebody's attendance
   * because a setting changed would be a silent loss of a real answer.
   */
  weeks: number;

  /**
   * The Monday each week of camp begins, as `YYYY-MM-DD`. Index 0 is week 1.
   *
   * ---------------------------------------------------------------------------
   * Added 2 Sep 2026, because *"I want admins to set a config for when the first
   * and second week of camp is"* — and because a register that says "Week 2 ·
   * Wed" is a puzzle to anybody standing at a door in June.
   *
   * **This changes no stored day key.** Attendance, a child's chosen days and
   * the register are all still `w1-mon`, for the reason `CampDayKey` gives: the
   * camp talks in weeks and weekdays, and dates would tie every registration to
   * one year's calendar. What these are is the *display* of those keys —
   * `campDayDate` turns `w2-wed` into a real day, and every screen that shows a
   * day shows both. Nothing migrates, and clearing this field only takes the
   * dates back off the screens.
   *
   * A start rather than a start and an end, so a week cannot be saved as four
   * days by accident; Monday to Friday is derived. A blank entry means that
   * week's dates are not set yet, which is the normal state in February.
   *
   * The length is coerced to `weeks` on read: shortening the camp leaves the
   * later dates unread rather than deleting them, matching what `weeks` already
   * does to everybody's registered days.
   * ---------------------------------------------------------------------------
   */
  weekStarts: string[];

  /**
   * What a servant may ask to do, **one list per week per section**, keyed
   * `w1_elementary`, `w1_middle`.
   *
   * ---------------------------------------------------------------------------
   * Added 2 Sep 2026 with the per-week question on the sign-up form: *"for the
   * service form there should be a section per week what they would like to do
   * and they can check off as many as they want"*. These are the boxes that
   * section offers, and the camp writes them — every camp invents jobs, and the
   * second week is rarely the first week's list (see `campWeekRoleKey`).
   *
   * It lives on `config/camp` and not on the allocation, which is where the
   * stations are, for one hard reason: **this document is world-readable and
   * the allocation is shut.** The sign-up form is public and has to draw its
   * own checkboxes; a list held with the groups could not be read by the person
   * filling the form in. Nothing here is sensitive — they are the names of
   * jobs at a summer camp.
   *
   * An empty week is not an empty section on the form. `campWeekRoleOptions`
   * falls back to `CAMP_ROLE_SUGGESTIONS`, because a week offering no boxes is a
   * form that cannot be completed, and a camp that has not got round to this
   * setting should still be able to take sign-ups.
   *
   * A **map** keyed by `campWeekRoleKey` and not an array of arrays, which is
   * not a shape Firestore has: an array may not contain another array, so
   * `string[][]` is a document that cannot be written. The keys are the same
   * `w1_elementary` the servants' own answers use, which is also what makes the
   * two readable side by side in a console.
   *
   * **The section is in the key** because the camp's two halves do not run the
   * same stations — Tommy, 2 Sep 2026: *"each week has stations for middle
   * school and elementary school so those should be distinct"*. A single list
   * per week offered a middle-school servant the elementary craft table, and
   * the roster then had to guess which one somebody meant.
   *
   * A bare `w1`, written before that, is read as the list for **both** halves
   * — see `campWeekRoleOptions`. It is left in the document rather than
   * rewritten: a migration of a camp's own words is a migration that can lose
   * them, and the key is simply shadowed as soon as either section is edited.
   *
   * A week and section with no list of its own is not stored at all, and reads
   * as "the camp has not chosen" rather than "the camp chose nothing".
   * ---------------------------------------------------------------------------
   */
  weekRoles: Record<string, string[]>;

  /**
   * Identifies the waiver wording currently in force.
   *
   * Bump this whenever `waiverText` changes in a way that matters. Registrations
   * store the version they agreed to, so what a family signed in June stays
   * legible after the text is edited in September.
   */
  waiverVersion: string;

  /**
   * The waiver itself, as plain text. Paragraphs separated by blank lines.
   *
   * Empty until the parish provides it, and the registration screen says so
   * rather than showing an empty box with a consent tick under it — asking
   * somebody to agree to nothing is worse than not asking.
   */
  waiverText: string;

  /** Shown above the registration form. Empty is fine. */
  note: string;

  /**
   * Whether servants may sign themselves up.
   *
   * ---------------------------------------------------------------------------
   * The one switch on an otherwise open door.
   *
   * `/forms/summer-camp` shows a **public** sign-up form to anybody who opens
   * it — no account, no link that has to be kept secret — because half the
   * camp's servants are teenagers who have never signed in to anything of the
   * parish's. What that costs is that the form is reachable all year, including
   * the eight months when the camp is not taking anybody, and a form that
   * accepts sign-ups for a camp that has closed its list is worse than no form:
   * somebody believes they are coming.
   *
   * So this closes it. The page then says the camp is not taking sign-ups at
   * the moment rather than 404ing, which is the same distinction
   * `FormDefinition.open` draws and for the same reason.
   *
   * Family registrations are unaffected — those are taken by administrators and
   * this never gated them.
   *
   * Defaults to **true**. The alternative is a feature that ships switched off
   * and is reported as broken by the first person who goes looking for it; the
   * queue is reviewed by a human either way, so an unwanted sign-up costs one
   * click to dismiss.
   *
   * Writable by a camp administrator, along with the rest of this document
   * except `programId` — see the `config/camp` block in `firestore.rules`.
   * ---------------------------------------------------------------------------
   */
  servantSignUp: boolean;

  /**
   * Whether the camp is taking family registrations.
   *
   * ---------------------------------------------------------------------------
   * The switch beside `servantSignUp`, added 2 Sep 2026 so that the two forms
   * are turned on and off the same way. It is **not** the same kind of switch,
   * and the difference is the point.
   *
   * A family registration is taken by an administrator at a desk; there is no
   * public path to it and there never will be. So closing this does not shut a
   * door on a stranger — it tells the camp's own volunteers that the list is
   * full, or that next season is not open yet, at the moment they go to type
   * somebody in. The form says so and refuses to start a new registration;
   * every registration already taken stays fully editable, because a fee still
   * gets paid in August on a list that closed in June.
   *
   * Defaults to **true**, for the reason `servantSignUp` does: a feature that
   * ships switched off is reported as broken by the first person who looks.
   * ---------------------------------------------------------------------------
   */
  familyRegistration: boolean;
}

/**
 * What the camp screen assumes before anybody has configured it.
 *
 * The fee is zero on purpose. A default fee is a number somebody has to notice
 * and correct, and the failure mode of noticing late is a family told the wrong
 * price at a desk. Zero shows as "no fee set" on the screen, which nobody
 * mistakes for a decision.
 *
 * The season defaults to the current calendar year, which is right for a camp
 * that runs in the summer and is registered for in the spring of the same year.
 */
export function defaultCampConfig(now: Date = new Date()): CampConfig {
  return {
    programId: 'summercamp',
    season: String(now.getFullYear()),
    baseCents: 0,
    // Zero, which is "no charge and no card step". A default charge is money
    // taken from a stranger that nobody at this parish decided to ask for.
    servantChargeCents: 0,
    servantChargeLabel: '',
    weeks: DEFAULT_CAMP_WEEKS,
    // Blank, not a guess. A camp whose dates default to some Monday in June is
    // a camp that shows the wrong dates on a register until somebody notices;
    // blank shows as "dates not set" and nobody mistakes that for a decision.
    weekStarts: Array.from({ length: DEFAULT_CAMP_WEEKS }, () => ''),
    // Empty, not seeded with the suggestions. A stored copy of the defaults is
    // a list somebody has to maintain to change nothing, and it would hide the
    // fact that the camp has never chosen — `campWeekRoleOptions` shows the
    // suggestions on the form either way.
    weekRoles: {},
    waiverVersion: '',
    waiverText: '',
    note: '',
    servantSignUp: true,
    familyRegistration: true,
  };
}

/** A guard against a mistyped fee: $2,000 for one child for one week is not a camp. */
export const MAX_CAMP_FEE_CENTS = 200_000;

/**
 * Coerce `config/camp` into usable settings, field by field.
 *
 * `baseCents` falls back rather than clamping, for the reason `deliveryCents`
 * does: clamping charges a family a figure nobody chose, and falling back to
 * zero surfaces on the screen as "no fee set" instead of quietly billing.
 */
export function parseCampConfig(raw: unknown, now: Date = new Date()): CampConfig {
  const doc = asRecord(raw);
  const fallback = defaultCampConfig(now);

  const base = doc?.['baseCents'];
  const usableBase =
    typeof base === 'number' && Number.isInteger(base) && base >= 0 && base <= MAX_CAMP_FEE_CENTS;

  const charge = doc?.['servantChargeCents'];
  const usableCharge =
    typeof charge === 'number' &&
    Number.isInteger(charge) &&
    charge >= 0 &&
    charge <= MAX_CAMP_FEE_CENTS;

  const weeks = doc?.['weeks'];
  const usableWeeks =
    typeof weeks === 'number' && Number.isInteger(weeks) && weeks >= 1 && weeks <= MAX_CAMP_WEEKS;

  const weekCount = usableWeeks ? (weeks as number) : fallback.weeks;

  return {
    programId: str(doc?.['programId']) || fallback.programId,
    season: str(doc?.['season']) || fallback.season,
    baseCents: usableBase ? (base as number) : fallback.baseCents,
    // Falls back to zero rather than clamping, exactly as `baseCents` does: a
    // clamped charge is a figure nobody chose, and zero reads on the settings
    // screen as "servants are not charged".
    servantChargeCents: usableCharge ? (charge as number) : fallback.servantChargeCents,
    servantChargeLabel: str(doc?.['servantChargeLabel']) ?? fallback.servantChargeLabel,
    weeks: weekCount,
    weekStarts: weekStartList(doc?.['weekStarts'], weekCount),
    weekRoles: weekRoleMap(doc?.['weekRoles']),
    waiverVersion: str(doc?.['waiverVersion']) ?? fallback.waiverVersion,
    waiverText: str(doc?.['waiverText']) ?? fallback.waiverText,
    note: str(doc?.['note']) ?? fallback.note,
    // Absent means open, matching the default. A camp configured before this
    // field existed has no `servantSignUp` key, and reading that as "closed"
    // would hide the sign-up on every parish that has not been told to add it.
    servantSignUp: typeof doc?.['servantSignUp'] === 'boolean'
      ? (doc['servantSignUp'] as boolean)
      : fallback.servantSignUp,
    // Absent means open, for the same reason as the field above it.
    familyRegistration: typeof doc?.['familyRegistration'] === 'boolean'
      ? (doc['familyRegistration'] as boolean)
      : fallback.familyRegistration,
  };
}

/**
 * Exactly `count` start dates, in week order, each either `YYYY-MM-DD` or ''.
 *
 * Padded rather than trusted: a document written before this field existed has
 * none, and one written when the camp ran three weeks has too many for a camp
 * that now runs two. Anything that is not a plain calendar date is dropped to
 * '' rather than carried, so no screen has to guess at the format it was
 * handed — and no date is *invented* to fill a gap, because a wrong date on a
 * register is worse than no date at all.
 */
function weekStartList(value: unknown, count: number): string[] {
  const given = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_unused, index) => {
    const entry = given[index];
    return typeof entry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.trim())
      ? entry.trim()
      : '';
  });
}

/** The most boxes one week's section of the sign-up form will offer. */
export const MAX_WEEK_ROLES = 30;

/**
 * The camp's role lists, week by week, trimmed and deduped.
 *
 * Weeks past `weeks` are **kept** rather than dropped, unlike `weekStarts`: a
 * camp shortened for a year has not stopped meaning what it typed for week
 * three, and `campWeekRoleOptions` only ever asks for the weeks the camp
 * currently runs. Blank names are dropped rather than carried, because a
 * checkbox with no label is a box nobody can tick meaningfully.
 */
function weekRoleMap(value: unknown): Record<string, string[]> {
  const doc = asRecord(value);
  const map: Record<string, string[]> = {};

  for (const [key, roles] of Object.entries(doc ?? {})) {
    const parts = parseCampWeekRoleKey(key);
    if (parts === null || !Array.isArray(roles)) continue;
    const list = [
      ...new Set(
        roles
          .filter((role): role is string => typeof role === 'string')
          .map((role) => role.trim().slice(0, MAX_CAMP_LINE))
          .filter(Boolean),
      ),
    ].slice(0, MAX_WEEK_ROLES);
    if (list.length > 0) map[campWeekRoleKey(parts.week, parts.section)] = list;
  }
  return map;
}

/**
 * The boxes one week of the sign-up form offers, for one half of the camp.
 *
 * Three sources, in order, and the order is the whole point:
 *
 * 1. **The camp's list for that week and that section** — what elementary runs
 *    in week two, which is not what middle school runs in week two.
 * 2. **A bare week list**, written before the two halves were told apart. It
 *    meant "week two, everybody", so it is offered to both.
 * 3. **`CAMP_ROLE_SUGGESTIONS`** — see `CampConfig.weekRoles` for why a
 *    fallback exists rather than an empty section.
 */
export function campWeekRoleOptions(
  config: CampConfig,
  week: number,
  section: CampSection,
): string[] {
  const own = config.weekRoles[campWeekRoleKey(week, section)] ?? [];
  if (own.length > 0) return own;
  const shared = config.weekRoles[campWeekRoleKey(week)] ?? [];
  return shared.length > 0 ? shared : [...CAMP_ROLE_SUGGESTIONS];
}

/* ==========================================================================
   The forms hub's own settings
   ========================================================================== */

/** Document id of the `/forms` page's own settings. */
export const CONFIG_DOC_FORMS = 'forms';

/**
 * The summer camp sign-up, as the forms hub addresses it.
 *
 * It is not a `forms` document and cannot become one — `FormsHub` records why
 * — but it *is* a card on the hub and a thing the parish can point a tag at, so
 * the two settings below have to be able to name it. This is the name they use,
 * and it is the same string as the route: `/forms/summer-camp`.
 */
export const CAMP_FORM_SLUG = 'summer-camp';

/**
 * Where a tap lands, and where the camp sits, decided by the office.
 *
 * ---------------------------------------------------------------------------
 * Why these two live in `config` rather than on the form documents.
 *
 * **`nfcFormSlug` is a single choice across a collection.** Modelled as a
 * `priority: true` field on `FormDefinition` it would be a flag that must be
 * true on exactly one document, maintained by a client that has to unset the
 * old one before setting the new one — two writes with no transaction around
 * them, and a tag that points at nothing (or at two things) whenever the second
 * one fails. One field naming one slug cannot get into that state.
 *
 * **`campOrder` has no document to live on.** The camp card is assembled in the
 * page from a route that exists in this codebase, so there is nowhere on a form
 * document to record where it sits; without this it is appended after
 * everything else, which is where it was before the office could say otherwise.
 *
 * Both are read by the public hub, which is why they are in `config` — world
 * readable, one document, already fetched by pages that need nothing else from
 * Firestore.
 * ---------------------------------------------------------------------------
 */
export interface FormsPageConfig {
  /**
   * The slug of the form an NFC tap should land on.
   *
   * A **slug**, not a document id, because that is what a URL is made of and
   * what the camp — which has no document — can be named by. The cost is that
   * renaming a form's slug in the builder can leave this pointing at nothing,
   * and the answer is the one `EventsPageConfig.mainSection` gives: a pointer
   * that does not resolve is read as "not set", and every reader falls back to
   * the vehicle registration rather than to an error.
   *
   * Defaults to `vehicle-registration` rather than to null, because that is
   * what the tag in the car park has always done and an unconfigured parish
   * must keep doing it.
   */
  nfcFormSlug: string;

  /**
   * Where the summer camp card sits among the forms, as an `order` number.
   *
   * The same scale the form documents use — `setFormOrder` renumbers the list
   * 10, 20, 30 … — so the hub can sort the camp in with everything else by
   * comparing one field. 1000 keeps it last on a parish that has never dragged
   * it, which is where it was appended before this existed.
   */
  campOrder: number;
}

/** The hub as it behaved before anybody set either of these. */
export const DEFAULT_FORMS_PAGE_CONFIG: FormsPageConfig = {
  nfcFormSlug: 'vehicle-registration',
  campOrder: 1000,
};

/**
 * Coerce whatever is in `config/forms` into a usable pair of settings.
 *
 * A blank or missing `nfcFormSlug` reads as the vehicle registration, for the
 * reason on the field: the tag has to go somewhere, and where it has always
 * gone is the only safe answer. `campOrder` is bounded to the range an `order`
 * can sensibly take so that a mistyped number cannot pin the card off the list.
 */
export function parseFormsPageConfig(raw: unknown): FormsPageConfig {
  const doc = asRecord(raw);
  const order = doc?.['campOrder'];
  return {
    nfcFormSlug: str(doc?.['nfcFormSlug']) || DEFAULT_FORMS_PAGE_CONFIG.nfcFormSlug,
    campOrder:
      typeof order === 'number' && Number.isFinite(order)
        ? Math.min(100_000, Math.max(0, Math.round(order)))
        : DEFAULT_FORMS_PAGE_CONFIG.campOrder,
  };
}
