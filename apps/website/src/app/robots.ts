import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from './layout';

/**
 * Crawling is allowed everywhere except the routes reached by tapping a tag.
 *
 * `/parking`, `/prayer`, and `/welcome` are excluded because each is reached by
 * tapping an NFC tag, and a search result for one is only ever a wrong turn
 * into a page that assumes you are already standing there.
 *
 * `/admin` used to head this list. The section is gone — editing happens on the
 * pages themselves now — and `/servants`, the one page still behind sign-in,
 * carries `noindex` in its own metadata rather than a line here. Neither is a
 * security control either way: the pages are static files anyone can fetch, and
 * everything behind them is gated by `firestore.rules`.
 *
 * `/parking` and `/prayer` are now also linked from `/forms`, which is in the
 * nav, and they stay disallowed anyway. Browsing to a form from a page that
 * explains what it is for is not the same as landing on it cold from a search
 * result — the hub is what is indexed, and it is the better first impression of
 * either. Worth revisiting for `/prayer` if the parish would rather someone
 * searching "prayer request" found the form directly.
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/parking', '/prayer', '/welcome'],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
