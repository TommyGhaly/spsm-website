/**
 * Every Firestore path the website, the app, and Cloud Functions are allowed to
 * touch. Nothing should hardcode a collection name as a string literal — import
 * from here so a rename is one edit and `firestore.rules` stays in step.
 */
export const COLLECTIONS = {
  /** Public static-ish content: beliefs, clergy bios, contact copy. */
  content: 'content',
  /** Homepage / push announcements, authored by staff here. */
  announcements: 'announcements',
  /**
   * Runtime configuration — integration endpoints and feature switches that
   * staff can change without a code deploy. Never credentials; see
   * schema/config.ts.
   */
  config: 'config',
  /** Parish calendar + one-off event pages (camp, festival, iconography class). */
  events: 'events',
  /** Servants calendar — staff-gated. */
  servantEvents: 'servantEvents',
  /**
   * The parish's standing programs, their occurrences, and the photographs
   * parishioners send in. Reached through `/events` but deliberately a separate
   * shape — see docs/program-galleries.md.
   *
   * `galleryMedia` is top-level rather than nested under an event because the
   * approval queue and the homepage band both read across every event at once.
   */
  programs: 'programs',
  programEvents: 'programEvents',
  galleryMedia: 'galleryMedia',
  /**
   * Configuration only servants may read.
   *
   * Deliberately not a document inside `config`. That collection is
   * `allow read: if true`, and a more specific rule cannot claw a broader one
   * back — Firestore grants if *any* matching rule allows, so `config/servants`
   * would be world-readable no matter what was written beneath it. A separate
   * collection is the only way to gate it.
   */
  servantsConfig: 'servantsConfig',
  /** Member profiles. Mirrors Firebase Auth uid as the doc id. */
  members: 'members',
  /** Prayer requests. See docs/decisions.md #1 for the privacy model. */
  prayerRequests: 'prayerRequests',
  /** Bookstore catalog. */
  products: 'products',
  /** Bookstore orders, keyed to the Square order id. */
  orders: 'orders',
  /**
   * Raw bookstore interactions — one document per view, cart change, or search.
   *
   * Create-only and unreadable by any client, which is what makes an
   * unauthenticated write path acceptable. One document per event rather than a
   * counter per product is the whole design; see schema/analytics.ts for why a
   * counter cannot work at all.
   */
  bookstoreEvents: 'bookstoreEvents',
  /**
   * Rolled-up bookstore statistics, keyed `day-YYYY-MM-DD`, `month-YYYY-MM`,
   * or `all`. Written by the scheduled rollup, read by staff in one `get`.
   */
  bookstoreStats: 'bookstoreStats',
  /** Parking lot vehicle registrations (members + guests). */
  vehicles: 'vehicles',
  /** Firestore-backed form definitions and their submissions. */
  forms: 'forms',
  formSubmissions: 'formSubmissions',
  /** Append-only audit trail for staff reads of sensitive collections. */
  auditLog: 'auditLog',
  /**
   * Outbound email queue, drained by the Trigger Email extension.
   *
   * Written by Cloud Functions only, and readable by nobody: a queued message
   * holds a buyer's address and the contents of their order, and it sits here
   * until the extension has delivered it. See firestore.rules.
   */
  mail: 'mail',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
