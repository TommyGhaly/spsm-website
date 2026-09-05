'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  CAMP_PAYMENT_METHODS,
  CAMP_STATUSES,
  campPaymentMethodLabel,
  financeMonth,
  financeMonths,
  financeStanding,
  toDate,
  type BookstoreStats,
  type CampFinanceRollup,
  type FinanceSource,
  type FormFinanceRollup,
} from '@spsm/shared';
import { isSuperadmin } from '@spsm/shared';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { getServerSnapshot, getSnapshot, signIn, subscribe } from '@/lib/authStore';
import { money } from '@/features/bookstore/money';
import type { CampRoster as CampRosterReading } from './data';
import { useFinanceAdmin } from './useFinanceAdmin';

/**
 * The parish's money, in one place, for the person who has to account for it.
 *
 * ---------------------------------------------------------------------------
 * ## What this screen is, and the constraint that shaped it
 *
 * The parish takes money in three places — the bookstore, the summer camp, and
 * whichever forms charge for something — and until now a treasurer could only
 * see one of them. Not for want of a screen: `finance` was a grant that could
 * not honestly be given the other two, because camp fees live inside a
 * registration document beside a child's allergies and a form's total sits
 * beside every answer given, and Firestore rules grant documents rather than
 * fields.
 *
 * So the fix was never a page. It was `functions/src/finance.ts`, which reads
 * those collections on a server and writes documents with the people taken out.
 * This screen is what those documents are for, and every figure on it is a
 * field of a document the reader is allowed to read. Nothing here aggregates
 * anything; nothing here can be made to leak a name, because there is no name
 * within reach.
 *
 * ## Why it leads with a month
 *
 * The three sources do not share a period. The shop is rolled up by day and
 * month, the camp by season, a form not at all. A grand total across them would
 * be the first number on the screen and would mean nothing. A month is the one
 * window all three can answer honestly — see `financeMonth` — so the month is
 * what the top band is, and everything beneath it is explicitly labelled as
 * standing rather than periodic.
 *
 * ## What is deliberately absent
 *
 * *Sunday giving.* It goes through Tithe.ly, which this site frames and does
 * not process, and not one cent of it reaches Firestore. It is named on the
 * screen rather than left out silently, because a total that quietly excludes
 * the collection plate reads as the parish's income and is not.
 *
 * *Anything to click that changes a number.* This is a report. The refresh
 * button recomputes the rollups from the records; it does not touch a record.
 * A screen where the reported-on can edit the report is not a report.
 * ---------------------------------------------------------------------------
 */
export function FinanceScreen() {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const session = useFinanceAdmin();

  if (auth.kind === 'restoring' || auth.kind === 'signing-in' || !session.ready) {
    return (
      <Shell>
        <p className="note">Loading…</p>
      </Shell>
    );
  }

  if (auth.kind !== 'signed-in') {
    return (
      <Shell>
        <div className="notice">
          <h2>Sign in first</h2>
          <p>These are the church&rsquo;s accounts.</p>
          <p>
            <button type="button" className="button" onClick={() => void signIn()}>
              Sign in with Microsoft
            </button>
          </p>
        </div>
      </Shell>
    );
  }

  if (!session.canView) {
    /*
     * Said plainly rather than 404ed, for the reason the admin hub gives: the
     * difference between "you have not been given this" and "this is broken" is
     * the difference between a shrug and a phone call to the office.
     */
    return (
      <Shell>
        <div className="notice">
          <h2>This one is not yours</h2>
          <p>
            The church&rsquo;s figures are shown to whoever looks after them. If that should
            be you, ask an administrator to give you the Finance area.
          </p>
        </div>
      </Shell>
    );
  }

  /*
   * The grant, held, with every source unticked.
   *
   * A real allocation rather than a corner case: /access offers the sources
   * under the Finance row, and somebody who ticks the row and nothing beneath
   * it has said "not yet". Rendering the report would draw sections of zeroes
   * and a treasurer would read that as the church having taken nothing, which
   * is the one wrong answer a money screen must never give.
   *
   * The three are deliberately **not** named here. This screen never tells a
   * reader what exists beyond what they hold — see the note on `FinanceBody` —
   * and a refusal that lists the rooms is still a description of the building.
   */
  if (session.sources.length === 0) {
    /*
     * A superadmin gets a different sentence, because for them it is not a
     * refusal — they narrowed themselves, they can reach every figure, and
     * "ask an administrator" would be advice to ask themselves.
     */
    const mine = isSuperadmin(session.claims);
    return (
      <Shell>
        <div className="notice">
          <h2>{mine ? 'You have set this to show nothing' : 'Nothing has been opened to you yet'}</h2>
          {mine ? (
            <p>
              None of the parts of Finance is ticked for you on{' '}
              <a href="/access">Areas</a>. Tick one there and it appears here.
            </p>
          ) : (
            <p>
              You have the Finance area, but no part of it has been opened to you. Ask an
              administrator which of it should be yours.
            </p>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <FinanceBody sources={session.sources} runsCamp={session.runsCamp} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Finance" />
      <PageBody>
        <section className="band">
          <div className="wrap">
            <h1 className="fin__title">Finance</h1>
            {children}
          </div>
        </section>
      </PageBody>
    </>
  );
}

/* ---- the report --------------------------------------------------------- */

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; camp: CampFinanceRollup[]; forms: FormFinanceRollup[] }
  | { kind: 'failed'; message: string };

/**
 * The report, drawn from what this reader holds and nothing else.
 *
 * ---------------------------------------------------------------------------
 * ## The rule this whole component is arranged around
 *
 * **Somebody with one source sees that one section, alone.** No totals, no
 * cross-source bands, and nothing that says another part of the church's money
 * exists. At Tommy's direction, and it is a stronger rule than the one this was
 * first built to: hiding the figures you were not given still leaves a screen
 * that describes its own shape — a "Together" tile with one number under it, a
 * line reading "this is the bookstore only", a lede naming three sources and
 * showing one. Each of those is a sentence about somebody else's business, told
 * to a person who was deliberately not given it.
 *
 * So the cross-source furniture — "Money in", "Owed to the church", and every
 * caveat that names a source in order to exclude it — appears only for a reader
 * holding more than one. With one source there is nothing to add up, nothing to
 * qualify, and no reason to mention any of it.
 *
 * ## Which means the copy is assembled, not written
 *
 * `listOf` builds the lede's subject from the sources held, and the sentences
 * that are *about* a source (the camp's payment dates, the shop's refunds) are
 * conditional on that source. A fixed sentence naming the three would be a leak
 * in a screen whose whole design is that it does not have one.
 * ---------------------------------------------------------------------------
 */
function FinanceBody({ sources, runsCamp }: { sources: FinanceSource[]; runsCamp: boolean }) {
  /*
   * Which sources this reader holds, asked once and used everywhere.
   *
   * Every read and every section below keys off these rather than off
   * `canView`, and the two must agree with `firestore.rules`: a section drawn
   * for a source the rules refuse shows an error where a figure belongs, and a
   * read fired for one is a permission error in the console for no reason.
   */
  const seesShop = sources.includes('bookstore');
  const seesCamp = sources.includes('camp');
  const seesForms = sources.includes('forms');
  /**
   * One source and one section — no totals band, no standing band, no aside.
   *
   * The distinction is not cosmetic. With two sources a total is a real figure
   * about things that are both yours; with one it is the same number written
   * twice, and the only thing the second copy adds is the news that it could
   * have been a sum of something.
   */
  const single = sources.length === 1;

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [month, setMonth] = useState<string>(() => parishMonth(0));
  const [bookstore, setBookstore] = useState<BookstoreStats | null>(null);
  const [bookstoreReady, setBookstoreReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const { readFinance } = await import('./data');
      const reading = await readFinance(sources);
      setLoad({ kind: 'ready', camp: reading.camp, forms: reading.forms });
    } catch (cause) {
      setLoad({
        kind: 'failed',
        message: cause instanceof Error ? cause.message : 'Could not read the figures.',
      });
    }
    // `sources` is a fresh array each render, so the joined string is what this
    // depends on — listing the array would re-read on every render for ever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources.join(',')]);

  useEffect(() => {
    void read();
  }, [read]);

  // The shop's month is a separate document, so it is a separate read — and it
  // is allowed to fail on its own. A month the shop sold nothing in has no
  // document at all, which is an answer rather than an error.
  useEffect(() => {
    let live = true;
    // Not read at all without the shop's source — `bookstoreStats` is refused
    // by the rules, and firing it would put a permission error in the console
    // of somebody whose allocation is working exactly as intended.
    if (!seesShop) {
      setBookstore(null);
      setBookstoreReady(true);
      return;
    }
    setBookstoreReady(false);
    void (async () => {
      try {
        const { readBookstoreMonth } = await import('./data');
        const stats = await readBookstoreMonth(month);
        if (live) setBookstore(stats);
      } catch {
        if (live) setBookstore(null);
      } finally {
        if (live) setBookstoreReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [month, seesShop]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const { refreshFinance } = await import('./data');
      await refreshFinance();
      await read();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  const camp = load.kind === 'ready' ? load.camp : [];
  const forms = load.kind === 'ready' ? load.forms : [];

  const months = useMemo(
    () => financeMonths(camp, forms, [parishMonth(0), parishMonth(1)]),
    [camp, forms],
  );
  const totals = useMemo(
    () =>
      financeMonth({
        month,
        bookstore: bookstore ? { revenue: bookstore.totals.revenue, refunded: bookstore.totals.refunded } : null,
        camp,
        forms,
      }),
    [month, bookstore, camp, forms],
  );
  const standing = useMemo(() => financeStanding(camp, forms), [camp, forms]);

  if (load.kind === 'loading') return <p className="note">Reading the figures…</p>;

  if (load.kind === 'failed') {
    return (
      <div className="notice">
        <h2>Could not read the figures</h2>
        <p>{load.message}</p>
        <p>
          <button type="button" className="button" onClick={() => void read()}>
            Try again
          </button>
        </p>
      </div>
    );
  }

  const nothingYet = camp.length === 0 && forms.length === 0 && !bookstore;

  /** "the bookstore and the paid forms" — what this reader's figures are of. */
  const named = listOf([
    seesShop ? 'the bookstore' : null,
    seesCamp ? 'the summer camp' : null,
    seesForms ? 'the paid forms' : null,
  ]);

  /** "every season and every form" — what the standing band reaches. */
  const owedAcross = listOf([
    seesCamp ? 'every season' : null,
    seesForms ? 'every form' : null,
  ]);

  /** The same list, as the records the figures are worked out from. */
  const records = listOf([
    seesShop ? 'the shop’s orders' : null,
    seesCamp ? 'the camp’s ledger' : null,
    seesForms ? 'the paid forms' : null,
  ]);

  return (
    <div className="fin">
      <div className="fin__bar">
        {/*
          The month picker, only where a month changes something on the page.
          The band it was built for is the cross-source one, and the shop is the
          only section keyed to a month of its own — so a camp treasurer, whose
          seasons are seasons, would otherwise be given a control that moves
          nothing. A dead control on a money screen reads as a figure that
          failed to update.
        */}
        {(!single || seesShop) && (
          <label className="fin__monthPick">
            <span>Month</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((option) => (
                <option key={option} value={option}>
                  {monthLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="fin__refresh"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Adding it up…' : 'Recalculate'}
        </button>
      </div>

      {error && <p className="fin__error" role="alert">{error}</p>}

      {nothingYet && (
        <div className="notice">
          <h2>Nothing has been added up yet</h2>
          {/*
            Named from `sources` rather than from a fixed sentence about the
            shop's orders, the camp's ledger and the paid forms. The empty state
            was the last place on this screen that described the whole of the
            church's money to somebody holding one part of it.
          */}
          <p>
            The figures are recalculated every hour from {records}. If this church has taken
            money and nothing is shown, press Recalculate.
          </p>
        </div>
      )}

      {/* ---- what came in, for one month ---- */}
      {/*
        The whole band is a total, so a reader with one source does not get it.
        Their section below already carries every figure this would show, and
        the only thing the second copy would add is the shape of the screen for
        somebody who has more.
      */}
      {!single && (
      <section className="fin__section">
        <h2 className="fin__h2">Money in — {monthLabel(month)}</h2>
        <p className="fin__lede">
          What {named} took in this month.
          {seesCamp && ' The camp is counted on the day the money arrived, not the day it was typed in.'}
        </p>

        {/*
          One tile per source held, and no tile for a source that is not.
          A zero in a money report is a statement — "the camp took nothing this
          month" — and drawing one for a part of the church this reader was
          never given would be a false statement rather than a blank.
        */}
        <div className="fin__tiles">
          {seesShop && (
            <Tile
              label="Bookstore"
              cents={totals.bookstoreCents}
              note={bookstoreReady ? undefined : 'reading…'}
            />
          )}
          {seesCamp && <Tile label="Summer camp" cents={totals.campCents} />}
          {seesForms && <Tile label="Forms" cents={totals.formsCents} />}
          <Tile label="Together" cents={totals.receivedCents} strong />
        </div>

        {/*
          There was a line here reading "This is the bookstore only. The rest of
          what the church takes is shown to whoever looks after it." It was
          written to stop a partial total being read as the parish's income, and
          it bought that by telling the reader there is a rest — which is the one
          thing this screen must not do. The lede names what the total is of, and
          that is the whole of the qualification anybody needs.
        */}

        {totals.bookstoreRefundedCents > 0 && (
          <p className="fin__foot">
            {money(totals.bookstoreRefundedCents)} was refunded from the bookstore this month.
            Shop takings are shown gross, with the refund beside them, so they agree with
            Square&rsquo;s own reports — the church kept {money(totals.netCents)}.
          </p>
        )}

        {/*
          Tithe.ly is not one of the sources and never can be — it is money that
          never reaches this site's records at all — so naming it discloses
          nothing about what this reader was or was not given. It belongs to the
          total, though, which is why it sits inside this band rather than at the
          foot of the page: with one source there is no total to mistake for the
          parish's income.
        */}
        <p className="fin__foot">
          Sunday giving is not here and cannot be: it goes through Tithe.ly, which this site
          shows but does not process. Nothing given there passes through this church&rsquo;s own
          records.
        </p>
      </section>
      )}

      {/* ---- what is owed, which is not a month ---- */}
      {/*
        Nothing is owed through the shop — a book is paid for or it is not sold
        — so this belongs to the camp and the forms, and somebody who holds only
        the bookstore never sees it.

        And it is a total, so a reader with one source does not see it either.
        Every figure in it is already on the section below: a season carries its
        own "Still owed" line and a form its own "Not taken" column, which is
        where a treasurer with one of them reads it. What this band adds is the
        sum across both, and a sum across both is only worth drawing for
        somebody who has both.
      */}
      {!single && (seesCamp || seesForms) && (
      <section className="fin__section">
        <h2 className="fin__h2">Owed to the church</h2>
        <p className="fin__lede">
          As it stands today, across {owedAcross} — not for the month above.
        </p>

        <div className="fin__tiles">
          {seesCamp && <Tile label="Camp fees unpaid" cents={standing.campOutstandingCents} />}
          {seesForms && (
            <Tile label="Form charges not taken" cents={standing.formsUncollectedCents} />
          )}
          {seesCamp && seesForms && (
            <Tile label="Together" cents={standing.owedCents} strong />
          )}
        </div>

        {seesCamp && standing.campWithdrawnCents > 0 && (
          <p className="fin__foot">
            {money(standing.campWithdrawnCents)} is held against registrations that were
            withdrawn. It is not owed to the church — it is either a refund waiting to be made
            or money kept by agreement, and either way somebody has to decide which.
          </p>
        )}
      </section>
      )}

      {/* ---- the camp, season by season ---- */}
      {seesCamp && (
      <section className="fin__section">
        <h2 className="fin__h2">Summer camp</h2>
        {/*
          Said once, at the top, rather than on every season: the two halves of
          each season below are worked out at different times, and a treasurer
          who has just watched a check be recorded needs to know which half to
          believe. The totals are the hourly rollup; the roster is read now.
        */}
        {runsCamp && camp.length > 0 && (
          <p className="fin__lede">
            Each season&rsquo;s totals are from the hourly rollup. The families beneath them are
            read from the camp&rsquo;s records as you open this, so a payment taken this
            morning is in the roster before it is in the totals.
          </p>
        )}
        {/*
          The seasons stop being cards side by side once each one carries a
          roster. Six columns of figures inside a 22rem grid track is a table
          that wraps every row onto three lines — the card layout is right for
          a ledger and wrong for a list of families, so the grid is dropped
          rather than the table squeezed.
        */}
        {camp.length === 0 ? (
          <p className="fin__empty">No season has been rolled up yet.</p>
        ) : (
          <ul className={runsCamp ? 'fin__seasons fin__seasons--full' : 'fin__seasons'}>
            {camp.map((season) => (
              <li key={season.key}>
                <Season season={season} runsCamp={runsCamp} />
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {/* ---- the forms ---- */}
      {seesForms && (
      <section className="fin__section">
        <h2 className="fin__h2">Forms that charge</h2>
        {forms.length === 0 ? (
          <p className="fin__empty">
            No form on the site charges for anything. A free form is not counted here.
          </p>
        ) : (
          <table className="fin__table">
            <thead>
              <tr>
                <th scope="col">Form</th>
                <th scope="col">Paid</th>
                <th scope="col">Taken</th>
                <th scope="col">Not taken</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((form) => (
                <tr key={form.key}>
                  <th scope="row">
                    {form.formTitle || form.formId}
                    <span className="fin__sub">
                      {form.submissions} submission{form.submissions === 1 ? '' : 's'} in all
                    </span>
                  </th>
                  <td>
                    {form.paidSubmissions} of {form.chargedSubmissions}
                  </td>
                  <td className="fin__num">{money(form.grossCents)}</td>
                  <td className="fin__num">
                    {form.uncollectedCents > 0 ? money(form.uncollectedCents) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fin__foot">
          &ldquo;Not taken&rdquo; is a submission that was priced and whose payment never
          completed. The church has the answers and not the money.
        </p>
      </section>
      )}

      {/* ---- the shop ---- */}
      {seesShop && (
      <section className="fin__section">
        <h2 className="fin__h2">Bookstore — {monthLabel(month)}</h2>
        {bookstore ? (
          <>
            <div className="fin__tiles">
              <Tile label="Taken" cents={bookstore.totals.revenue} />
              <Tile label="Refunded" cents={bookstore.totals.refunded} />
              <Tile
                label="Kept"
                cents={bookstore.totals.revenue - bookstore.totals.refunded}
                strong
              />
            </div>
            <p className="fin__foot">
              {bookstore.totals.orders} order{bookstore.totals.orders === 1 ? '' : 's'},{' '}
              {bookstore.totals.unitsSold} book{bookstore.totals.unitsSold === 1 ? '' : 's'}. What
              sold, and what people looked at, is on{' '}
              <a href="/bookstore">the shop&rsquo;s own screen</a>.
            </p>
          </>
        ) : (
          <p className="fin__empty">
            {bookstoreReady
              ? 'The shop recorded nothing in this month.'
              : 'Reading the shop’s figures…'}
          </p>
        )}
      </section>
      )}

      <AsOf camp={camp} forms={forms} bookstore={bookstore} />
    </div>
  );
}

/* ---- one camp season ---------------------------------------------------- */

function Season({ season, runsCamp }: { season: CampFinanceRollup; runsCamp: boolean }) {
  const methods = CAMP_PAYMENT_METHODS.filter((method) => season.byMethod[method].count > 0);

  /*
   * The servants' shirt money. Absent entirely on a camp that charges none,
   * which is the default and most camps' state — see `CampServantCharges`.
   */
  const charges = season.servantCharges;
  const childCents = season.money.subtotalCents - charges.billedCents;

  return (
    <article className="fin__season">
      <header className="fin__seasonHead">
        <h3>{season.season}</h3>
        <p>
          {season.billable} registration{season.billable === 1 ? '' : 's'} · {season.children}{' '}
          child{season.children === 1 ? '' : 'ren'}
          {/* Named on the header only once they cost something. A servant count
              beside a fee line is a number a treasurer would try to multiply. */}
          {charges.count > 0 && <> · {season.servants} servants</>} ·{' '}
          {season.billableWeeks} child-week
          {season.billableWeeks === 1 ? '' : 's'}
          {season.weeklyRateCents !== null && season.weeklyRateCents > 0 && (
            <> at {money(season.weeklyRateCents)} a week</>
          )}
          {season.weeklyRateCents === null && (
            /*
             * Two rates in one season is not an error — the fee is copied onto a
             * registration when it is taken, so a mid-season change genuinely
             * leaves both in the data. Naming it beats showing one of them.
             */
            <> at more than one weekly rate</>
          )}
        </p>
      </header>

      <dl className="fin__ledger">
        {charges.count > 0 ? (
          /*
           * Split, so the arithmetic comes out.
           *
           * A single "Billed" line against a header reading "48 child-weeks at
           * $175" is a figure a treasurer cannot check: the shirt money is in
           * it and nothing on the screen says so. Two lines and a total are
           * three numbers that add up.
           */
          <>
            <Line label="Billed — child weeks" cents={childCents} />
            <Line label="Billed — servant charges" cents={charges.billedCents} />
            <Line label="Billed" cents={season.money.subtotalCents} />
          </>
        ) : (
          <Line label="Billed" cents={season.money.subtotalCents} />
        )}
        <Line label="Discounts" cents={-season.money.discountCents} />
        <Line label="Due" cents={season.money.dueCents} strong />
        <Line label="Received" cents={season.money.receivedCents} />
        <Line label="Still owed" cents={season.money.outstandingCents} strong />
      </dl>

      <p className="fin__seasonNote">
        {season.settled} settled, {season.owing} still owing
        {season.money.creditCents > 0 && <>, {money(season.money.creditCents)} overpaid</>}
        {season.money.refundedCents > 0 && <>, {money(season.money.refundedCents)} refunded</>}.
      </p>

      {charges.count > 0 && (
        <p className="fin__seasonNote">
          {charges.count} servant charge{charges.count === 1 ? '' : 's'}
          {charges.chargeCents !== null ? (
            <> at {money(charges.chargeCents)} each</>
          ) : (
            /* Two figures in one season is not an error: the charge is copied
               onto a sign-up when it is taken, so raising it mid-season leaves
               both in the data. Naming it beats showing one of them. */
            <> at more than one amount</>
          )}
          {' — '}
          {money(charges.paidCents)} in
          {charges.unpaid > 0 ? (
            <>
              , <strong>{charges.unpaid} unpaid</strong>
            </>
          ) : (
            <>, all paid</>
          )}
          . Taken by card as each sign-up was sent.
        </p>
      )}

      {(season.money.draftCents > 0 || season.money.withdrawnCents > 0) && (
        <p className="fin__seasonNote">
          Outside the bill above:
          {season.money.draftCents > 0 && (
            <> {money(season.money.draftCents)} taken against a registration still a draft.</>
          )}
          {season.money.withdrawnCents > 0 && (
            <> {money(season.money.withdrawnCents)} taken against a withdrawn one.</>
          )}
        </p>
      )}

      {methods.length > 0 && (
        <ul className="fin__methods">
          {methods.map((method) => (
            <li key={method}>
              <span>{campPaymentMethodLabel(method)}</span>
              <span className="fin__num">{money(season.byMethod[method].cents)}</span>
              <span className="fin__sub">
                {season.byMethod[method].count} payment
                {season.byMethod[method].count === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="fin__statuses">
        {CAMP_STATUSES.map((status) => `${season.registrations[status]} ${status}`).join(' · ')}
      </p>

      {runsCamp && <Roster programId={season.programId} season={season.season} />}
    </article>
  );
}

/* ---- one season, family by family --------------------------------------- */

/**
 * Who owes what, for somebody who runs the camp as well as its books.
 *
 * ---------------------------------------------------------------------------
 * ## What this is for
 *
 * The season above answers "how much is outstanding". It cannot answer "who",
 * and "who" is the only version of the question anybody acts on — the figure
 * exists so that somebody makes three phone calls in June.
 *
 * Until now the answer was on /admin/camp: open Registrations, read down the
 * balance column, cross-reference the season total on a different screen. The
 * two screens were split because `finance` cannot be given the registrations
 * collection, and they stay split for everybody that is true of. For a reader
 * holding both grants it was never a boundary, only two trips.
 *
 * ## Loaded per season, and only when drawn
 *
 * A season is a few hundred documents. Every season on the page loading its own
 * roster is the honest cost of showing them all, and it is paid once on open
 * rather than kept live: nothing here is edited, two people are not arranging
 * it at a table, and a listener would be a subscription per season for a report
 * somebody reads for a minute.
 *
 * A failure is reported in place and does not touch the rest of the screen. The
 * likeliest cause by far is the grant having been taken away between the page
 * loading and this reading, and "could not read the families" beside intact
 * totals says that far better than a screen that falls over.
 * ---------------------------------------------------------------------------
 */
function Roster({ programId, season }: { programId: string; season: string }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; roster: CampRosterReading }
    | { kind: 'failed'; message: string }
  >({ kind: 'loading' });
  const [owingOnly, setOwingOnly] = useState(false);

  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const { readCampRoster } = await import('./data');
        const roster = await readCampRoster(programId, season);
        if (live) setState({ kind: 'ready', roster });
      } catch (cause) {
        if (live) {
          setState({
            kind: 'failed',
            message: cause instanceof Error ? cause.message : 'Could not read the families.',
          });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [programId, season]);

  if (state.kind === 'loading') {
    return <p className="fin__empty">Reading the families…</p>;
  }

  if (state.kind === 'failed') {
    return <p className="fin__empty">Could not read the families: {state.message}</p>;
  }

  const { rows, owing, owedCents, servantsOmitted } = state.roster;
  if (rows.length === 0) {
    return (
      <p className="fin__empty">
        {servantsOmitted > 0
          ? `Only servants have registered for this season, and a servant is billed nothing.`
          : 'Nobody has registered for this season.'}
      </p>
    );
  }

  const shown = owingOnly
    ? rows.filter((row) => row.status === 'registered' && row.balanceCents > 0)
    : rows;

  return (
    <div className="fin__roster">
      <div className="fin__rosterBar">
        <h4>Family by family</h4>
        {/*
          A filter rather than a sort, because "still owing" is a list somebody
          works through and a sort leaves them counting where it stops. It is
          disabled rather than hidden on a settled season: a control that
          vanishes when it would return nothing makes the reader wonder whether
          they misremembered it.
        */}
        <label className="fin__rosterFilter">
          <input
            type="checkbox"
            checked={owingOnly}
            disabled={owing === 0}
            onChange={(event) => setOwingOnly(event.target.checked)}
          />
          <span>
            Only those still owing
            {owing > 0 ? ` (${owing}, ${money(owedCents)})` : ' — everyone is settled'}
          </span>
        </label>
      </div>

      <table className="fin__table fin__rosterTable">
        <thead>
          <tr>
            <th scope="col">Who</th>
            <th scope="col">Weeks</th>
            <th scope="col">Billed</th>
            <th scope="col">Off</th>
            <th scope="col">Paid</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr
              key={row.id}
              className={
                row.status === 'registered' && row.balanceCents > 0 ? 'is-owing' : undefined
              }
            >
              <th scope="row">
                {row.name}
                {/*
                  The status is on every row, not only the odd ones. A withdrawn
                  family who paid is the single most confusing line in a camp's
                  books — money in, nothing owed, no child at camp — and it has
                  to be legible as that rather than as a family who settled up.
                */}
                <span className="fin__rosterStatus">{row.status}</span>
                {row.kind === 'servant' ? (
                  <span className="fin__sub">Servant — billed nothing</span>
                ) : (
                  row.who && <span className="fin__sub">{row.who}</span>
                )}
                {row.payments.length > 0 && (
                  <span className="fin__rosterPayments">
                    {row.payments.map((payment, index) => (
                      <span key={index}>
                        {dayLabel(payment.on)} {campPaymentMethodLabel(payment.method).toLowerCase()}{' '}
                        {money(payment.cents)}
                      </span>
                    ))}
                  </span>
                )}
              </th>
              <td className="fin__num">{row.kind === 'servant' ? '—' : row.weeks}</td>
              <td className="fin__num">{row.dueCents === 0 ? '—' : money(row.subtotalCents)}</td>
              <td className="fin__num">
                {row.discountCents > 0 ? money(row.discountCents) : '—'}
              </td>
              <td className="fin__num">{row.paidCents === 0 ? '—' : money(row.paidCents)}</td>
              <td className="fin__num">
                {row.dueCents === 0 && row.paidCents === 0
                  ? '—'
                  : row.balanceCents > 0
                    ? money(row.balanceCents)
                    : row.balanceCents < 0
                      ? `${money(-row.balanceCents)} over`
                      : 'Paid'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="fin__foot">
        Read from the camp&rsquo;s own records just now — see{' '}
        <a href="/admin/camp/registrations">Registrations</a> to change any of it.
        &ldquo;Off&rdquo; is what discounts took off the bill.
        {servantsOmitted > 0 && (
          <>
            {' '}
            {servantsOmitted} servant{servantsOmitted === 1 ? ' is' : 's are'} registered and not
            listed here: a servant is billed for no weeks, so every column of this table would
            be a dash. One who was charged for a shirt, or has any payment recorded against
            them, is listed.
          </>
        )}
      </p>
    </div>
  );
}

/** `2027-06-14` → "Jun 14". Anything else is left as it came. */
function dayLabel(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day || 'undated';
  const parsed = new Date(`${day}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

/* ---- bits --------------------------------------------------------------- */

function Tile({
  label,
  cents,
  strong,
  note,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  /** `| undefined` explicitly: this project runs `exactOptionalPropertyTypes`,
      so a caller passing a conditional cannot use a plain optional. */
  note?: string | undefined;
}) {
  return (
    <div className={strong ? 'fin__tile fin__tile--strong' : 'fin__tile'}>
      <span className="fin__tileLabel">{label}</span>
      <span className="fin__tileValue">{money(cents)}</span>
      {note && <span className="fin__sub">{note}</span>}
    </div>
  );
}

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={strong ? 'fin__line fin__line--strong' : 'fin__line'}>
      <dt>{label}</dt>
      {/*
        `|| 0` collapses negative zero, which is not pedantry: the discounts
        line is passed `-discountCents`, and a season with no discounts rendered
        "-$0.00" — a minus sign in a ledger that means nothing, on the line a
        treasurer would look at hardest.
      */}
      <dd className="fin__num">{money(cents || 0)}</dd>
    </div>
  );
}

/**
 * When each of these numbers was last worked out.
 *
 * On the screen rather than assumed away, exactly as the bookstore's own
 * metrics do it. Everything here is rolled up on a schedule, so every figure is
 * up to an hour old — and a treasurer who has just watched a check be recorded
 * needs to be able to tell "it has not been counted yet" from "it was not
 * recorded".
 */
function AsOf({
  camp,
  forms,
  bookstore,
}: {
  camp: CampFinanceRollup[];
  forms: FormFinanceRollup[];
  bookstore: BookstoreStats | null;
}) {
  const rollups = [...camp, ...forms]
    .map((one) => toDate(one.computedAt))
    .filter((date): date is Date => date !== null);
  const newest = rollups.length > 0 ? new Date(Math.max(...rollups.map((d) => d.getTime()))) : null;
  const shop = toDate(bookstore?.computedAt ?? null);

  if (!newest && !shop) return null;

  /*
   * "Camp and forms worked out …" named two sources whatever the reader held,
   * which made the smallest line on the page the one that gave the screen's
   * shape away. It is assembled from what is actually in hand now — and
   * `camp`/`forms` are empty for a reader without them, because the read is not
   * fired at all, so this cannot name a source the rules would refuse.
   *
   * "Both" went with it for the same reason it had to: with one line it was
   * wrong, and with one source it was a second thing to explain.
   */
  const rolled = listOf([
    camp.length > 0 ? 'Camp' : null,
    forms.length > 0 ? 'forms' : null,
  ]);

  return (
    <p className="fin__asof">
      {newest && <>{sentenceCase(rolled)} worked out {when(newest)}. </>}
      {shop && <>Bookstore {when(shop)}. </>}
      Recalculated every hour.
    </p>
  );
}

/** "camp and forms" → "Camp and forms". The list builder does not capitalise. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function when(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * "the bookstore", "the camp and the paid forms", "the bookstore, the camp and
 * the paid forms" — the sources this reader holds, as English.
 *
 * The screen used to be able to say "each part of the church" because it was
 * always all of them. It is not, now, and a total labelled as the church's
 * money that quietly leaves one source out is the same failure as a total that
 * quietly leaves out Sunday giving — which this screen already names rather
 * than omits.
 */
function listOf(parts: readonly (string | null)[]): string {
  const kept = parts.filter((part): part is string => part !== null);
  if (kept.length === 0) return 'nothing';
  if (kept.length === 1) return kept[0]!;
  return `${kept.slice(0, -1).join(', ')} and ${kept[kept.length - 1]}`;
}

/** `2026-08`, this month or an earlier one, in the church's own zone. */
function parishMonth(offsetMonths: number): string {
  const now = new Date();
  const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetMonths, 15));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).format(shifted);
}

/** `2026-08` → "August 2026". */
function monthLabel(month: string): string {
  const parsed = new Date(`${month}-15T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return month;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(parsed);
}
