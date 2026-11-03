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
 *   1. An ordination admin opens an **ordination** — a date. One ordination
 *      takes all three ranks; the diocese still gets a packet per rank.
 *   2. A nominee, or a parent for a child, fills the nominee page in on
 *      /forms/ordination, choosing the date and the rank. That posts to the
 *      `ordinationApply` Function, which is the only writer of
 *      `ordinationApplications`.
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
 * One of the diocese's questions, and how the admin screen asks it.
 *
 * Every question is answered by picking one of `choices`, with an optional
 * line of detail. What is stored — and printed — is still a single line of
 * text: the choice, then the detail after a dash ("Yes — serves at the altar
 * on Sundays"). Keeping the stored shape a string is what lets a nomination
 * reviewed before the choices existed print and reopen unchanged.
 *
 * The father of confession is the one question whose detail is required and
 * goes first, because the question asks *who* before it asks whether: "Fr. Mina
 * — Approved".
 */
export interface OrdinationQuestion {
  key: string;
  label: string;
  choices: readonly string[];
  /** The detail box's placeholder. */
  detailHint: string;
  /** Required, and printed before the choice rather than after it. */
  detailFirst?: boolean;
}

const YES_NO = ['Yes', 'No'] as const;

const ATTENDANCE_FAMILY: OrdinationQuestion = {
  key: 'attendance',
  label: 'Is the nominee and his family a consistent and active attendee of this parish?',
  choices: YES_NO,
  detailHint: 'Anything to add (optional)',
};
const FATHER_OF_CONFESSION: OrdinationQuestion = {
  key: 'fatherOfConfession',
  label: 'Who is the nominee’s Father of Confession, and has he approved the nomination for ordination?',
  choices: ['Approved', 'Not yet approved'],
  detailHint: 'e.g. Fr. Mina',
  detailFirst: true,
};
const CONDUCT: OrdinationQuestion = {
  key: 'conduct',
  label: 'Does the nominee possess a reputation of good conduct, becoming of a servant in this parish?',
  choices: YES_NO,
  detailHint: 'Anything to add (optional)',
};
const INTERPERSONAL: OrdinationQuestion = {
  key: 'interpersonal',
  label: 'Does the nominee possess good interpersonal skills at church and in his secular life?',
  choices: YES_NO,
  detailHint: 'Anything to add (optional)',
};
const criteria = (rank: string): OrdinationQuestion => ({
  key: 'criteria',
  label: `Has the nominee met the requirement criteria for the rank of ${rank}?`,
  choices: YES_NO,
  detailHint: 'Anything to add (optional)',
});

/**
 * The questions on each rank's nominee page, in the order the page asks them.
 *
 * The keys are what `OrdinationReview.answers` is keyed by, and the order is
 * load-bearing: `ordination/packetLayout.ts` draws answer *n* on the *n*th line.
 * The subdeacon's page asks two more than the others and asks them in a
 * different order — criteria before father of confession — so each rank has
 * its own list rather than a shared one with extras appended.
 */
export const ORDINATION_QUESTIONS: Record<OrdinationRank, readonly OrdinationQuestion[]> = {
  cantor: [ATTENDANCE_FAMILY, FATHER_OF_CONFESSION, criteria('Cantor (Epsaltos)'), CONDUCT, INTERPERSONAL],
  reader: [ATTENDANCE_FAMILY, FATHER_OF_CONFESSION, criteria('Reader (Anaghnostis)'), CONDUCT, INTERPERSONAL],
  subdeacon: [
    { ...ATTENDANCE_FAMILY, label: 'Is the nominee a consistent and active attendee of this parish?' },
    criteria('Subdeacon (Epidiacon)'),
    FATHER_OF_CONFESSION,
    CONDUCT,
    {
      key: 'ministry',
      label: 'Does the nominee oversee or take part in a current ministry in this parish?',
      choices: YES_NO,
      detailHint: 'Which ministry (optional)',
    },
    {
      key: 'leadership',
      label: 'Does the nominee portray leadership and mentoring skills?',
      choices: YES_NO,
      detailHint: 'Anything to add (optional)',
    },
    INTERPERSONAL,
  ],
};

/** Between the choice and the detail in a stored answer. */
const ANSWER_SEPARATOR = ' — ';

/** A stored answer taken apart. `choice` is empty when none of the choices matches. */
export interface OrdinationAnswerParts {
  choice: string;
  detail: string;
}

/** The line stored and printed for a choice and its detail. */
export function composeOrdinationAnswer(question: OrdinationQuestion, parts: OrdinationAnswerParts): string {
  const choice = parts.choice.trim();
  const detail = parts.detail.trim();
  if (!choice) return detail;
  if (!detail) return choice;
  return question.detailFirst
    ? `${detail}${ANSWER_SEPARATOR}${choice}`
    : `${choice}${ANSWER_SEPARATOR}${detail}`;
}

/**
 * The reverse of `composeOrdinationAnswer`. An answer typed before there were
 * choices matches none of them and comes back whole as the detail, so nothing
 * anybody wrote is lost by reopening it.
 */
export function splitOrdinationAnswer(question: OrdinationQuestion, answer: string): OrdinationAnswerParts {
  const text = answer.trim();
  // Longest first, so "Not yet approved" is not read as "…approved".
  const choices = [...question.choices].sort((a, b) => b.length - a.length);
  for (const choice of choices) {
    if (text === choice) return { choice, detail: '' };
    if (question.detailFirst && text.endsWith(`${ANSWER_SEPARATOR}${choice}`)) {
      return { choice, detail: text.slice(0, -(ANSWER_SEPARATOR.length + choice.length)) };
    }
    if (!question.detailFirst && text.startsWith(`${choice}${ANSWER_SEPARATOR}`)) {
      return { choice, detail: text.slice(choice.length + ANSWER_SEPARATOR.length) };
    }
  }
  return { choice: '', detail: text };
}

/**
 * The cover page has twenty rows and no continuation sheet, so an ordination
 * can approve twenty of each rank and no more. The admin screen refuses the
 * twenty-first.
 */
export const ORDINATION_MAX_NOMINEES = 20;

/** The diocese's form has three lines for parish priests. */
export const ORDINATION_MAX_SIGNATURES = 3;

/* -------------------------------------------------------------------------- */
/* Ordinations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One ordination day. It has no rank: each nomination carries its own, and the
 * admin screen prints one diocese packet per rank from the nominations for it.
 */
export interface Ordination {
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
    date: isCalendarDay(date) ? date : '',
    open: doc['open'] === true,
    churchName: text(doc['churchName']),
    churchAddress: text(doc['churchAddress']),
    createdAt: (doc['createdAt'] as Timestamped | undefined) ?? null,
    updatedAt: (doc['updatedAt'] as Timestamped | undefined) ?? null,
    updatedBy: typeof doc['updatedBy'] === 'string' ? doc['updatedBy'] : null,
  };
}

/** "Ordination on 6 December 2026" */
export function ordinationTitle(ordination: Pick<Ordination, 'date'>): string {
  return `Ordination on ${longDay(ordination.date)}`;
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
  /** The rank the nominee is put forward for. Empty until the sender chooses. */
  rank: OrdinationRank | '';
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
  /** Always one of the three once filed; the Function refuses a draft without one. */
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

export function emptyOrdinationDraft(
  ordinationId = '',
  rank: OrdinationRank | '' = '',
): OrdinationApplicationDraft {
  return {
    ordinationId,
    rank,
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
    rank: isOrdinationRank(doc['rank']) ? doc['rank'] : '',
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
  ordinationDate: string,
): string[] {
  const errors: string[] = [];
  const nominee = draft.nominee;

  if (!draft.ordinationId) errors.push('Choose the ordination this nomination is for.');
  if (!draft.rank) {
    // Which fields the page has follows the rank, so nothing past here applies.
    errors.push('Choose the rank the nominee is put forward for.');
    return errors;
  }
  const info = ORDINATION_RANK_INFO[draft.rank];
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
 * What an approval needs before it can be saved: a choice for every question,
 * the father of confession's name, and at least one priest's signature.
 */
export function validateOrdinationApproval(
  rank: OrdinationRank,
  answers: Record<string, string>,
  signatures: readonly OrdinationSignature[],
): string[] {
  const errors: string[] = [];
  for (const question of ORDINATION_QUESTIONS[rank]) {
    const parts = splitOrdinationAnswer(question, answers[question.key] ?? '');
    if (!parts.choice) {
      errors.push(`Answer “${question.label}”`);
    } else if (question.detailFirst && !parts.detail) {
      errors.push(`Name the father of confession in “${question.label}”`);
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
