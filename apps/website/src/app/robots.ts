import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from './layout';

/**
 * Crawling is allowed everywhere except the staff tooling.
 *
 * `/admin` carries `noindex` in its own metadata too. Both are worth having and
 * neither is a security control: the pages are static files that anyone can
 * fetch, and everything behind them is gated by `firestore.rules`. This is
 * about keeping a sign-in page out of search results, which is a support
 * question nobody needs, not about hiding anything.
 *
 * `/parking` is excluded for a different reason — it is reached by tapping an
 * NFC tag on the day, and a search result for it is only ever a wrong turn.
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/admin/', '/parking'],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
