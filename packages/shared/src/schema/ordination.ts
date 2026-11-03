/**
 * Nominations for ordination to the minor ranks of the diaconate.
 *
 * ---------------------------------------------------------------------------
 * The diocese takes these on its own paper: one PDF per rank, each with a cover
 * page listing up to twenty nominees, a page of requirements the parish priests
 * sign, a page about each nominee, and a page of guidelines. The originals are
 * in `docs/ordination-forms/`.
 *
 * The website's part is everything up to the paper:
 *
 *   1. An ordination admin opens an **ordination** — a rank and a date.
 *   2. A nominee, or a parent for a child, fills the nominee page in on
 *      /forms/ordination. That posts to the `ordinationApply` Function, which
 *      is the only writer of `ordinationApplications`.
 *   3. An admin approves or rejects each one. Approving is where the questions
 *      the priest answers *about* the nominee get answered, and where a priest
 *      signs with the signature they drew once on the signatures tab.
 *   4. The admin screen fills the diocese's PDFs with all of it.
 *
 * The nominee never answers the "Elaborate" questions. They are the parish's
 * testimony about the nominee, and a form that let somebody write their own
 * reference would make the page meaningless. What the nominee *can* give is
 * the name of their father of confession, which the admin's answer starts from.
 * ---------------------------------------------------------------------------
 */

import type { Timestamped } from './common.js';
import { looksLikeEmail } from '../payments/squareCheckout.js';

/* -------------------------------------------------------------------------- */
/* Ranks                                                                      */
/* -------------------------------------------------------------------------- */

/** In order of seniority, which is also the order the admin screen lists them. */
export const ORDINATION_RANKS = ['cantor', 'reader', 'subdeacon'] as const;

export type OrdinationRank = (typeof ORDINATION_RANKS)[number];

export function isOrdinationRank(value: unknown): value is OrdinationRank {
  return typeof value === 'string' && (ORDINATION_RANKS as readonly string[]).includes(value);
}

export interface OrdinationRankInfo {
  /** "Reader" */
  title: string;
  /** "Anaghnostis" — the diocese's forms give both, and so does every heading here. */
  greek: string;
  /**
   * The age the diocese's requirements page asks for, in completed years.
   *
   * Shown to the admin as a warning and never enforced. The cantor's own page
   * allows six "if accompanied by his father", and the parish priest is the
   * one who decides whether that applies — not a validator.
   */
  minimumAge: number;
  /** True where the nominee page asks for a school grade and two parents. */
  minor: boolean;
}

export const ORDINATION_RANK_INFO: Record<OrdinationRank, OrdinationRankInfo> = {
  cantor: { title: 'Cantor', greek: 'Epsaltos', minimumAge: 8, minor: true },
  reader: { title: 'Reader', greek: 'Anaghnostis', minimumAge: 16, minor: true },
  subdeacon: { title: 'Subdeacon', greek: 'Epidiacon', minimumAge: 24, minor: false },
};

/** "Reader (Anaghnostis)", the way the diocese's own headings put it. */
export function ordinationRankLabel(rank: OrdinationRank): string {
  const info = ORDINATION_RANK_INFO[rank];
  return `${info.title} (${info.greek})`;
}

/**
 * The questions on each rank's nominee page, in the order the page asks them.
 *
 * The keys are what `OrdinationReview.answers` is keyed by, and the order is
 * load-bearing: `ordination/packetLayout.ts` draws answer *n* on the *n*th line.
 * The subdeacon's page asks two more than the others and asks them in a
 * different order — criteria before father of confession — so each rank has
 * its own list rather than a shared one with extras appended.
 */
export const ORDINATION_QUESTIONS: Record<OrdinationRank, readonly { key: string; label: string }[]> = {
  cantor: [
    { key: 'attendance', label: 'Is the nominee and his family a consistent and active attendee of this parish?' },
    { key: 'fatherOfConfession', label: 'Who is the nominee’s Father of Confession, and has he approved the nomination for ordination?' },
    { key: 'criteria', label: 'Has the nominee met the requirement criteria for the rank of Cantor (Epsaltos)?' },
    { key: 'conduct', label: 'Does the nominee possess a reputation of good conduct, becoming of a servant in this parish?' },
    { key: 'interpersonal', label: 'Does the nominee possess good interpersonal skills at church and in his secular life?' },
  ],
  reader: [
    { key: 'attendance', label: 'Is the nominee and his family a consistent and active attendee of this parish?' },
    { key: 'fatherOfConfession', label: 'Who is the nominee’s Father of Confession, and has he approved the nomination for ordination?' },
    { key: 'criteria', label: 'Has the nominee met the requirement criteria for the rank of Reader (Anaghnostis)?' },
    { key: 'conduct', label: 'Does the nominee possess a reputation of good conduct, becoming of a servant in this parish?' },
    { key: 'interpersonal', label: 'Does the nominee possess good interpersonal skills at church and in his secular life?' },
  ],
  subdeacon: [
    { key: 'attendance', label: 'Is the nominee a consistent and active attendee of this parish?' },
    { key: 'criteria', label: 'Has the nominee met the requirement criteria for the rank of Subdeacon (Epidiacon)?' },
    { key: 'fatherOfConfession', label: 'Who is the nominee’s Father of Confession, and has he approved the nomination for ordination?' },
    { key: 'conduct', label: 'Does the nominee possess a reputation of good conduct, becoming of a servant in this parish?' },
    { key: 'ministry', label: 'Does the nominee oversee or take part in a current ministry in this parish?' },
    { key: 'leadership', label: 'Does the nominee portray leadership and mentoring skills?' },
    { key: 'interpersonal', label: 'Does the nominee possess good interpersonal skills at church and in his secular life?' },
  ],
};

/**
 * The cover page has twenty rows and no continuation sheet, so an ordination
 * can approve twenty and no more. The admin screen refuses the twenty-first.
 */
export const ORDINATION_MAX_NOMINEES = 20;

/** The diocese's form has three lines for parish priests. */
export const ORDINATION_MAX_SIGNATURES = 3;

/* -------------------------------------------------------------------------- */
/* Ordinations                                                                */
/* -------------------------------------------------------------------------- */

export interface Ordination {
  rank: OrdinationRank;
  /** The proposed date of ordination, `YYYY-MM-DD`. */
  date: string;
  /** Whether /forms/ordination offers it. Closing it keeps every application. */
  open: boolean;
  /**
   * The church's name and "address, city, state" as the cover page prints
   * them. Filled from `config/parish` when the ordination is created and kept
   * on the ordination after that, so a packet printed next year says what the
   * one sent to the diocese said.
   */
  churchName: string;
  churchAddress: string;
  createdAt?: Timestamped | null;
  updatedAt?: Timestamped | null;
  updatedBy?: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in `YYYY-MM-DD`, not merely the right shape. */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseOrdination(raw: unknown): Ordination {
  const doc = record(raw);
  const date = text(doc['date'], 10);
  return {
    rank: isOrdinationRank(doc['rank']) ? doc['rank'] : 'reader',
    date: isCalendarDay(date) ? date : '',
    open: doc['open'] === true,
    churchName: text(doc['churchName']),
    churchAddress: text(doc['churchAddress']),
    createdAt: (doc['createdAt'] as Timestamped | undefined) ?? null,
    updatedAt: (doc['updatedAt'] as Timestamped | undefined) ?? null,
    updatedBy: typeof doc['updatedBy'] === 'string' ? doc['updatedBy'] : null,
  };
}

/** "Reader (Anaghnostis) · 6 December 2026" */
export function ordinationTitle(ordination: Pick<Ordination, 'rank' | 'date'>): string {
  return `${ordinationRankLabel(ordination.rank)} · ${longDay(ordination.date)}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `2026-12-06` → "6 December 2026". Pure string work, so no time zone can shift it. */
export function longDay(day: string): string {
  if (!isCalendarDay(day)) return day;
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `2026-12-06` → "12/06/2026", which is how a US form is filled in by hand. */
export function formDay(day: string): string {
  if (!isCalendarDay(day)) return day;
  const [y, m, d] = day.split('-');
  return `${m}/${d}/${y}`;
}

/**
 * Completed years between a birthday and a day, both `YYYY-MM-DD`.
 * Null when either is not a real date.
 */
export function ageOn(dateOfBirth: string, day: string): number | null {
  if (!isCalendarDay(dateOfBirth) || !isCalendarDay(day)) return null;
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

export interface OrdinationContact {
  name: string;
  phone: string;
  email: string;
}

export interface OrdinationNominee {
  name: string;
  address: string;
  /** `YYYY-MM-DD` */
  dateOfBirth: string;
  /** Cantor and reader. */
  schoolGrade: string;
  /** Subdeacon: "Level of Study or Professional Position". */
  occupation: string;
  phone: string;
  email: string;
  /**
   * The name the nominee gives for their father of confession.
   *
   * Not on the diocese's paper as a field of its own — the page asks the
   * *priest* who it is — but the admin answering that question needs the name
   * to start from, and the nominee is the one person certain to know it.
   */
  fatherOfConfession: string;
}

/** What the public form sends. Everything else on an application is the parish's. */
export interface OrdinationApplicationDraft {
  ordinationId: string;
  nominee: OrdinationNominee;
  /** Cantor and reader only. Always two entries, either of which may be blank. */
  parents: OrdinationContact[];
  /** Who filled the form in, when it was not the nominee. */
  submittedBy: string;
  /** Anything the sender wants the parish to know. */
  message: string;
}

export const ORDINATION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type OrdinationStatus = (typeof ORDINATION_STATUSES)[number];

/**
 * One priest's signature on one application.
 *
 * The image is copied onto the application when they sign rather than looked up
 * when the packet is printed. A priest who redraws their signature next year
 * must not change the packet the diocese already has, and an application that
 * holds its own signature reprints identically for as long as it exists.
 */
export interface OrdinationSignature {
  uid: string;
  name: string;
  /** A `data:image/png;base64,…` URL. */
  image: string;
  /** `YYYY-MM-DD`, printed on the DATE line beside the signature. */
  signedOn: string;
}

export interface OrdinationReview {
  /** Keyed by `ORDINATION_QUESTIONS[rank][n].key`. */
  answers: Record<string, string>;
  /** Why it was rejected, or anything the admins want to keep. Never printed. */
  note: string;
  decidedByUid: string;
  decidedByName: string;
  /** `YYYY-MM-DD` */
  decidedOn: string;
}

export interface OrdinationApplication extends OrdinationApplicationDraft {
  /** Copied from the ordination when filed, so a list can be read without a join. */
  rank: OrdinationRank;
  status: OrdinationStatus;
  review: OrdinationReview | null;
  signatures: OrdinationSignature[];
  submittedAt?: Timestamped | null;
  updatedAt?: Timestamped | null;
  updatedBy?: string | null;
}

/** Longest any one answer may be. Two printed lines and a continuation page. */
export const ORDINATION_ANSWER_MAX = 1_200;

/** Large enough for a drawn signature as a PNG; small enough to keep a document cheap. */
export const ORDINATION_SIGNATURE_IMAGE_MAX = 150_000;

export function emptyOrdinationContact(): OrdinationContact {
  return { name: '', phone: '', email: '' };
}

export function emptyOrdinationDraft(ordinationId = ''): OrdinationApplicationDraft {
  return {
    ordinationId,
    nominee: {
      name: '',
      address: '',
      dateOfBirth: '',
      schoolGrade: '',
      occupation: '',
      phone: '',
      email: '',
      fatherOfConfession: '',
    },
    parents: [emptyOrdinationContact(), emptyOrdinationContact()],
    submittedBy: '',
    message: '',
  };
}

function parseContact(raw: unknown): OrdinationContact {
  const doc = record(raw);
  return { name: text(doc['name']), phone: text(doc['phone'], 40), email: text(doc['email']) };
}

/**
 * Any object into a draft: every field coerced, unknown keys dropped.
 *
 * This is what makes the Function safe to post to — whatever a stranger sends,
 * nothing reaches Firestore that this shape did not put there.
 */
export function parseOrdinationDraft(raw: unknown): OrdinationApplicationDraft {
  const doc = record(raw);
  const nominee = record(doc['nominee']);
  const parents = Array.isArray(doc['parents']) ? doc['parents'] : [];
  const dateOfBirth = text(nominee['dateOfBirth'], 10);
  return {
    ordinationId: text(doc['ordinationId'], 100),
    nominee: {
      name: text(nominee['name']),
      address: text(nominee['address'], 300),
      dateOfBirth: isCalendarDay(dateOfBirth) ? dateOfBirth : '',
      schoolGrade: text(nominee['schoolGrade'], 40),
      occupation: text(nominee['occupation']),
      phone: text(nominee['phone'], 40),
      email: text(nominee['email']),
      fatherOfConfession: text(nominee['fatherOfConfession']),
    },
    parents: [parseContact(parents[0]), parseContact(parents[1])],
    submittedBy: text(doc['submittedBy']),
    message: text(doc['message'], 2_000),
  };
}

function parseSignature(raw: unknown): OrdinationSignature | null {
  const doc = record(raw);
  const image = typeof doc['image'] === 'string' ? doc['image'] : '';
  const uid = text(doc['uid'], 128);
  if (!uid || !image.startsWith('data:image/png;base64,')) return null;
  const signedOn = text(doc['signedOn'], 10);
  return { uid, name: text(doc['name']), image, signedOn: isCalendarDay(signedOn) ? signedOn : '' };
}

function parseReview(raw: unknown): OrdinationReview | null {
  if (raw === null || raw === undefined) return null;
  const doc = record(raw);
  const answers: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(doc['answers']))) {
    answers[key] = text(value, ORDINATION_ANSWER_MAX);
  }
  const decidedOn = text(doc['decidedOn'], 10);
  return {
    answers,
    note: text(doc['note'], 2_000),
    decidedByUid: text(doc['decidedByUid'], 128),
    decidedByName: text(doc['decidedByName']),
    decidedOn: isCalendarDay(decidedOn) ? decidedOn : '',
  };
}

export function parseOrdinationApplication(raw: unknown): OrdinationApplication {
  const doc = record(raw);
  const status = doc['status'];
  return {
    ...parseOrdinationDraft(doc),
    rank: isOrdinationRank(doc['rank']) ? doc['rank'] : 'reader',
    status: (ORDINATION_STATUSES as readonly unknown[]).includes(status)
      ? (status as OrdinationStatus)
      : 'pending',
    review: parseReview(doc['review']),
    signatures: (Array.isArray(doc['signatures']) ? doc['signatures'] : [])
      .map(parseSignature)
      .filter((signature): signature is OrdinationSignature => signature !== null)
      .slice(0, ORDINATION_MAX_SIGNATURES),
    submittedAt: (doc['submittedAt'] as Timestamped | undefined) ?? null,
    updatedAt: (doc['updatedAt'] as Timestamped | undefined) ?? null,
    updatedBy: typeof doc['updatedBy'] === 'string' ? doc['updatedBy'] : null,
  };
}

/**
 * Everything wrong with a draft, as sentences to show beside the form.
 *
 * Run by the page before sending, as a courtesy, and by the Function after, as
 * the decision — the same split `validateServantSignUp` makes.
 *
 * `ordinationDate` is passed so a minor is told to give a parent, and is not
 * asked to when the nominee is an adult on the day.
 */
export function validateOrdinationDraft(
  draft: OrdinationApplicationDraft,
  rank: OrdinationRank,
  ordinationDate: string,
): string[] {
  const errors: string[] = [];
  const nominee = draft.nominee;
  const info = ORDINATION_RANK_INFO[rank];

  if (!draft.ordinationId) errors.push('Choose the ordination this nomination is for.');
  if (!nominee.name) errors.push('Enter the nominee’s full name.');
  if (!nominee.address) errors.push('Enter the nominee’s address.');
  if (!nominee.dateOfBirth) errors.push('Enter the nominee’s date of birth.');
  if (!nominee.phone && !nominee.email) {
    errors.push('Enter a telephone number or an email address for the nominee.');
  }
  if (nominee.email && !looksLikeEmail(nominee.email)) {
    errors.push('The nominee’s email address does not look right.');
  }
  if (info.minor && !nominee.schoolGrade) errors.push('Enter the nominee’s school grade.');
  if (!info.minor && !nominee.occupation) {
    errors.push('Enter the nominee’s level of study or professional position.');
  }

  if (info.minor) {
    const age = ageOn(nominee.dateOfBirth, ordinationDate);
    const parent = draft.parents[0] ?? emptyOrdinationContact();
    if (age !== null && age < 18) {
      if (!parent.name) errors.push('Enter a parent’s name — the nominee is under 18.');
      if (!parent.phone && !parent.email) {
        errors.push('Enter a telephone number or an email address for the parent.');
      }
    }
    draft.parents.forEach((contact, index) => {
      if (contact.email && !looksLikeEmail(contact.email)) {
        errors.push(`Parent ${index + 1}’s email address does not look right.`);
      }
    });
  }

  return errors;
}

/**
 * What an approval needs before it can be saved: an answer to every question
 * and at least one priest's signature.
 */
export function validateOrdinationApproval(
  rank: OrdinationRank,
  answers: Record<string, string>,
  signatures: readonly OrdinationSignature[],
): string[] {
  const errors: string[] = [];
  for (const question of ORDINATION_QUESTIONS[rank]) {
    if (!(answers[question.key] ?? '').trim()) {
      errors.push(`Answer “${question.label}”`);
    }
  }
  if (signatures.length === 0) errors.push('A parish priest needs to sign before this is approved.');
  return errors;
}

/** The signature record the rules allow a priest to keep. */
export interface OrdinationSignatureProfile {
  name: string;
  /** A `data:image/png;base64,…` URL, or empty when none has been drawn. */
  image: string;
  updatedAt?: Timestamped | null;
}

export function parseOrdinationSignatureProfile(raw: unknown): OrdinationSignatureProfile {
  const doc = record(raw);
  const image = typeof doc['image'] === 'string' && doc['image'].startsWith('data:image/png;base64,')
    ? doc['image']
    : '';
  return {
    name: text(doc['name']),
    image,
    updatedAt: (doc['updatedAt'] as Timestamped | undefined) ?? null,
  };
}
