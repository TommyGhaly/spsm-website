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
