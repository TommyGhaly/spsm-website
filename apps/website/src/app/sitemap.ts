import type { MetadataRoute } from 'next';
import { CONTENT_SECTIONS } from '@spsm/shared';
import { getAllEvents } from '@/features/events';
import { SITE_ORIGIN } from './layout';

/**
 * The sitemap, generated at build time.
 *
 * Generated rather than hand-written because events come and go: a static file
 * would be stale the first time staff added something, and a sitemap listing
 * URLs that 404 is worse than no sitemap. Everything here is read from the same
 * sources the pages themselves use, so the two cannot disagree.
 *
 * `output: 'export'` still runs this during `next build` and writes
 * `out/sitemap.xml`.
 *
 * Not listed, deliberately: `/admin` (staff tooling, also `noindex`), `/misc`
 * (no longer emitted at all), and the three NFC routes — `/parking`, `/prayer`,
 * and `/welcome` — which are reached by tapping a tag, not by searching.
 *
 * Two of those three are now linked from `/forms`, which is in the nav. That
 * changes whether they can be *browsed* to, not whether they should turn up in
 * a search: `robots.ts` still keeps all three out, on the same reasoning it
 * always did, and a URL kept out of the crawl has no business in the sitemap
 * advertising itself. `/welcome` remains unlinked from anywhere.
 */

// Routes that exist as real pages and are not driven by the content collection.
// `/calendar` and `/events` are both here: they are two views of one collection
// rather than one page and a duplicate of it, and each is worth finding on its
// own — "parish calendar" and "upcoming events" are different searches.
const FIXED_ROUTES = [
  '/',
  '/calendar',
  '/events',
  // Added when the bookstore joined the main nav. It was missing here for as
  // long as nothing linked to it, which made it unreachable by search as well
  // as by browsing; a page in the top bar should be findable.
  '/bookstore',
  '/livestream',
  '/giving',
  '/contact',
  // The hub, not the forms themselves. The individual forms stay out of the
  // crawl — see the note above — so this page is the one findable entry point
  // to them, which is the right shape: it says what each form is for before
  // dropping somebody into one.
  '/forms',
] as const;

// `clergy` joins these because it is no longer a route: the biographies are
// disclosures on the homepage, which is already listed above. Keep this in step
// with NOT_A_PAGE in [section]/page.tsx — a sitemap advertising a URL the export
// never wrote is worse than no sitemap.
const EXCLUDED_SECTIONS: readonly string[] = ['contact', 'clergy', 'misc', 'welcome'];

export const dynamic = 'force-static';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const fixed: MetadataRoute.Sitemap = FIXED_ROUTES.map((path) => ({
    url: `${SITE_ORIGIN}${path}`,
    lastModified: now,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }));

  const sections: MetadataRoute.Sitemap = CONTENT_SECTIONS.filter(
    (section) => !EXCLUDED_SECTIONS.includes(section),
  ).map((section) => ({
    url: `${SITE_ORIGIN}/${section}`,
    lastModified: now,
    changeFrequency: 'yearly',
    priority: 0.6,
  }));

  // Only published events — `getAllEvents` filters on `published == true`, so a
  // draft cannot leak into the sitemap and advertise a URL that 404s.
  const events = await getAllEvents();
  const eventUrls: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${SITE_ORIGIN}/events/${event.slug}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: 0.5,
  }));

  return [...fixed, ...sections, ...eventUrls];
}
