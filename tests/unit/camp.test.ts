import { describe, expect, it } from 'vitest';
import {
  campAge,
  CAMP_PAYMENT_METHODS,
  MAX_CHILDREN,
  campAllDayKeys,
  campSectionForGrade,
  campWeekKeys,
  describeCampDays,
  acceptedServantRegistration,
  blankChild,
  blankRegistration,
  blankServant,
  blankServantSignUp,
  campBill,
  campPaymentMethodLabel,
  campWeeksAttended,
  readCampPaymentMethod,
  parseCampConfig,
  parseCampRegistration,
  shirtCounts,
  sortRegistrations,
  validateCampDraft,
  validateCampRegistration,
  validateServantSignUp,
  type CampChild,
  type CampRegistrationDraft,
  type CampServantRequest,
} from '@spsm/shared';

/**
 * The two things about a camp registration that must not be got wrong: what a
 * family owes, and what is missing before the camp can rely on the record.
 *
 * Both are read by more than one screen — the drawer prints them, and the
 * rosters and shirt orders that come next will read the same functions — so
 * getting them right once here is what stops three implementations disagreeing
 * about whether the Guirguis family has paid.
 */

/**
 * `weeksEach` gives every child that many weeks of attendance.
 *
 * The fee is per child **per week**, so a fixture with no days is a fixture
 * that costs nothing — which is right, and is exactly the trap the old
 * per-child tests would have fallen into silently.
 */
function family(children: number, baseCents: number, weeksEach = 1): CampRegistrationDraft {
  const draft = blankRegistration({
    programId: 'summercamp',
    season: '2027',
    kind: 'family',
    baseCents,
    takenByUid: 'admin-1',
  });
  draft.children = Array.from({ length: children }, () => ({
    ...blankChild(),
    days: Array.from({ length: weeksEach }, (_unused, week) => campWeekKeys(week + 1)).flat(),
  }));
  return draft;
}

describe('campBill', () => {
  it('bills per child, per week', () => {
    const bill = campBill(family(3, 150_00));
    expect(bill.billableWeeks).toBe(3);
    expect(bill.subtotalCents).toBe(450_00);
    expect(bill.dueCents).toBe(450_00);
    expect(bill.balanceCents).toBe(450_00);
    expect(bill.paid).toBe(false);
  });

  /**
   * The decision this whole file was rewritten for: a child doing both weeks is
   * two weeks of camp and is charged for two.
   */
  it('charges a child twice for two weeks', () => {
    const one = campBill(family(1, 175_00, 1));
    const two = campBill(family(1, 175_00, 2));
    expect(one.subtotalCents).toBe(175_00);
    expect(two.subtotalCents).toBe(350_00);
    expect(two.billableWeeks).toBe(2);
  });

  it('itemises a line per child, so a bill can be read aloud', () => {
    const draft = family(2, 100_00, 1);
    (draft.children[0] as CampChild).firstName = 'Mariam';
    (draft.children[0] as CampChild).lastName = 'Guirguis';
    (draft.children[1] as CampChild).firstName = 'Antony';
    (draft.children[1] as CampChild).lastName = 'Guirguis';
    // Antony comes for both weeks; Mariam only for the first.
    (draft.children[1] as CampChild).days = [...campWeekKeys(1), ...campWeekKeys(2)];

    const bill = campBill(draft);
    expect(bill.lines).toEqual([
      { childId: draft.children[0]!.id, name: 'Mariam Guirguis', weeks: 1, cents: 100_00 },
      { childId: draft.children[1]!.id, name: 'Antony Guirguis', weeks: 2, cents: 200_00 },
    ]);
    expect(bill.subtotalCents).toBe(300_00);
  });

  /**
   * A part-week is a whole week's fee. The fee buys a place for the week — the
   * staffing, the room and the materials are the same whether a child comes
   * three days or five.
   */
  it('charges a full week for a partial one', () => {
    const draft = family(1, 175_00, 0);
    (draft.children[0] as CampChild).days = ['w1-mon', 'w1-wed'];
    expect(campBill(draft).subtotalCents).toBe(175_00);
  });

  /**
   * A registration saved before attendance existed has no days and prices at
   * zero. Guessing one week per child would put a figure nobody chose onto a
   * real family's balance.
   */
  it('charges nothing for a child with no days chosen', () => {
    const bill = campBill(family(2, 175_00, 0));
    expect(bill.subtotalCents).toBe(0);
    expect(bill.lines.every((line) => line.weeks === 0)).toBe(true);
  });

  it('bills a servant for nothing, and calls them paid', () => {
    const servant = blankRegistration({
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      baseCents: 150_00,
      takenByUid: null,
    });
    const bill = campBill(servant);
    expect(bill.billableWeeks).toBe(0);
    expect(bill.lines).toEqual([]);
    expect(bill.dueCents).toBe(0);
    // The point of this one: a servant must not sit in the "owes money" list
    // forever because a fee was copied onto their document.
    expect(bill.paid).toBe(true);
  });

  it('takes a flat amount off the subtotal', () => {
    const draft = family(2, 100_00);
    draft.billing.discounts = [
      { id: 'd1', kind: 'amount', value: 25_00, reason: 'Sibling', childId: null, appliedByUid: null, appliedAt: null },
    ];
    const bill = campBill(draft);
    expect(bill.discountCents).toBe(25_00);
    expect(bill.dueCents).toBe(175_00);
  });

  /**
   * The decision this file exists to pin.
   *
   * Two 50% discounts come to 100% off, not 75%. The compounding reading would
   * make the order an administrator happened to type the lines in change what
   * the family owes, and nobody at a registration desk will ever guess that.
   */
  it('takes every percentage off the subtotal rather than compounding', () => {
    const draft = family(2, 100_00);
    draft.billing.discounts = [
      { id: 'd1', kind: 'percent', value: 50, reason: 'Scholarship', childId: null, appliedByUid: null, appliedAt: null },
      { id: 'd2', kind: 'percent', value: 50, reason: 'Servant child', childId: null, appliedByUid: null, appliedAt: null },
    ];
    const bill = campBill(draft);
    expect(bill.discountCents).toBe(200_00);
    expect(bill.dueCents).toBe(0);
  });

  it('never lets discounts push the total below zero', () => {
    const draft = family(1, 50_00);
    draft.billing.discounts = [
      { id: 'd1', kind: 'amount', value: 400_00, reason: 'Typo', childId: null, appliedByUid: null, appliedAt: null },
    ];
    const bill = campBill(draft);
    expect(bill.discountCents).toBe(50_00);
    expect(bill.dueCents).toBe(0);
    expect(bill.balanceCents).toBe(0);
  });

  it('sums payments, and reports an overpayment as a negative balance', () => {
    const draft = family(1, 100_00);
    draft.billing.payments = [
      { id: 'p1', amountCents: 60_00, method: 'check', reference: '1041', receivedOn: '2027-05-01', note: '', recordedByUid: null, recordedAt: null },
      { id: 'p2', amountCents: 60_00, method: 'cash', reference: '', receivedOn: '2027-05-08', note: '', recordedByUid: null, recordedAt: null },
    ];
    const bill = campBill(draft);
    expect(bill.paidCents).toBe(120_00);
    expect(bill.balanceCents).toBe(-20_00);
    expect(bill.paid).toBe(true);
  });

  it('treats a refund as a negative payment rather than a deletion', () => {
    const draft = family(1, 100_00);
    draft.billing.payments = [
      { id: 'p1', amountCents: 100_00, method: 'check', reference: '', receivedOn: '2027-05-01', note: '', recordedByUid: null, recordedAt: null },
      { id: 'p2', amountCents: -100_00, method: 'check', reference: 'refunded', receivedOn: '2027-06-01', note: '', recordedByUid: null, recordedAt: null },
    ];
    const bill = campBill(draft);
    expect(bill.paidCents).toBe(0);
    expect(bill.balanceCents).toBe(100_00);
    expect(bill.paid).toBe(false);
  });
});

describe('payment methods', () => {
  it('offers Square, and not a second option that also means a card', () => {
    expect(CAMP_PAYMENT_METHODS).toEqual(['cash', 'check', 'zelle', 'square', 'other']);
    expect(campPaymentMethodLabel('square')).toBe('Square');
  });

  /**
   * `card` was in the list before `square` replaced it. A stored one must not
   * become `other` — that would turn a card payment into an unexplained one in
   * the only field that says how the money came in, and the parish's sole card
   * processor is Square.
   */
  it('reads the retired `card` value as Square', () => {
    expect(readCampPaymentMethod('card')).toBe('square');

    const parsed = parseCampRegistration({
      billing: { baseCents: 0, payments: [{ id: 'p1', amountCents: 5000, method: 'card' }] },
    });
    expect(parsed.billing.payments[0]?.method).toBe('square');
  });

  it('falls back to `other` for anything it does not know', () => {
    expect(readCampPaymentMethod('bitcoin')).toBe('other');
    expect(readCampPaymentMethod(undefined)).toBe('other');
  });
});

describe('campWeeksAttended', () => {
  it('counts a week once however many of its days are chosen', () => {
    expect(campWeeksAttended([])).toBe(0);
    expect(campWeeksAttended(['w1-mon'])).toBe(1);
    expect(campWeeksAttended(campWeekKeys(1))).toBe(1);
    expect(campWeeksAttended([...campWeekKeys(1), 'w2-fri'])).toBe(2);
  });

  /**
   * A week the camp no longer runs still counts. `dayList` keeps those days on
   * purpose, and a week somebody was registered and charged for does not stop
   * being one because a setting changed.
   */
  it('counts a week the camp no longer runs', () => {
    expect(campWeeksAttended(['w1-mon', 'w3-tue'])).toBe(2);
  });

  it('ignores anything that is not a day key', () => {
    expect(campWeeksAttended(['saturday', 'w1-mon'])).toBe(1);
  });
});

describe('validation', () => {
  it('lets a draft save with only a name', () => {
    const draft = family(1, 100_00);
    draft.contact.name = 'Mina Guirguis';
    expect(validateCampDraft(draft)).toEqual([]);
    // …while the full check still knows what is missing.
    expect(validateCampRegistration(draft).length).toBeGreaterThan(0);
  });

  it('refuses to save without a name', () => {
    expect(validateCampDraft(family(1, 0))).not.toEqual([]);
  });

  it('requires a contact, an emergency contact, named children and a waiver', () => {
    const draft = family(1, 100_00);
    draft.contact.name = 'Mina Guirguis';
    const problems = validateCampRegistration(draft);
    expect(problems.some((p) => p.includes('phone number or an email'))).toBe(true);
    expect(problems.some((p) => p.includes('emergency contact'))).toBe(true);
    expect(problems.some((p) => p.includes('first and last name'))).toBe(true);
    expect(problems.some((p) => p.includes('waiver'))).toBe(true);
  });

  it('passes a complete family registration', () => {
    const draft = family(1, 100_00);
    draft.contact.name = 'Mina Guirguis';
    draft.contact.phone = '555-0100';
    draft.emergency = { name: 'Sara Guirguis', phone: '555-0101', relationship: 'Aunt' };
    const child = draft.children[0] as CampChild;
    child.firstName = 'Mariam';
    child.lastName = 'Guirguis';
    child.days = campWeekKeys(1);
    draft.waiver = {
      version: '2027-1',
      agreed: true,
      signedName: 'Mina Guirguis',
      signedRelationship: 'Parent',
      signedAt: null,
      signedByUid: 'admin-1',
    };
    expect(validateCampRegistration(draft)).toEqual([]);
  });

  it('wants a servant to name a section and a role', () => {
    const draft = blankRegistration({
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      baseCents: 0,
      takenByUid: null,
    });
    draft.contact.name = 'Peter Awadalla';
    draft.contact.email = 'peter@example.org';
    draft.emergency = { name: 'Mona', phone: '555-0102', relationship: 'Mother' };
    draft.waiver = {
      version: '2027-1',
      agreed: true,
      signedName: 'Peter Awadalla',
      signedRelationship: 'Self',
      signedAt: null,
      signedByUid: null,
    };
    const problems = validateCampRegistration(draft);
    expect(problems.some((p) => p.includes('which group'))).toBe(true);
    expect(problems.some((p) => p.includes('role'))).toBe(true);

    // A role without a group is still incomplete: the camp runs two sections
    // and "Sports" does not say which one.
    draft.servant = { ...draft.servant!, desiredRoles: ['Sports'] };
    expect(validateCampRegistration(draft).some((p) => p.includes('which group'))).toBe(true);

    draft.servant = { ...draft.servant, sections: ['middle-school'] };
    expect(validateCampRegistration(draft).some((p) => p.includes('days'))).toBe(true);

    draft.servant = { ...draft.servant, days: campWeekKeys(2) };
    expect(validateCampRegistration(draft)).toEqual([]);
  });

  /**
   * The deadlock this argument exists to prevent.
   *
   * `config/camp` did not exist in production, so there was no waiver text, so
   * the consent control was disabled — and this function demanded a signature
   * anyway. Every registration was stuck in `draft` forever. See
   * `CampValidationContext`.
   */
  it('does not demand a waiver the parish has not written', () => {
    const draft = family(1, 100_00);
    draft.contact.name = 'Mina Guirguis';
    draft.contact.phone = '555-0100';
    draft.emergency = { name: 'Sara Guirguis', phone: '555-0101', relationship: 'Aunt' };
    const child = draft.children[0] as CampChild;
    child.firstName = 'Mariam';
    child.lastName = 'Guirguis';
    child.days = campWeekKeys(1);

    expect(validateCampRegistration(draft, { waiverInForce: false })).toEqual([]);

    // …and demands it again the moment there is one, including by default, so a
    // caller that forgets the context gets the stricter answer.
    expect(validateCampRegistration(draft, { waiverInForce: true })).toEqual([
      'The waiver has not been signed.',
    ]);
    expect(validateCampRegistration(draft)).toEqual(['The waiver has not been signed.']);
  });
});

describe('attendance days', () => {
  it('enumerates Monday to Friday for every week', () => {
    expect(campWeekKeys(1)).toEqual(['w1-mon', 'w1-tue', 'w1-wed', 'w1-thu', 'w1-fri']);
    expect(campAllDayKeys(2)).toHaveLength(10);
    expect(campAllDayKeys(2)[9]).toBe('w2-fri');
  });

  it('clamps a nonsense week count rather than rendering four hundred toggles', () => {
    expect(campAllDayKeys(0)).toHaveLength(10);
    expect(campAllDayKeys(99)).toHaveLength(30);
  });

  /**
   * Sorted and deduped on read, so two registrations covering the same days are
   * the same array — which is what lets a later roster compare them without
   * normalising first.
   */
  it('drops malformed keys and sorts what is left by week then weekday', () => {
    const parsed = parseCampRegistration({
      kind: 'family',
      children: [
        { id: 'c1', days: ['w2-wed', 'saturday', 'w1-fri', 'w1-mon', 'w2-wed', 42] },
      ],
    });
    expect(parsed.children[0]?.days).toEqual(['w1-mon', 'w1-fri', 'w2-wed']);
  });

  /**
   * Lowering the camp's week count must not delete days somebody is already
   * registered for — that would be a setting silently destroying a real answer.
   */
  it('keeps a stored day from a week the camp no longer runs', () => {
    const parsed = parseCampRegistration({
      kind: 'family',
      children: [{ id: 'c1', days: ['w3-mon'] }],
    });
    expect(parsed.children[0]?.days).toEqual(['w3-mon']);
  });

  it('describes a selection the way a camp says it', () => {
    expect(describeCampDays([], 2)).toBe('No days chosen');
    expect(describeCampDays(campAllDayKeys(2), 2)).toBe('Every day');
    expect(describeCampDays(campWeekKeys(1), 2)).toBe('Week 1');
    expect(describeCampDays(['w1-mon', 'w1-wed'], 2)).toBe('Week 1 (Mon, Wed)');
    expect(describeCampDays([...campWeekKeys(1), 'w2-fri'], 2)).toBe('Week 1 · Week 2 (Fri)');
  });
});

describe('camp sections', () => {
  it('puts kindergarten through grade 5 in elementary and 6 to 8 in middle school', () => {
    expect(campSectionForGrade('k')).toBe('elementary');
    expect(campSectionForGrade('5')).toBe('elementary');
    expect(campSectionForGrade('6')).toBe('middle-school');
    expect(campSectionForGrade('8')).toBe('middle-school');
  });

  /**
   * Not a guess. The camp runs two sections and a high-schooler is in neither —
   * rounding them into middle school would put a fifteen-year-old on an
   * eighth-grade roster.
   */
  it('gives no section to a grade the camp does not run', () => {
    expect(campSectionForGrade('9')).toBeNull();
    expect(campSectionForGrade('12')).toBeNull();
  });

  it('keeps only known sections, deduped and in a stable order', () => {
    const parsed = parseCampRegistration({
      kind: 'servant',
      servant: { sections: ['middle-school', 'high-school', 'elementary', 'middle-school'] },
    });
    expect(parsed.servant?.sections).toEqual(['elementary', 'middle-school']);
  });

  it('defaults a servant to no section rather than to one of them', () => {
    expect(parseCampRegistration({ kind: 'servant', servant: {} }).servant?.sections).toEqual([]);
  });
});

describe('parseCampRegistration', () => {
  it('reads an empty document into something usable', () => {
    const parsed = parseCampRegistration({});
    expect(parsed.kind).toBe('family');
    expect(parsed.status).toBe('draft');
    expect(parsed.children).toEqual([]);
    expect(parsed.billing.baseCents).toBe(0);
  });

  /**
   * Dropping a child from a camp roster is the worst failure this file has, so
   * a child with a missing id is repaired rather than discarded — unlike a form
   * field with no key, which is genuinely unrecoverable.
   */
  it('gives a child with no id a new one rather than dropping them', () => {
    const parsed = parseCampRegistration({
      kind: 'family',
      children: [{ firstName: 'Mariam', lastName: 'Guirguis', grade: '4' }],
    });
    expect(parsed.children).toHaveLength(1);
    expect(parsed.children[0]?.id).toBeTruthy();
    expect(parsed.children[0]?.grade).toBe('4');
  });

  it('falls back on an unknown grade or shirt size rather than storing it', () => {
    const parsed = parseCampRegistration({
      kind: 'family',
      children: [{ id: 'c1', grade: 'freshman', shirtSize: 'Large' }],
    });
    expect(parsed.children[0]?.grade).toBe('1');
    expect(parsed.children[0]?.shirtSize).toBe('YM');
  });

  it('caps the children at the bound the rules also enforce', () => {
    const parsed = parseCampRegistration({
      kind: 'family',
      children: Array.from({ length: MAX_CHILDREN + 5 }, (_, index) => ({ id: `c${index}` })),
    });
    expect(parsed.children).toHaveLength(MAX_CHILDREN);
  });

  it('drops the servant block on a family and the children on a servant', () => {
    expect(parseCampRegistration({ kind: 'servant', children: [{ id: 'c1' }] }).children).toEqual([]);
    expect(parseCampRegistration({ kind: 'family', servant: { uid: 'x' } }).servant).toBeNull();
  });

  it('keeps a refund negative while clamping a fee positive', () => {
    const parsed = parseCampRegistration({
      billing: {
        baseCents: -500,
        payments: [{ id: 'p1', amountCents: -2500 }],
      },
    });
    expect(parsed.billing.baseCents).toBe(0);
    expect(parsed.billing.payments[0]?.amountCents).toBe(-2500);
  });

  it('defaults photo consent to withheld', () => {
    const parsed = parseCampRegistration({ kind: 'family', children: [{ id: 'c1' }] });
    expect(parsed.children[0]?.photoConsent).toBe(false);
  });
});

describe('parseCampConfig', () => {
  const now = new Date('2027-03-04T00:00:00Z');

  it('defaults the season to the current year and the fee to nothing', () => {
    const config = parseCampConfig(undefined, now);
    expect(config.season).toBe('2027');
    expect(config.baseCents).toBe(0);
    expect(config.programId).toBe('summercamp');
  });

  it('falls back rather than clamping a fee that is out of range', () => {
    expect(parseCampConfig({ baseCents: -100 }, now).baseCents).toBe(0);
    expect(parseCampConfig({ baseCents: 9_999_999 }, now).baseCents).toBe(0);
    expect(parseCampConfig({ baseCents: 175_00 }, now).baseCents).toBe(175_00);
  });

  it('reads a missing servant sign-up switch as open', () => {
    /*
     * Every camp configured before this field existed has no `servantSignUp`
     * key. Reading that as "closed" would hide the sign-up form on a parish
     * that was never told to add it, which is indistinguishable from the
     * feature being broken.
     */
    expect(parseCampConfig({}, now).servantSignUp).toBe(true);
    expect(parseCampConfig({ servantSignUp: false }, now).servantSignUp).toBe(false);
    // Only a real boolean closes it. A truthy string in the console would
    // otherwise read one way here and another way in a template.
    expect(parseCampConfig({ servantSignUp: 'no' }, now).servantSignUp).toBe(true);
  });
});

describe('shirtCounts', () => {
  it('counts every child and servant, and excludes the withdrawn', () => {
    const rows = [
      {
        status: 'registered' as const,
        servant: null,
        children: [
          { ...blankChild(), shirtSize: 'YM' as const },
          { ...blankChild(), shirtSize: 'YL' as const },
        ],
      },
      // A draft still counts: the shirt order goes in before every registration
      // is finished, and a spare beats being one short.
      {
        status: 'draft' as const,
        servant: null,
        children: [{ ...blankChild(), shirtSize: 'YM' as const }],
      },
      {
        status: 'withdrawn' as const,
        servant: null,
        children: [{ ...blankChild(), shirtSize: 'YM' as const }],
      },
      {
        status: 'registered' as const,
        children: [],
        servant: { uid: null, sections: ['elementary' as const], desiredRoles: [], assignedRoles: [], shirtSize: 'AL' as const, days: [], availability: '', cleared: true, clearedNote: '' },
      },
    ];

    const counts = shirtCounts(rows);
    expect(counts.YM).toBe(2);
    expect(counts.YL).toBe(1);
    expect(counts.AL).toBe(1);
    expect(counts.AS).toBe(0);
  });
});

describe('sortRegistrations', () => {
  it('orders by the contact name, not by when they registered', () => {
    const rows = [
      { kind: 'family' as const, contact: contact('Zakhary') },
      { kind: 'family' as const, contact: contact('Awadalla') },
      { kind: 'servant' as const, contact: contact('Guirguis') },
    ];
    expect(sortRegistrations(rows).map((row) => row.contact.name)).toEqual([
      'Awadalla',
      'Guirguis',
      'Zakhary',
    ]);
  });
});

function contact(name: string) {
  return { name, email: '', phone: '', altName: '', altPhone: '', address: '' };
}

/* ---- ages --------------------------------------------------------------- */

describe('campAge', () => {
  it('counts whole years, and waits for the birthday', () => {
    // Born 1 July 2010, asked on 30 June 2027: still 16.
    expect(campAge('2010-07-01', new Date(2027, 5, 30))).toBe(16);
    expect(campAge('2010-07-01', new Date(2027, 6, 1))).toBe(17);
    expect(campAge('2010-07-01', new Date(2027, 6, 2))).toBe(17);
  });

  it('answers null rather than nought for a missing or broken date', () => {
    // A chip reading "0" beside a servant's name is worse than one reading
    // nothing: one is a missing answer and the other is a wrong one.
    expect(campAge('')).toBeNull();
    expect(campAge('not a date')).toBeNull();
    expect(campAge('2010-13-01')).toBeNull();
    expect(campAge('10-07-2010')).toBeNull();
  });

  it('refuses a date in the future', () => {
    expect(campAge('2030-01-01', new Date(2027, 6, 1))).toBeNull();
  });
});

/* ---------------------------------------------------------------------------
 * Servants signing themselves up
 * ------------------------------------------------------------------------ */

/**
 * The sign-up a stranger can send, and what accepting one produces.
 *
 * These run in two places, which is the reason they are tested here rather
 * than through a screen: `validateServantSignUp` decides both what the public
 * form refuses to send and what `campServantRequest` refuses to store, and
 * `acceptedServantRegistration` is the whole of what "accept" means — the one
 * function standing between an open form and the register that holds children's
 * medical notes.
 */
function signUpDraft(over: Partial<CampRegistrationDraft> = {}): CampRegistrationDraft {
  const base = blankServantSignUp({ programId: 'summercamp', season: '2027' });
  return {
    ...base,
    contact: { ...base.contact, name: 'Marina Rizk', phone: '555-0100' },
    emergency: { name: 'Nabil Rizk', phone: '555-0101', relationship: 'Father' },
    servant: {
      ...(base.servant ?? blankServant()),
      dateOfBirth: '2009-06-01',
      sections: ['elementary'],
      desiredRoles: ['Sports'],
      days: ['w1-mon', 'w1-tue'],
      shirtSize: 'AM',
    },
    ...over,
  };
}

describe('validating a servant’s own sign-up', () => {
  it('accepts a complete one when there is no waiver to sign', () => {
    expect(validateServantSignUp(signUpDraft(), { waiverInForce: false })).toEqual([]);
  });

  it('asks for what the camp cannot build its groups without', () => {
    const bare = blankServantSignUp({ programId: 'summercamp', season: '2027' });
    const problems = validateServantSignUp(bare, { waiverInForce: false });

    // Every one of these is a question the camp would otherwise have to ring
    // somebody to ask, which is the cost the whole feature exists to remove.
    expect(problems).toContain('Enter your name.');
    expect(problems.some((problem) => problem.includes('date of birth'))).toBe(true);
    expect(problems.some((problem) => problem.includes('which group'))).toBe(true);
    expect(problems.some((problem) => problem.includes('role'))).toBe(true);
    expect(problems.some((problem) => problem.includes('days'))).toBe(true);
  });

  it('speaks to the servant, not about them', () => {
    /*
     * The reason this function exists beside `validateCampRegistration` rather
     * than being shared with it. That one is read by a volunteer looking at
     * somebody else's record; this one is read by a sixteen-year-old on their
     * phone, about themselves.
     */
    const problems = validateServantSignUp(
      blankServantSignUp({ programId: 'summercamp', season: '2027' }),
      { waiverInForce: false },
    );
    expect(problems.every((problem) => !problem.includes('the servant'))).toBe(true);
  });

  it('demands the waiver only when there is one', () => {
    const draft = signUpDraft();
    expect(validateServantSignUp(draft, { waiverInForce: true })).toEqual([
      'The waiver has not been signed.',
    ]);
    expect(validateServantSignUp(draft, { waiverInForce: false })).toEqual([]);
    // Defaults to the stricter answer, so a caller that forgets the context
    // asks for a signature rather than skipping it.
    expect(validateServantSignUp(draft)).toHaveLength(1);
  });
});

describe('accepting a sign-up', () => {
  function request(over: Partial<CampServantRequest> = {}): CampServantRequest {
    return {
      programId: 'summercamp',
      season: '2027',
      registration: signUpDraft(),
      message: '',
      submittedAt: new Date(),
      ...over,
    };
  }

  it('registers one that answers everything, and credits the administrator', () => {
    const accepted = acceptedServantRegistration(request(), {
      takenByUid: 'lead-1',
      waiverInForce: false,
    });

    expect(accepted.status).toBe('registered');
    expect(accepted.kind).toBe('servant');
    expect(accepted.takenByUid).toBe('lead-1');
    expect(accepted.children).toEqual([]);
    expect(accepted.servant?.desiredRoles).toEqual(['Sports']);
  });

  it('accepts an incomplete one as a draft rather than refusing it', () => {
    /*
     * A waiver that came into force after the sign-up was sent is the case
     * this exists for. Refusing would leave a real person's sign-up stuck in a
     * queue for a reason they cannot see and cannot fix; `draft` says "this is
     * real and it is not finished", which is exactly true.
     */
    const accepted = acceptedServantRegistration(request(), {
      takenByUid: 'lead-1',
      waiverInForce: true,
    });
    expect(accepted.status).toBe('draft');
  });

  it('keeps what the servant wrote, and labels whose words they are', () => {
    const accepted = acceptedServantRegistration(
      request({ message: 'I can drive the van on the Friday.' }),
      { takenByUid: 'lead-1', waiverInForce: false },
    );
    // `note` is the administrators' field. Carrying the message across without
    // saying where it came from would make it read as something the camp
    // agreed rather than something the servant asked for.
    expect(accepted.note).toBe('From their sign-up: I can drive the van on the Friday.');
  });

  it('files it under the ministry on the request, not the one in the draft', () => {
    // The Function sets the top-level pair from `config/camp`. A draft that
    // arrived naming a different ministry must not be able to smuggle one in.
    const accepted = acceptedServantRegistration(
      request({ registration: signUpDraft({ programId: 'st-simon', season: '1999' }) }),
      { takenByUid: 'lead-1', waiverInForce: false },
    );
    expect(accepted.programId).toBe('summercamp');
    expect(accepted.season).toBe('2027');
  });
});
