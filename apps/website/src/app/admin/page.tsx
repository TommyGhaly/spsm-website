import type { Metadata } from 'next';
import { AdminScreen } from '@/features/admin/AdminScreen';

/**
 * The admin screen's front door.
 *
 * A real route rather than a Hosting rewrite, because there is nothing dynamic
 * about the address: `/admin` and `/admin/camp` are both files on
 * disk after the export, and Hosting serves an exact file before it considers
 * any rewrite. Nothing in `firebase.json` needs to change for either.
 *
 * The page ships a heading and an empty shell — every list on it is decided in
 * the browser from the reader's own grants, and `firestore.rules` refuses the
 * data behind each entry regardless of what this draws.
 */
export const metadata: Metadata = {
  title: 'Admin',
  // Out of search. Not because the address is secret — it is a link in the
  // account menu — but because an indexed page whose content is "sign in" is a
  // result that helps nobody.
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminScreen />;
}
