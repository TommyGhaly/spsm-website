/**
 * Every Firestore path the website, the app, and Cloud Functions are allowed to
 * touch. Nothing should hardcode a collection name as a string literal — import
 * from here so a rename is one edit and `firestore.rules` stays in step.
 */
export const COLLECTIONS = {
  /** Public static-ish content: beliefs, clergy bios, contact copy. */
  content: 'content',
  /**
   * Staff's edits to the five About pages — an overlay on hand-written routes,
   * never the pages themselves. One document per slug, five ever; the rule
   * refuses any other id, because a sixth part of About needs a route file the
   * static export can enumerate. See schema/about.ts.
   */
  aboutOverrides: 'aboutOverrides',
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
   * The two things staff may add to a schedule assembled from sources the
   * parish maintains elsewhere: entries of their own, and annotations on
   * everybody else's. Kept apart so that "you may only delete what you added"
   * is a path check rather than a flag somebody could set. See
   * schema/scheduleAdmin.ts.
   */
  scheduleEntries: 'scheduleEntries',
  calendarDetails: 'calendarDetails',
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
   * How many photographs one uploader has sent today. Closed to every client.
   *
   * Written only by `galleryUploadUrl`, which is the only thing that may create
   * a `galleryMedia` document at all now. It lives in Firestore rather than in
   * `rateLimit.ts`'s in-memory window because that window is per instance —
   * a real daily total has to be shared across all of them.
   *
   * Keyed `uid:{uid}` and `ip:{sha256}`. The address is hashed rather than
   * stored: a plain one would make this collection a log of who visited which
   * gallery and when, which is personal data the site does not otherwise keep.
   */
  submissionQuota: 'submissionQuota',
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
  /**
   * Summer camp registrations — families with their children, and servants
   * with their roles.
   *
   * Deliberately not `formSubmissions`. A submission is a flat answer map
   * recording one moment; a registration holds a repeating child, a payment
   * ledger written to over weeks, and roles administrators append afterwards.
   * See schema/camp.ts for the long version.
   *
   * The most sensitive collection on the site: a child's date of birth,
   * allergies and medical notes. There is no anonymous write path and no public
   * read — every access takes a program grant on the camp's ministry.
   */
  campRegistrations: 'campRegistrations',
  /**
   * Servants who have signed themselves up, waiting to be accepted.
   *
   * Separate from `campRegistrations` rather than a `status` on it, because the
   * two have opposite write rules: a registration is written by somebody
   * holding a program grant, and one of these is written by a Cloud Function on
   * behalf of a stranger. A pending row inside the register would mean opening
   * that collection to unauthenticated writes — beside the children's medical
   * notes — which is the one thing its shape is chosen to prevent.
   *
   * Accepting a request writes a real registration and deletes the request, so
   * nothing here is ever the record of somebody who is coming. See
   * `schema/camp.ts`.
   */
  campServantRequests: 'campServantRequests',
  /**
   * How one camp season is divided up: grade bands, the groups inside them,
   * the activity stations, and which child or servant is in each.
   *
   * One document per season, id `<programId>__<season>` — see
   * `allocationDocId`. It holds no names, only keys pointing back into
   * `campRegistrations`, which is deliberate: the registration is the record
   * and a second copy of a child's name is a copy that goes stale. Same
   * program grant as the registrations themselves.
   */
  campAllocations: 'campAllocations',
  /**
   * The camp's register: one document per day of camp.
   *
   * Id `<programId>__<season>__<day>` — see `attendanceDocId`. Children only,
   * two marks each (arrived, collected), keyed by the same
   * `registrationId/childId` keys the allocation places. A map rather than a
   * list because two servants tick at once and each tap has to merge rather
   * than overwrite the morning. Same program grant as the registrations.
   */
  campAttendance: 'campAttendance',
  /**
   * Totals-only money, with the people taken out.
   *
   * One document per camp season and per paid form — counts and sums, no name,
   * no email, no check number. It exists because the `finance` grant could not
   * honestly reach either: a camp fee lives inside a `campRegistrations`
   * document next to a child's medical notes, and a form's total sits beside
   * every answer given, and Firestore rules grant documents rather than fields.
   * This is the document the treasurer can be given on its own.
   *
   * Written solely by the scheduled rollup through the Admin SDK; no client may
   * write it. See schema/finance.ts and functions/src/finance.ts.
   */
  financeRollups: 'financeRollups',
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
