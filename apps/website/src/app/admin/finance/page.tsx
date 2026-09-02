import type { Metadata } from 'next';
import { FinanceScreen } from '@/features/finance/FinanceScreen';

/**
 * Finance — the church's money, in one place.
 *
 * Under /admin rather than at a top-level address, because it is the second
 * screen of the kind that hub exists for: work that is not *about* a page.
 * There is no visitor-facing page whose contents are "what the church took in
 * August", so there is nowhere in-place for this to live.
 *
 * `noindex`, like the allocation screen beside it. This is a static export, so
 * the address is public and the file is served to anybody who types it — what
 * keeps the figures private is `firestore.rules` refusing every read behind it,
 * and what keeps the address out of a search result is this line.
 */
export const metadata: Metadata = {
  title: 'Finance',
  robots: { index: false, follow: false },
};

export default function FinancePage() {
  return <FinanceScreen />;
}
