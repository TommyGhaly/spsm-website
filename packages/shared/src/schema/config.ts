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
