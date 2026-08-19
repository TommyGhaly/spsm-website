/**
 * Per-screen admin permissions.
 *
 * A second, finer axis than `Role`. The role tiers answer "how much of the site
 * is this person trusted with at all"; this answers "which parts". A parish has
 * people who should edit the bulletin and nothing else, and a bookstore
 * volunteer who has no business in prayer requests — distinctions the four
 * tiers in ./roles.ts cannot express without inventing a role per job.
 *
 * **These flags grant, they never revoke.** `hasRole(claims, 'admin')` still
 * opens everything; a screen flag is how somebody *below* admin is let into one
 * area. Read `canAdminScreen` as "admin, or specifically entrusted with this".
 *
 * The list is deliberately one constant. Every member document carries a
 * complete map with an entry per screen — see `DEFAULT_SCREEN_ADMIN` — so
 * adding a screen here means existing documents lack the key, and
 * `canAdminScreen` treats a missing key as `false`. That is the safe direction:
 * a new screen is closed to everyone until somebody is granted it, rather than
 * open to everyone who happened to sign in first.
 */

/**
 * Every area of the site that can be administered separately.
 *
 * Named for the thing being managed, not the route — `/admin/events` may move
 * but "events" is what the permission is about. Ordered roughly by how often a
 * parish actually touches them.
 */
export const ADMIN_SCREENS = [
  /** Parish calendar and event pages. */
  'events',
  /** The weekly bulletin and homepage announcements. */
  'bulletin',
  /** Bookstore catalog and orders. */
  'bookstore',
  /** Prayer requests. Sensitive — see docs/decisions.md #1. */
  'prayer',
  /** Vehicle registrations from the car-park NFC tag. */
  'parking',
  /** The servants schedule and the calendar URL behind it. */
  'servants',
  /** Beliefs, clergy bios, and the other `content` pages. */
  'content',
  /** Design tokens — colours, spacing, type. */
  'theme',
  /** People, and the roles they hold. */
  'members',
  /** Integration endpoints and feature switches. */
  'config',
] as const;

export type AdminScreen = (typeof ADMIN_SCREENS)[number];

/** A complete map, one boolean per screen. Stored on the member document. */
export type ScreenAdmin = Record<AdminScreen, boolean>;

export function isAdminScreen(value: unknown): value is AdminScreen {
  return typeof value === 'string' && (ADMIN_SCREENS as readonly string[]).includes(value);
}

/**
 * What a newly created member gets: every screen `false`.
 *
 * A function rather than a frozen constant because callers write it straight
 * into Firestore, and handing every caller the same object is how one of them
 * mutates it and the next member inherits somebody else's permissions.
 */
export function defaultScreenAdmin(): ScreenAdmin {
  return Object.fromEntries(ADMIN_SCREENS.map((screen) => [screen, false])) as ScreenAdmin;
}

/**
 * Coerce anything read out of Firestore into a complete, trustworthy map.
 *
 * Documents predate screens being added, are written by older code, or are
 * simply absent — all of which arrive here as a partial object or `undefined`.
 * Every unknown key resolves to `false`, and keys that are not screens are
 * dropped rather than carried, so a hand-edited document cannot smuggle in a
 * permission the code does not know how to check.
 */
export function parseScreenAdmin(value: unknown): ScreenAdmin {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    ADMIN_SCREENS.map((screen) => [screen, source[screen] === true]),
  ) as ScreenAdmin;
}

/**
 * Whether this person may administer this screen.
 *
 * `admin` short-circuits: the tier already means "all of it", and requiring an
 * admin to also tick ten boxes would make the first account created by
 * `grant-admin.mjs` unable to reach anything.
 */
export function canAdminScreen(
  claims: { role?: string } | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
  screen: AdminScreen,
): boolean {
  if (claims?.role === 'admin') return true;
  return screenAdmin?.[screen] === true;
}
