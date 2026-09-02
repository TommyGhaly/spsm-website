import type { Metadata } from 'next';
import { aboutHref, aboutPage } from '@/features/content';
import { TourScreen } from '@/features/tour';
import { PageHeader } from '@/components/PageHeader';
import { MoreOfAbout } from '@/components/MoreOfAbout';

/**
 * Welcome, Newcomers — the festival tour.
 *
 * ---------------------------------------------------------------------------
 * **This is the one part of About that is not prose from the `content`
 * collection.** The other four are a title, a lede and a Firestore document
 * rendered by `app/about/[page]/page.tsx`; this one is a coded page, and the
 * template route explicitly refuses to emit its slug so that the static export
 * does not write `/about/welcome-newcomers` twice. The same collision, and the
 * same fix, as `contact` and `about` in `app/[section]/page.tsx`. If this file
 * is ever deleted, remove the slug from `NOT_PROSE` in the template or this
 * page 404s.
 *
 * Why it had to stop being prose: the tour needs a fragment per station,
 * because a QR code beside each station at the festival deep-links into it; it
 * needs client-side state, because the passport collects stamps; and it needs
 * the galleries and the disclosures. A `content` document can hold none of
 * those. The cost is real and worth naming — staff can no longer rewrite this
 * page from the Firebase console, and changing a word in it is a deploy. That
 * was the trade Tommy chose, over keeping the prose page and putting the tour
 * at a second URL.
 *
 * It keeps its place in `ABOUT_PAGES`, so the header menu, the `/about` index
 * and the sitemap all still know about it and none of them needed touching.
 * ---------------------------------------------------------------------------
 */

const META = aboutPage('welcome-newcomers');

export const metadata: Metadata = {
  title: META?.title ?? 'Welcome, Newcomers',
  description:
    'A six-station tour of the Coptic Orthodox Church — its origins, its icons, its vestments, its music, and its liturgy.',
  alternates: { canonical: aboutHref('welcome-newcomers') },
};

export default function WelcomeNewcomersPage() {
  return (
    <>
      {/*
        Hidden, like every other page's. The visible opening is the tour's own
        hero band — see PageHeader for why the banner was cut sitewide.
      */}
      <PageHeader title={META?.title ?? 'Welcome, Newcomers'} />

      {/*
        No `PageBody`. That is the centred `--shell-width` column, and this page
        is built out of full-bleed bands the way the homepage is; a container
        around it would put the alternating grounds inside a 80rem box with
        paper down both sides.
      */}
      <TourScreen />

      {/*
        The foot: the other four parts of About, and the way back to the index.
        It replaced a bare `.wrap` holding one "All of About" link — see
        `MoreOfAbout` for why a correct link still looked wrong there.
      */}
      <MoreOfAbout current="welcome-newcomers" />
    </>
  );
}
