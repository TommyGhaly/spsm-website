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
    },
  };
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
