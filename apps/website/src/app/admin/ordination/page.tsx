import type { Metadata } from 'next';
import { OrdinationHome } from '@/features/ordination/OrdinationHome';

/**
 * The ordination back office: every ordination, and opening a new one.
 *
 * Real routes under /admin, for the reason /admin/camp gives: they are files
 * after the export, so Hosting serves them before any rewrite.
 */
export const metadata: Metadata = {
  title: 'Ordinations',
  // Out of search: it names nominees, several of them children.
  robots: { index: false, follow: false },
};

export default function OrdinationPage() {
  return <OrdinationHome />;
}
