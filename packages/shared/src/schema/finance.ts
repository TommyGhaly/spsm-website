import type { Timestamped } from './common.js';
import {
  CAMP_PAYMENT_METHODS,
  CAMP_STATUSES,
  campBill,
  campWeeksAttended,
  readCampPaymentMethod,
  type CampPaymentMethod,
  type CampRegistration,
  type CampStatus,
} from './camp.js';

/**
 * The money, with the people taken out.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all.
 *
 * The parish takes money in three places and only one of them keeps it in a
 * document of its own. `bookstoreStats` is nothing but figures, so the
 * `finance` flag can read it exactly. The other two cannot be reached the same
 * way: a camp fee lives in `billing.payments[]` *inside* a `campRegistrations`
 * document, next to the child's grade, allergies and medical notes, and a paid
 * form's total sits on the `formSubmissions` document beside every answer
 * given. Firestore rules grant documents, not fields — so a `finance` flag that
 * reached either would hand the treasurer children's medical notes.
 *
 * That shortfall was written down in three places and left open. This is the
 * thing those notes said to build: **a totals-only document per season and per
 * form**, with no names in it, which `finance` can read on its own.
 *
 * ## The rule this file lives or dies by
 *
 * Nothing here may carry anything that identifies a person. Not a name, not an
 * email, not a check number — `CampPaymentRecord.reference` is a check number
 * or a Zelle confirmation and is deliberately never summarised here, only
 * counted. What comes out is counts and sums, and the only strings are ids the
 * parish chose itself: a program id, a season, a form's own title.
 *
 * The consequence to be honest about: on a season with one registration, the
 * total *is* that family's payment. A rollup cannot fix small numbers, and
 * pretending otherwise by suppressing them would make the treasurer's screen
 * lie in June. What it does guarantee is that no *identity* is attached, which
 * is the difference between a figure and a record about somebody.
 *
 * ## Where the arithmetic happens
 *
 * Here, as pure functions over plain arrays, and called from
 * `functions/src/finance.ts` on a schedule — the same shape as
 * `rollupBookstore`. The browser never aggregates: a treasurer opening the
 * screen reads a handful of documents whatever the season did.
 * ---------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * Ids
 * ------------------------------------------------------------------------ */

/**
 * One collection for both kinds, with the kind in the id.
 *
 * A camp season and a form have nothing in common except that the treasurer
 * reads them together, and two collections would mean two rules, two reads and
 * two chances for one of them to be left behind when the grant changes. The
 * prefix keeps them apart inside the one collection and makes a prefix query —
 * "every camp season" — a range scan rather than a field index.
 */
export function campFinanceDocId(programId: string, season: string): string {
  return `camp__${programId}__${season}`;
}

export function formFinanceDocId(formId: string): string {
  return `form__${formId}`;
}

/* ---------------------------------------------------------------------------
 * Camp
 * ------------------------------------------------------------------------ */

/**
 * What one season is owed and what has come in.
 *
 * Every figure is integer cents, like everywhere else money is handled on this
 * site. `null` is not used for "nothing yet" — a season with no registrations
 * rolls up to a document full of zeroes, so the screen can render it without a
 * second code path and a treasurer can tell "nobody has registered" from "the
 * rollup has not run".
 */
export interface CampFinanceMoney {
  /** `baseCents × billable child-weeks`, before anything comes off. */
  subtotalCents: number;
  /** Everything the discount lines took off, capped at the subtotal. */
  discountCents: number;
  /** What the live registrations owe: subtotal less discounts. */
  dueCents: number;
  /**
   * Money actually recorded as received, across **every** status.
   *
   * Including drafts and withdrawals, deliberately. Money that arrived is money
   * that arrived, and a total that quietly dropped a withdrawn family's payment
   * would stop matching the parish's bank statement — which is the one thing a
   * treasurer's screen has to do. Where that money sits is broken out below.
   */
  receivedCents: number;
  /** Still owed on live registrations. Sum of positive balances only. */
  outstandingCents: number;
  /**
   * Overpayments on live registrations, as a positive number.
   *
   * Kept apart from `outstandingCents` rather than netted against it. Netting
   * would let one family's $50 overpayment hide another's $50 debt and report a
   * season as square when two conversations are owed.
   */
  creditCents: number;
  /** Received against a registration still in `draft`. */
  draftCents: number;
  /**
   * Received against a `withdrawn` registration — a refund waiting to happen,
   * or one that was kept by agreement. Either way it is a number somebody has
   * to look at, which is why it is not folded into the total above.
   */
  withdrawnCents: number;
  /**
   * The sum of every negative payment line: refunds and corrections.
   *
   * Reported as a positive number. It is already netted out of
   * `receivedCents` — a refund is recorded as a negative payment, not as a
   * deletion — so this is "how much went back", not something to subtract
   * again.
   */
  refundedCents: number;
}

export interface CampServantCharges {
  /** Live servants carrying a charge at all. Zero on a camp that charges none. */
  count: number;
  /**
   * The amount each was charged, when every charged servant carries the same.
   *
   * `null` when they do not, for the same reason `weeklyRateCents` is null in
   * that case: the charge is copied onto a sign-up when it is taken, so a camp
   * that raised it mid-season genuinely has two figures in it, and showing one
   * of them would be a lie.
   */
  chargeCents: number | null;
  /** What those charges come to, after any discount against them. */
  billedCents: number;
  /** Of that, what has actually been received. */
  paidCents: number;
  /** Charged servants whose balance is still positive. */
  unpaid: number;
}

export interface CampPaymentTally {
  count: number;
  cents: number;
}

export interface CampFinanceRollup {
  kind: 'camp';
  /** The doc id, repeated inside the document so a query result is self-describing. */
  key: string;
  programId: string;
  season: string;

  /** How many registrations sit in each status. Every status has a key. */
  registrations: Record<CampStatus, number>;
  /** Live registrations — the ones the money above is billed against. */
  billable: number;
  families: number;
  servants: number;
  /** Children on live registrations. */
  children: number;
  /** Child-weeks on live registrations: what the fee is multiplied by. */
  billableWeeks: number;
  /**
   * The weekly fee, when every live *family* was taken at the same one.
   *
   * `null` when they disagree, which is not an error: `billing.baseCents` is
   * copied onto a registration when it is taken, so a season whose fee changed
   * mid-way genuinely has two rates in it. Showing one of them would be a lie
   * and averaging them would be a worse one.
   */
  weeklyRateCents: number | null;

  /**
   * The servants' flat charge, on its own.
   *
   * ---------------------------------------------------------------------------
   * Broken out because it is the one figure on this screen that nobody can
   * derive from the others.
   *
   * Everything else here divides by *family*: child-weeks times a weekly rate.
   * A servant's charge is one flat amount for a shirt — see
   * `CampBilling.chargeCents` — and folded into `money.subtotalCents` it is
   * invisible: a treasurer reading "billed $8,400" against "48 child-weeks at
   * $175" finds the arithmetic does not come out, and has nowhere on the screen
   * to look for the missing $140.
   *
   * It is also the only part of the camp's money that is taken **before** a
   * human being has seen the sign-up. The card is charged by the endpoint; an
   * administrator accepting the sign-up afterwards is what turns it into a
   * registration. So "how much shirt money has come in, and from how many
   * people" is a question with an answer the parish's bank statement can be
   * matched against, and it should not have to be reconstructed.
   * ---------------------------------------------------------------------------
   */
  servantCharges: CampServantCharges;

  money: CampFinanceMoney;
  /** How the money came in. Every method has a key, most of them zero. */
  byMethod: Record<CampPaymentMethod, CampPaymentTally>;
  /** Received, bucketed by the day it arrived: `YYYY-MM` → cents. */
  byMonth: Record<string, number>;

  /** Live registrations whose balance is settled. */
  settled: number;
  /** Live registrations still owing something. */
  owing: number;

  computedAt: Timestamped;
}

/**
 * The statuses whose bill counts.
 *
 * A draft is not yet a registration and a waitlisted family has not been given
 * a place — billing either would put money in the "owed" column that nobody has
 * agreed to pay. A withdrawal's bill is cancelled; its *payments* are not, and
 * they are carried separately above.
 */
const LIVE_STATUSES: readonly CampStatus[] = ['registered'];

function zeroMethods(): Record<CampPaymentMethod, CampPaymentTally> {
  return Object.fromEntries(
    CAMP_PAYMENT_METHODS.map((method) => [method, { count: 0, cents: 0 }]),
  ) as Record<CampPaymentMethod, CampPaymentTally>;
}

function zeroStatuses(): Record<CampStatus, number> {
  return Object.fromEntries(CAMP_STATUSES.map((status) => [status, 0])) as Record<
    CampStatus,
    number
  >;
}

export function emptyCampFinance(programId: string, season: string): Omit<CampFinanceRollup, 'computedAt'> {
  return {
    kind: 'camp',
    key: campFinanceDocId(programId, season),
    programId,
    season,
    registrations: zeroStatuses(),
    billable: 0,
    families: 0,
    servants: 0,
    children: 0,
    billableWeeks: 0,
    weeklyRateCents: null,
    servantCharges: { count: 0, chargeCents: null, billedCents: 0, paidCents: 0, unpaid: 0 },
    money: {
      subtotalCents: 0,
      discountCents: 0,
      dueCents: 0,
      receivedCents: 0,
      outstandingCents: 0,
      creditCents: 0,
      draftCents: 0,
      withdrawnCents: 0,
      refundedCents: 0,
    },
    byMethod: zeroMethods(),
    byMonth: {},
    settled: 0,
    owing: 0,
  };
}

/**
 * What this rollup needs off a registration, and nothing more.
 *
 * A structural type rather than `CampRegistration` so the Function can hand it
 * documents straight out of Firestore and the tests can hand it four fields.
 * It is also a statement of intent: this is the whole of what leaves the
 * sensitive collection, and adding a field here is a decision to be argued
 * rather than a convenience.
 */
export type CampFinanceInput = Pick<
  CampRegistration,
  'kind' | 'status' | 'children' | 'billing'
>;

/**
 * Add a season up.
 *
 * Idempotent and total: it reads an array and returns a document. Nothing is
 * accumulated across calls, so a retried scheduled run writes the same answer
 * rather than doubling it — the same property `rollupDay` rests on, and the
 * only way a job that can be retried is safe to write totals at all.
 */
export function rollupCampFinance(input: {
  programId: string;
  season: string;
  registrations: readonly CampFinanceInput[];
}): Omit<CampFinanceRollup, 'computedAt'> {
  const out = emptyCampFinance(input.programId, input.season);
  const rates = new Set<number>();
  /* The servants' side of the same question — see `CampServantCharges`. */
  const charges = new Set<number>();

  for (const registration of input.registrations) {
    const status: CampStatus = registration.status;
    if (status in out.registrations) out.registrations[status] += 1;

    const live = LIVE_STATUSES.includes(status);
    const bill = campBill(registration);

    if (live) {
      out.billable += 1;
      if (registration.kind === 'family') {
        out.families += 1;
        out.children += registration.children.length;
        for (const child of registration.children) {
          out.billableWeeks += campWeeksAttended(child.days);
        }
        /*
         * Families only. A servant is billed nothing and is saved with
         * `baseCents: 0`, so counting theirs would put a second rate in this
         * set on every real season and report "more than one weekly rate"
         * for ever — which is what the first version of this did.
         */
        rates.add(Math.max(0, Math.round(registration.billing.baseCents)));
      } else {
        out.servants += 1;

        /*
         * The shirt money, counted apart from everything above.
         *
         * Only servants who actually carry one: a camp that charges nothing
         * leaves every one of these at zero and the screen draws no line for
         * it, which is the state most camps are in. `bill.dueCents` rather
         * than the raw charge, because a discount against a servant is as real
         * as a discount against a family.
         */
        if (bill.chargeCents > 0) {
          out.servantCharges.count += 1;
          out.servantCharges.billedCents += bill.dueCents;
          out.servantCharges.paidCents += bill.paidCents;
          if (bill.balanceCents > 0) out.servantCharges.unpaid += 1;
          charges.add(bill.chargeCents);
        }
      }

      out.money.subtotalCents += bill.subtotalCents;
      out.money.discountCents += bill.discountCents;
      out.money.dueCents += bill.dueCents;

      /*
       * Balances are split at zero rather than summed. See `creditCents`: a
       * season where one family is $50 ahead and another $50 behind is two
       * conversations, and a net of zero is the one answer that hides both.
       */
      if (bill.balanceCents > 0) {
        out.money.outstandingCents += bill.balanceCents;
        out.owing += 1;
      } else {
        out.money.creditCents += -bill.balanceCents;
        out.settled += 1;
      }
    } else if (status === 'draft') {
      out.money.draftCents += bill.paidCents;
    } else if (status === 'withdrawn') {
      out.money.withdrawnCents += bill.paidCents;
    }

    /*
     * Payments are counted for every status, not only the live ones.
     *
     * This is the line that makes the screen reconcilable against a bank
     * statement: the bank does not know that a family withdrew in July, only
     * that a check cleared in June.
     */
    for (const payment of registration.billing.payments) {
      const cents = Math.round(payment.amountCents);
      if (!Number.isFinite(cents) || cents === 0) continue;

      out.money.receivedCents += cents;
      if (cents < 0) out.money.refundedCents += -cents;

      const method = readCampPaymentMethod(payment.method);
      const tally = out.byMethod[method];
      tally.count += 1;
      tally.cents += cents;

      /*
       * Bucketed by `receivedOn` — the day the money arrived — rather than by
       * when it was typed in. A check handed over on Sunday is entered on
       * Tuesday, and a treasurer matching this against a statement is looking
       * for the Sunday.
       */
      const month = monthOf(payment.receivedOn);
      if (month) out.byMonth[month] = (out.byMonth[month] ?? 0) + cents;
    }
  }

  out.weeklyRateCents = rates.size === 1 ? [...rates][0]! : null;
  // Null when a season carries two different charges, and null when it carries
  // none — the count beside it is what tells those two apart.
  out.servantCharges.chargeCents = charges.size === 1 ? [...charges][0]! : null;
  return out;
}

/** `2027-06-14` → `2027-06`. Null for anything that is not an ISO day. */
function monthOf(day: unknown): string | null {
  if (typeof day !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(day.trim()) ? day.trim().slice(0, 7) : null;
}

/* ---------------------------------------------------------------------------
 * Forms
 * ------------------------------------------------------------------------ */

/**
 * What one form has taken.
 *
 * Per form rather than one document for all of them, because "how much did the
 * retreat bring in" is the question actually asked, and a single total across
 * every paid form on the site answers nobody's question while being just as
 * much work to compute.
 *
 * The form's own `title` and `slug` are carried. They are not personal data —
 * the parish wrote them and they are on a public page — and without them the
 * screen would show a treasurer a column of Firestore ids.
 */
export interface FormFinanceRollup {
  kind: 'form';
  key: string;
  formId: string;
  formSlug: string;
  formTitle: string;

  /** Every submission stored against this form. */
  submissions: number;
  /** Submissions that were priced at something. */
  chargedSubmissions: number;
  /**
   * Priced, and Square took the money — `paymentId` is set.
   *
   * The gap between this and `chargedSubmissions` is the interesting number and
   * is why the two are separate: a submission with a total and no payment id is
   * one the charge did not complete for, which is money the parish thinks it
   * has and does not.
   */
  paidSubmissions: number;
  grossCents: number;
  /** Priced but unpaid. See above — this is a number somebody should look at. */
  uncollectedCents: number;

  /** Taken, bucketed by the month it was submitted: `YYYY-MM` → cents. */
  byMonth: Record<string, number>;

  computedAt: Timestamped;
}

export function emptyFormFinance(form: {
  id: string;
  slug: string;
  title: string;
}): Omit<FormFinanceRollup, 'computedAt'> {
  return {
    kind: 'form',
    key: formFinanceDocId(form.id),
    formId: form.id,
    formSlug: form.slug,
    formTitle: form.title,
    submissions: 0,
    chargedSubmissions: 0,
    paidSubmissions: 0,
    grossCents: 0,
    uncollectedCents: 0,
    byMonth: {},
  };
}

/**
 * What this rollup needs off a submission: a price, whether it was taken, and
 * when. Not the answers, not the submitter, not their email.
 */
export interface FormFinanceInput {
  totalCents: number;
  paymentId: string | null;
  /** `YYYY-MM`, from `submittedAt`. The caller converts; this module has no clock. */
  month: string | null;
}

export function rollupFormFinance(input: {
  form: { id: string; slug: string; title: string };
  submissions: readonly FormFinanceInput[];
}): Omit<FormFinanceRollup, 'computedAt'> {
  const out = emptyFormFinance(input.form);

  for (const submission of input.submissions) {
    out.submissions += 1;

    const cents = Math.max(0, Math.round(submission.totalCents) || 0);
    if (cents === 0) continue;

    out.chargedSubmissions += 1;
    if (submission.paymentId) {
      out.paidSubmissions += 1;
      out.grossCents += cents;
      if (submission.month) {
        out.byMonth[submission.month] = (out.byMonth[submission.month] ?? 0) + cents;
      }
    } else {
      out.uncollectedCents += cents;
    }
  }

  return out;
}

/* ---------------------------------------------------------------------------
 * Reading them back
 * ------------------------------------------------------------------------ */

export type FinanceRollup = CampFinanceRollup | FormFinanceRollup;

export function isCampFinanceRollup(value: FinanceRollup): value is CampFinanceRollup {
  return value.kind === 'camp';
}

/**
 * Coerce anything out of Firestore into one of the two shapes, or null.
 *
 * Tolerant in the same way every other parser here is, and for the usual
 * reason: these documents are written by a Function that will be edited, read
 * by a screen deployed separately from it, and a missing key must render a zero
 * rather than a crash on the treasurer's screen.
 */
export function parseFinanceRollup(raw: unknown): FinanceRollup | null {
  const doc = asRecord(raw);
  if (doc['kind'] === 'camp') return parseCampFinance(doc);
  if (doc['kind'] === 'form') return parseFormFinance(doc);
  return null;
}

function parseCampFinance(doc: Record<string, unknown>): CampFinanceRollup {
  const programId = str(doc['programId']) || 'summercamp';
  const season = str(doc['season']);
  const base = emptyCampFinance(programId, season);

  const statuses = asRecord(doc['registrations']);
  const registrations = zeroStatuses();
  for (const status of CAMP_STATUSES) registrations[status] = num(statuses[status]);

  const methods = asRecord(doc['byMethod']);
  const byMethod = zeroMethods();
  for (const method of CAMP_PAYMENT_METHODS) {
    const tally = asRecord(methods[method]);
    byMethod[method] = { count: num(tally['count']), cents: num(tally['cents']) };
  }

  const money = asRecord(doc['money']);

  /*
   * Absent on every document written before the charge existed, which is every
   * document in the parish today until the next hourly run. `base` supplies the
   * zeroes, and a zero count is exactly what "this camp charges its servants
   * nothing" looks like — so a stale rollup reads as a season with no shirt
   * money rather than crashing the screen on an undefined.
   */
  const charges = asRecord(doc['servantCharges']);

  return {
    ...base,
    key: str(doc['key']) || base.key,
    registrations,
    billable: num(doc['billable']),
    families: num(doc['families']),
    servants: num(doc['servants']),
    children: num(doc['children']),
    billableWeeks: num(doc['billableWeeks']),
    weeklyRateCents: typeof doc['weeklyRateCents'] === 'number' ? doc['weeklyRateCents'] : null,
    servantCharges: {
      count: num(charges['count']),
      chargeCents: typeof charges['chargeCents'] === 'number' ? charges['chargeCents'] : null,
      billedCents: num(charges['billedCents']),
      paidCents: num(charges['paidCents']),
      unpaid: num(charges['unpaid']),
    },
    money: {
      subtotalCents: num(money['subtotalCents']),
      discountCents: num(money['discountCents']),
      dueCents: num(money['dueCents']),
      receivedCents: num(money['receivedCents']),
      outstandingCents: num(money['outstandingCents']),
      creditCents: num(money['creditCents']),
      draftCents: num(money['draftCents']),
      withdrawnCents: num(money['withdrawnCents']),
      refundedCents: num(money['refundedCents']),
    },
    byMethod,
    byMonth: numberMap(doc['byMonth']),
    settled: num(doc['settled']),
    owing: num(doc['owing']),
    computedAt: (doc['computedAt'] ?? null) as Timestamped,
  };
}

function parseFormFinance(doc: Record<string, unknown>): FormFinanceRollup {
  const form = {
    id: str(doc['formId']),
    slug: str(doc['formSlug']),
    title: str(doc['formTitle']),
  };
  const base = emptyFormFinance(form);

  return {
    ...base,
    key: str(doc['key']) || base.key,
    submissions: num(doc['submissions']),
    chargedSubmissions: num(doc['chargedSubmissions']),
    paidSubmissions: num(doc['paidSubmissions']),
    grossCents: num(doc['grossCents']),
    uncollectedCents: num(doc['uncollectedCents']),
    byMonth: numberMap(doc['byMonth']),
    computedAt: (doc['computedAt'] ?? null) as Timestamped,
  };
}

/* ---------------------------------------------------------------------------
 * Putting the three together
 * ------------------------------------------------------------------------ */

/**
 * The three sources do not share a period, and pretending they do is the one
 * way this screen could lie.
 *
 * ---------------------------------------------------------------------------
 * The bookstore is bucketed by day and by month. The camp is bucketed by
 * *season* — a year, or whatever the parish called it. A form is bucketed by
 * nothing at all; it simply accumulates. Adding "this month's shop takings" to
 * "the 2027 camp" produces a number that means nothing, and it would be the
 * first number on the screen.
 *
 * So the two rollups carry a `byMonth` map — camp payments by the day the money
 * arrived, form charges by the month submitted — and a month is the one period
 * all three can honestly answer. That is what these helpers compute, and it is
 * why the screen leads with a month rather than with a grand total.
 *
 * What is deliberately *not* offered is an all-time total across the three.
 * `bookstoreStats` has no all-time document — the scheduled rollup writes days
 * and months and nothing wider — so any such figure would silently be
 * "the camp and the forms, for ever, plus the shop, for never".
 * ---------------------------------------------------------------------------
 */
export interface FinanceMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Gross bookstore revenue, as `bookstoreStats` reports it. */
  bookstoreCents: number;
  /** Refunded in the same month. Already counted in the line above. */
  bookstoreRefundedCents: number;
  /*
   * `bookstoreCents` divided into what it is: the books, the sales tax, and
   * delivery (postage and handling). The three add up to `bookstoreCents`.
   */
  bookstoreSalesCents: number;
  bookstoreTaxCents: number;
  bookstoreDeliveryCents: number;
  /**
   * Sales tax collected this month less the tax on refunded orders — what the
   * parish holds for the Commonwealth and has to pay over. Inside `netCents`,
   * so it is shown beside it rather than subtracted silently.
   */
  salesTaxDueCents: number;
  /** Camp payments recorded as received in this month, refunds netted out. */
  campCents: number;
  /** Form charges Square took in this month. */
  formsCents: number;
  /** The three gross figures, added. */
  receivedCents: number;
  /** The same, less the bookstore refunds. What the parish actually kept. */
  netCents: number;
}

export function financeMonth(input: {
  month: string;
  bookstore: {
    revenue: number;
    refunded: number;
    /* The split, from `bookstoreStats.totals`. Absent ⇒ all of it is books. */
    salesCents?: number;
    taxCents?: number;
    postageCents?: number;
    handlingCents?: number;
    refundedTaxCents?: number;
  } | null;
  camp: readonly Pick<CampFinanceRollup, 'byMonth'>[];
  forms: readonly Pick<FormFinanceRollup, 'byMonth'>[];
}): FinanceMonth {
  const bookstoreCents = input.bookstore?.revenue ?? 0;
  const bookstoreRefundedCents = input.bookstore?.refunded ?? 0;
  const bookstoreTaxCents = input.bookstore?.taxCents ?? 0;
  const bookstoreDeliveryCents =
    (input.bookstore?.postageCents ?? 0) + (input.bookstore?.handlingCents ?? 0);
  const campCents = input.camp.reduce((sum, one) => sum + (one.byMonth[input.month] ?? 0), 0);
  const formsCents = input.forms.reduce((sum, one) => sum + (one.byMonth[input.month] ?? 0), 0);

  const receivedCents = bookstoreCents + campCents + formsCents;

  return {
    month: input.month,
    bookstoreCents,
    bookstoreRefundedCents,
    // Whatever is left of the revenue, so the three always sum to it.
    bookstoreSalesCents: bookstoreCents - bookstoreTaxCents - bookstoreDeliveryCents,
    bookstoreTaxCents,
    bookstoreDeliveryCents,
    salesTaxDueCents: Math.max(0, bookstoreTaxCents - (input.bookstore?.refundedTaxCents ?? 0)),
    campCents,
    formsCents,
    receivedCents,
    /*
     * Only the bookstore's refunds are subtracted, and the asymmetry is real
     * rather than an oversight. A camp refund is recorded as a negative
     * payment, so it has *already* reduced `campCents` — subtracting it again
     * would double it. `bookstoreStats` keeps a refunded order counted as
     * revenue with the refund beside it, deliberately, so that the figures
     * agree with Square's own reports.
     */
    netCents: receivedCents - bookstoreRefundedCents,
  };
}

/**
 * What is owed right now, which is not a period at all.
 *
 * A family that has not paid owes it today whichever month they registered in,
 * so this is deliberately outside the month selector — and the screen says so,
 * because a figure sitting under a month heading will be read as belonging to
 * it.
 */
export interface FinanceStanding {
  /** Camp fees still owed, across every season. */
  campOutstandingCents: number;
  /** Money held against registrations that were withdrawn — refunds pending. */
  campWithdrawnCents: number;
  /** Form submissions priced at something the charge never completed for. */
  formsUncollectedCents: number;
  owedCents: number;
}

export function financeStanding(
  camp: readonly Pick<CampFinanceRollup, 'money'>[],
  forms: readonly Pick<FormFinanceRollup, 'uncollectedCents'>[],
): FinanceStanding {
  const campOutstandingCents = camp.reduce((sum, one) => sum + one.money.outstandingCents, 0);
  const campWithdrawnCents = camp.reduce((sum, one) => sum + one.money.withdrawnCents, 0);
  const formsUncollectedCents = forms.reduce((sum, one) => sum + one.uncollectedCents, 0);

  return {
    campOutstandingCents,
    campWithdrawnCents,
    formsUncollectedCents,
    // Withdrawn money is not owed *to* the parish, so it is not in this sum.
    owedCents: campOutstandingCents + formsUncollectedCents,
  };
}

/**
 * Every month the rollups have anything to say about, newest first.
 *
 * Drives the screen's month picker. Built from the data rather than from a
 * fixed "last twelve months", because the camp takes its money in three of them
 * and a picker full of empty Februaries is a picker nobody scrolls. The caller
 * adds the current month, so the screen opens on something even in a month
 * where nothing has happened yet.
 */
export function financeMonths(
  camp: readonly Pick<CampFinanceRollup, 'byMonth'>[],
  forms: readonly Pick<FormFinanceRollup, 'byMonth'>[],
  also: readonly string[] = [],
): string[] {
  const months = new Set<string>(also.filter((month) => /^\d{4}-\d{2}$/.test(month)));
  for (const one of camp) for (const month of Object.keys(one.byMonth)) months.add(month);
  for (const one of forms) for (const month of Object.keys(one.byMonth)) months.add(month);
  return [...months].sort().reverse();
}

/* ---------------------------------------------------------------------------
 * bits
 * ------------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

function numberMap(value: unknown): Record<string, number> {
  const source = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(source)) {
    const cents = num(entry);
    if (cents !== 0) out[key] = cents;
  }
  return out;
}
