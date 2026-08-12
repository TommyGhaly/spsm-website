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
 * Not listed, deliberately: `/admin` (staff tooling, also `noindex`),
 * `/parking` (reached by NFC tap, not by search), and `/misc` (no longer
 * emitted at all).
 */

// Routes that exist as real pages and are not driven by the content collection.
const FIXED_ROUTES = ['/', '/events', '/livestream', '/giving', '/contact', '/prayer'] as const;

const EXCLUDED_SECTIONS: readonly string[] = ['contact', 'misc'];

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
