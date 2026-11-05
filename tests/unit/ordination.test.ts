import { describe, expect, it } from 'vitest';
import {
  ORDINATION_PACKET_LAYOUT,
  ORDINATION_QUESTIONS,
  ORDINATION_RANKS,
  ageOn,
  combinedCoverTitle,
  coverRowName,
  composeOrdinationAnswer,
  emptyOrdinationDraft,
  formDay,
  isCalendarDay,
  nomineeAnswerLines,
  nomineeFieldValues,
  ordinationAccepting,
  parseOrdination,
  parseOrdinationApplication,
  parseOrdinationDraft,
  splitOrdinationAnswer,
  validateOrdinationApproval,
  validateOrdinationDraft,
  type OrdinationApplicationDraft,
} from '@spsm/shared';

function draft(
  over: Partial<OrdinationApplicationDraft['nominee']> = {},
  rank: OrdinationApplicationDraft['rank'] = 'reader',
): OrdinationApplicationDraft {
  const base = emptyOrdinationDraft('ord-1', rank);
  return {
    ...base,
    nominee: {
      ...base.nominee,
      name: 'Mark Example',
      address: '1 Main St, Wayland, MA',
      dateOfBirth: '2010-05-01',
      schoolGrade: '10th',
      phone: '555-0100',
      ...over,
    },
    parents: [{ name: 'George', phone: '555-0101', email: '' }, { name: '', phone: '', email: '' }],
  };
}

describe('dates', () => {
  it('knows a real day from the right shape', () => {
    expect(isCalendarDay('2026-12-06')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('12/06/2026')).toBe(false);
  });

  it('counts completed years, the way the requirements do', () => {
    expect(ageOn('2010-12-06', '2026-12-06')).toBe(16);
    expect(ageOn('2010-12-07', '2026-12-06')).toBe(15);
    expect(ageOn('', '2026-12-06')).toBeNull();
  });

  it('prints a day the way a US form is filled in', () => {
    expect(formDay('2026-04-03')).toBe('04/03/2026');
  });
});

describe('validateOrdinationDraft', () => {
  it('accepts a complete reader nomination', () => {
    expect(validateOrdinationDraft(draft(), '2026-12-06')).toEqual([]);
  });

  it('asks for the rank, since one ordination takes all three', () => {
    expect(validateOrdinationDraft(draft({}, ''), '2026-12-06')).toEqual([
      'Choose the rank the nominee is put forward for.',
    ]);
  });

  it('asks a minor for a parent', () => {
    const value = draft();
    value.parents = [{ name: '', phone: '', email: '' }, { name: '', phone: '', email: '' }];
    const errors = validateOrdinationDraft(value, '2026-12-06');
    expect(errors.some((error) => error.includes('parent’s name'))).toBe(true);
  });

  it('does not ask an adult reader for a parent', () => {
    const value = draft({ dateOfBirth: '2000-01-01' });
    value.parents = [{ name: '', phone: '', email: '' }, { name: '', phone: '', email: '' }];
    expect(validateOrdinationDraft(value, '2026-12-06')).toEqual([]);
  });

  it('asks a subdeacon for study or profession rather than a grade', () => {
    const errors = validateOrdinationDraft(draft({ dateOfBirth: '1995-01-01' }, 'subdeacon'), '2026-12-06');
    expect(errors).toEqual(['Enter the nominee’s level of study or professional position.']);
  });

  it('never refuses an under-age nominee — that is the priest’s call', () => {
    expect(validateOrdinationDraft(draft({ dateOfBirth: '2020-01-01' }, 'cantor'), '2026-12-06')).toEqual([]);
  });
});

describe('parsing', () => {
  it('drops a review, a status and signatures smuggled into a public draft', () => {
    const parsed = parseOrdinationDraft({
      ...draft(),
      status: 'approved',
      review: { answers: { attendance: 'yes' } },
      signatures: [{ uid: 'x', image: 'data:image/png;base64,AAAA' }],
    });
    expect(parsed).not.toHaveProperty('status');
    expect(parsed).not.toHaveProperty('review');
    expect(parsed).not.toHaveProperty('signatures');
  });

  it('keeps a real rank from the sender and drops a made-up one', () => {
    expect(parseOrdinationDraft({ ...draft(), rank: 'subdeacon' }).rank).toBe('subdeacon');
    expect(parseOrdinationDraft({ ...draft(), rank: 'deacon' }).rank).toBe('');
  });

  it('keeps no more than three signatures, and only PNG ones', () => {
    const signature = { uid: 'a', name: 'A', image: 'data:image/png;base64,AAAA', signedOn: '2026-11-02' };
    const parsed = parseOrdinationApplication({
      ...draft(),
      signatures: [signature, { ...signature, image: 'javascript:alert(1)' }, signature, signature, signature],
    });
    expect(parsed.signatures).toHaveLength(3);
    expect(parsed.signatures.every((s) => s.image.startsWith('data:image/png'))).toBe(true);
  });
});

describe('approval', () => {
  const signature = { uid: 'a', name: 'A', image: 'data:image/png;base64,AAAA', signedOn: '2026-11-02' };
  const answered = () =>
    Object.fromEntries(
      ORDINATION_QUESTIONS.reader.map((q) => [
        q.key,
        composeOrdinationAnswer(q, { choice: q.choices[0]!, detail: q.detailFirst ? 'Fr. Mina' : '' }),
      ]),
    );

  it('needs a choice for every question and a signature', () => {
    expect(validateOrdinationApproval('reader', {}, [])).toHaveLength(ORDINATION_QUESTIONS.reader.length + 1);
    expect(validateOrdinationApproval('reader', answered(), [signature])).toEqual([]);
  });

  it('needs the father of confession named, not only approved', () => {
    const answers = { ...answered(), fatherOfConfession: 'Approved' };
    expect(validateOrdinationApproval('reader', answers, [signature])).toHaveLength(1);
  });

  it('does not count an answer typed before there were choices', () => {
    const answers = { ...answered(), conduct: 'He is well regarded' };
    expect(validateOrdinationApproval('reader', answers, [signature])).toHaveLength(1);
  });
});

describe('answers', () => {
  const conduct = ORDINATION_QUESTIONS.reader.find((q) => q.key === 'conduct')!;
  const confession = ORDINATION_QUESTIONS.reader.find((q) => q.key === 'fatherOfConfession')!;

  it('prints the choice, then any detail', () => {
    expect(composeOrdinationAnswer(conduct, { choice: 'Yes', detail: '' })).toBe('Yes');
    expect(composeOrdinationAnswer(conduct, { choice: 'Yes', detail: 'Serves on Sundays' })).toBe('Yes — Serves on Sundays');
  });

  it('prints the father of confession before whether he approved', () => {
    expect(composeOrdinationAnswer(confession, { choice: 'Approved', detail: 'Fr. Mina' })).toBe('Fr. Mina — Approved');
  });

  it('takes apart what it put together', () => {
    for (const [question, parts] of [
      [conduct, { choice: 'No', detail: 'Spoke to his family' }],
      [conduct, { choice: 'Yes', detail: '' }],
      [confession, { choice: 'Not yet approved', detail: 'Fr. Mina' }],
      [confession, { choice: 'Approved', detail: 'Fr. Mina' }],
    ] as const) {
      expect(splitOrdinationAnswer(question, composeOrdinationAnswer(question, parts))).toEqual(parts);
    }
  });

  it('keeps an old free-text answer whole, as the detail', () => {
    expect(splitOrdinationAnswer(conduct, 'He is well regarded')).toEqual({ choice: '', detail: 'He is well regarded' });
  });
});

describe('packet layout', () => {
  it('has one answer line per question on every rank', () => {
    for (const rank of ORDINATION_RANKS) {
      expect(ORDINATION_PACKET_LAYOUT[rank].nominee.answers).toHaveLength(ORDINATION_QUESTIONS[rank].length);
    }
  });

  it('has twenty cover rows and three priest lines', () => {
    for (const rank of ORDINATION_RANKS) {
      expect(ORDINATION_PACKET_LAYOUT[rank].cover.rows).toHaveLength(20);
      expect(ORDINATION_PACKET_LAYOUT[rank].signatures).toHaveLength(3);
    }
  });

  it('keeps every blank on the page', () => {
    for (const rank of ORDINATION_RANKS) {
      const layout = ORDINATION_PACKET_LAYOUT[rank];
      const blanks = [
        layout.cover.churchName,
        layout.cover.churchAddress,
        ...layout.cover.rows.flatMap((row) => [row.name, row.dateOfBirth]),
        ...layout.signatures.flatMap((line) => [line.signature, line.date]),
        ...Object.values(layout.nominee.fields),
        ...layout.nominee.answers,
      ];
      for (const blank of blanks) {
        expect(blank!.x).toBeGreaterThan(30);
        expect(blank!.x + blank!.width).toBeLessThanOrEqual(580);
        expect(blank!.y).toBeGreaterThan(40);
        expect(blank!.y).toBeLessThan(760);
      }
    }
  });

  it('fills only the fields a rank’s page has', () => {
    const application = { ...draft(), rank: 'subdeacon' as const, review: null };
    application.nominee.occupation = 'Engineer';
    const values = nomineeFieldValues(application);
    expect(values.occupation).toBe('Engineer');
    expect(values).not.toHaveProperty('schoolGrade');
    expect(values).not.toHaveProperty('parent1Name');
    expect(values.dateOfBirth).toBe('05/01/2010');
  });

  it('pairs the subdeacon’s answers with its own question order', () => {
    const lines = nomineeAnswerLines({
      rank: 'subdeacon',
      review: {
        answers: { criteria: 'Met', fatherOfConfession: 'Fr. Mina' },
        note: '', decidedByUid: '', decidedByName: '', decidedOn: '',
      },
    });
    // Criteria is asked second on the subdeacon's page, before the father of confession.
    expect(lines[1]!.text).toBe('Met');
    expect(lines[2]!.text).toBe('Fr. Mina');
    expect(lines[1]!.blank.y).toBeGreaterThan(lines[2]!.blank.y);
  });
});

describe('combined cover', () => {
  it('names every rank on the application in the title', () => {
    expect(combinedCoverTitle(['cantor', 'reader', 'subdeacon'])).toBe('Diaconate Ranks of Cantor, Reader and Subdeacon');
    expect(combinedCoverTitle(['cantor', 'subdeacon'])).toBe('Diaconate Ranks of Cantor and Subdeacon');
  });

  it('keeps the diocese’s own title when there is only one rank', () => {
    expect(combinedCoverTitle(['reader'])).toBe('Diaconate Rank of Reader (Anaghnostis)');
  });

  it('puts the rank beside each name', () => {
    const application = { ...draft(), rank: 'subdeacon' as const };
    application.nominee.name = 'Mina Guirguis';
    expect(coverRowName(application)).toBe('Mina Guirguis (Subdeacon)');
  });
});

describe('ordinationAccepting', () => {
  const open = { open: true, closesOn: '2026-11-20' };

  it('takes nominations through the last day, and not after', () => {
    expect(ordinationAccepting(open, '2026-11-19')).toBe(true);
    expect(ordinationAccepting(open, '2026-11-20')).toBe(true);
    expect(ordinationAccepting(open, '2026-11-21')).toBe(false);
  });

  it('closes by hand whatever the date, and has no end without one', () => {
    expect(ordinationAccepting({ ...open, open: false }, '2026-11-01')).toBe(false);
    expect(ordinationAccepting({ open: true, closesOn: '' }, '2099-01-01')).toBe(true);
  });

  it('reads a missing or malformed close date as none', () => {
    expect(parseOrdination({ date: '2026-12-06', open: true }).closesOn).toBe('');
    expect(parseOrdination({ date: '2026-12-06', open: true, closesOn: '2026-02-30' }).closesOn).toBe('');
    expect(parseOrdination({ date: '2026-12-06', open: true, closesOn: '2026-11-20' }).closesOn).toBe('2026-11-20');
  });
});
