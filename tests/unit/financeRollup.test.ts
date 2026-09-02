import { describe, expect, it } from 'vitest';
import {
  blankChild,
  campFinanceDocId,
  campWeekKeys,
  financeMonth,
  financeMonths,
  financeStanding,
  formFinanceDocId,
  parseFinanceRollup,
  rollupCampFinance,
  rollupFormFinance,
  type CampChild,
  type CampFinanceInput,
  type CampPaymentRecord,
} from '@spsm/shared';

/**
 * The arithmetic behind every figure on /admin/finance.
 *
 * ---------------------------------------------------------------------------
 * Checkable without an emulator, and it has to be, for a sharper reason than
 * the bookstore's rollup has. These documents are the *only* way the treasurer
 * ever sees the camp's money — the collection the figures come from is refused
 * to them by `firestore.rules`, permanently and correctly — so there is nobody
 * downstream in a position to notice that a total is wrong. A camp fee that
 * quietly stopped being counted would be invisible until somebody reconciled
 * the parish's bank statement by hand.
 *
 * The other property under test here is a privacy one: nothing that comes out
 * of these functions may identify a person. That is asserted rather than
 * assumed, because it is exactly the sort of thing a well-meant "it would be
 * useful to see who has not paid" would break.
 * ---------------------------------------------------------------------------
 */

const RATE = 15_000; // $150 a week, per child.

function child(over: Partial<CampChild> = {}): CampChild {
  return { ...blankChild(), days: campWeekKeys(1), ...over };
}

function payment(over: Partial<CampPaymentRecord> = {}): CampPaymentRecord {
  return {
    id: 'pay-1',
    amountCents: 15_000,
    method: 'check',
    reference: 'check 4021',
    receivedOn: '2027-06-14',
    note: '',
    recordedByUid: 'admin-1',
    recordedAt: null,
    ...over,
  };
}

function family(over: Partial<CampFinanceInput> = {}): CampFinanceInput {
  return {
    kind: 'family',
    status: 'registered',
    children: [child()],
    billing: { baseCents: RATE, discounts: [], payments: [] },
    ...over,
  };
}

function season(registrations: CampFinanceInput[]) {
  return rollupCampFinance({ programId: 'summercamp', season: '2027', registrations });
}

describe('a camp season', () => {
  it('bills a child per week, not per child', () => {
    // The correction that was made after this was first built: two weeks is two
    // charges. See `campBill` — the field is called `baseCents` and is weekly.
    const out = season([
      family({ children: [child({ days: [...campWeekKeys(1), ...campWeekKeys(2)] })] }),
    ]);

    expect(out.billableWeeks).toBe(2);
    expect(out.money.subtotalCents).toBe(2 * RATE);
    expect(out.money.dueCents).toBe(2 * RATE);
  });

  it('counts money that arrived against a withdrawn registration', () => {
    /*
     * The line that makes this reconcilable against a bank statement. The bank
     * does not know a family withdrew in July, only that a check cleared in
     * June — so the payment is in `receivedCents`, and *where* it sits is said
     * separately rather than by dropping it.
     */
    const out = season([
      family({ status: 'withdrawn', billing: { baseCents: RATE, discounts: [], payments: [payment()] } }),
    ]);

    expect(out.money.receivedCents).toBe(15_000);
    expect(out.money.withdrawnCents).toBe(15_000);
    // Withdrawn is not billed, so it owes nothing and is not in the count.
    expect(out.money.dueCents).toBe(0);
    expect(out.billable).toBe(0);
    expect(out.registrations.withdrawn).toBe(1);
  });

  it('does not let an overpayment hide somebody else’s arrears', () => {
    const out = season([
      // Owes $150, has paid $200.
      family({ billing: { baseCents: RATE, discounts: [], payments: [payment({ amountCents: 20_000 })] } }),
      // Owes $150, has paid nothing.
      family(),
    ]);

    expect(out.money.outstandingCents).toBe(15_000);
    expect(out.money.creditCents).toBe(5_000);
    expect(out.owing).toBe(1);
    expect(out.settled).toBe(1);
  });

  it('reports a refund as money returned, already netted out of the total', () => {
    const out = season([
      family({
        billing: {
          baseCents: RATE,
          discounts: [],
          payments: [payment(), payment({ id: 'pay-2', amountCents: -5_000 })],
        },
      }),
    ]);

    expect(out.money.receivedCents).toBe(10_000);
    expect(out.money.refundedCents).toBe(5_000);
    expect(out.byMethod.check.count).toBe(2);
    expect(out.byMethod.check.cents).toBe(10_000);
  });

  it('buckets payments by the day the money arrived, not the day it was typed', () => {
    const out = season([
      family({
        billing: {
          baseCents: RATE,
          discounts: [],
          payments: [
            payment({ receivedOn: '2027-06-14' }),
            payment({ id: 'pay-2', receivedOn: '2027-07-02', amountCents: 5_000 }),
          ],
        },
      }),
    ]);

    expect(out.byMonth).toEqual({ '2027-06': 15_000, '2027-07': 5_000 });
  });

  it('says nothing rather than guessing when the season has two weekly rates', () => {
    // `baseCents` is copied onto a registration when it is taken, so a fee
    // raised mid-season genuinely leaves two in the data. Averaging them would
    // print a rate the parish never charged.
    const one = season([family()]);
    expect(one.weeklyRateCents).toBe(RATE);

    const two = season([family(), family({ billing: { baseCents: 20_000, discounts: [], payments: [] } })]);
    expect(two.weeklyRateCents).toBeNull();
  });

  it('does not let a servant’s zero fee read as a second weekly rate', () => {
    /*
     * The first version of this counted every live registration's `baseCents`,
     * and a servant is saved with zero — so every real season had two rates in
     * it and the screen said "at more than one weekly rate" for ever. Caught by
     * seeding the emulator and reading the document back.
     */
    const out = season([
      family(),
      { kind: 'servant', status: 'registered', children: [], billing: { baseCents: 0, discounts: [], payments: [] } },
    ]);

    expect(out.weeklyRateCents).toBe(RATE);
  });

  it('bills servants nothing and still counts them', () => {
    const out = season([{ kind: 'servant', status: 'registered', children: [], billing: { baseCents: RATE, discounts: [], payments: [] } }]);

    expect(out.servants).toBe(1);
    expect(out.money.dueCents).toBe(0);
    // A free registration is settled, or every servant sits in "owes money".
    expect(out.settled).toBe(1);
  });

  it('carries no name, no address and no check number', () => {
    /*
     * The property the whole feature rests on. `finance` may read this document
     * and may not read the registrations behind it, so anything personal that
     * leaked into here would be a permission bypass rather than an untidiness.
     */
    const out = season([
      family({
        children: [child({ firstName: 'Mariam', lastName: 'Guirguis', allergies: 'peanuts' })],
        billing: { baseCents: RATE, discounts: [], payments: [payment({ reference: 'check 4021' })] },
      }),
    ]);

    const text = JSON.stringify(out);
    expect(text).not.toContain('Mariam');
    expect(text).not.toContain('Guirguis');
    expect(text).not.toContain('peanuts');
    expect(text).not.toContain('4021');
  });

  it('rolls an empty season up to zeroes rather than to nothing', () => {
    const out = season([]);
    expect(out.key).toBe(campFinanceDocId('summercamp', '2027'));
    expect(out.money.receivedCents).toBe(0);
    expect(out.registrations.registered).toBe(0);
  });

  it('is idempotent — a retried run writes the same answer', () => {
    const rows = [family({ billing: { baseCents: RATE, discounts: [], payments: [payment()] } })];
    expect(season(rows)).toEqual(season(rows));
  });
});

describe('a paid form', () => {
  const form = { id: 'retreat', slug: 'retreat', title: 'Winter retreat' };

  it('separates what was charged from what was actually taken', () => {
    const out = rollupFormFinance({
      form,
      submissions: [
        { totalCents: 4_000, paymentId: 'sq-1', month: '2027-01' },
        { totalCents: 4_000, paymentId: 'sq-2', month: '2027-01' },
        // Priced, and the charge never completed. The parish has the answers
        // and not the money, which is the number worth surfacing.
        { totalCents: 4_000, paymentId: null, month: '2027-01' },
        // A free submission on a paid form — every field left blank.
        { totalCents: 0, paymentId: null, month: '2027-02' },
      ],
    });

    expect(out.submissions).toBe(4);
    expect(out.chargedSubmissions).toBe(3);
    expect(out.paidSubmissions).toBe(2);
    expect(out.grossCents).toBe(8_000);
    expect(out.uncollectedCents).toBe(4_000);
    expect(out.byMonth).toEqual({ '2027-01': 8_000 });
    expect(out.key).toBe(formFinanceDocId('retreat'));
  });
});

describe('putting the three together', () => {
  const camp = [season([family({ billing: { baseCents: RATE, discounts: [], payments: [payment()] } })])];
  const forms = [
    rollupFormFinance({
      form: { id: 'retreat', slug: 'retreat', title: 'Winter retreat' },
      submissions: [{ totalCents: 4_000, paymentId: 'sq-1', month: '2027-06' }],
    }),
  ];

  it('adds one month of all three', () => {
    const out = financeMonth({
      month: '2027-06',
      bookstore: { revenue: 12_500, refunded: 2_500 },
      camp,
      forms,
    });

    expect(out.campCents).toBe(15_000);
    expect(out.formsCents).toBe(4_000);
    expect(out.receivedCents).toBe(31_500);
    // Only the shop's refunds are subtracted: a camp refund is a negative
    // payment and has already reduced the camp figure.
    expect(out.netCents).toBe(29_000);
  });

  it('reports a month nothing happened in as zero, not as missing', () => {
    const out = financeMonth({ month: '2027-11', bookstore: null, camp, forms });
    expect(out.receivedCents).toBe(0);
  });

  it('keeps what is owed outside the month', () => {
    const standing = financeStanding(camp, forms);
    // The family paid one week and is registered for one; nothing outstanding.
    expect(standing.owedCents).toBe(0);

    const behind = financeStanding([season([family()])], forms);
    expect(behind.campOutstandingCents).toBe(15_000);
    expect(behind.owedCents).toBe(15_000);
  });

  it('offers the months the data actually has, newest first', () => {
    expect(financeMonths(camp, forms, ['2027-08'])).toEqual(['2027-08', '2027-06']);
    // A caller's junk does not become an option.
    expect(financeMonths([], [], ['nonsense'])).toEqual([]);
  });
});

describe('reading one back', () => {
  it('survives a document written by an older version of the Function', () => {
    const rolled = parseFinanceRollup({ kind: 'camp', programId: 'summercamp', season: '2027' });
    expect(rolled?.kind).toBe('camp');
    expect(rolled && rolled.kind === 'camp' && rolled.money.receivedCents).toBe(0);
  });

  it('returns null for anything that is not one', () => {
    expect(parseFinanceRollup({ kind: 'bookstore' })).toBeNull();
    expect(parseFinanceRollup(null)).toBeNull();
  });
});
