import { describe, expect, it } from 'vitest';
import {
  campAge,
  CAMP_PAYMENT_METHODS,
  MAX_CHILDREN,
  campAllDayKeys,
  campDesiredRoles,
  campDesiredRolesFor,
  campDesiredRolesForWeek,
  clearDesiredRolesForSection,
  campSectionForGrade,
  campWeekKeys,
  campWeekRoleKey,
  campWeekRoleOptions,
  campWeeksOf,
  CAMP_ROLE_SUGGESTIONS,
  describeCampDesiredRoles,
  parseCampWeekRoleKey,
  toggleDesiredRole,
  describeCampDays,
  acceptedServantRegistration,
  blankChild,
  blankRegistration,
  blankServant,
  blankServantSignUp,
  campBill,
  campNeedsGuardian,
  campGenderLabel,
  campGenderPlural,
  campGenderShort,
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

  /**
   * The servants' shirt money: one flat amount, however many weeks they serve.
   *
   * It is not `baseCents` and must never become it — see
   * `CampBilling.chargeCents`. A weekly rate would charge a servant twice for
   * doing both weeks, which is the opposite of what was asked for, and it would
   * put a second "weekly rate" into every season's finance rollup.
   */
  it('charges a servant a flat amount, once, whatever weeks they serve', () => {
    const servant = blankRegistration({
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      baseCents: 175_00,
      chargeCents: 20_00,
      chargeLabel: 'Servant shirt',
      takenByUid: null,
    });
    servant.servant = { ...servant.servant!, days: [...campWeekKeys(1), ...campWeekKeys(2)] };

    const bill = campBill(servant);
    // No lines: a servant is billed for no weeks, and the charge is not one.
    expect(bill.lines).toEqual([]);
    expect(bill.chargeCents).toBe(20_00);
    expect(bill.subtotalCents).toBe(20_00);
    expect(bill.dueCents).toBe(20_00);
    expect(bill.balanceCents).toBe(20_00);
    expect(bill.paid).toBe(false);
  });

  it('calls a servant settled once the charge is paid', () => {
    const servant = blankRegistration({
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      baseCents: 0,
      chargeCents: 20_00,
      chargeLabel: 'Servant shirt',
      takenByUid: null,
    });
    servant.billing.payments = [
      { id: 'p1', amountCents: 20_00, method: 'square', reference: 'sq-1', receivedOn: '2027-05-01', note: 'Servant shirt', recordedByUid: null, recordedAt: null },
    ];
    const bill = campBill(servant);
    expect(bill.paidCents).toBe(20_00);
    expect(bill.balanceCents).toBe(0);
    expect(bill.paid).toBe(true);
  });

  /**
   * A registration written before the charge existed has no such field, and
   * `Math.round(undefined)` is `NaN` — which does not throw, does not show, and
   * turns a season's outstanding total into nothing. The rollup's fixtures found
   * this before a parish did.
   */
  it('reads a registration written before the charge existed as no charge', () => {
    const draft = family(1, 100_00);
    delete (draft.billing as { chargeCents?: number }).chargeCents;
    const bill = campBill(draft);
    expect(bill.chargeCents).toBe(0);
    expect(bill.dueCents).toBe(100_00);
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
    child.gender = 'female';
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
    // Nothing about roles yet: they are asked per week, and a servant with no
    // days has no week to be asked about.
    expect(problems.some((p) => p.includes('days'))).toBe(true);

    draft.servant = { ...draft.servant!, gender: 'male', sections: ['middle-school'] };
    draft.servant = { ...draft.servant, days: campWeekKeys(2) };
    // Now there is a week, so the week is asked about — and named, along with
    // the half of the camp, because a servant coming to both weeks or serving
    // both halves must not be told "choose a role" twice with no way to tell
    // which one is missing.
    expect(validateCampRegistration(draft)).toEqual([
      'Choose at least one thing the servant would like to do in middle school, week 2.',
    ]);

    // Answering week one does not answer week two.
    draft.servant = { ...draft.servant, desiredRolesByWeek: { w1_middle: ['Sports'] } };
    expect(validateCampRegistration(draft)).toHaveLength(1);

    // Nor does answering the other half of the camp: the stations differ, so
    // an elementary answer says nothing about the middle-school week.
    draft.servant = { ...draft.servant, desiredRolesByWeek: { w2_elementary: ['Sports'] } };
    expect(validateCampRegistration(draft)).toHaveLength(1);

    draft.servant = { ...draft.servant, desiredRolesByWeek: { w2_middle: ['Sports'] } };
    expect(validateCampRegistration(draft)).toEqual([]);

    // Serving both halves is two answers, and the missing one is named.
    draft.servant = { ...draft.servant, sections: ['elementary', 'middle-school'] };
    expect(validateCampRegistration(draft)).toEqual([
      'Choose at least one thing the servant would like to do in elementary, week 2.',
    ]);
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
    child.gender = 'female';
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

/* ---------------------------------------------------------------------------
 * Male and female
 * ------------------------------------------------------------------------ */

/**
 * The field the groups board is balanced on.
 *
 * Two things are worth pinning here and nowhere else. The first is that
 * **nothing recorded stays nothing recorded** — a parser that defaulted it
 * would put a number on a ratio somebody staffs a crew against, and the wrong
 * number would be indistinguishable from a right one. The second is that both
 * validators ask for it: the register's, which lists it as still to fill in,
 * and the sign-up's, which refuses to send without it. See `CAMP_GENDERS`.
 */
describe('male and female', () => {
  it('reads a child’s and a servant’s answer off a stored document', () => {
    const child = parseCampRegistration({
      kind: 'family',
      children: [{ id: 'c1', firstName: 'Mariam', gender: 'female' }],
    }).children[0]!;
    expect(child.gender).toBe('female');

    const servant = parseCampRegistration({ kind: 'servant', servant: { gender: 'male' } }).servant;
    expect(servant?.gender).toBe('male');
  });

  it('never guesses one', () => {
    // Absent, misspelled, and a value from somebody else's vocabulary. All
    // three are "not asked", because a default here is a wrong ratio nobody
    // can see is wrong.
    for (const stored of [undefined, '', 'Male', 'boy', 'm', 'unknown', 42, null]) {
      expect(
        parseCampRegistration({ kind: 'family', children: [{ id: 'c1', gender: stored }] })
          .children[0]!.gender,
      ).toBe('');
    }
  });

  it('survives a registration written before the field existed', () => {
    // The whole legacy corpus: no key at all. It must parse, and it must read
    // as unanswered rather than throw or default.
    const old = parseCampRegistration({
      kind: 'family',
      children: [{ id: 'c1', firstName: 'Mariam', grade: '3', shirtSize: 'YM' }],
    });
    expect(old.children[0]!.gender).toBe('');
    expect(old.children[0]!.grade).toBe('3');
  });

  it('starts blank on a new child and a new servant', () => {
    expect(blankChild().gender).toBe('');
    expect(blankServant().gender).toBe('');
  });

  it('says it in the vocabulary of whoever is being described', () => {
    expect(campGenderLabel('female', 'child')).toBe('Girl');
    expect(campGenderLabel('female', 'servant')).toBe('Female');
    expect(campGenderLabel('', 'child')).toBe('Not given');

    // The chip's one letter follows the same split — see `campGenderShort`.
    expect(campGenderShort('male', 'child')).toBe('B');
    expect(campGenderShort('male', 'servant')).toBe('M');
    expect(campGenderShort('', 'servant')).toBe('?');

    expect(campGenderPlural('female', 'child')).toBe('girls');
    expect(campGenderPlural('female', 'servant')).toBe('female');
    // The count is what stops a tally's hover text reading "1 boys". A
    // servant's word does not inflect either way.
    expect(campGenderPlural('male', 'child', 1)).toBe('boy');
    expect(campGenderPlural('female', 'child', 1)).toBe('girl');
    expect(campGenderPlural('female', 'child', 0)).toBe('girls');
    expect(campGenderPlural('female', 'servant', 1)).toBe('female');
  });

  it('is asked for on the register, by name, and stops being asked once given', () => {
    const draft = family(1, 100_00);
    draft.contact.name = 'Mina Guirguis';
    const child = draft.children[0] as CampChild;
    child.firstName = 'Mariam';

    // Named, because a registration with four children on it has to say which.
    expect(validateCampRegistration(draft).some((p) => p.includes('Mariam is a boy or a girl'))).toBe(
      true,
    );

    child.gender = 'female';
    expect(validateCampRegistration(draft).some((p) => p.includes('boy or a girl'))).toBe(false);
  });

  it('is asked of a servant on the register too', () => {
    const draft = blankRegistration({
      programId: 'summercamp',
      season: '2027',
      kind: 'servant',
      baseCents: 0,
      takenByUid: null,
    });
    expect(validateCampRegistration(draft).some((p) => p.includes('male or female'))).toBe(true);

    draft.servant = { ...draft.servant!, gender: 'male' };
    expect(validateCampRegistration(draft).some((p) => p.includes('male or female'))).toBe(false);
  });

  it('stops a public sign-up that does not say', () => {
    // `validateServantSignUp` is the gate on the endpoint as well as the form,
    // so this is what a stranger's POST is refused by. See `campServantRequest`.
    const draft = signUpDraft();
    draft.servant = { ...draft.servant!, gender: '' };
    expect(validateServantSignUp(draft, { waiverInForce: false })).toEqual([
      'Choose male or female — the camp splits its groups by it.',
    ]);
  });

  it('carries a sign-up’s answer through acceptance unchanged', () => {
    const request: CampServantRequest = {
      programId: 'summercamp',
      season: '2027',
      registration: signUpDraft(),
      message: '',
      submittedAt: null,
    };
    const accepted = acceptedServantRegistration(request, {
      takenByUid: 'lead-1',
      waiverInForce: false,
    });
    expect(accepted.servant?.gender).toBe('female');
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
    // Not `draft`: that status and `waitlisted` are history, and a stored
    // document still holding one is a real registration filed under a state no
    // screen draws. See `CAMP_STATUSES`.
    expect(parsed.status).toBe('registered');
    expect(parseCampRegistration({ status: 'draft' }).status).toBe('registered');
    expect(parseCampRegistration({ status: 'waitlisted' }).status).toBe('registered');
    // The one that still means something survives untouched.
    expect(parseCampRegistration({ status: 'withdrawn' }).status).toBe('withdrawn');
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

  /**
   * The servants' charge, which is the one setting on this document that takes
   * money off a stranger's card the moment they press send on a public form.
   *
   * Zero is not "unset" here — it is "no charge", which switches the card step
   * off entirely. That is the default and the state most camps stay in.
   */
  it('reads a missing servant charge as no charge, and no card step', () => {
    expect(parseCampConfig({}, now).servantChargeCents).toBe(0);
    expect(parseCampConfig({}, now).servantChargeLabel).toBe('');
    expect(parseCampConfig({ servantChargeCents: 20_00 }, now).servantChargeCents).toBe(20_00);
  });

  it('falls back rather than clamping a servant charge out of range', () => {
    // The same rule the fee follows: a clamped figure is money nobody chose,
    // and zero reads on the settings screen as "servants are not charged".
    expect(parseCampConfig({ servantChargeCents: -100 }, now).servantChargeCents).toBe(0);
    expect(parseCampConfig({ servantChargeCents: 9_999_999 }, now).servantChargeCents).toBe(0);
    expect(parseCampConfig({ servantChargeCents: 20.5 }, now).servantChargeCents).toBe(0);
    expect(parseCampConfig({ servantChargeCents: '2000' }, now).servantChargeCents).toBe(0);
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

/*
 * What a servant would like to do, week by week.
 *
 * The behaviour these pin is the one the screens depend on and the one a
 * refactor would quietly break: an old flat `desiredRoles` still reads, an
 * empty week has no key, and the union the allocation board draws on a chip is
 * derived rather than stored.
 */
describe('per-week desired roles', () => {
  it('keys a week the way the day keys do', () => {
    expect(campWeekRoleKey(1)).toBe('w1');
    expect(campWeekRoleKey(2)).toBe('w2');
    // Clamped, not thrown: a mistyped week from a hand-edited document lands
    // somewhere real rather than producing `wNaN`.
    expect(campWeekRoleKey(0)).toBe('w1');
    expect(campWeekRoleKey(99)).toBe('w6');

    // The half of the camp is in the key, and spelled `middle` rather than
    // `middle-school`: these are written as Firestore field paths, which a
    // hyphen makes unparseable.
    expect(campWeekRoleKey(1, 'elementary')).toBe('w1_elementary');
    expect(campWeekRoleKey(2, 'middle-school')).toBe('w2_middle');
    expect(campWeekRoleKey(2, null)).toBe('w2');

    expect(parseCampWeekRoleKey('w2')).toEqual({ week: 2, section: null });
    expect(parseCampWeekRoleKey('w2_middle')).toEqual({ week: 2, section: 'middle-school' });
    expect(parseCampWeekRoleKey('w1_elementary')).toEqual({ week: 1, section: 'elementary' });
    expect(parseCampWeekRoleKey('w9')).toBe(null);
    expect(parseCampWeekRoleKey('w1-mon')).toBe(null);
    expect(parseCampWeekRoleKey('w1_middle-school')).toBe(null);
    expect(parseCampWeekRoleKey(2)).toBe(null);
  });

  it('names the weeks somebody has any day in', () => {
    expect(campWeeksOf(['w2-wed', 'w1-mon', 'w2-fri'])).toEqual([1, 2]);
    expect(campWeeksOf([])).toEqual([]);
    expect(campWeeksOf(['nonsense'])).toEqual([]);
  });

  it('unions across weeks and halves for the screens that want one line', () => {
    const servant = {
      desiredRolesByWeek: {
        w2_middle: ['Kitchen', 'Sports'],
        w1_elementary: ['Sports'],
        w2_elementary: ['Arts and crafts'],
      },
    };
    // Week order, deduped — not the order the keys happen to be stored in.
    expect(campDesiredRoles(servant)).toEqual(['Sports', 'Arts and crafts', 'Kitchen']);

    // One week, one half: what the form and the drawer ask.
    expect(campDesiredRolesFor(servant, 2, 'middle-school')).toEqual(['Kitchen', 'Sports']);
    expect(campDesiredRolesFor(servant, 2, 'elementary')).toEqual(['Arts and crafts']);
    expect(campDesiredRolesFor(servant, 1, 'middle-school')).toEqual([]);

    // One week, both halves: what a chip shows.
    expect(campDesiredRolesForWeek(servant, 2)).toEqual([
      'Arts and crafts',
      'Kitchen',
      'Sports',
    ]);
    expect(campDesiredRolesForWeek(servant, 3)).toEqual([]);
    expect(campDesiredRoles(null)).toEqual([]);
  });

  it('takes a half of the camp’s answers away with the half', () => {
    const before = {
      w1_elementary: ['Arts and crafts'],
      w1_middle: ['Sports'],
      w2_middle: ['Trip chaperone'],
    };
    // Unticking middle school leaves nothing filed under a half they are not
    // serving — invisible on their own form, and read by the person building
    // the boards as somebody who wants to be there.
    expect(clearDesiredRolesForSection(before, 'middle-school')).toEqual({
      w1_elementary: ['Arts and crafts'],
    });
    expect(clearDesiredRolesForSection(before, 'elementary')).toEqual({
      w1_middle: ['Sports'],
      w2_middle: ['Trip chaperone'],
    });
  });

  it('drops a week and half nobody wants anything in, rather than storing an empty list', () => {
    let map: Record<string, string[]> = {};
    map = toggleDesiredRole(map, 1, 'middle-school', 'Sports', true);
    map = toggleDesiredRole(map, 1, 'middle-school', 'Kitchen', true);
    expect(map).toEqual({ w1_middle: ['Sports', 'Kitchen'] });

    // Ticking the same box twice is not two roles.
    expect(toggleDesiredRole(map, 1, 'middle-school', 'Sports', true)).toEqual(map);

    // The same job in the other half is a second answer, not the same one —
    // "Kitchen" for elementary is a different rota from "Kitchen" for middle
    // school, and unticking one must not untick the other.
    map = toggleDesiredRole(map, 1, 'elementary', 'Kitchen', true);
    expect(map.w1_elementary).toEqual(['Kitchen']);
    map = toggleDesiredRole(map, 1, 'elementary', 'Kitchen', false);
    expect(map).not.toHaveProperty('w1_elementary');
    expect(map.w1_middle).toEqual(['Sports', 'Kitchen']);

    map = toggleDesiredRole(map, 1, 'middle-school', 'Sports', false);
    map = toggleDesiredRole(map, 1, 'middle-school', 'Kitchen', false);
    expect(map).toEqual({});
  });

  it('says what was asked for a week at a time, naming the halves only when they differ', () => {
    const servant = {
      desiredRolesByWeek: { w1_middle: ['Sports'], w2_middle: ['Kitchen'] },
    };
    expect(describeCampDesiredRoles(servant, 2)).toBe('Week 1: Sports · Week 2: Kitchen');
    // A camp shortened to one week must not hide what somebody said about the
    // second one — they signed up for it.
    expect(describeCampDesiredRoles(servant, 1)).toContain('Week 2: Kitchen');
    expect(describeCampDesiredRoles({ desiredRolesByWeek: {} }, 2)).toBe('');

    // Both halves, the same answer in each: said once, because naming the
    // sections there is two lines carrying one fact.
    expect(
      describeCampDesiredRoles(
        { desiredRolesByWeek: { w1_elementary: ['Sports'], w1_middle: ['Sports'] } },
        1,
      ),
    ).toBe('Week 1: Sports');

    // Both halves, different answers: told apart, which is the whole point of
    // the sectioned keys.
    expect(
      describeCampDesiredRoles(
        { desiredRolesByWeek: { w1_elementary: ['Arts and crafts'], w1_middle: ['Sports'] } },
        1,
      ),
    ).toBe('Week 1 elementary: Arts and crafts · Week 1 middle school: Sports');
  });

  it('reads a flat list from before the split as covering the weeks and halves they came to', () => {
    /*
     * The first of the two migrations. `desiredRoles` used to be a single
     * list, and the honest reading of it is "what they wanted while they were
     * here" — so it lands on every week they have days in, which is exactly the
     * span it used to cover, and on every half they signed up to serve.
     */
    const migrated = parseCampRegistration({
      kind: 'servant',
      servant: {
        desiredRoles: ['Sports'],
        sections: ['middle-school'],
        days: ['w2-mon', 'w2-tue'],
      },
    });
    expect(migrated.servant?.desiredRolesByWeek).toEqual({ w2_middle: ['Sports'] });

    // No days at all: week one, because a wish filed under no week is a wish
    // no screen will ever show. No sections either: both halves, because a
    // record with wishes and no section is one to show whole rather than to
    // file under a half nobody chose.
    const noDays = parseCampRegistration({
      kind: 'servant',
      servant: { desiredRoles: ['Kitchen'] },
    });
    expect(noDays.servant?.desiredRolesByWeek).toEqual({
      w1_elementary: ['Kitchen'],
      w1_middle: ['Kitchen'],
    });

    // A document that has both is a document somebody has already saved since
    // the split, so the map wins and the legacy field is ignored.
    const both = parseCampRegistration({
      kind: 'servant',
      servant: {
        desiredRoles: ['Sports'],
        sections: ['elementary'],
        desiredRolesByWeek: { w1_elementary: ['Music'] },
        days: ['w1-mon'],
      },
    });
    expect(both.servant?.desiredRolesByWeek).toEqual({ w1_elementary: ['Music'] });
  });

  it('reads a bare week key from before the halves were told apart as meaning both', () => {
    /*
     * The second migration. A `w1` was written by a form that offered one set
     * of boxes to somebody who had already ticked their sections, so it meant
     * "week one, in whichever halves I serve".
     */
    const spread = parseCampRegistration({
      kind: 'servant',
      servant: {
        sections: ['elementary', 'middle-school'],
        desiredRolesByWeek: { w1: ['Sports'] },
        days: ['w1-mon'],
      },
    });
    expect(spread.servant?.desiredRolesByWeek).toEqual({
      w1_elementary: ['Sports'],
      w1_middle: ['Sports'],
    });

    // A sectioned key beside a bare one is an administrator's save, half done.
    // What they typed wins; the old key only fills the half they did not touch.
    const halfMigrated = parseCampRegistration({
      kind: 'servant',
      servant: {
        sections: ['elementary', 'middle-school'],
        desiredRolesByWeek: { w1: ['Sports'], w1_elementary: ['Arts and crafts'] },
        days: ['w1-mon'],
      },
    });
    expect(halfMigrated.servant?.desiredRolesByWeek).toEqual({
      w1_elementary: ['Arts and crafts'],
      w1_middle: ['Sports'],
    });
  });

  it('refuses a week key it did not write, and an empty list', () => {
    const parsed = parseCampRegistration({
      kind: 'servant',
      servant: {
        sections: ['elementary'],
        desiredRolesByWeek: {
          w1_elementary: ['Sports'],
          w9_elementary: ['Nonsense'],
          'w1_middle-school': ['Nonsense'],
          nope: ['Nonsense'],
          w2_elementary: [],
        },
      },
    });
    expect(parsed.servant?.desiredRolesByWeek).toEqual({ w1_elementary: ['Sports'] });
  });
});

describe('the camp’s own list of roles', () => {
  it('offers the suggestions until the camp has chosen', () => {
    const config = parseCampConfig({}, new Date('2027-03-04T00:00:00Z'));
    expect(config.weekRoles).toEqual({});
    expect(campWeekRoleOptions(config, 1, 'elementary')).toEqual([...CAMP_ROLE_SUGGESTIONS]);
    expect(campWeekRoleOptions(config, 1, 'middle-school')).toEqual([...CAMP_ROLE_SUGGESTIONS]);
  });

  it('reads one list per week and half, and keeps a week past the camp’s length', () => {
    const config = parseCampConfig(
      {
        weeks: 2,
        weekRoles: {
          w1_elementary: [' Arts and crafts ', 'Arts and crafts', ''],
          w2_elementary: ['Water play'],
          w2_middle: ['Trip chaperone'],
          w3_middle: ['Something for a week the camp no longer runs'],
          nope: ['Ignored'],
        },
      },
      new Date('2027-03-04T00:00:00Z'),
    );

    // Trimmed and deduped; a blank name is dropped, because a checkbox with no
    // label cannot be ticked meaningfully.
    expect(config.weekRoles.w1_elementary).toEqual(['Arts and crafts']);
    // The halves are distinct: week two's middle school is a trip, and
    // elementary is not offered it.
    expect(campWeekRoleOptions(config, 2, 'middle-school')).toEqual(['Trip chaperone']);
    expect(campWeekRoleOptions(config, 2, 'elementary')).toEqual(['Water play']);
    // A half the camp has not filled in falls through to the suggestions on its
    // own, without borrowing the other half's list.
    expect(campWeekRoleOptions(config, 1, 'middle-school')).toEqual([...CAMP_ROLE_SUGGESTIONS]);
    // Unlike `weekStarts`, a week past `weeks` is kept: shortening the camp for
    // a year has not unsaid what the camp typed.
    expect(config.weekRoles.w3_middle).toHaveLength(1);
    expect(config.weekRoles).not.toHaveProperty('nope');
    // An empty list is not stored, so it reads as "not chosen" and the form
    // shows the suggestions.
    expect(
      campWeekRoleOptions(parseCampConfig({ weekRoles: { w1_elementary: [] } }), 1, 'elementary'),
    ).toEqual([...CAMP_ROLE_SUGGESTIONS]);
  });

  it('offers a list written before the halves were told apart to both of them', () => {
    const config = parseCampConfig(
      { weeks: 2, weekRoles: { w1: ['Sports', 'Kitchen'], w1_middle: ['Bible study'] } },
      new Date('2027-03-04T00:00:00Z'),
    );

    // A bare `w1` meant "week one, everybody", so it is what elementary sees
    // until the camp gives elementary a list of its own.
    expect(campWeekRoleOptions(config, 1, 'elementary')).toEqual(['Sports', 'Kitchen']);
    // And it is shadowed the moment either half is edited.
    expect(campWeekRoleOptions(config, 1, 'middle-school')).toEqual(['Bible study']);
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
        servant: { uid: null, sections: ['elementary' as const], desiredRolesByWeek: {}, assignedRoles: [], shirtSize: 'AL' as const, days: [], availability: '', cleared: true, clearedNote: '' },
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
      gender: 'female',
      sections: ['elementary'],
      desiredRolesByWeek: { w1_elementary: ['Sports'] },
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
    expect(problems.some((problem) => problem.includes('days'))).toBe(true);

    // Once there is a week and a half of the camp, both are named. A servant
    // serving both halves across both weeks would otherwise be told "choose a
    // role" four times with no way to tell which one is missing — and the two
    // halves do not run the same stations, so they genuinely are four answers.
    const both = {
      ...bare,
      servant: {
        ...bare.servant!,
        sections: ['elementary', 'middle-school'] as const,
        days: ['w1-mon'] as const,
      },
    };
    const named = validateServantSignUp(
      both as unknown as Parameters<typeof validateServantSignUp>[0],
      { waiverInForce: false },
    );
    expect(named).toContain('Choose at least one thing you would like to do in elementary, week 1.');
    expect(named).toContain(
      'Choose at least one thing you would like to do in middle school, week 1.',
    );
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
    // Pinned to a day the fixture is an adult on. The sign-up fixture was born
    // in 2009 and turns 18 in June 2027 — without a fixed day this assertion
    // silently becomes the guardian's one, on a morning nobody is looking.
    const grown = { today: new Date(2030, 0, 1) };

    const draft = signUpDraft();
    expect(validateServantSignUp(draft, { waiverInForce: true, ...grown })).toEqual([
      'The waiver has not been signed.',
    ]);
    expect(validateServantSignUp(draft, { waiverInForce: false, ...grown })).toEqual([]);
    // Defaults to the stricter answer, so a caller that forgets the context
    // asks for a signature rather than skipping it.
    expect(validateServantSignUp(draft, grown)).toHaveLength(1);
  });
});

/**
 * Who signs an under-18 servant's waiver.
 *
 * ---------------------------------------------------------------------------
 * Half the camp's servants are teenagers, and a fifteen-year-old cannot agree
 * to a waiver on their own behalf. The form is still theirs to fill in — that
 * is the whole design of a public sign-up — but the last box is their parent's,
 * and these are the assertions that keep it so.
 *
 * Every one of them pins the day. An age test written against `new Date()` is a
 * test that changes its mind on somebody's birthday.
 * ---------------------------------------------------------------------------
 */
describe('a servant under 18', () => {
  /*
   * Local midnight, not `Date('…Z')`.
   *
   * `campAge` reads the day with `getMonth`/`getDate`, which are local — so a
   * UTC midnight is the day before in every American timezone, and a birthday
   * test written that way is off by one for half the planet and passes in
   * London.
   */
  const TEEN = { today: new Date(2026, 8, 5) };   // the fixture is 17
  const GROWN = { today: new Date(2030, 0, 1) };  // and 20

  it('is anybody under eighteen, and anybody with no date of birth', () => {
    expect(campNeedsGuardian('2009-06-01', TEEN.today)).toBe(true);
    expect(campNeedsGuardian('2009-06-01', GROWN.today)).toBe(false);
    // Eighteen on the day, and not a day before.
    expect(campNeedsGuardian('2008-09-05', TEEN.today)).toBe(false);
    expect(campNeedsGuardian('2008-09-06', TEEN.today)).toBe(true);
    /*
     * The defensive half. A sign-up with no date of birth is refused on that
     * line anyway, so nothing rests on this in practice — but of the two
     * possible mistakes, asking an adult for a guardian is a sentence they can
     * argue with and letting a child sign for themselves is not.
     */
    expect(campNeedsGuardian('')).toBe(true);
    expect(campNeedsGuardian('not a date')).toBe(true);
  });

  it('needs the guardian’s name and how they are related', () => {
    const draft = signUpDraft();
    draft.waiver = { ...draft.waiver, agreed: true, signedName: 'Nabil Rizk' };

    expect(validateServantSignUp(draft, { waiverInForce: true, ...TEEN })).toEqual([
      'Say how the person signing is related to you — mother, father, guardian.',
    ]);

    draft.waiver = { ...draft.waiver, signedRelationship: 'Father' };
    expect(validateServantSignUp(draft, { waiverInForce: true, ...TEEN })).toEqual([]);
  });

  it('says whose signature is missing, rather than that one is', () => {
    const draft = signUpDraft();
    expect(validateServantSignUp(draft, { waiverInForce: true, ...TEEN })).toContain(
      'Your parent or guardian has to agree to the waiver and sign it with their name.',
    );
  });

  it('asks an adult for no relationship at all', () => {
    const draft = signUpDraft();
    draft.waiver = { ...draft.waiver, agreed: true, signedName: 'Marina Rizk' };
    expect(validateServantSignUp(draft, { waiverInForce: true, ...GROWN })).toEqual([]);
  });

  /**
   * The one that keeps the error list honest.
   *
   * A sign-up with no date of birth is under-18 by the rule above, but the form
   * has not shown the guardian's fields yet — it only knows to once an age is
   * given. Demanding a relationship there is a message about a field that is
   * not on the screen.
   */
  it('does not ask a form with no age yet for a guardian at all', () => {
    /*
     * The wording waits for the answer. An adult who has typed nothing into
     * this form yet must not be told their parent has to sign it — and nothing
     * is let through by waiting, because the date of birth is demanded on its
     * own line.
     */
    const draft = signUpDraft();
    draft.servant = { ...draft.servant!, dateOfBirth: '' };
    expect(validateServantSignUp(draft, { waiverInForce: true, ...TEEN })).toContain(
      'The waiver has not been signed.',
    );
  });

  it('does not ask for a relationship before it knows an age', () => {
    const draft = signUpDraft();
    draft.servant = { ...draft.servant!, dateOfBirth: '' };
    draft.waiver = { ...draft.waiver, agreed: true, signedName: 'Nabil Rizk' };

    const problems = validateServantSignUp(draft, { waiverInForce: true, ...TEEN });
    expect(problems).toContain(
      'Enter your date of birth — the camp needs it to build the groups.',
    );
    expect(problems.some((problem) => problem.includes('related to you'))).toBe(false);
  });

  /**
   * The desk's copy of the same rule, in the third person. The two validators
   * are deliberately separate — one is read by the servant and one about them —
   * and the cost of that is that they drift unless something says so.
   */
  it('is refused at the desk too, in the third person', () => {
    const draft = signUpDraft();
    draft.waiver = { ...draft.waiver, agreed: true, signedName: 'Nabil Rizk' };
    expect(validateCampRegistration(draft, { waiverInForce: true, ...TEEN })).toEqual([
      'A servant under 18 needs a parent or guardian to sign — say how they are related.',
    ]);
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
    expect(accepted.servant?.desiredRolesByWeek).toEqual({ w1_elementary: ['Sports'] });
  });

  it('registers an incomplete one rather than filing it as a draft', () => {
    /*
     * A waiver that came into force after the sign-up was sent is the case this
     * exists for. It used to be filed as a `draft`, which sounds careful and was
     * not: the administrator had already read it and pressed **Accept**, and the
     * only thing the status changed was that the editor then refused to save any
     * correction they made to it. What is missing is shown on the editor as a
     * list of things still to come; nothing blocks.
     */
    const accepted = acceptedServantRegistration(request(), {
      takenByUid: 'lead-1',
      waiverInForce: true,
    });
    expect(accepted.status).toBe('registered');
    // And it really is incomplete — the point is that it saves anyway.
    expect(validateCampRegistration(accepted, { waiverInForce: true })).not.toEqual([]);
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
