import type { AuditFields, Timestamped } from './common.js';

/**
 * Summer camp registration.
 *
 * ---------------------------------------------------------------------------
 * Why this is not a `FormDefinition`.
 *
 * The obvious move was to build this in the drawer on /forms like every other
 * parish form. It does not survive contact with what is actually being asked
 * for. A form definition is a flat list of questions producing a flat map of
 * answers — `FormAnswers` is `Record<string, string | number | boolean |
 * string[]>` and nothing else. This needs:
 *
 *  - a *repeating* child, with a grade and a shirt size each, of any number;
 *  - a payment ledger that is written to over weeks, long after submission,
 *    by somebody other than whoever filled the form in;
 *  - roles the camp's administrators *append* after the fact.
 *
 * A form submission is a record of one moment. A camp registration is a record
 * that is still being edited in August. The builder has no vocabulary for
 * either the repetition or the afterwards, and the reason it matters is stated
 * in the request: this data gets used somewhere else. A roster, a grade
 * breakdown, a shirt order, a list of who has paid — every one of those is a
 * query, and a query cannot be run against answers whose keys were chosen by
 * whoever built the form that year.
 *
 * So: a real collection with real fields. `vehicles` made the same call for the
 * same reason and is the precedent.
 *
 * ## Who fills it in
 *
 * Only camp administrators. This is an intake screen at a registration desk,
 * not a public form — the parent is standing there, or on the phone, and an
 * administrator types. Two consequences worth being explicit about:
 *
 *  - there is no anonymous write path, and `firestore.rules` allows none. That
 *    is what lets this collection hold a child's date of birth, allergies and
 *    medical notes at all;
 *  - the waiver is signed *through* an administrator's screen. `waiver.signedName`
 *    is the parent typing their own name on a device somebody else is holding.
 *    That is weaker evidence than a signature on paper and this file will not
 *    pretend otherwise — see `CampWaiver`.
 *
 * ## The permission
 *
 * `programAdmin.programs` containing the camp's program id — the third axis in
 * ../programAdmin.ts, which already exists and already means "runs Summercamp".
 * Not `screenAdmin`, and specifically not `screenAdmin.events`: that flag means
 * the parish calendar, and the person who runs the camp has no business in it.
 * The same argument the program-galleries work made, reused rather than
 * repeated.
 *
 * ## Bounds
 *
 * Everything below marked as a bound is transcribed into `firestore.rules`. A
 * bound only present here is not a bound — anything in this file can be skipped
 * by anyone willing to open a console.
 * ---------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * Bounds — mirrored in firestore.rules
 * ------------------------------------------------------------------------ */

/**
 * Children on one registration.
 *
 * "Any number of children" was the request, and twenty is the number that
 * honours it while still being a number. A family with twenty-one children is
 * two registrations and a note, which is a support conversation; an unbounded
 * array is a document somebody can grow past Firestore's 1MiB limit until the
 * registration can no longer be saved at all.
 */
export const MAX_CHILDREN = 20;

/** Discount lines. More than this is a fee that should have been changed. */
export const MAX_DISCOUNTS = 12;

/** Recorded payments. A family paying in more than twelve instalments is rare. */
export const MAX_PAYMENTS = 24;

/** Roles on one servant — desired or assigned, each list separately. */
export const MAX_ROLES = 12;

/** Any single free-text line: a name, a role, a reason, a reference. */
export const MAX_LINE = 120;

/** Any free-text block: allergies, medical notes, an administrator's note. */
export const MAX_NOTE = 2000;

/**
 * The most any one figure on a registration may be, in integer cents.
 *
 * $5,000 covers a large family at any fee the parish would set, and stops a
 * mistyped `baseCents` from producing a balance nobody can explain.
 */
export const MAX_CAMP_CENTS = 500_000;

/* ---------------------------------------------------------------------------
 * Small vocabularies
 * ------------------------------------------------------------------------ */

/**
 * The grade a child is *entering*, not the one they just finished.
 *
 * Stated because it is the single most common way a camp roster goes wrong: ask
 * in June and half the parents answer with the year that just ended. The label
 * on the field says "entering", and this list is read in that sense everywhere.
 *
 * Stored as these exact strings rather than as numbers, because "k" is not a
 * number and encoding it as `0` makes every consumer re-learn that convention.
 *
 * **Pre-K was here and was removed on 30 Aug 2026.** The camp runs K to 8th and
 * takes no four-year-olds, so an option for them is a wrong registration
 * waiting to be taken at the desk. Nothing migrates: `parseCampChild` falls
 * back to grade 1 for a value it does not know, and there were no live Pre-K
 * registrations to fall back — but a document written before that date and
 * still saying `pre-k` will read as a first grader, which is the one failure
 * mode worth knowing about here.
 */
export const CAMP_GRADES = [
  'k',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
] as const;

export type CampGrade = (typeof CAMP_GRADES)[number];

export function campGradeLabel(grade: CampGrade): string {
  if (grade === 'k') return 'Kindergarten';
  return `Grade ${grade}`;
}

/** The short form a chip and a filter pill use: "K", "3". */
export function campGradeShort(grade: CampGrade): string {
  return grade === 'k' ? 'K' : grade;
}

export function isCampGrade(value: unknown): value is CampGrade {
  return typeof value === 'string' && (CAMP_GRADES as readonly string[]).includes(value);
}

/**
 * Shirt sizes, youth through adult, in the order a printer expects them.
 *
 * One list for children and servants rather than two, because a tall
 * twelve-year-old wears an adult small and a size list that will not let an
 * administrator record that is a list that produces a wrong shirt.
 */
export const SHIRT_SIZES = [
  'YXS', 'YS', 'YM', 'YL', 'YXL',
  'AS', 'AM', 'AL', 'AXL', 'A2XL', 'A3XL',
] as const;

export type ShirtSize = (typeof SHIRT_SIZES)[number];

export function shirtSizeLabel(size: ShirtSize): string {
  const youth = size.startsWith('Y');
  const rest = size.slice(1);
  const words: Record<string, string> = {
    XS: 'Extra small', S: 'Small', M: 'Medium', L: 'Large',
    XL: 'Extra large', '2XL': '2X large', '3XL': '3X large',
  };
  return `${youth ? 'Youth' : 'Adult'} ${words[rest] ?? rest}`;
}

export function isShirtSize(value: unknown): value is ShirtSize {
  return typeof value === 'string' && (SHIRT_SIZES as readonly string[]).includes(value);
}

/**
 * The two halves the camp runs as.
 *
 * ---------------------------------------------------------------------------
 * A closed set, unlike the roles below, and deliberately so.
 *
 * A role is a job somebody does and the camp invents new ones every year, so
 * `desiredRoles` holds free strings. A section is a *division of the camp* —
 * there are two, they have their own servants and their own rooms, and a third
 * one appearing is a change to how the camp is organised rather than a name
 * somebody types at a desk. Making it an enum is what lets "how many servants
 * has elementary got" be a question with an answer.
 * ---------------------------------------------------------------------------
 */
export const CAMP_SECTIONS = ['elementary', 'middle-school'] as const;
export type CampSection = (typeof CAMP_SECTIONS)[number];

export function campSectionLabel(section: CampSection): string {
  return section === 'elementary' ? 'Elementary' : 'Middle school';
}

export function isCampSection(value: unknown): value is CampSection {
  return typeof value === 'string' && (CAMP_SECTIONS as readonly string[]).includes(value);
}

/** The grades a section covers, in order: K–5, then 6–8. */
export function campGradesForSection(section: CampSection): CampGrade[] {
  return CAMP_GRADES.filter((grade) => campSectionForGrade(grade) === section);
}

/**
 * Which section a child belongs to, from the grade they are entering.
 *
 * Derived rather than stored, because it is not a second fact — it *is* the
 * grade, read another way. Storing it would create the possibility of a child
 * in grade 2 filed under middle school, which is a state nobody would ever
 * choose and somebody would eventually have to reconcile.
 *
 * `null` for grade 9 and above rather than a guess. The camp runs two sections
 * and a high-schooler is not in either — they are almost certainly a servant,
 * and quietly rounding them into middle school would put a fifteen-year-old on
 * an eighth-grade roster.
 */
export function campSectionForGrade(grade: CampGrade): CampSection | null {
  if (grade === 'k') return 'elementary';
  const year = Number(grade);
  if (year >= 1 && year <= 5) return 'elementary';
  if (year >= 6 && year <= 8) return 'middle-school';
  return null;
}

/**
 * Whole years old on a given day, from an ISO `YYYY-MM-DD` birth date.
 *
 * `null` for an empty or unparseable date rather than a zero, because a chip
 * reading "0" beside a servant's name is worse than a chip reading nothing —
 * one is a missing answer and the other is a wrong one.
 *
 * `on` defaults to today. The allocation board passes it explicitly when
 * looking at a past season, so a servant who was 16 in 2027 does not read as 19
 * on an archived board.
 */
export function campAge(dateOfBirth: string, on: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let age = on.getFullYear() - year;
  // Their birthday has not come round yet this year.
  const monthNow = on.getMonth() + 1;
  if (monthNow < month || (monthNow === month && on.getDate() < day)) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/* ---------------------------------------------------------------------------
 * Which days somebody is coming
 * ------------------------------------------------------------------------ */

/**
 * The camp runs Monday to Friday. No weekend, and no half-days.
 *
 * A closed list rather than dates, and that is the important decision. Dates
 * would tie every registration to one year's calendar — the same camp next
 * summer would be a different set of strings, and "who came on Wednesday of
 * week 2" would need the calendar to answer. Week-and-weekday is how the camp
 * itself talks, and it survives the year changing.
 */
export const CAMP_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'] as const;
export type CampWeekday = (typeof CAMP_WEEKDAYS)[number];

const WEEKDAY_LABELS: Record<CampWeekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri',
};

export function campWeekdayLabel(day: CampWeekday): string {
  return WEEKDAY_LABELS[day];
}

/**
 * How many weeks the camp runs, when nothing says otherwise.
 *
 * Two, "normally" — which is exactly why it is a `config/camp` field with this
 * as its default rather than a constant. A year with one week or three is a
 * setting the parish changes, not a deploy.
 */
export const DEFAULT_CAMP_WEEKS = 2;

/** A sane ceiling, so a mistyped week count cannot render 400 checkboxes. */
export const MAX_CAMP_WEEKS = 6;

/**
 * One day of one week, as stored: `w1-mon`.
 *
 * A flat string rather than `{ week, day }` objects, because these live in an
 * array inside a document and Firestore cannot query for an object inside an
 * array — `array-contains 'w2-wed'` is a real query and the object form is not.
 */
export type CampDayKey = string;

export function campDayKey(week: number, day: CampWeekday): CampDayKey {
  return `w${week}-${day}`;
}

export function parseCampDayKey(key: unknown): { week: number; day: CampWeekday } | null {
  if (typeof key !== 'string') return null;
  const match = /^w([1-9])-(mon|tue|wed|thu|fri)$/.exec(key);
  if (!match) return null;
  return { week: Number(match[1]), day: match[2] as CampWeekday };
}

export function campDayLabel(key: CampDayKey): string {
  const parsed = parseCampDayKey(key);
  return parsed ? `Week ${parsed.week} · ${campWeekdayLabel(parsed.day)}` : key;
}

/** Every day of one week, in order. What the "whole week" button toggles. */
export function campWeekKeys(week: number): CampDayKey[] {
  return CAMP_WEEKDAYS.map((day) => campDayKey(week, day));
}

/* ---------------------------------------------------------------------------
 * Day keys, seen as real days
 * ---------------------------------------------------------------------------
 *
 * `config/camp.weekStarts` holds the Monday each week begins on. Everything
 * below turns a stored `w2-wed` into the day it actually falls on, and every
 * one of them answers null or a plain fallback when the dates are not set —
 * which is the normal state of the camp for most of the year.
 *
 * Nothing here is stored. A date is a *reading* of a day key, never a
 * replacement for one: the keys survive the calendar changing and dates do not,
 * which is the argument `CampDayKey` makes above and this does not weaken.
 * ------------------------------------------------------------------------ */

/**
 * The calendar day `w2-wed` falls on, or null if that week has no start date.
 *
 * Built with the local `Date(y, m, d)` constructor rather than
 * `new Date('2027-06-22')`, which is parsed as **UTC** and lands on the Sunday
 * evening for every parish west of Greenwich — the single most common way a
 * date-only string shows up a day early.
 */
export function campDayDate(weekStarts: readonly string[], key: CampDayKey): Date | null {
  const parsed = parseCampDayKey(key);
  if (!parsed) return null;

  const start = weekStarts[parsed.week - 1];
  const match = typeof start === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(start) : null;
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + CAMP_WEEKDAYS.indexOf(parsed.day));
  return date;
}

/** "Wed, Jun 24", or '' when the week has no date set. */
export function campDayDateLabel(weekStarts: readonly string[], key: CampDayKey): string {
  const date = campDayDate(weekStarts, key);
  if (!date) return '';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * How a day is named on a screen: "Wed, Jun 24" when the camp's dates are set,
 * and "Week 2 · Wed" when they are not.
 *
 * One function rather than each screen choosing, because the fallback is the
 * whole point — a register opened in February still has to name its days.
 */
export function campDayHeading(weekStarts: readonly string[], key: CampDayKey): string {
  return campDayDateLabel(weekStarts, key) || campDayLabel(key);
}

/** "Jun 22 – 26", or "Week 2" when that week has no date set. */
export function campWeekRangeLabel(weekStarts: readonly string[], week: number): string {
  const first = campDayDate(weekStarts, campDayKey(week, 'mon'));
  const last = campDayDate(weekStarts, campDayKey(week, 'fri'));
  if (!first || !last) return `Week ${week}`;

  const month = first.toLocaleDateString('en-US', { month: 'short' });
  const lastMonth = last.toLocaleDateString('en-US', { month: 'short' });
  return month === lastMonth
    ? `${month} ${first.getDate()} – ${last.getDate()}`
    : `${month} ${first.getDate()} – ${lastMonth} ${last.getDate()}`;
}

/** Every day the camp runs, week 1 first. */
export function campAllDayKeys(weeks: number): CampDayKey[] {
  const count = clamp(Math.round(weeks) || DEFAULT_CAMP_WEEKS, 1, MAX_CAMP_WEEKS);
  return Array.from({ length: count }, (_unused, index) => campWeekKeys(index + 1)).flat();
}

/**
 * How many days somebody is coming, said the way a camp says it.
 *
 * "Both weeks" and "Week 1" are what an administrator scanning a list wants to
 * read; "w1-mon, w1-tue, w1-wed, w1-thu, w1-fri" is not. Falls back to naming
 * the days only when the selection is genuinely partial.
 */
export function describeCampDays(days: CampDayKey[], weeks = DEFAULT_CAMP_WEEKS): string {
  if (days.length === 0) return 'No days chosen';

  const chosen = new Set(days);
  const all = campAllDayKeys(weeks);
  if (all.every((key) => chosen.has(key))) return 'Every day';

  const parts: string[] = [];
  const count = clamp(Math.round(weeks) || DEFAULT_CAMP_WEEKS, 1, MAX_CAMP_WEEKS);
  for (let week = 1; week <= count; week += 1) {
    const keys = campWeekKeys(week);
    const on = keys.filter((key) => chosen.has(key));
    if (on.length === 0) continue;
    parts.push(
      on.length === keys.length
        ? `Week ${week}`
        : `Week ${week} (${on.map((key) => campWeekdayLabel(parseCampDayKey(key)!.day)).join(', ')})`,
    );
  }
  return parts.join(' · ');
}

/**
 * Roles a servant can be asked for or given.
 *
 * A *suggestion list*, not a closed set — `desiredRoles` and `assignedRoles`
 * hold plain strings, and the screen offers these while letting an
 * administrator type anything. "Admins can append roles and whatnot" was the
 * request, and a closed enum would mean a code deploy the first time the camp
 * invents a job, which is every year.
 *
 * The cost of that openness is real and worth naming: "Lifeguard" and
 * "lifeguard" are two roles as far as any later count is concerned. The screen
 * offers the list first and normalises case on entry, which makes the drift
 * unlikely rather than impossible.
 */
export const CAMP_ROLE_SUGGESTIONS = [
  'Group servant',
  'Head servant',
  'Sports',
  'Arts and crafts',
  'Music',
  'Kitchen',
  'Lifeguard',
  'First aid',
  'Transport',
  'Photography',
  'Setup and cleanup',
] as const;

/**
 * How money actually arrived.
 *
 * ---------------------------------------------------------------------------
 * `square` records a payment; it does not take one.
 *
 * This site never charges for camp — that is decision #2, and nothing here
 * changes it. A family paying by Square does so at the church's own reader or
 * through an invoice sent from the Square Dashboard, and an administrator then
 * writes down that it happened. Choosing `square` in this list does not reach
 * Square, reconcile against it, or verify anything; it is a label on a line in
 * a ledger, exactly like `cash`.
 *
 * It replaced a generic `card`. Two options meaning "a card" — one of them
 * Square, which is the only card processor the parish has — is a choice nobody
 * can make correctly, and the ambiguity would land in the one field the camp
 * later has to reconcile against a Square report.
 * ---------------------------------------------------------------------------
 */
export const CAMP_PAYMENT_METHODS = ['cash', 'check', 'zelle', 'square', 'other'] as const;
export type CampPaymentMethod = (typeof CAMP_PAYMENT_METHODS)[number];

export function isCampPaymentMethod(value: unknown): value is CampPaymentMethod {
  return typeof value === 'string' && (CAMP_PAYMENT_METHODS as readonly string[]).includes(value);
}

/**
 * What a stored method means, including the one that no longer exists.
 *
 * `card` was in the list before `square` replaced it, and a document holding it
 * must not silently become `other` — that would turn a card payment into an
 * unexplained one in the only field that says how the money came in. The
 * parish's sole card processor is Square, so that is what the old value meant.
 *
 * Kept as a lookup rather than folded into `isCampPaymentMethod`, so the legacy
 * value is readable and un-writable: nothing can store `card` again.
 */
const LEGACY_PAYMENT_METHODS: Readonly<Record<string, CampPaymentMethod>> = { card: 'square' };

export function readCampPaymentMethod(value: unknown): CampPaymentMethod {
  if (isCampPaymentMethod(value)) return value;
  if (typeof value === 'string' && value in LEGACY_PAYMENT_METHODS) {
    return LEGACY_PAYMENT_METHODS[value] as CampPaymentMethod;
  }
  return 'other';
}

export function campPaymentMethodLabel(method: CampPaymentMethod): string {
  const labels: Record<CampPaymentMethod, string> = {
    cash: 'Cash',
    check: 'Check',
    zelle: 'Zelle',
    square: 'Square',
    other: 'Other',
  };
  return labels[method];
}

/** A family bringing children, or a servant serving. */
export type CampRegistrantKind = 'family' | 'servant';

/**
 * Where a registration stands.
 *
 * `draft` exists because this is filled in at a desk with a queue behind it: an
 * administrator who has a name and two children but no waiver yet must be able
 * to save and come back. It is the same argument as
 * [[spsm-draft-needs-only-name-and-day]] on events — validation for *publishing*
 * is not validation for *saving*, and conflating them loses work.
 *
 * `withdrawn` rather than deletion, because a family that pulled out after
 * paying is a record the camp still needs when the refund is questioned.
 */
export const CAMP_STATUSES = ['draft', 'registered', 'waitlisted', 'withdrawn'] as const;
export type CampStatus = (typeof CAMP_STATUSES)[number];

export function isCampStatus(value: unknown): value is CampStatus {
  return typeof value === 'string' && (CAMP_STATUSES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
 * The parts
 * ------------------------------------------------------------------------ */

/**
 * Whoever the camp calls when it needs to reach this registration.
 *
 * The guardian on a family registration; the servant themself on a servant one.
 * One shape for both, because "who do I ring" is the same question either way
 * and two near-identical shapes is how a phone number ends up in the field the
 * roster does not read.
 */
export interface CampContact {
  name: string;
  email: string;
  phone: string;
  /** A second guardian, or a servant's parent. Blank is normal. */
  altName: string;
  altPhone: string;
  /** Free text. The camp does not need this parsed and will not benefit from
      four fields where a label and a street will do. */
  address: string;
}

/**
 * Somebody to ring when the contact cannot be reached.
 *
 * Its own shape rather than three more strings on `CampContact`, because it has
 * a different meaning: this is the number used when a child is hurt and their
 * parent's phone goes to voicemail. Keeping it separate is what stops it being
 * quietly filled with the same person.
 */
export interface CampEmergencyContact {
  name: string;
  phone: string;
  /** "Grandmother", "Uncle" — how they are related to the child. */
  relationship: string;
}

/**
 * One child.
 *
 * `id` is a stable local identifier, generated once and never reused. It is
 * what a discount line points at and what a later roster or shirt order will
 * key on. Array position cannot do that job: reordering the children or
 * removing the middle one would silently move a sibling discount onto somebody
 * else.
 */
export interface CampChild {
  id: string;
  firstName: string;
  lastName: string;
  /** ISO `YYYY-MM-DD`, or empty when it was not asked for. */
  dateOfBirth: string;
  /** The grade being *entered* in the autumn. See `CAMP_GRADES`. */
  grade: CampGrade;
  shirtSize: ShirtSize;

  /**
   * Which days this child is coming — `w1-mon`, `w2-thu`.
   *
   * Per child, not per family. Siblings routinely come different weeks, and a
   * single list on the registration would make the camp guess which of them the
   * Wednesday headcount was for.
   */
  days: CampDayKey[];

  /**
   * Two fields, not one, and the distinction is not pedantry.
   *
   * `allergies` is what the kitchen and the first-aid box need to know before
   * lunch. `medicalNotes` is everything else — an inhaler, a condition, a
   * medication schedule. A camp reads the first one at every meal and the
   * second one once; merging them means the inhaler is buried in a paragraph
   * about peanuts.
   */
  allergies: string;
  medicalNotes: string;

  /**
   * The group or cabin this child is put in. Assigned by administrators later
   * — empty on the day the family registers, and that is expected.
   */
  groupName: string;

  /** Permission to photograph this child for the parish's own galleries. */
  photoConsent: boolean;

  /** Anything the camp needs about this child that has no field. */
  note: string;
}

/**
 * The servant half of a registration.
 *
 * Two role lists, because they answer different questions and collapsing them
 * loses the one that matters. `desiredRoles` is what the servant asked for and
 * is *never* rewritten — when somebody who wanted Sports spends the week in the
 * kitchen, the camp should be able to see that next year. `assignedRoles` is
 * what the administrators actually gave them, and is the list the roster reads.
 */
export interface CampServantDetails {
  /** Set when the servant has a parish account, so a later screen can show
      somebody their own assignment. Null when an administrator entered a
      servant who has never signed in, which is normal. */
  uid: string | null;

  /**
   * ISO `YYYY-MM-DD`, or empty when it was not asked for.
   *
   * Added for the allocation board, which shows a servant's age on their chip.
   * Not vanity: half the camp's servants are teenagers, and "can this person be
   * left with a group of eight-year-olds on their own" is a question the person
   * building the groups has to answer about somebody they may not know. A year
   * of birth answers it at a glance; a name does not.
   *
   * Stored as a birth date rather than an age for the obvious reason — an age
   * is only true for a year, and this document is read again next summer.
   */
  dateOfBirth: string;

  /**
   * Which half of the camp they want to serve.
   *
   * A list rather than a single choice. Most servants pick one, and the two
   * sections are genuinely different jobs — but a servant who is happy with
   * either is common and useful, and a single field would force them to
   * invent an answer that then reads as a preference the camp has to honour.
   * Choosing both says "put me where you need me", which is information.
   */
  sections: CampSection[];

  /** What they asked for, in their own order of preference. Never edited by
      administrators — see above. */
  desiredRoles: string[];
  /** What they were given. Appended to by administrators. */
  assignedRoles: string[];

  shirtSize: ShirtSize;

  /** Which days they are serving — the same `w1-mon` keys the children use, so
      "who is here on Wednesday" is one question rather than two. */
  days: CampDayKey[];

  /** "Mornings only", "can drive on the Friday". Free text for everything the
      day grid cannot say. */
  availability: string;

  /**
   * Safeguarding paperwork done.
   *
   * A flag rather than a document store, deliberately. The parish's background
   * checks live with the diocese and are not this site's to hold; what this
   * records is that somebody checked, which is the thing a head servant needs
   * to see when building a group list.
   */
  cleared: boolean;
  clearedNote: string;
}

/**
 * The waiver, as signed.
 *
 * ---------------------------------------------------------------------------
 * What this is and is not evidence of.
 *
 * A typed name and a ticked box, entered on an administrator's device. That is
 * meaningfully weaker than ink on paper, and the honest description is "a record
 * that the waiver was read aloud and agreed to in front of a member of staff",
 * not "a signature". If the parish's insurer wants a signature, this does not
 * replace one, and nothing here should be read as claiming it does.
 *
 * `version` is why the text is copied nowhere and referenced by name: the
 * waiver text lives in `config/camp` and can be edited, and a registration must
 * record *which* wording was agreed to. Without it, editing the waiver in
 * September silently rewrites what every family agreed to in June.
 *
 * `signedByUid` is the administrator who was present. It is the only part of
 * this record that is strong evidence of anything.
 * ---------------------------------------------------------------------------
 */
export interface CampWaiver {
  /** Identifies the wording agreed to. From `CampConfig.waiverVersion`. */
  version: string;
  agreed: boolean;
  /** The parent's own full name, typed by them. */
  signedName: string;
  /** "Parent", "Guardian", "Self". */
  signedRelationship: string;
  signedAt: Timestamped | null;
  /** uid of the administrator at whose screen it was signed. */
  signedByUid: string | null;
}

export const NO_WAIVER: CampWaiver = {
  version: '',
  agreed: false,
  signedName: '',
  signedRelationship: '',
  signedAt: null,
  signedByUid: null,
};

/**
 * One discount.
 *
 * `reason` is required by `validateCampRegistration` rather than optional,
 * which is the whole design of this type. A camp where money comes off a family's
 * bill and nobody wrote down why is a camp that cannot answer a question about
 * its own accounts six months later. The reason is the record.
 */
export interface CampDiscount {
  id: string;
  /** `amount` is cents off; `percent` is 0–100 off the subtotal. */
  kind: 'amount' | 'percent';
  value: number;
  reason: string;
  /**
   * The child this is for, or null for the whole registration.
   *
   * Informational: the arithmetic in `campBill` treats every discount as coming
   * off the registration's subtotal either way. It is here so a family can be
   * told "the sibling discount is on Mariam", and so a later per-child
   * breakdown has something to work from.
   */
  childId: string | null;
  appliedByUid: string | null;
  appliedAt: Timestamped | null;
}

/**
 * One payment, as received.
 *
 * Append-only in practice: a mistaken entry is corrected by recording a
 * negative amount with a reason, not by editing history. `MAX_CAMP_CENTS`
 * bounds the magnitude in both directions for that reason.
 */
export interface CampPaymentRecord {
  id: string;
  /** Integer cents. Negative for a refund or a correction. */
  amountCents: number;
  method: CampPaymentMethod;
  /** Check number, Zelle confirmation, Square payment id — whatever identifies
      it in the place it actually happened. */
  reference: string;
  /** ISO `YYYY-MM-DD`. The day the money arrived, which is not the day it was
      typed in — a check handed over on Sunday is entered on Tuesday. */
  receivedOn: string;
  note: string;
  recordedByUid: string | null;
  recordedAt: Timestamped | null;
}

/**
 * What this registration owes and what has come in.
 *
 * ---------------------------------------------------------------------------
 * `baseCents` is copied onto the document, not looked up.
 *
 * The fee lives in `config/camp`, and a registration stores the figure that was
 * in force when it was taken. This is the single most important decision in
 * this file's money handling: if the bill were computed from the live config,
 * raising the fee in July would silently re-bill every family who registered in
 * May, and the balance a parent was told at the desk would stop matching the
 * one on the screen. Copying is what makes a bill a bill.
 *
 * The cost is that a deliberate mid-season change has to be applied to existing
 * registrations one at a time. That is the right way round: a change to what
 * somebody already owes should be a decision, not a side effect.
 * ---------------------------------------------------------------------------
 */
export interface CampBilling {
  /** The per-registrant fee in force when this was taken. Integer cents. */
  baseCents: number;
  discounts: CampDiscount[];
  payments: CampPaymentRecord[];
}

export const NO_BILLING: CampBilling = { baseCents: 0, discounts: [], payments: [] };

/* ---------------------------------------------------------------------------
 * The document
 * ------------------------------------------------------------------------ */

export interface CampRegistration extends AuditFields {
  /**
   * The ministry this belongs to — `summercamp` today.
   *
   * Stored rather than implied by the collection name, because the permission
   * is a program grant and `firestore.rules` reads this field to decide it. It
   * is also what lets the parish run this for a second camp without a second
   * collection.
   */
  programId: string;
  /**
   * The season, as the camp names it: `2027`, or `2027-week-1` if the parish
   * ever registers per week.
   *
   * A plain string on every document rather than a subcollection, because every
   * useful query is "this season's registrations" and a flat collection with an
   * equality filter is the shape Firestore charges least for and rules can
   * prove most easily.
   */
  season: string;

  kind: CampRegistrantKind;
  status: CampStatus;

  contact: CampContact;
  emergency: CampEmergencyContact;

  /** Populated on a `family` registration; empty on a `servant` one. */
  children: CampChild[];
  /** Populated on a `servant` registration; null on a `family` one. */
  servant: CampServantDetails | null;

  waiver: CampWaiver;
  billing: CampBilling;

  /** Administrators' own notes about this registration. */
  note: string;

  /** uid of the administrator who took it. Distinct from `updatedBy`, which is
      whoever touched it last. */
  takenByUid: string | null;
}

/** A registration as the editor holds it: everything staff set, nothing stamped. */
export type CampRegistrationDraft = Omit<CampRegistration, keyof AuditFields>;

/* ---------------------------------------------------------------------------
 * Blanks
 * ------------------------------------------------------------------------ */

/**
 * Ids for children, discounts and payments.
 *
 * Generated in the browser rather than by Firestore, because all three live
 * inside one document and there is no `doc()` to take an id from. Time plus
 * randomness: two administrators at two desks adding a child in the same
 * millisecond must not collide, and `Date.now()` alone would.
 */
export function campLineId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankChild(): CampChild {
  return {
    id: campLineId('child'),
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    grade: '1',
    shirtSize: 'YM',
    days: [],
    allergies: '',
    medicalNotes: '',
    groupName: '',
    // Defaults to false. A consent that defaults to given is not a consent —
    // it is a checkbox nobody read, and this one governs photographs of
    // children on a public website.
    photoConsent: false,
    note: '',
  };
}

export function blankServant(): CampServantDetails {
  return {
    uid: null,
    dateOfBirth: '',
    sections: [],
    desiredRoles: [],
    assignedRoles: [],
    shirtSize: 'AM',
    days: [],
    availability: '',
    cleared: false,
    clearedNote: '',
  };
}

/**
 * A new registration, ready to be edited.
 *
 * `baseCents` is passed in rather than read from config here, because this
 * module has no Firestore access and copying the fee is the caller's job — see
 * `CampBilling`.
 */
export function blankRegistration(input: {
  programId: string;
  season: string;
  kind: CampRegistrantKind;
  baseCents: number;
  takenByUid: string | null;
}): CampRegistrationDraft {
  return {
    programId: input.programId,
    season: input.season,
    kind: input.kind,
    status: 'draft',
    contact: { name: '', email: '', phone: '', altName: '', altPhone: '', address: '' },
    emergency: { name: '', phone: '', relationship: '' },
    children: input.kind === 'family' ? [blankChild()] : [],
    servant: input.kind === 'servant' ? blankServant() : null,
    waiver: { ...NO_WAIVER },
    billing: { baseCents: input.baseCents, discounts: [], payments: [] },
    note: '',
    takenByUid: input.takenByUid,
  };
}

/* ---------------------------------------------------------------------------
 * The bill
 * ------------------------------------------------------------------------ */

/** One child's share of the bill, itemised. */
export interface CampBillLine {
  childId: string;
  /** The child's name, or a placeholder while it is still being typed. */
  name: string;
  /** How many weeks they are coming. Zero until days are chosen. */
  weeks: number;
  /** `baseCents × weeks`. */
  cents: number;
}

export interface CampBill {
  /**
   * Every child, and what each one costs.
   *
   * Itemised rather than reduced to a single figure because this is read aloud
   * to a parent standing at a desk. "Two children, three weeks between them,
   * $525" invites the question "which of them is the extra week for?", and a
   * total cannot answer it.
   */
  lines: CampBillLine[];
  /** Total billable child-weeks. `lines` summed. */
  billableWeeks: number;
  /** `baseCents × billableWeeks`, before anything comes off. */
  subtotalCents: number;
  discountCents: number;
  /** What is owed: subtotal less discounts, never below zero. */
  dueCents: number;
  paidCents: number;
  /** Positive when money is still owed, negative when the family overpaid. */
  balanceCents: number;
  paid: boolean;
}

/**
 * How many weeks of camp one child is coming to.
 *
 * A week counts if they are coming on **any** day of it. That is how camps
 * price: the fee buys a place for the week, and a child who can only make
 * Monday to Wednesday has not bought three-fifths of a place — the staffing,
 * the room and the materials are the same. Charging by the day would also make
 * the bill move every time somebody adjusted a single toggle, which at a
 * registration desk is a conversation nobody wants to have twice.
 *
 * Days from a week the camp no longer runs still count. `dayList` deliberately
 * keeps them (lowering `config/camp.weeks` must not delete somebody's
 * attendance), and a week they were registered and charged for does not stop
 * being one because a setting changed.
 */
export function campWeeksAttended(days: CampDayKey[]): number {
  const weeks = new Set<number>();
  for (const key of days) {
    const parsed = parseCampDayKey(key);
    if (parsed) weeks.add(parsed.week);
  }
  return weeks.size;
}

/**
 * What a registration is billed for, per child.
 *
 * ---------------------------------------------------------------------------
 * The fee is per child **per week**, not per child.
 *
 * This was per child at first, and it was wrong: a child doing both weeks is
 * two weeks of camp and is charged for two. Tommy: *"if they register for two
 * weeks they get charged twice per kid."*
 *
 * Which means `billing.baseCents` is a *weekly* rate, and the field's name does
 * not say so — it is left alone deliberately rather than migrated, because it
 * is stored on every existing registration and renaming it in code without
 * rewriting those documents is how a fee silently reads as zero. The name is
 * the cost of that; this comment is the mitigation.
 *
 * A consequence worth knowing before it surprises somebody: a registration
 * saved before attendance existed has no days, so it prices at zero. There is
 * no way to guess what it should have been — the days were never asked for —
 * and inventing one week per child would put a number nobody chose onto a real
 * family's balance. They show as "no days chosen" and are corrected by opening
 * them.
 * ---------------------------------------------------------------------------
 */
export function campBill(registration: {
  kind: CampRegistrantKind;
  children: CampChild[];
  billing: CampBilling;
}): CampBill {
  const rate = Math.max(0, Math.round(registration.billing.baseCents));

  /*
   * Servants are billed for nothing, so they get no lines at all.
   *
   * Not "one line at zero": the alternative — billing them and relying on a
   * 100% discount — would put a fee on every servant's screen that somebody has
   * to remember to cancel.
   */
  const lines: CampBillLine[] =
    registration.kind === 'family'
      ? registration.children.map((child) => {
          const weeks = campWeeksAttended(child.days);
          return {
            childId: child.id,
            name: childName(child) || 'This child',
            weeks,
            cents: rate * weeks,
          };
        })
      : [];

  const billableWeeks = lines.reduce((sum, line) => sum + line.weeks, 0);
  const subtotalCents = lines.reduce((sum, line) => sum + line.cents, 0);

  let off = 0;
  for (const discount of registration.billing.discounts) {
    off +=
      discount.kind === 'percent'
        ? Math.round((subtotalCents * clamp(discount.value, 0, 100)) / 100)
        : Math.max(0, Math.round(discount.value));
  }
  /*
   * Percentages come off the subtotal and never compound: two 50% discounts are
   * 100% off, not 75%. The compounding reading is defensible in the abstract
   * and indefensible at a desk — it makes the order the lines were typed in
   * change what the family owes, and no administrator will ever guess that.
   *
   * The total coming off is clamped to the subtotal, so `dueCents` cannot go
   * below zero. A negative bill is not a refund; a refund is a negative
   * payment, which is recorded, dated and has somebody's name on it.
   */
  const discountCents = Math.min(off, subtotalCents);

  const dueCents = subtotalCents - discountCents;
  const paidCents = registration.billing.payments.reduce(
    (sum, payment) => sum + Math.round(payment.amountCents),
    0,
  );

  return {
    lines,
    billableWeeks,
    subtotalCents,
    discountCents,
    dueCents,
    paidCents,
    balanceCents: dueCents - paidCents,
    // A free registration — a servant, or a family discounted to nothing — is
    // paid. Otherwise every servant would sit in the "owes money" list forever.
    paid: paidCents >= dueCents,
  };
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}

/* ---------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/**
 * What must be true to *save* a draft: a name, and nothing else.
 *
 * Deliberately almost nothing. A registration is typed at a desk with a family
 * standing there, and a screen that refuses to save until every field is filled
 * is a screen that loses the four fields already typed when somebody has to
 * take a phone call. The same reasoning as the events editor, which was
 * tightened once and had to be loosened again.
 */
export function validateCampDraft(draft: CampRegistrationDraft): string[] {
  const errors: string[] = [];
  if (!draft.contact.name.trim()) {
    errors.push(
      draft.kind === 'family'
        ? "Enter the parent or guardian's name."
        : "Enter the servant's name.",
    );
  }
  if (!draft.season.trim()) errors.push('This registration has no season.');
  return errors;
}

/**
 * Whether there is a waiver to sign at all.
 *
 * ---------------------------------------------------------------------------
 * A waiver that does not exist cannot be required, and requiring one deadlocked
 * the whole screen.
 *
 * The waiver text lives in `config/camp` and the parish had not written it yet
 * — in production the document did not exist at all. The form correctly refused
 * to offer a consent tick for a document with no words in it, and this function
 * just as correctly said the waiver was unsigned. Between them: a registration
 * that could never leave `draft`, on every registration, for as long as the
 * text was missing. Tommy: *"the draft cannot change to registered."*
 *
 * So the requirement is conditional on there being something to agree to. When
 * the parish writes the waiver and gives it a `waiverVersion`, this flips to
 * true and every new registration has to carry a signature again; the ones
 * taken before it existed keep saying, accurately, that they agreed to nothing.
 * ---------------------------------------------------------------------------
 */
export interface CampValidationContext {
  /**
   * True when `config/camp` has waiver text to show. Defaults to true, so a
   * caller that forgets it gets the stricter answer rather than the laxer one.
   */
  waiverInForce?: boolean;
}

/**
 * What must be true to move a registration out of `draft` — the real check.
 *
 * Everything here is something the camp genuinely cannot run without: a way to
 * reach the family, somebody to ring in an emergency, a named child with a
 * grade and a size, and — when there is one — an agreed waiver. Each message
 * names the field and what to do, because these are read by a volunteer at a
 * desk and "invalid input" is not something they can act on.
 */
export function validateCampRegistration(
  draft: CampRegistrationDraft,
  context: CampValidationContext = {},
): string[] {
  const errors = validateCampDraft(draft);

  if (!draft.contact.phone.trim() && !draft.contact.email.trim()) {
    errors.push('Enter a phone number or an email address, so the camp can reach them.');
  }
  if (!draft.emergency.name.trim() || !draft.emergency.phone.trim()) {
    errors.push('Enter an emergency contact — a name and a phone number.');
  }

  if (draft.kind === 'family') {
    if (draft.children.length === 0) {
      errors.push('Add at least one child.');
    }
    if (draft.children.length > MAX_CHILDREN) {
      errors.push(`A registration holds at most ${MAX_CHILDREN} children. Start a second one.`);
    }
    draft.children.forEach((child, index) => {
      const who = child.firstName.trim() || `Child ${index + 1}`;
      if (!child.firstName.trim() || !child.lastName.trim()) {
        errors.push(`${who} needs a first and last name.`);
      }
      if (!isCampGrade(child.grade)) {
        errors.push(`${who} needs the grade they are entering.`);
      }
      if (!isShirtSize(child.shirtSize)) {
        errors.push(`${who} needs a shirt size.`);
      }
      if (child.days.length === 0) {
        errors.push(`${who} needs the days they are coming.`);
      }
    });
  } else {
    const servant = draft.servant;
    if (!servant) {
      errors.push('This servant registration is missing its details.');
    } else {
      if (servant.sections.length === 0) {
        errors.push('Choose which group the servant will serve — elementary, middle school, or both.');
      }
      if (servant.desiredRoles.length === 0) {
        errors.push('Choose at least one role the servant would like.');
      }
      if (servant.days.length === 0) {
        errors.push('Choose the days the servant is coming.');
      }
    }
  }

  // See `CampValidationContext`: only demanded when there is a waiver to sign.
  if (context.waiverInForce !== false && (!draft.waiver.agreed || !draft.waiver.signedName.trim())) {
    errors.push('The waiver has not been signed.');
  }

  return errors;
}

/* ---------------------------------------------------------------------------
 * Reading a stored document
 * ------------------------------------------------------------------------ */

/**
 * Coerce anything out of Firestore into a registration.
 *
 * Tolerant in the same way `parseFormDefinition` is, and for a sharper reason:
 * this document is edited over weeks by more than one person, so a half-written
 * or partly-migrated version of it is the normal case rather than the broken
 * one. Everything falls back to a usable blank; nothing throws. A child with no
 * usable id is given one rather than dropped, because dropping a child from a
 * camp roster is the worst possible failure mode here.
 */
export function parseCampRegistration(raw: unknown): CampRegistration {
  const doc = asRecord(raw);

  const kindRaw = str(doc['kind']);
  const kind: CampRegistrantKind = kindRaw === 'servant' ? 'servant' : 'family';

  const children = list(doc['children'])
    .map(parseChild)
    .slice(0, MAX_CHILDREN);

  return {
    programId: str(doc['programId']) || 'summercamp',
    season: str(doc['season']),
    kind,
    status: isCampStatus(doc['status']) ? doc['status'] : 'draft',
    contact: parseContact(doc['contact']),
    emergency: parseEmergency(doc['emergency']),
    children: kind === 'family' ? children : [],
    servant: kind === 'servant' ? parseServant(doc['servant']) : null,
    waiver: parseWaiver(doc['waiver']),
    billing: parseBilling(doc['billing']),
    note: text(doc['note']),
    takenByUid: nullableStr(doc['takenByUid']),
    createdAt: (doc['createdAt'] ?? null) as CampRegistration['createdAt'],
    updatedAt: (doc['updatedAt'] ?? null) as CampRegistration['updatedAt'],
    updatedBy: nullableStr(doc['updatedBy']),
  };
}

function parseContact(raw: unknown): CampContact {
  const doc = asRecord(raw);
  return {
    name: str(doc['name']),
    email: str(doc['email']),
    phone: str(doc['phone']),
    altName: str(doc['altName']),
    altPhone: str(doc['altPhone']),
    address: text(doc['address']),
  };
}

function parseEmergency(raw: unknown): CampEmergencyContact {
  const doc = asRecord(raw);
  return {
    name: str(doc['name']),
    phone: str(doc['phone']),
    relationship: str(doc['relationship']),
  };
}

function parseChild(raw: unknown): CampChild {
  const doc = asRecord(raw);
  return {
    id: str(doc['id']) || campLineId('child'),
    firstName: str(doc['firstName']),
    lastName: str(doc['lastName']),
    dateOfBirth: str(doc['dateOfBirth']),
    grade: isCampGrade(doc['grade']) ? doc['grade'] : '1',
    shirtSize: isShirtSize(doc['shirtSize']) ? doc['shirtSize'] : 'YM',
    days: dayList(doc['days']),
    allergies: text(doc['allergies']),
    medicalNotes: text(doc['medicalNotes']),
    groupName: str(doc['groupName']),
    photoConsent: doc['photoConsent'] === true,
    note: text(doc['note']),
  };
}

function parseServant(raw: unknown): CampServantDetails {
  const doc = asRecord(raw);
  return {
    uid: nullableStr(doc['uid']),
    dateOfBirth: str(doc['dateOfBirth']),
    sections: sectionList(doc['sections']),
    desiredRoles: roleList(doc['desiredRoles']),
    assignedRoles: roleList(doc['assignedRoles']),
    shirtSize: isShirtSize(doc['shirtSize']) ? doc['shirtSize'] : 'AM',
    days: dayList(doc['days']),
    availability: text(doc['availability']),
    cleared: doc['cleared'] === true,
    clearedNote: text(doc['clearedNote']),
  };
}

function parseWaiver(raw: unknown): CampWaiver {
  const doc = asRecord(raw);
  return {
    version: str(doc['version']),
    agreed: doc['agreed'] === true,
    signedName: str(doc['signedName']),
    signedRelationship: str(doc['signedRelationship']),
    signedAt: (doc['signedAt'] ?? null) as CampWaiver['signedAt'],
    signedByUid: nullableStr(doc['signedByUid']),
  };
}

function parseBilling(raw: unknown): CampBilling {
  const doc = asRecord(raw);
  return {
    baseCents: cents(doc['baseCents']),
    discounts: list(doc['discounts']).map(parseDiscount).slice(0, MAX_DISCOUNTS),
    payments: list(doc['payments']).map(parsePayment).slice(0, MAX_PAYMENTS),
  };
}

function parseDiscount(raw: unknown): CampDiscount {
  const doc = asRecord(raw);
  const kind = str(doc['kind']) === 'percent' ? 'percent' : 'amount';
  const rawValue = typeof doc['value'] === 'number' ? doc['value'] : 0;
  return {
    id: str(doc['id']) || campLineId('discount'),
    kind,
    value: kind === 'percent' ? clamp(Math.round(rawValue), 0, 100) : cents(rawValue),
    reason: str(doc['reason']),
    childId: nullableStr(doc['childId']),
    appliedByUid: nullableStr(doc['appliedByUid']),
    appliedAt: (doc['appliedAt'] ?? null) as CampDiscount['appliedAt'],
  };
}

function parsePayment(raw: unknown): CampPaymentRecord {
  const doc = asRecord(raw);
  return {
    id: str(doc['id']) || campLineId('payment'),
    // Signed, unlike everything else that uses `cents`: a refund is a negative
    // payment, and clamping it to zero would make a refunded family look paid.
    amountCents: signedCents(doc['amountCents']),
    method: readCampPaymentMethod(doc['method']),
    reference: str(doc['reference']),
    receivedOn: str(doc['receivedOn']),
    note: text(doc['note']),
    recordedByUid: nullableStr(doc['recordedByUid']),
    recordedAt: (doc['recordedAt'] ?? null) as CampPaymentRecord['recordedAt'],
  };
}

/* ---- coercion helpers -------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_LINE) : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_NOTE) : '';
}

function nullableStr(value: unknown): string | null {
  const out = typeof value === 'string' ? value.trim() : '';
  return out || null;
}

function cents(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return clamp(n, 0, MAX_CAMP_CENTS);
}

function signedCents(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
  return clamp(n, -MAX_CAMP_CENTS, MAX_CAMP_CENTS);
}

/**
 * Well-formed day keys only, deduped, sorted by week then by weekday.
 *
 * Sorted rather than kept in click order, so two registrations covering the
 * same days are the same array — which is what lets a later roster compare them
 * without normalising first. Anything that is not a `w<n>-<day>` key is dropped
 * rather than carried; the week number is not range-checked here because
 * lowering the camp's week count must not silently delete the days somebody
 * already registered for.
 */
function dayList(value: unknown): CampDayKey[] {
  const keys = new Map<string, { week: number; index: number }>();
  for (const entry of list(value)) {
    const parsed = parseCampDayKey(entry);
    if (!parsed) continue;
    keys.set(entry as string, {
      week: parsed.week,
      index: CAMP_WEEKDAYS.indexOf(parsed.day),
    });
  }
  return [...keys.entries()]
    .sort((a, b) => a[1].week - b[1].week || a[1].index - b[1].index)
    .map(([key]) => key);
}

/** Known sections only, deduped, in the canonical order rather than the stored
    one — so two documents holding the same pair read identically. */
function sectionList(value: unknown): CampSection[] {
  const found = new Set(list(value).filter(isCampSection));
  return CAMP_SECTIONS.filter((section) => found.has(section));
}

function roleList(value: unknown): string[] {
  return [
    ...new Set(
      list(value)
        .filter((role): role is string => typeof role === 'string')
        .map((role) => role.trim().slice(0, MAX_LINE))
        .filter(Boolean),
    ),
  ].slice(0, MAX_ROLES);
}

/* ---------------------------------------------------------------------------
 * Sorting and summarising, for the roster screens that read this next
 * ------------------------------------------------------------------------ */

/** "Mariam Guirguis", or the last name alone, or "New registration". */
export function childName(child: CampChild): string {
  return [child.firstName, child.lastName].filter(Boolean).join(' ').trim();
}

/**
 * How a registration is titled in a list.
 *
 * The contact's name, because that is what an administrator scanning for a
 * family is looking for. A registration with nothing typed into it yet says so
 * rather than rendering as an empty row somebody cannot click confidently.
 */
export function registrationName(registration: {
  contact: CampContact;
  kind: CampRegistrantKind;
}): string {
  return registration.contact.name.trim() || 'Untitled registration';
}

/**
 * Registrations in the order a camp wants to read them.
 *
 * Alphabetical by contact name. Not by date added — an administrator looking
 * for the Guirguis family knows their name and does not know when they
 * registered, and a list that reorders itself every time somebody new is added
 * is a list you cannot learn the shape of.
 */
export function sortRegistrations<T extends { contact: CampContact; kind: CampRegistrantKind }>(
  registrations: T[],
): T[] {
  return [...registrations].sort((a, b) =>
    registrationName(a).localeCompare(registrationName(b)),
  );
}

/**
 * Every shirt that has to be ordered, by size.
 *
 * Here rather than in the screen because it is the first of the "we will be
 * using this somewhere" consumers, and because it is the clearest possible
 * demonstration of why this is a typed collection: it is six lines against
 * structured children, and impossible against `FormAnswers`.
 */
export function shirtCounts(
  registrations: { children: CampChild[]; servant: CampServantDetails | null; status: CampStatus }[],
): Record<ShirtSize, number> {
  const counts = Object.fromEntries(SHIRT_SIZES.map((size) => [size, 0])) as Record<ShirtSize, number>;
  for (const registration of registrations) {
    // Withdrawn registrations do not get shirts. A draft does — the shirt order
    // goes in before every registration is finished, and a camp would rather
    // have a spare than be one short.
    if (registration.status === 'withdrawn') continue;
    for (const child of registration.children) counts[child.shirtSize] += 1;
    if (registration.servant) counts[registration.servant.shirtSize] += 1;
  }
  return counts;
}

/* ---------------------------------------------------------------------------
 * Servants signing themselves up
 * ------------------------------------------------------------------------ */

/**
 * A servant's own sign-up, waiting for an administrator to accept it.
 *
 * ---------------------------------------------------------------------------
 * Families are registered by the camp. Servants register themselves.
 *
 * The two halves of this camp are not the same transaction and were wrong to
 * share a screen. A family registration is taken at a desk: it carries
 * children's medical notes and allergies, a fee, a payment ledger written to
 * over weeks, and a waiver signed by a guardian — all of which an administrator
 * checks in front of the person. A servant is one adult or teenager saying
 * which days they can serve and what they would like to do. Making the second
 * wait for somebody with a program grant to type it in is how a camp ends up
 * with a spreadsheet nobody reconciles.
 *
 * So this collection exists, and `campRegistrations` stays exactly as shut as
 * it was. Nothing a stranger sends reaches the register: a sign-up lands here,
 * an administrator reads it, and **accepting it is what writes a
 * `campRegistrations` document** — under their own uid, with their own grant.
 *
 * ## Why a whole draft, rather than a smaller shape
 *
 * `registration` is a `CampRegistrationDraft` — the same type the editor holds.
 * A narrower "request" shape was the obvious first design and it is worse in
 * the one place it matters: accepting would then be a field-by-field mapping,
 * and every field added to a registration afterwards would silently stop being
 * carried across. This way accepting is a copy, and a servant's answers cannot
 * be quietly dropped by a schema that drifted.
 *
 * ## What it is not
 *
 * Not a `formSubmissions` row, though it arrives through a Function like one.
 * A form submission is answers to questions; this is a registration in every
 * respect except that nobody has agreed to it yet, and the camp's own screens
 * — the roster, the shirt count, the allocation board — all read
 * `CampRegistration` and would be blind to it in any other shape.
 * ---------------------------------------------------------------------------
 */
export interface CampServantRequest {
  /** Copied to the top level so `firestore.rules` can decide on it without
      reaching into the nested draft. Set by the Function from `config/camp`,
      never from the request body — a sign-up cannot choose its own ministry. */
  programId: string;
  season: string;

  /** The registration as the servant filled it in. Always `kind: 'servant'`. */
  registration: CampRegistrationDraft;

  /**
   * Whatever they typed in the "anything else" box.
   *
   * Kept out of `registration.note`, which is the *administrators'* notes about
   * a registration. Merging them would make "we agreed to let her leave at
   * three on the Thursday" indistinguishable from something the servant asked
   * for, which is exactly the distinction the note is read for.
   */
  message: string;

  submittedAt: Timestamped;
}

/**
 * A blank sign-up, as the public form starts.
 *
 * `baseCents: 0` rather than the camp's fee, and it is not an oversight:
 * `campBill` charges per child per week and a servant has no children on their
 * registration, so a servant's bill is zero however the fee moves. Copying a
 * fee onto a document that can never be billed by it would put a number on the
 * screen that means nothing.
 */
export function blankServantSignUp(input: {
  programId: string;
  season: string;
}): CampRegistrationDraft {
  return blankRegistration({
    programId: input.programId,
    season: input.season,
    kind: 'servant',
    baseCents: 0,
    // Nobody took this at a desk. `takenByUid` is the administrator who did,
    // and claiming one here would credit somebody with work they did not do.
    takenByUid: null,
  });
}

/**
 * What a servant has to have answered before the form will send.
 *
 * ---------------------------------------------------------------------------
 * The same requirements as `validateCampRegistration`'s servant branch, in the
 * first person — and the duplication is deliberate.
 *
 * That function is read by a volunteer at a desk looking at somebody else's
 * record, so it says "Enter the servant's name" and "Choose the days the
 * servant is coming". This one is read by the servant, on their phone, about
 * themselves. "Choose the days the servant is coming" is a sentence that makes
 * a sixteen-year-old wonder which servant is meant.
 *
 * The cost is that a requirement added there and not here would not be asked
 * for at sign-up. That failure is visible rather than silent — the
 * administrator opens the accepted registration and the missing field is
 * flagged by the very function that was changed — so it is the cheaper of the
 * two mistakes. Keep them in step anyway.
 * ---------------------------------------------------------------------------
 */
export function validateServantSignUp(
  draft: CampRegistrationDraft,
  context: CampValidationContext = {},
): string[] {
  const errors: string[] = [];
  const servant = draft.servant;

  if (!draft.contact.name.trim()) errors.push('Enter your name.');
  if (!draft.contact.phone.trim() && !draft.contact.email.trim()) {
    errors.push('Enter a phone number or an email address, so the camp can reach you.');
  }
  if (!draft.emergency.name.trim() || !draft.emergency.phone.trim()) {
    errors.push('Enter an emergency contact — somebody to ring if we cannot reach you.');
  }

  if (!servant) {
    errors.push('This sign-up is missing its details.');
  } else {
    if (!servant.dateOfBirth.trim()) {
      errors.push('Enter your date of birth — the camp needs it to build the groups.');
    }
    if (servant.sections.length === 0) {
      errors.push('Choose which group you would like to serve — elementary, middle school, or both.');
    }
    if (servant.desiredRoles.length === 0) {
      errors.push('Choose at least one role you would like.');
    }
    if (servant.days.length === 0) errors.push('Choose the days you can come.');
    if (!isShirtSize(servant.shirtSize)) errors.push('Choose a shirt size.');
  }

  if (context.waiverInForce !== false && (!draft.waiver.agreed || !draft.waiver.signedName.trim())) {
    errors.push('The waiver has not been signed.');
  }

  return errors;
}

/**
 * Read a stored sign-up.
 *
 * `parseCampRegistration` does the inner work and then the audit fields are
 * dropped, because a request has none: it was written by a Function on behalf
 * of somebody with no account, so there is no `updatedBy` to record and
 * pretending otherwise would put a uid on a document nobody signed in to
 * create. `submittedAt` is the only time this document has.
 */
export function parseCampServantRequest(raw: unknown): CampServantRequest {
  const doc = asRecord(raw);
  const registration = parseCampRegistration({ ...asRecord(doc['registration']), kind: 'servant' });
  const { createdAt: _created, updatedAt: _updated, updatedBy: _by, ...draft } = registration;

  return {
    programId: str(doc['programId']) || draft.programId,
    season: str(doc['season']) || draft.season,
    registration: draft,
    message: text(doc['message']),
    submittedAt: (doc['submittedAt'] ?? null) as Timestamped,
  };
}

/**
 * A sign-up, as the registration an administrator has just accepted.
 *
 * ---------------------------------------------------------------------------
 * Accepting decides the status, and it is not always `registered`.
 *
 * A sign-up that answers everything the camp needs is accepted *as registered*
 * — the queue is the review, and making an administrator open the record
 * afterwards to press a second button would make the queue a place where work
 * is announced rather than done.
 *
 * One that does not — a waiver that came into force after it was sent, a field
 * added since — becomes a `draft` instead, which is the state that says "this
 * is real and it is not finished". The alternative, refusing to accept it, would
 * leave a real person's sign-up stuck in a queue for a reason they cannot see
 * and cannot fix.
 * ---------------------------------------------------------------------------
 */
export function acceptedServantRegistration(
  request: CampServantRequest,
  input: { takenByUid: string | null; waiverInForce: boolean },
): CampRegistrationDraft {
  const draft: CampRegistrationDraft = {
    ...request.registration,
    programId: request.programId,
    season: request.season,
    kind: 'servant',
    takenByUid: input.takenByUid,
    /*
     * The servant's own words, kept and labelled.
     *
     * `note` is the administrators' field. Dropping the message on acceptance
     * would lose the one part of a sign-up that has nowhere else to live, so it
     * is carried across with its provenance attached rather than silently
     * merged into somebody else's notes.
     */
    note: request.message.trim()
      ? `From their sign-up: ${request.message.trim()}`
      : request.registration.note,
  };

  const problems = validateCampRegistration(draft, { waiverInForce: input.waiverInForce });
  return { ...draft, status: problems.length === 0 ? 'registered' : 'draft' };
}
