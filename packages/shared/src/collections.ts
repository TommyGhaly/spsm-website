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
  /** Parking lot vehicle registrations (members + guests). */
  vehicles: 'vehicles',
  /** Firestore-backed form definitions and their submissions. */
  forms: 'forms',
  formSubmissions: 'formSubmissions',
  /** Append-only audit trail for staff reads of sensitive collections. */
  auditLog: 'auditLog',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
