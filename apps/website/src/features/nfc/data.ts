import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import {
  COLLECTIONS,
  PARISH_TIME_ZONE,
  dayKey,
  nfcPeriodDocIds,
  sumNfcRevenue,
  sumNfcStats,
  type NfcSlug,
  type NfcSlugCounts,
  type NfcSlugRevenue,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * Reading the NFC tag statistics for a period.
 *
 * ---------------------------------------------------------------------------
 * One query per collection, over a range of document ids — `day-2026-10-23`
 * to `day-2026-11-21`, or `month-…` for a year — rather than a `get` per day.
 * A range on the document id needs no composite index, and the rules on both
 * collections are a plain grant with no condition on the document, so a
 * `list` is allowed without the query having to prove anything.
 *
 * The money is a second query against a second collection, asked only when the
 * reader holds Finance as well, because `firestore.rules` refuses it otherwise
 * and a refused read is a red line in the console for no reason. See
 * packages/shared/src/analytics/nfc.ts for why it is separate at all.
 * ---------------------------------------------------------------------------
 */

export const NFC_RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last 12 months' },
] as const;

export interface NfcReading {
  bySlug: Record<NfcSlug, NfcSlugCounts>;
  /** Total taps per document in the period, oldest first — days, or months past ninety days. */
  series: { id: string; scans: number }[];
  /** Null when the reader does not hold Finance. */
  revenue: Record<NfcSlug, NfcSlugRevenue> | null;
}

async function readRange(collectionName: string, ids: string[]): Promise<Map<string, unknown>> {
  const first = ids[0];
  const last = ids[ids.length - 1];
  const found = new Map<string, unknown>();
  if (!first || !last) return found;
  const snapshot = await getDocs(
    query(
      collection(db(), collectionName),
      where(documentId(), '>=', first),
      where(documentId(), '<=', last),
    ),
  );
  snapshot.forEach((doc) => found.set(doc.id, doc.data()));
  return found;
}

export async function readNfcPeriod(days: number, withRevenue: boolean): Promise<NfcReading> {
  const ids = nfcPeriodDocIds(dayKey(new Date(), PARISH_TIME_ZONE), days);
  const [stats, money] = await Promise.all([
    readRange(COLLECTIONS.nfcStats, ids),
    withRevenue ? readRange(COLLECTIONS.nfcRevenue, ids) : Promise.resolve(null),
  ]);
  const series = ids.map((id) => {
    const one = sumNfcStats(stats.has(id) ? [stats.get(id)] : []);
    return { id, scans: Object.values(one).reduce((total, counts) => total + counts.scans, 0) };
  });
  return {
    bySlug: sumNfcStats([...stats.values()]),
    series,
    revenue: money ? sumNfcRevenue([...money.values()]) : null,
  };
}
