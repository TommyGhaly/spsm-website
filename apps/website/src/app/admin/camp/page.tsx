import type { Metadata } from 'next';
import { CampHome } from '@/features/camp/CampHome';

/**
 * The camp's front door.
 *
 * `/admin/camp` and the three pages beneath it replaced `/admin/camp-allocation`
 * and its register on 2 Sep 2026, when the whole camp section was rebuilt. Real
 * routes rather than Hosting rewrites, for the reason /admin gives: these are
 * files on disk after the export, and Hosting serves an exact file before it
 * considers any rewrite, so nothing in firebase.json needs to know about them.
 */
export const metadata: Metadata = {
  title: 'Summer camp',
  // Out of search: an indexed page whose content is "sign in" helps nobody, and
  // this one names children.
  robots: { index: false, follow: false },
};

export default function CampPage() {
  return <CampHome />;
}
