/**
 * Everything the finance screen reads, and the one thing it writes.
 *
 * ---------------------------------------------------------------------------
 * Three documents' worth of reading, whatever the parish did that year.
 *
 * Nothing here aggregates anything. The camp's seasons and the paid forms are
 * added up hourly by `functions/src/finance.ts`, the bookstore by
 * `functions/src/stats.ts`, and this reads what they wrote. That is not a
 * performance nicety — it is the only reason this screen can exist at all.
 * A browser cannot sum the camp's fees, because the collection they live in
 * holds children's medical notes and the treasurer is refused it by
 * `firestore.rules`, correctly and permanently.
 *
 * Dynamic-imported by the screen for the same reason the bookstore's admin
 * reads are: this pulls Firestore queries into a chunk, and the chunk should be
 * one that only a treasurer ever fetches.
 * ---------------------------------------------------------------------------
 */
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  parseFinanceRollup,
  type BookstoreStats,
  type CampFinanceRollup,
  type CampPaymentMethod,
  type CampStatus,
  type FinanceSource,
  type FormFinanceRollup,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { auth } from '@/lib/auth';

export interface FinanceReading {
  /** Camp seasons, newest first. */
  camp: CampFinanceRollup[];
  /** Paid forms, biggest takings first. */
  forms: FormFinanceRollup[];
}

/**
 * The rollups this reader is allowed, one query per source they hold.
 *
 * ---------------------------------------------------------------------------
 * This was a single unfiltered `getDocs(collection(...))`, and the filter is
 * not an optimisation — **the unfiltered read is now refused for everybody,
 * including a treasurer holding all three sources.**
 *
 * `finance` can be narrowed to the shop, the camp or the paid forms, and the
 * camp and the forms share this one collection. A rule that narrows a
 * collection has to narrow it on something a `list` can prove, because
 * Firestore evaluates a query against its *potential* result set rather than
 * the documents it would return — the same property that once made a
 * `published` rule deny every public query on the site. `kind` is a field with
 * an equality filter on it, so `where('kind','==','camp')` proves the rule;
 * nothing about a bare collection read proves anything at all.
 *
 * So a reader with both sources sends two queries and gets the same documents
 * as before, and a reader with one sends one and cannot see the other. No
 * index: a single equality filter is served by the automatic single-field one.
 *
 * Sorting stays here rather than in the query because ordering by season string
 * and by takings needs two composite indexes to save nothing.
 * ---------------------------------------------------------------------------
 */
export async function readFinance(sources: readonly FinanceSource[]): Promise<FinanceReading> {
  const rollups = collection(db(), COLLECTIONS.financeRollups);

  const [campDocs, formDocs] = await Promise.all([
    sources.includes('camp') ? getDocs(query(rollups, where('kind', '==', 'camp'))) : null,
    sources.includes('forms') ? getDocs(query(rollups, where('kind', '==', 'form'))) : null,
  ]);

  const camp: CampFinanceRollup[] = [];
  const forms: FormFinanceRollup[] = [];

  for (const entry of [...(campDocs?.docs ?? []), ...(formDocs?.docs ?? [])]) {
    const rollup = parseFinanceRollup(entry.data());
    if (!rollup) continue;
    if (rollup.kind === 'camp') camp.push(rollup);
    else forms.push(rollup);
  }

  // Seasons are `2027`, `2028` — sorting the strings descending is newest
  // first, and stays right if the parish ever writes `2027-week-1`.
  camp.sort((a, b) => b.season.localeCompare(a.season));
  forms.sort((a, b) => b.grossCents - a.grossCents || a.formTitle.localeCompare(b.formTitle));

  return { camp, forms };
}

/**
 * One month of the bookstore.
 *
 * Read here rather than through `features/bookstore/adminData` on purpose: that
 * module also carries the orders queue, the fulfilment write and the refund
 * call, and importing it would put the shop's back office into the treasurer's
 * chunk to reuse two lines. The rule behind this document already admits
 * `finance` — it is the one place money was always a document of its own.
 *
 * Null is an ordinary answer. A month the shop sold nothing in never gets a
 * document, and so does every month before the rollup first ran.
 */
export async function readBookstoreMonth(month: string): Promise<BookstoreStats | null> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.bookstoreStats, `month-${month}`));
  return snapshot.exists() ? (snapshot.data() as BookstoreStats) : null;
}

/**
 * Recompute the camp and form figures now.
 *
 * The rollup runs hourly, which is fresh enough to read and too stale to trust
 * when a payment has just been recorded at a desk and somebody is standing
 * there asking whether it landed. The Function re-checks the token server-side
 * — this is a write path, and the ID token is the whole of what guards it.
 */
export async function refreshFinance(): Promise<void> {
  const user = auth().currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again.');

  const response = await fetch('/api/finance/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'Could not refresh the figures.');
  }
}

/* ---------------------------------------------------------------------------
 * The season, family by family
 * ------------------------------------------------------------------------ */

/**
 * One registration's money, with just enough of the family to know who it is.
 *
 * ---------------------------------------------------------------------------
 * The shape is a statement of intent, the same way `CampFinanceInput` is.
 *
 * A `CampRegistration` carries a child's date of birth, allergies, medical
 * notes and an emergency contact. **None of it belongs on a finance screen**,
 * so this is what is lifted off and the rest is dropped at the boundary rather
 * than merely left unrendered — a component that never reads a field is one
 * refactor away from reading it, and this is not a mistake worth leaving
 * available.
 *
 * What is kept is the contact's name, the children's first names and grades,
 * and the bill. That is the row a registrar already reads on /admin/camp, and
 * nobody reaches this without the grant that draws that screen.
 * ---------------------------------------------------------------------------
 */
export interface CampFinanceRow {
  id: string;
  name: string;
  kind: 'family' | 'servant';
  status: CampStatus;
  /** "Marina (3rd), Peter (K)" — empty for a servant. */
  who: string;
  weeks: number;
  subtotalCents: number;
  discountCents: number;
  dueCents: number;
  paidCents: number;
  /** Positive when owed, negative when overpaid. */
  balanceCents: number;
  /** Every payment, newest first: what came in, how, and on what day. */
  payments: { cents: number; method: CampPaymentMethod; on: string }[];
}

export interface CampRoster {
  rows: CampFinanceRow[];
  /** Live registrations still owing something, and what they owe between them. */
  owing: number;
  owedCents: number;
  /**
   * Servants left out of `rows` because no money has ever touched them.
   *
   * ---------------------------------------------------------------------------
   * On the seeded 2027 season this was 14 rows of 38 — better than a third of a
   * money table reading "— — — — —", because a servant is billed nothing and so
   * has nothing in any column of it. They were not noise to be tidied away; they
   * were the wrong rows for this table, on a screen where a dash in the balance
   * column is supposed to mean something.
   *
   * They are counted rather than dropped silently, and the count is on screen:
   * a treasurer who knows the season has 38 registrations must be able to see
   * why 24 are listed. And a servant who *has* a payment against them — a refund
   * of something, a correction — stays in the table, because a figure nobody can
   * see is the one failure a money screen cannot have.
   * ---------------------------------------------------------------------------
   */
  servantsOmitted: number;
}

/**
 * Read one season's registrations and reduce them to money.
 *
 * ---------------------------------------------------------------------------
 * The one read on this screen that is not a rollup, and the one that is live.
 *
 * Behind `session.runsCamp` — see the long note on `useFinanceAdmin`. It is
 * the *camp's* grant, not the treasurer's, and firestore.rules will refuse this
 * flatly to a reader holding only `finance`, which is the point.
 *
 * `readRegistrations` is imported from the camp feature rather than
 * reimplemented: its two equality filters are what make the list provable to
 * the rules, and a second copy of that query is a second thing to get wrong the
 * next time the rule moves. The dynamic import keeps the camp's parsing out of
 * the chunk a treasurer without the camp flag downloads.
 *
 * Being live is not incidental. The rollup runs hourly, which is right for a
 * season total and wrong for "the Girgis family paid ten minutes ago" — and
 * this is the part of the screen where somebody is about to make a phone call.
 * The section says which figures are which.
 * ---------------------------------------------------------------------------
 */
export async function readCampRoster(programId: string, season: string): Promise<CampRoster> {
  const [{ readRegistrations }, shared] = await Promise.all([
    import('@/features/camp/data'),
    import('@spsm/shared'),
  ]);
  const registrations = await readRegistrations(programId, season);

  const all: CampFinanceRow[] = registrations.map((registration) => {
    const bill = shared.campBill(registration);
    return {
      id: registration.id,
      name: shared.registrationName(registration),
      kind: registration.kind,
      status: registration.status,
      who: registration.children
        .map(
          (child) =>
            `${child.firstName.trim() || 'Child'} (${shared.campGradeShort(child.grade)})`,
        )
        .join(', '),
      weeks: bill.billableWeeks,
      subtotalCents: bill.subtotalCents,
      discountCents: bill.discountCents,
      dueCents: bill.dueCents,
      paidCents: bill.paidCents,
      balanceCents: bill.balanceCents,
      payments: [...registration.billing.payments]
        .map((payment) => ({
          cents: Math.round(payment.amountCents),
          method: shared.readCampPaymentMethod(payment.method),
          on: typeof payment.receivedOn === 'string' ? payment.receivedOn : '',
        }))
        .sort((a, b) => b.on.localeCompare(a.on)),
    };
  });

  /*
   * `registered` only, matching `LIVE_STATUSES` in the rollup.
   *
   * The two figures below sit next to the rollup's `outstandingCents` on the
   * same screen, and a chase list built on a wider set of statuses than the
   * total above it would disagree with it in front of the treasurer. A draft
   * or a waitlisted family is not owed anything yet — see the note on
   * `LIVE_STATUSES` in packages/shared/src/schema/finance.ts.
   */
  const live = all.filter((row) => row.status === 'registered' && row.balanceCents > 0);

  // See `servantsOmitted`: a servant with nothing billed and nothing paid has no
  // figure in any column of this table.
  const rows = all.filter((row) => row.kind === 'family' || row.payments.length > 0);

  return {
    rows,
    owing: live.length,
    owedCents: live.reduce((sum, row) => sum + row.balanceCents, 0),
    servantsOmitted: all.length - rows.length,
  };
}
