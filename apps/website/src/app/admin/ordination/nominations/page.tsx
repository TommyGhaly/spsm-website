import type { Metadata } from 'next';
import { NominationsScreen } from '@/features/ordination/NominationsScreen';

/**
 * One ordination's nominations: review, sign, print. Which ordination is
 * `?id=` in the address, read in the browser so the page stays one static file.
 */
export const metadata: Metadata = {
  title: 'Nominations',
  robots: { index: false, follow: false },
};

export default function NominationsPage() {
  return <NominationsScreen />;
}
