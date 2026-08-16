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
 * and `/welcome` — which are reached by tapping a tag, not by searching. Nothing
 * on the site links to them either; see NAV in layout.tsx.
 */

// Routes that exist as real pages and are not driven by the content collection.
// `/calendar` and `/events` are both here: they are two views of one collection
// rather than one page and a duplicate of it, and each is worth finding on its
// own — "parish calendar" and "upcoming events" are different searches.
const FIXED_ROUTES = [
  '/',
  '/calendar',
  '/events',
  '/livestream',
  '/giving',
  '/contact',
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
