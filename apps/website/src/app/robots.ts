import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from './layout';

/**
 * Crawling is allowed everywhere except the routes reached by tapping a tag.
 *
 * `/parking` and `/welcome` are excluded because each is reached by tapping an
 * NFC tag, and a search result for one is only ever a wrong turn into a page
 * that assumes you are already standing there.
 *
 * `/admin` and `/servants` both used to head this list, and neither route
 * exists now. Editing happens on the pages themselves, and the servants
 * schedule is part of `/calendar` — visible to whoever signs in, absent from
 * the exported HTML for everyone else, because it is fetched from a Function
 * that checks a token rather than baked into a file. That is a stronger
 * arrangement than `noindex` ever was: there is nothing on disk to crawl.
 *
 * `/parking` is now also linked from `/forms`, which is in the nav, and it
 * stays disallowed anyway. Browsing to a form from a page that explains what it
 * is for is not the same as landing on it cold from a search result — the hub
 * is what is indexed, and it is the better first impression.
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      /*
       * `/forms/*` joins them, and `/form` with it.
       *
       * Individual forms are fetched in the browser through one shell page, so
       * there is no per-form HTML for a crawler to index in the first place —
       * this line makes that state deliberate rather than incidental. A crawler
       * that followed a link to `/forms/summer-camp` would otherwise index a
       * page whose only content is the word "Loading…".
       *
       * `/forms` itself stays crawlable. The hub is the page worth finding, and
       * it explains what each form is for before anybody opens one.
       *
       * `/c/` is the tags themselves — the fallback pages
       * scripts/make-clip-pages.mjs writes. Each one counts a tap in an inline
       * script, and a crawler that runs scripts would add taps nobody made to
       * the NFC statistics. They are doorways with a canonical link elsewhere
       * anyway, so nothing worth finding is lost. Apple reads
       * apple-app-site-association, not these pages, so the App Clip and the
       * app's links are untouched.
       */
      disallow: ['/parking', '/welcome', '/form', '/forms/', '/c/'],
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
