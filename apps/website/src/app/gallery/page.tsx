import type { Metadata } from 'next';
import { GalleryShell } from '@/features/programs';

/**
 * The shell every program gallery is served from.
 *
 * `firebase.json` rewrites `/events/**` here whenever nothing matches on disk.
 * Hosting resolves redirects, then exact static files, then rewrites — so the
 * calendar's own pages (`/events`, `/events/some-liturgy`) keep serving their
 * baked HTML and never reach this, and only a path with no file falls through.
 * The URL is preserved, because a rewrite is not a redirect: the visitor stays
 * at `/events/summercamp/week-1-2027` and the component reads that path back
 * out of the address bar.
 *
 * This route also exists at `/gallery` in its own right, which nothing links
 * to. Landing there renders the "no such gallery" state, which is correct — it
 * is machinery, not a page. `parseGalleryPath` refuses `gallery` as a program
 * slug so the shell cannot recurse into itself.
 *
 * `noindex`, and that is not a loss. There is no HTML here for a crawler to
 * read — every gallery is fetched in the browser — so the alternative is
 * letting a search engine index one empty shell as though it were every camp
 * the parish has ever run.
 */
export const metadata: Metadata = {
  title: 'Gallery',
  robots: { index: false, follow: false },
};

export default function GalleryPage() {
  return <GalleryShell />;
}
