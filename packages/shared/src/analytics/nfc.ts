/**
 * NFC tag statistics: who taps the church's tags, how the tap opened, what
 * they did next, and what it brought in.
 *
 * ---------------------------------------------------------------------------
 * ## Three ways a tap opens, and why each one reports for itself
 *
 * Every tag holds `https://www.spsmwayland.org/c/<slug>`, and the phone decides
 * what that URL becomes:
 *
 *   `clip`  an iPhone without SPSM Connect — the App Clip card, then the Swift
 *           clip in `ios-appclip/`.
 *   `app`   a phone with SPSM Connect installed, iOS or Android — the app
 *           opens at `app/c/[slug].tsx`, which redirects to the real screen.
 *   `web`   anything else — an Android phone without the app, a laptop,
 *           somebody who dismissed the card — gets `public/c/<slug>.html`.
 *
 * Only the third ever reaches Hosting. iOS hands the clip its URL directly and
 * the operating system hands the app its own, so a server log would count one
 * tap in three. Each of the three therefore posts its own `scan` to
 * `/api/nfc/event` — one endpoint rather than three Firestore writers, because
 * the clip has no Firestore SDK and no settled App Check story (see
 * `AppAttest.swift`), and a static HTML page has neither.
 *
 * ## A visit, and why the funnel counts visits rather than taps on a button
 *
 * A scan mints a `visit`: sixteen random hex characters, made up by the device
 * for this one tap and kept nowhere afterwards. Everything that follows carries
 * it — the cart, the checkout, the form, the payment — so "what did people do
 * after tapping the bookstore tag" is a question with an answer.
 *
 * The endpoint keeps the first `(visit, action)` pair and drops repeats, so the
 * funnel reads "visits that reached this step". Somebody who adds four books
 * is one visit that added to the basket, not four, which is the number that
 * says whether the tag works.
 *
 * ## What is deliberately not here
 *
 * No IP address, no user agent, no uid, no location, and no id that survives
 * the visit. The app's privacy notice says there is no analytics service in it
 * and that stays true: this is the church's own database counting taps on the
 * church's own tags, the arrangement `faults.ts` set out for the crash
 * reporter. A visit identifies a tap, not a person.
 *
 * ## Money is a separate collection, and must stay one
 *
 * Counts go to `nfcStats`, read with the `nfc` grant. Revenue goes to
 * `nfcRevenue`, which also needs `finance`. Rules grant documents, not fields,
 * so putting dollars beside the counts would hand them to everybody who can
 * see the counts. See the note on `'finance'` in ../screens.ts.
 * ---------------------------------------------------------------------------
 */

/** The eight experiences, in the order the sticker sheet prints them. */
export const NFC_SLUGS = [
  'give',
  'schedule',
  'apps',
  'welcome',
  'plans',
  'bookstore',
  'forms',
  'photos',
] as const;

export type NfcSlug = (typeof NFC_SLUGS)[number];

/** What an administrator calls each one — the App Clip card titles. */
export const NFC_SLUG_LABELS: Readonly<Record<NfcSlug, string>> = {
  give: 'Give',
  schedule: 'This Week',
  apps: 'The Church’s Apps',
  welcome: 'Welcome',
  plans: 'Expansion Plans',
  bookstore: 'Bookstore',
  forms: 'Church Forms',
  photos: 'Send a Photograph',
};

/** How the tap opened. See the header. */
export const NFC_PATHS = ['clip', 'app', 'web'] as const;
export type NfcPath = (typeof NFC_PATHS)[number];

export const NFC_PATH_LABELS: Readonly<Record<NfcPath, string>> = {
  clip: 'App Clip',
  app: 'SPSM Connect app',
  web: 'Website',
};

/** `web` is a browser that is neither — a laptop, a tablet that says so. */
export const NFC_PLATFORMS = ['ios', 'android', 'web'] as const;
export type NfcPlatform = (typeof NFC_PLATFORMS)[number];

export const NFC_PLATFORM_LABELS: Readonly<Record<NfcPlatform, string>> = {
  ios: 'iPhone',
  android: 'Android',
  web: 'Other browser',
};

/**
 * What a device may report. `scan` first, then the milestones after it.
 *
 * Each answers one question an administrator asked: did the giving tag send
 * anybody to Tithe.ly, does the bookstore tag lead to a basket, does the forms
 * tag get forms opened, does the photographs tag get photographs sent, does
 * any of it get people to install the app.
 */
export const NFC_CLIENT_ACTIONS = [
  'scan',
  /** Opened Tithe.ly from the giving screen. The gift itself is Tithe.ly's. */
  'giveTap',
  'cartAdd',
  'checkoutStart',
  'formOpen',
  'photoSent',
  /** Tapped through to the App Store or Google Play for SPSM Connect. */
  'getApp',
] as const;

/**
 * What only a Function may record, because only a Function knows it happened.
 *
 * A form is submitted when `formSubmit` stores it and paid when Square takes
 * the card. A device saying so is a device's opinion; these are written by the
 * triggers in `functions/src/nfc.ts` and refused from `/api/nfc/event`.
 */
export const NFC_SERVER_ACTIONS = ['formSubmit', 'paid'] as const;

export const NFC_ACTIONS = [...NFC_CLIENT_ACTIONS, ...NFC_SERVER_ACTIONS] as const;

export type NfcClientAction = (typeof NFC_CLIENT_ACTIONS)[number];
export type NfcServerAction = (typeof NFC_SERVER_ACTIONS)[number];
export type NfcAction = (typeof NFC_ACTIONS)[number];

export const NFC_ACTION_LABELS: Readonly<Record<NfcAction, string>> = {
  scan: 'Tapped',
  giveTap: 'Opened Tithe.ly',
  cartAdd: 'Added to basket',
  checkoutStart: 'Started checkout',
  formOpen: 'Opened a form',
  photoSent: 'Sent a photograph',
  getApp: 'Went to get the app',
  formSubmit: 'Sent a form',
  paid: 'Paid',
};

/**
 * The steps worth drawing under each experience, in order.
 *
 * A step can happen under any tag — somebody who tapped Give may wander into
 * the bookstore in the app — and those are still counted. This is only which
 * steps the screen draws as that tag's funnel.
 */
export const NFC_FUNNELS: Readonly<Record<NfcSlug, readonly NfcAction[]>> = {
  give: ['giveTap'],
  schedule: ['getApp'],
  apps: ['getApp'],
  welcome: ['getApp'],
  plans: ['getApp'],
  bookstore: ['cartAdd', 'checkoutStart', 'paid'],
  forms: ['formOpen', 'formSubmit', 'paid'],
  photos: ['photoSent'],
};

/** Where tag-attributed money was taken. Tithe.ly's is never visible here. */
export const NFC_REVENUE_SOURCES = ['bookstore', 'forms'] as const;
export type NfcRevenueSource = (typeof NFC_REVENUE_SOURCES)[number];

export const NFC_VISIT_LENGTH = 16;

/** How long raw events and their dedupe markers live before the TTL sweep. */
export const NFC_EVENT_TTL_DAYS = 90;

/**
 * How long a tap keeps claiming what follows it in the full app and on the
 * website, in minutes.
 *
 * Long enough for somebody who tapped the bookstore tag after the Liturgy to
 * browse, talk to somebody and come back to pay; short enough that a purchase
 * on Thursday is not credited to Sunday's tap. The clip needs no window — it
 * is one tap from launch to close.
 */
export const NFC_VISIT_WINDOW_MINUTES = 30;

/** Carried from the tap to everything after it, and into checkout and forms. */
export interface NfcAttribution {
  visit: string;
  slug: NfcSlug;
  path: NfcPath;
  platform: NfcPlatform;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function isNfcSlug(value: unknown): value is NfcSlug {
  return oneOf(NFC_SLUGS, value);
}

export function isNfcVisit(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${NFC_VISIT_LENGTH}}$`).test(value);
}

/**
 * An attribution out of a request body, or null.
 *
 * Null for anything malformed, and every caller treats null as "not from a
 * tag" rather than as an error: a checkout must never fail because its
 * statistics were wrong.
 */
export function parseNfcAttribution(value: unknown): NfcAttribution | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isNfcVisit(raw['visit'])) return null;
  if (!isNfcSlug(raw['slug'])) return null;
  if (!oneOf(NFC_PATHS, raw['path'])) return null;
  if (!oneOf(NFC_PLATFORMS, raw['platform'])) return null;
  return {
    visit: raw['visit'],
    slug: raw['slug'],
    path: raw['path'],
    platform: raw['platform'],
  };
}

/** One event as a device posts it. */
export interface NfcEventInput extends NfcAttribution {
  action: NfcClientAction;
}

/** Validate a posted event, or return null. Server actions are refused. */
export function parseNfcEvent(value: unknown): NfcEventInput | null {
  const attribution = parseNfcAttribution(value);
  if (!attribution) return null;
  const action = (value as Record<string, unknown>)['action'];
  if (!oneOf(NFC_CLIENT_ACTIONS, action)) return null;
  return { ...attribution, action };
}

/**
 * Sixteen hex characters from whatever randomness the caller has.
 *
 * Takes the bytes rather than finding them, because the three callers find
 * them differently — `crypto.getRandomValues` in a browser, `expo-crypto` in
 * the app — and this package must not import either.
 */
export function nfcVisitFrom(bytes: ArrayLike<number>): string {
  return Array.from(bytes)
    .slice(0, NFC_VISIT_LENGTH / 2)
    .map((byte) => (byte & 0xff).toString(16).padStart(2, '0'))
    .join('');
}

/** The platform a browser is on, from its user agent. Only the web path asks. */
export function nfcPlatformFromUserAgent(userAgent: string): NfcPlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  return 'web';
}

/* ---------------------------------------------------------------------------
 * The rolled-up documents
 * ------------------------------------------------------------------------ */

/**
 * One experience's counts for one period.
 *
 * `path` and `platform` split the scans. `actions` is visits that reached each
 * step, and is keyed by the tag the visit *started* on.
 */
export interface NfcSlugCounts {
  scans: number;
  path: Record<NfcPath, number>;
  platform: Record<NfcPlatform, number>;
  actions: Record<NfcAction, number>;
}

/**
 * `nfcStats/day-YYYY-MM-DD` and `nfcStats/month-YYYY-MM`.
 *
 * Incremented as events arrive rather than rolled up on a schedule, unlike
 * `bookstoreStats`. The contention argument in schema/analytics.ts is about one
 * document taking a write per page view on a busy shop; this takes one per tap
 * on a parish's tags, which is a handful a minute after the Liturgy at most.
 * What that buys is a screen that is never stale.
 */
export interface NfcStatsDoc {
  period: 'day' | 'month';
  key: string;
  slugs: Partial<Record<NfcSlug, NfcSlugCounts>>;
}

export interface NfcRevenueSlice {
  cents: number;
  count: number;
}

/** One experience's tag-attributed money for one period. */
export interface NfcSlugRevenue extends NfcRevenueSlice {
  source: Record<NfcRevenueSource, NfcRevenueSlice>;
  /** Cents, by how the tap that started the visit opened. */
  path: Record<NfcPath, number>;
}

/** `nfcRevenue/day-…` and `nfcRevenue/month-…`. Needs `finance` as well. */
export interface NfcRevenueDoc {
  period: 'day' | 'month';
  key: string;
  slugs: Partial<Record<NfcSlug, NfcSlugRevenue>>;
}

function zeroes<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

export function emptyNfcSlugCounts(): NfcSlugCounts {
  return {
    scans: 0,
    path: zeroes(NFC_PATHS),
    platform: zeroes(NFC_PLATFORMS),
    actions: zeroes(NFC_ACTIONS),
  };
}

export function emptyNfcSlugRevenue(): NfcSlugRevenue {
  return {
    cents: 0,
    count: 0,
    source: { bookstore: { cents: 0, count: 0 }, forms: { cents: 0, count: 0 } },
    path: zeroes(NFC_PATHS),
  };
}

/** The two document ids an instant lands in, in the parish's zone. */
export function nfcPeriodIds(day: string): { day: string; month: string } {
  return { day: `day-${day}`, month: `month-${day.slice(0, 7)}` };
}

/**
 * Turn `{ 'a.b.c': x }` into `{ a: { b: { c: x } } }`.
 *
 * The Functions write with `set(…, { merge: true })`, which creates the day's
 * document on its first tap. `update()` would read dotted keys as paths but
 * fails on a document that does not exist yet, and `set` reads them as literal
 * field names with dots in. So the paths are built here and nested before the
 * write.
 */
export function nestFieldPaths<T>(paths: Record<string, T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(paths)) {
    const parts = path.split('.');
    let cursor = out;
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        cursor[part] = value;
      } else {
        cursor[part] = (cursor[part] as Record<string, unknown> | undefined) ?? {};
        cursor = cursor[part] as Record<string, unknown>;
      }
    });
  }
  return out;
}

/** The counters one event moves, as field paths. */
export function nfcStatsPaths(attribution: NfcAttribution, action: NfcAction): string[] {
  const base = `slugs.${attribution.slug}`;
  if (action === 'scan') {
    return [
      `${base}.scans`,
      `${base}.path.${attribution.path}`,
      `${base}.platform.${attribution.platform}`,
    ];
  }
  return [`${base}.actions.${action}`];
}

/** The amounts one payment moves, as field paths and what to add to each. */
export function nfcRevenuePaths(
  attribution: NfcAttribution,
  source: NfcRevenueSource,
  cents: number,
): Record<string, number> {
  const base = `slugs.${attribution.slug}`;
  return {
    [`${base}.cents`]: cents,
    [`${base}.count`]: 1,
    [`${base}.source.${source}.cents`]: cents,
    [`${base}.source.${source}.count`]: 1,
    [`${base}.path.${attribution.path}`]: cents,
  };
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * Everything in a period's stats documents, added up per experience.
 *
 * Every number is read through `num`, so a document written before a counter
 * existed adds zero rather than `NaN`. Unknown slugs are dropped.
 */
export function sumNfcStats(docs: readonly unknown[]): Record<NfcSlug, NfcSlugCounts> {
  const total = Object.fromEntries(NFC_SLUGS.map((slug) => [slug, emptyNfcSlugCounts()])) as Record<
    NfcSlug,
    NfcSlugCounts
  >;
  for (const doc of docs) {
    const slugs = obj(obj(doc)['slugs']);
    for (const slug of NFC_SLUGS) {
      const raw = obj(slugs[slug]);
      const into = total[slug];
      into.scans += num(raw['scans']);
      for (const path of NFC_PATHS) into.path[path] += num(obj(raw['path'])[path]);
      for (const platform of NFC_PLATFORMS) into.platform[platform] += num(obj(raw['platform'])[platform]);
      for (const action of NFC_ACTIONS) into.actions[action] += num(obj(raw['actions'])[action]);
    }
  }
  return total;
}

/** The same for revenue documents. */
export function sumNfcRevenue(docs: readonly unknown[]): Record<NfcSlug, NfcSlugRevenue> {
  const total = Object.fromEntries(NFC_SLUGS.map((slug) => [slug, emptyNfcSlugRevenue()])) as Record<
    NfcSlug,
    NfcSlugRevenue
  >;
  for (const doc of docs) {
    const slugs = obj(obj(doc)['slugs']);
    for (const slug of NFC_SLUGS) {
      const raw = obj(slugs[slug]);
      const into = total[slug];
      into.cents += num(raw['cents']);
      into.count += num(raw['count']);
      for (const source of NFC_REVENUE_SOURCES) {
        const from = obj(obj(raw['source'])[source]);
        into.source[source].cents += num(from['cents']);
        into.source[source].count += num(from['count']);
      }
      for (const path of NFC_PATHS) into.path[path] += num(obj(raw['path'])[path]);
    }
  }
  return total;
}

/** The headline figures for a summed period. */
export interface NfcSummary {
  scans: number;
  path: Record<NfcPath, number>;
  platform: Record<NfcPlatform, number>;
  /** Experiences with at least one scan, busiest first. Ties keep sheet order. */
  ranked: { slug: NfcSlug; counts: NfcSlugCounts }[];
}

export function summarizeNfcStats(bySlug: Record<NfcSlug, NfcSlugCounts>): NfcSummary {
  const path = zeroes(NFC_PATHS);
  const platform = zeroes(NFC_PLATFORMS);
  let scans = 0;
  for (const slug of NFC_SLUGS) {
    const counts = bySlug[slug];
    scans += counts.scans;
    for (const key of NFC_PATHS) path[key] += counts.path[key];
    for (const key of NFC_PLATFORMS) platform[key] += counts.platform[key];
  }
  const ranked = NFC_SLUGS.map((slug) => ({ slug, counts: bySlug[slug] }))
    .filter((row) => row.counts.scans > 0)
    .sort((a, b) => b.counts.scans - a.counts.scans);
  return { scans, path, platform, ranked };
}

/** A share as a whole percentage, or `null` when there is nothing to share. */
export function nfcPercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/**
 * The document ids a period covers, newest last.
 *
 * `days` counts back from `today` inclusive and reads day documents; past
 * ninety days it switches to whole months, which is one read a month rather
 * than thirty and loses nothing a dashboard draws.
 */
export function nfcPeriodDocIds(today: string, days: number): string[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const anchor = Date.UTC(y, m - 1, d);
  if (days <= 90) {
    const ids: string[] = [];
    for (let back = days - 1; back >= 0; back -= 1) {
      ids.push(`day-${new Date(anchor - back * 86_400_000).toISOString().slice(0, 10)}`);
    }
    return ids;
  }
  const months = Math.ceil(days / 30.44);
  const ids: string[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(y, m - 1 - back, 1));
    ids.push(`month-${at.toISOString().slice(0, 7)}`);
  }
  return ids;
}
