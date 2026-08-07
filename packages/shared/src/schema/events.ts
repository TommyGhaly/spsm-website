import type { AuditFields, Publishable, Timestamped } from './common.js';

/**
 * One generic shape behind every event page the Wix site had as a bespoke page
 * (camp, festival, feeding the homeless, seniors, iconography class). Adding an
 * event should never mean adding a route.
 */
export interface Event extends AuditFields, Publishable {
  slug: string;
  title: string;
  /** Short line for calendar cells and list views. */
  summary: string;
  /** Long-form body. Markdown, rendered at build time for static export. */
  body: string;

  startAt: Timestamped;
  /** Null for an all-day or open-ended entry. */
  endAt: Timestamped | null;
  allDay: boolean;
  /** IANA zone. Stored explicitly so DST never shifts a listed service time. */
  timeZone: string;

  location: EventLocation | null;
  /** Storage path, not a full URL — signed/CDN URL is derived at render time. */
  heroImagePath: string | null;

  category: EventCategory;
  /** Free-form tags for filtering ("youth", "outreach", "fundraiser"). */
  tags: string[];

  registration: EventRegistration | null;

  /**
   * `parish`   — public calendar.
   * `servants` — servants calendar, staff-gated. Lives in a separate
   *              collection so security rules stay a path check rather than a
   *              per-document field check.
   */
  audience: EventAudience;

  /** Recurrence is deliberately out of scope for MVP — see docs/decisions.md. */
  recurrence: null;
}

export interface EventLocation {
  name: string;
  address: string | null;
  /** Set when the event is online-only or hybrid. */
  meetingUrl: string | null;
}

export interface EventRegistration {
  /** Firestore `forms` doc id, or an external URL — never both. */
  formId: string | null;
  externalUrl: string | null;
  opensAt: Timestamped | null;
  closesAt: Timestamped | null;
  capacity: number | null;
}

export const EVENT_CATEGORIES = [
  'liturgy',
  'class',
  'outreach',
  'youth',
  'seniors',
  'festival',
  'camp',
  'meeting',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const EVENT_AUDIENCES = ['parish', 'servants'] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

/** Homepage / push announcements. Shorter-lived than an event. */
export interface Announcement extends AuditFields, Publishable {
  title: string;
  body: string;
  /** Stop showing it after this. Null ⇒ until unpublished by hand. */
  expiresAt: Timestamped | null;
  /** Pinned items sort above everything else. */
  pinned: boolean;
  /** Set once a push has gone out, so a re-publish doesn't re-notify. */
  pushedAt: Timestamped | null;
  linkUrl: string | null;
}
