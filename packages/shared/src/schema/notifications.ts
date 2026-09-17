/**
 * Who may be told what, and the two completely different mechanisms behind it.
 *
 * ---------------------------------------------------------------------------
 * There are two kinds of notification in this programme and almost nothing is
 * shared between them but this file. Conflating them is the mistake this header
 * exists to prevent.
 *
 *   **Admin notices** are *remote* pushes. A parishioner sends a photograph, a
 *   book is bought, somebody signs a form — and a servant who administers that
 *   area is told, on a phone that may not have been opened for a week. That
 *   cannot be scheduled on the device, because the device does not know the
 *   event happened. So it is FCM, sent by a Cloud Function from a Firestore
 *   trigger, to tokens held in `pushDevices`.
 *
 *   **Calendar reminders** are *local* notifications. Nothing happens on a
 *   server when Vespers is in two hours; the event was already on the schedule
 *   the last time the phone looked. So the phone schedules them itself with
 *   expo-notifications, and the preferences never leave it.
 *
 * ## Why the reminders are deliberately not push
 *
 * It would be the obvious symmetry and it is the wrong design here, for three
 * reasons that are all facts about this parish rather than opinions:
 *
 *   1. **There is no server-side copy of the schedule to trigger from.** The
 *      parish calendar is read out of Breeze at request time — see
 *      `functions/src/calendar.ts` and `MAX_CALENDAR_RANGE_DAYS`, which caps a
 *      request at 62 days precisely so that this site is not a bulk export of
 *      it. A reminder scheduler would have to poll Breeze forever and keep a
 *      mirror, which is a second source of truth for the thing the whole
 *      calendar design avoids having.
 *   2. **Most people using the app are anonymous.** Sign-in is Microsoft
 *      restricted to the parish's Entra tenant — see `firebase/auth.ts` — so
 *      "a signed-in user" means *a servant*, not a parishioner. A parishioner
 *      who wants telling about Bright Saturday has no member document to hang a
 *      preference on and should not need one.
 *   3. **A reminder preference is a statement about somebody's week.** "Notify
 *      me about the Wednesday study, two hours before" is a small confession of
 *      where a person will be on Wednesday. Kept on the device it is nobody
 *      else's business; kept in Firestore it is a record the parish then holds.
 *
 * What local scheduling costs is honesty about staleness: the phone can only
 * remind somebody about events it has already fetched, so a phone left closed
 * for a month runs out of scheduled reminders. That is mitigated by a
 * background refresh (`expo-background-task`, already carrying the upload
 * queue) and it is not hidden from the person — the settings screen says how
 * far ahead reminders are currently set.
 *
 * `CalendarReminderPrefs` lives here rather than in the app anyway, because the
 * *shape* wants one home and one set of tests, and because a later decision to
 * mirror it server-side should not be a re-modelling.
 * ---------------------------------------------------------------------------
 */
import { canAdminScreen, type AdminScreen, type ScreenAdmin } from '../screens.js';
import { hasAnyProgramGrant, type ProgramAdmin } from '../programAdmin.js';
import { OCCURRENCE_KINDS, type OccurrenceKind } from './calendar.js';

/* -------------------------------------------------------------------------- */
/* Admin notices                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The things that happen in this parish which somebody needs telling about.
 *
 * Named for what occurred, not for the collection it landed in, because the
 * person ticking the box is choosing between events in a church rather than
 * between Firestore paths — and because two of these do not map onto one
 * collection anyway (`forms` covers a submission and its payment; `camp` covers
 * a registration and a servant's request).
 *
 * Deliberately short. Every entry here is a push that interrupts somebody's
 * evening, so the bar for adding one is that a servant would otherwise have to
 * remember to go and look.
 */
export const ADMIN_NOTICES = [
  /** A parishioner sent a photograph in to a program gallery; it needs review. */
  'uploads',
  /** Somebody bought something in the bookstore and the money has settled. */
  'orders',
  /** A parish form was filled in and signed. */
  'forms',
  /** A camp registration, or a servant asking to help. */
  'camp',
  /** A vehicle registered at the car-park NFC tag. */
  'parking',
  /**
   * Money went back out — a refund was issued.
   *
   * The treasurer's one notice, and the only one on this list about something a
   * *servant* did rather than a parishioner. The parish publishes a no-returns
   * policy, so a refund is the record of an exception being made, and the
   * person who reconciles the takings should not discover it a month later.
   */
  'refunds',
] as const;

export type AdminNotice = (typeof ADMIN_NOTICES)[number];

/**
 * What entitles somebody to one of these, and how it reads on the settings
 * screen.
 *
 * The entitlement is **the same grant that opens the screen where the thing is
 * dealt with**, and that is the whole rule. A notification is a shortcut to a
 * job; if a person cannot do the job, telling them about it is at best noise
 * and at worst a disclosure — "Maryam Girgis signed the baptism form" names a
 * parishioner to whoever reads the lock screen.
 *
 * So there is no notification here that reaches further than the grant it rides
 * on, and `entitledAdminNotices` is the only thing that decides who may
 * subscribe. `functions/src/notify/audience.ts` resolves the same question in
 * the other direction — from an event to the people — and the two must agree.
 */
export interface AdminNoticeSpec {
  notice: AdminNotice;
  /** The row's label. Sentence case, a noun phrase. */
  label: string;
  /** One line under it, saying what arrives and how often. */
  hint: string;
  /**
   * The screen grant that entitles it.
   *
   * Null for `uploads` alone, which is entitled by a *program* grant instead:
   * photographs belong to a program's gallery, and `programAdmin` is what says
   * who looks after one. See `entitledAdminNotices`.
   */
  screen: AdminScreen | null;
}

export const ADMIN_NOTICE_SPECS: readonly AdminNoticeSpec[] = [
  {
    notice: 'uploads',
    label: 'Photographs sent in',
    hint: 'When somebody submits a picture to a gallery you look after.',
    screen: null,
  },
  {
    notice: 'orders',
    label: 'Bookstore orders',
    hint: 'When an order is paid for. Not when a basket is abandoned.',
    screen: 'bookstore',
  },
  {
    notice: 'forms',
    label: 'Forms signed',
    hint: 'When somebody completes a church form.',
    screen: 'forms',
  },
  {
    notice: 'camp',
    label: 'Camp registrations',
    hint: 'New registrations, and servants asking to help.',
    screen: 'camp',
  },
  {
    notice: 'parking',
    label: 'Vehicles registered',
    hint: 'When a car is registered at the car-park tag.',
    screen: 'parking',
  },
  {
    notice: 'refunds',
    label: 'Refunds issued',
    hint: 'When a servant refunds an order, with who did it and why.',
    screen: 'finance',
  },
];

export function specOfAdminNotice(notice: AdminNotice): AdminNoticeSpec {
  // Non-null: ADMIN_NOTICE_SPECS is asserted complete by tests/unit.
  return ADMIN_NOTICE_SPECS.find((spec) => spec.notice === notice)!;
}

export function isAdminNotice(value: unknown): value is AdminNotice {
  return typeof value === 'string' && (ADMIN_NOTICES as readonly string[]).includes(value);
}

/**
 * Which of these this person is allowed to ask for.
 *
 * `uploads` takes any program grant rather than a specific one. Whether a
 * *particular* photograph reaches them is a narrower question answered per-event
 * by `audience.ts` against the program it was sent to; this is only "may this
 * person subscribe to gallery submissions at all", and somebody who looks after
 * one program should see the row.
 *
 * A superadmin is entitled to everything, via `canAdminScreen` — but note that
 * being entitled is not being subscribed. See `AdminNoticePrefs`.
 */
export function entitledAdminNotices(
  claims: { superadmin?: boolean } | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
  programAdmin: ProgramAdmin | null | undefined,
): AdminNotice[] {
  return ADMIN_NOTICE_SPECS.filter((spec) => {
    if (spec.screen === null) {
      return claims?.superadmin === true || hasAnyProgramGrant(claims, programAdmin);
    }
    return canAdminScreen(claims, screenAdmin, spec.screen);
  }).map((spec) => spec.notice);
}

/** A complete map, one boolean per notice. Stored on a `pushDevices` document. */
export type AdminNoticePrefs = Record<AdminNotice, boolean>;

/**
 * Nothing, and that is the important default.
 *
 * ---------------------------------------------------------------------------
 * These are **opt-in**, unlike every other grant-shaped map in this codebase,
 * and the asymmetry is deliberate rather than an oversight.
 *
 * `defaultScreenAdmin` is all-false because a permission must be given. This is
 * all-false for a different reason: the day this ships, every servant in the
 * parish already holds their grants, and a default of "on" would mean the
 * feature announces itself by pushing a fortnight of backlog at a dozen people
 * who never asked for any of it. The first impression of a notification system
 * is the only one it gets.
 *
 * So a grant makes a row *appear*, and the person ticks it. `entitledAdminNotices`
 * and this map are two different questions — "may you" and "do you want to" —
 * and the fan-out checks both.
 * ---------------------------------------------------------------------------
 */
export function noAdminNotices(): AdminNoticePrefs {
  return Object.fromEntries(ADMIN_NOTICES.map((notice) => [notice, false])) as AdminNoticePrefs;
}

/**
 * Coerce anything read out of Firestore into a complete map.
 *
 * Every unknown key resolves to `false` and keys that are not notices are
 * dropped, exactly as `parseScreenAdmin` does — so a notice added to this list
 * is off for everybody until they ask for it, and a hand-edited document cannot
 * subscribe itself to something the code does not know how to send.
 */
export function parseAdminNoticePrefs(value: unknown): AdminNoticePrefs {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return Object.fromEntries(
    ADMIN_NOTICES.map((notice) => [notice, source[notice] === true]),
  ) as AdminNoticePrefs;
}

/** Whether anything at all is subscribed. A device with nothing on is not sent to. */
export function wantsAnyAdminNotice(prefs: AdminNoticePrefs | null | undefined): boolean {
  return ADMIN_NOTICES.some((notice) => prefs?.[notice] === true);
}

/* -------------------------------------------------------------------------- */
/* The device registry                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One phone, and what it has asked to be told.
 *
 * Keyed by a SHA-256 of the FCM token rather than by uid, because a servant has
 * a phone and an iPad and both should ring — and because a token is reassigned
 * by the OS on reinstall, so the token *is* the identity of the installation.
 * The id is derived server-side in `functions/src/notify/register.ts`, which
 * makes re-registering the same phone an idempotent overwrite rather than a
 * second row that then gets sent to twice.
 *
 * Hashed rather than used raw because an FCM token is 160-odd characters of
 * URL-unsafe base64 and Firestore document ids may not contain `/`.
 *
 * `uid` is carried so the fan-out can resolve grants: the audience for an event
 * is a set of people, and this is what turns those people back into tokens. It
 * is also what makes a stale document harmless — a device whose owner has lost
 * a grant is filtered by `entitledAdminNotices` at send time, not by hoping
 * something deleted the row.
 */
export interface PushDevice {
  /** The FCM registration token. The thing actually sent to. */
  token: string;
  /** Firebase Auth uid of whoever registered it. Never anonymous — see the rule. */
  uid: string;
  /** `ios` or `android`. Only for reading the collection by eye. */
  platform: 'ios' | 'android';
  /** Which admin notices this device wants. */
  notices: AdminNoticePrefs;
  /** ISO 8601. Refreshed on every app start, so a dead device can be swept. */
  refreshedAt: string;
  /** The app version that last wrote this, for triaging a bad release. */
  appVersion: string | null;
}

/**
 * Whether a registration is worth keeping.
 *
 * A device that wants nothing is deleted rather than stored, which keeps the
 * collection to "phones that have opted in" — so the fan-out's own query is the
 * audience and there is no second filtering pass that could forget a case.
 */
export function pushDeviceIsUseful(device: Pick<PushDevice, 'notices'>): boolean {
  return wantsAnyAdminNotice(device.notices);
}

/* -------------------------------------------------------------------------- */
/* Calendar reminders — local, and never sent anywhere                        */
/* -------------------------------------------------------------------------- */

/**
 * How long before an event to say something, in minutes.
 *
 * A fixed list rather than a free number field. "Remind me 37 minutes before"
 * is not a thing anybody wants, and a text input would need validating,
 * localising and defending against `0`; a picker of six sensible answers needs
 * none of that and is one tap instead of a keyboard.
 *
 * `0` is "when it starts", which sounds useless and is the one people choose
 * for a livestream.
 */
export const REMINDER_LEADS = [0, 15, 30, 60, 120, 1440] as const;

export type ReminderLead = (typeof REMINDER_LEADS)[number];

/** "When it starts", "2 hours before". Built here so both surfaces agree. */
export function reminderLeadLabel(minutes: number): string {
  if (minutes <= 0) return 'When it starts';
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes < 1440) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  }
  const days = Math.round(minutes / 1440);
  return days === 1 ? 'The day before' : `${days} days before`;
}

export function isReminderLead(value: unknown): value is ReminderLead {
  return typeof value === 'number' && (REMINDER_LEADS as readonly number[]).includes(value);
}

/**
 * What somebody has asked to be reminded about.
 *
 * ---------------------------------------------------------------------------
 * Three axes, and each is here because the other two cannot express it.
 *
 *   `kinds`     a standing subscription — "anything that is a Liturgy". This is
 *               what most people want and it keeps working as the calendar
 *               changes, because `kindOf` classifies next month's events too.
 *   `pinned`    one specific occurrence, ticked from its own sheet. For the
 *               retreat that is not a kind of anything and happens once.
 *   `muted`     one specific occurrence, *un*-ticked. Because a standing
 *               subscription to Liturgies is right and the 6am one on a
 *               weekday is not, and without this the only way to say so is to
 *               give up the subscription.
 *
 * Occurrence ids are stable *within a source* (see `CalendarOccurrence.id`) —
 * Breeze's instance id, or `event:<slug>`. That is exactly as stable as this
 * needs: a pin is a statement about one dated occurrence, and if Breeze ever
 * reissues an id the pin silently stops matching, which loses a reminder rather
 * than firing a wrong one. Preferring the failure that goes quiet is the right
 * way round for something that makes a phone buzz.
 * ---------------------------------------------------------------------------
 */
export interface CalendarReminderPrefs {
  /** The master switch. Off is the shipped state, and off means nothing is scheduled. */
  enabled: boolean;
  /** Standing subscriptions by kind. */
  kinds: Record<OccurrenceKind, boolean>;
  /** How far ahead of an event to speak. */
  leadMinutes: number;
  /** Occurrence ids subscribed individually, whatever their kind says. */
  pinned: string[];
  /** Occurrence ids excluded individually, whatever their kind says. */
  muted: string[];
}

/**
 * Off, with sensible answers already filled in behind the switch.
 *
 * The kinds default to *on* and the master switch to *off*, which looks
 * inconsistent and is the point: the first thing a person does here is flip one
 * switch, and what they get should be a working set of reminders rather than
 * silence and a second puzzle about why. `other` is off because it is the
 * bucket `occurrenceKind` puts everything it could not classify into — parish
 * council, a hall booking, a bin collection — and a reminder for each of those
 * is how somebody learns to ignore this app's notifications.
 */
export function defaultReminderPrefs(): CalendarReminderPrefs {
  return {
    enabled: false,
    kinds: { liturgy: true, study: true, gathering: true, other: false },
    leadMinutes: 60,
    pinned: [],
    muted: [],
  };
}

/**
 * Coerce whatever came out of the phone's own storage.
 *
 * This parses a value written by an *older build of this app* rather than
 * anything a server sent, which changes what the failure mode is: there is no
 * adversary, only a shape that has moved on. So every field falls back to the
 * default individually instead of the whole object being discarded — somebody
 * who had chosen a two-hour lead keeps it across an upgrade that adds a kind.
 */
export function parseReminderPrefs(value: unknown): CalendarReminderPrefs {
  const fallback = defaultReminderPrefs();
  if (typeof value !== 'object' || value === null) return fallback;
  const source = value as Record<string, unknown>;

  const kinds = typeof source['kinds'] === 'object' && source['kinds'] !== null
    ? (source['kinds'] as Record<string, unknown>)
    : {};

  return {
    enabled: source['enabled'] === true,
    kinds: Object.fromEntries(
      OCCURRENCE_KINDS.map((kind) => [
        kind,
        typeof kinds[kind] === 'boolean' ? kinds[kind] : fallback.kinds[kind],
      ]),
    ) as Record<OccurrenceKind, boolean>,
    leadMinutes: isReminderLead(source['leadMinutes']) ? source['leadMinutes'] : fallback.leadMinutes,
    pinned: idList(source['pinned']),
    muted: idList(source['muted']),
  };
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  // Deduplicated and bounded. These grow by a tap each and nothing ever prunes
  // them, so a phone used for years would otherwise carry an unbounded list of
  // ids for events that happened in 2026.
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry !== ''))].slice(
    -MAX_PINNED_OCCURRENCES,
  );
}

/**
 * How many individual occurrences one person may pin or mute.
 *
 * Bounded because `pinned` and `muted` are append-only from the UI's point of
 * view — there is no screen listing them to tidy — and because the whole
 * preferences blob is read and rewritten on every change. Two hundred is far
 * past what anybody will tick by hand and still a trivial write.
 */
export const MAX_PINNED_OCCURRENCES = 200;

/**
 * Whether one occurrence should produce a reminder.
 *
 * The order is the whole of the logic and it is not rearrangeable: an explicit
 * mute beats everything, then an explicit pin, then the standing subscription.
 * A person who muted one Liturgy has said something more specific than "remind
 * me about Liturgies" and the specific thing wins.
 *
 * Takes `kind` already resolved rather than calling `kindOf` itself, so the
 * caller does the classification once for a screenful of occurrences.
 */
export function wantsReminder(
  prefs: CalendarReminderPrefs,
  occurrence: { id: string; kind: OccurrenceKind },
): boolean {
  if (!prefs.enabled) return false;
  if (prefs.muted.includes(occurrence.id)) return false;
  if (prefs.pinned.includes(occurrence.id)) return true;
  return prefs.kinds[occurrence.kind] === true;
}

/** Toggle one occurrence, whatever its kind currently says. */
export function withOccurrenceReminder(
  prefs: CalendarReminderPrefs,
  occurrence: { id: string; kind: OccurrenceKind },
  wanted: boolean,
): CalendarReminderPrefs {
  const pinned = prefs.pinned.filter((id) => id !== occurrence.id);
  const muted = prefs.muted.filter((id) => id !== occurrence.id);

  /*
   * Recorded as an *override* only where it disagrees with the standing
   * subscription. Ticking a Liturgy when Liturgies are already on adds nothing
   * to `pinned` — otherwise turning the kind off later would leave the pin
   * behind and that one Liturgy would keep buzzing, which reads as the switch
   * not working.
   */
  const byKind = prefs.kinds[occurrence.kind] === true;
  if (wanted === byKind) return { ...prefs, pinned, muted };

  return wanted
    ? { ...prefs, pinned: [...pinned, occurrence.id].slice(-MAX_PINNED_OCCURRENCES), muted }
    : { ...prefs, pinned, muted: [...muted, occurrence.id].slice(-MAX_PINNED_OCCURRENCES) };
}
