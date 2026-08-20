import { GalleriesAdmin } from './GalleriesAdmin';

/**
 * A thin server shell, matching /admin/events. Every read and write on this
 * screen happens in a signed-in browser, so none of it can be prerendered.
 */
export default function AdminGalleriesPage() {
  return <GalleriesAdmin />;
}
