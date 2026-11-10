/**
 * Where everything goes on the diocese's ordination forms.
 *
 * ---------------------------------------------------------------------------
 * The forms are flat PDFs — no fillable fields — so filling one in means
 * drawing text over the blank lines at the right coordinates. These are those
 * coordinates, in PDF points from the bottom-left of a US Letter page.
 *
 * They were measured, not guessed: pdf.js reported where each run of
 * underscores starts and ends on each page, and every number here is that
 * line's start plus a few points of air, with the text baseline a little above
 * the rule. The three ranks share a cover page exactly and differ everywhere
 * else by a few points, because each was typeset separately.
 *
 * If the diocese sends a new revision, measure it again. A form whose lines
 * have moved by ten points prints every answer through the words beneath it,
 * and nothing in code can notice.
 *
 * Pure data and pure functions, so the website can draw it today with pdf-lib
 * and a Function can draw it later, when packets go to SharePoint.
 * ---------------------------------------------------------------------------
 */

import {
  ORDINATION_QUESTIONS,
  ORDINATION_RANK_INFO,
  formDay,
  ordinationRankLabel,
  type OrdinationApplication,
  type OrdinationRank,
} from '../schema/ordination.js';

/** One blank to write on: the baseline's left end, how wide it may run, and the type size. */
export interface PacketBlank {
  x: number;
  y: number;
  width: number;
  size: number;
}

export type NomineeField =
  | 'name'
  | 'address'
  | 'dateOfBirth'
  | 'schoolGrade'
  | 'occupation'
  | 'phone'
  | 'email'
  | 'parent1Name'
  | 'parent1Phone'
  | 'parent1Email'
  | 'parent2Name'
  | 'parent2Phone'
  | 'parent2Email';

export interface OrdinationPacketLayout {
  /** Page indexes in the rank's template PDF. */
  pages: { cover: number; signatures: number; nominee: number; guidelines: number };
  cover: {
    churchName: PacketBlank;
    churchAddress: PacketBlank;
    /** The twenty FULL NAME rows, top to bottom: the name blank, then the date of birth. */
    rows: { name: PacketBlank; dateOfBirth: PacketBlank }[];
  };
  /** The three PARISH PRIEST(S) SIGNATURE lines, top to bottom. */
  signatures: { signature: PacketBlank; date: PacketBlank }[];
  /**
   * The one PARISH DEACON/HEAD of DIACONATE MINISTRY SIGNATURE line below
   * them. Measured like the rest: "SIGNATURE" ends and the underscores start
   * at about 107.5, and DATE's underscores at about 410.8, on every rank.
   */
  deacon: { signature: PacketBlank; date: PacketBlank };
  nominee: {
    fields: Partial<Record<NomineeField, PacketBlank>>;
    /**
     * One answer line per question, in `ORDINATION_QUESTIONS[rank]` order.
     * There are about eighteen points between a line and the question above
     * it, which is room for two lines of small type and no more.
     */
    answers: PacketBlank[];
  };
}

/** Points between the rule and the baseline of the text written on it. */
const LIFT = 2.5;
/** The right-hand end every full-width line on these forms stops at, give or take a point. */
const RIGHT = 570;

/** A blank that starts where the underscores do and runs to `end`. */
function blank(underscoresStart: number, rule: number, size: number, end = RIGHT): PacketBlank {
  const x = underscoresStart + 3;
  return { x, y: rule + LIFT, width: end - x, size };
}

/** The twenty rows on the cover page, identical on all three ranks. */
const COVER_RULES = [
  524.4, 503.6, 482.9, 462.2, 441.6, 420.8, 400.1, 379.4, 358.7, 338.0,
  317.3, 296.7, 275.9, 255.3, 234.5, 213.9, 193.1, 172.5, 151.7, 131.0,
];

const COVER: OrdinationPacketLayout['cover'] = {
  churchName: blank(128.9, 639.9, 11),
  churchAddress: blank(173.4, 619.2, 11),
  rows: COVER_RULES.map((rule) => ({
    name: blank(107.6, rule, 11, 330),
    dateOfBirth: blank(421.2, rule, 11),
  })),
};

function signatureLines(rules: [number, number, number]): OrdinationPacketLayout['signatures'] {
  return rules.map((rule) => ({
    signature: blank(219.8, rule, 11, 416),
    date: blank(448.9, rule, 11),
  }));
}

function deaconLine(rule: number): OrdinationPacketLayout['deacon'] {
  return { signature: blank(107.5, rule, 11, 372), date: blank(410.8, rule, 11) };
}

function answerLines(rules: number[]): PacketBlank[] {
  return rules.map((rule) => ({ x: 38, y: rule + LIFT, width: 534, size: 10 }));
}

const PAGES = { cover: 0, signatures: 1, nominee: 2, guidelines: 3 };

export const ORDINATION_PACKET_LAYOUT: Record<OrdinationRank, OrdinationPacketLayout> = {
  cantor: {
    pages: PAGES,
    cover: COVER,
    signatures: signatureLines([192.7, 172.1, 151.3]),
    deacon: deaconLine(89.3),
    nominee: {
      fields: {
        name: blank(69.4, 633.1, 12),
        address: blank(81.8, 611.7, 12),
        dateOfBirth: blank(109.7, 590.4, 12),
        schoolGrade: blank(112.5, 569.0, 12),
        phone: blank(144.0, 547.6, 12),
        email: blank(117.3, 526.3, 12),
        parent1Name: blank(206.2, 483.6, 12),
        parent1Phone: blank(144.0, 462.2, 12),
        parent1Email: blank(115.7, 440.8, 12),
        parent2Name: blank(202.7, 398.1, 12),
        parent2Phone: blank(144.0, 376.6, 12),
        parent2Email: blank(119.1, 355.3, 12),
      },
      answers: answerLines([296.4, 241.5, 168.1, 113.3, 58.3]),
    },
  },
  reader: {
    pages: PAGES,
    cover: COVER,
    signatures: signatureLines([174.9, 154.2, 133.4]),
    deacon: deaconLine(71.4),
    nominee: {
      fields: {
        name: blank(69.4, 641.1, 12),
        address: blank(81.8, 619.7, 12),
        dateOfBirth: blank(109.8, 598.3, 12),
        schoolGrade: blank(112.5, 576.9, 12),
        phone: blank(145.5, 555.5, 12),
        email: blank(117.8, 534.2, 12),
        parent1Name: blank(206.2, 491.5, 12),
        parent1Phone: blank(144.9, 470.1, 12),
        parent1Email: blank(115.6, 448.8, 12),
        parent2Name: blank(202.7, 406.0, 12),
        parent2Phone: blank(144.5, 384.6, 12),
        parent2Email: blank(119.1, 363.3, 12),
      },
      answers: answerLines([304.4, 249.4, 176.2, 121.2, 66.2]),
    },
  },
  subdeacon: {
    pages: PAGES,
    cover: COVER,
    signatures: signatureLines([178.9, 158.3, 137.5]),
    deacon: deaconLine(75.5),
    nominee: {
      fields: {
        name: blank(69.4, 632.0, 12),
        address: blank(81.8, 606.3, 12),
        dateOfBirth: blank(109.8, 580.8, 12),
        occupation: blank(254.1, 555.1, 12),
        phone: blank(144.8, 529.4, 12),
        email: blank(117.8, 503.8, 12),
      },
      answers: answerLines([436.4, 363.1, 308.1, 253.3, 198.3, 143.3, 88.3]),
    },
  },
};

/** A rectangle to paint white, in the same points as a blank. */
export interface PacketMask {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One cover page for every rank at an ordination.
 *
 * The diocese prints a cover per rank, and each names its rank twice — in the
 * title ("Diaconate Rank of Reader (Anaghnostis)") and in the sentence above
 * the names ("…nominated for the ordination to the rank of Reader…"). The
 * parish sends one cover with everybody on it, so those two are painted over
 * and reworded, and each name carries its own rank instead.
 *
 * The reader's cover is the base: it and the subdeacon's are titled
 * "Application for Nomination" where the cantor's says "Recommendation", and
 * the three are otherwise identical. Measured with pdf.js like everything
 * above; the masks run a few points past the text on every side.
 */
export const ORDINATION_COMBINED_COVER = {
  template: 'reader' as OrdinationRank,
  /** "Diaconate Rank of …", 16pt on a 706.4 baseline. */
  title: {
    mask: { x: 140, y: 700, width: 332, height: 24 } satisfies PacketMask,
    baseline: 706.4,
    size: 16,
  },
  /** The two-line sentence, 12pt bold on 577.8 and 557.1. */
  sentence: {
    mask: { x: 34, y: 552, width: 544, height: 40 } satisfies PacketMask,
    baselines: [577.8, 557.1] as const,
    x: 36,
    width: 540,
    size: 12,
  },
} as const;

/** The cover's title once it names more than one rank. */
export function combinedCoverTitle(ranks: readonly OrdinationRank[]): string {
  if (ranks.length === 1) return `Diaconate Rank of ${ordinationRankLabel(ranks[0]!)}`;
  const titles = ranks.map((rank) => ORDINATION_RANK_INFO[rank].title);
  const list = titles.length === 2
    ? titles.join(' and ')
    : `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  return `Diaconate Ranks of ${list}`;
}

/** The cover's sentence, rank-neutral: the rank is beside each name. */
export const COMBINED_COVER_SENTENCE =
  'The following person(s) have been nominated for the ordination to the rank shown beside each name by ' +
  'the parish priest(s) and the head(s) of the diaconate ministry in the above parish.';

/** "Mina Guirguis (Reader)" — a cover row. */
export function coverRowName(application: Pick<OrdinationApplication, 'rank' | 'nominee'>): string {
  return `${application.nominee.name} (${ORDINATION_RANK_INFO[application.rank].title})`;
}

/**
 * What goes in each blank on one nominee's page, already formatted.
 *
 * Only the fields this rank's page has are returned, so a subdeacon's school
 * grade — which the form never asked for — has nowhere to be drawn.
 */
export function nomineeFieldValues(
  application: Pick<OrdinationApplication, 'rank' | 'nominee' | 'parents'>,
): Partial<Record<NomineeField, string>> {
  const { nominee, parents } = application;
  const [first, second] = parents;
  const all: Record<NomineeField, string> = {
    name: nominee.name,
    address: nominee.address,
    dateOfBirth: formDay(nominee.dateOfBirth),
    schoolGrade: nominee.schoolGrade,
    occupation: nominee.occupation,
    phone: nominee.phone,
    email: nominee.email,
    parent1Name: first?.name ?? '',
    parent1Phone: first?.phone ?? '',
    parent1Email: first?.email ?? '',
    parent2Name: second?.name ?? '',
    parent2Phone: second?.phone ?? '',
    parent2Email: second?.email ?? '',
  };
  const fields = ORDINATION_PACKET_LAYOUT[application.rank].nominee.fields;
  const values: Partial<Record<NomineeField, string>> = {};
  for (const key of Object.keys(fields) as NomineeField[]) {
    if (all[key]) values[key] = all[key];
  }
  return values;
}

/** The review's answers in the order this rank's page prints them, each paired with its line. */
export function nomineeAnswerLines(
  application: Pick<OrdinationApplication, 'rank' | 'review'>,
): { label: string; text: string; blank: PacketBlank }[] {
  const lines = ORDINATION_PACKET_LAYOUT[application.rank].nominee.answers;
  return ORDINATION_QUESTIONS[application.rank].map((question, index) => ({
    label: question.label,
    text: application.review?.answers[question.key]?.trim() ?? '',
    blank: lines[index]!,
  }));
}
