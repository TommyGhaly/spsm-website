import type { Metadata } from 'next';
import { aboutHref, aboutPage } from '@/features/content';
import { WhoScreen } from '@/features/who';
import { PageHeader } from '@/components/PageHeader';
import { MoreOfAbout } from '@/components/MoreOfAbout';

/**
 * Who We Are — the history, from Alexandria to Rice Road.
 *
 * ---------------------------------------------------------------------------
 * The fourth part of About that is not prose from the `content` collection, and
 * it left for the reason /about/our-belief and /about/patron-saints did:
 * **pictures**. A `content` document is a title and a markdown body. Seven
 * plates with their own alt text, captions and srcsets, plus two dated spines
 * rendered as description lists, cannot be expressed in that shape.
 *
 * `app/about/[page]/page.tsx` refuses to emit this slug (`NOT_PROSE`), so the
 * static export does not write `/about/who-we-are` twice. If this file is ever
 * deleted, take the slug back out of that list or the page 404s from the header
 * menu.
 *
 * The cost is the same one those two pay: staff can no longer rewrite this page
 * from the Firebase console, and changing a word in it is a deploy. For a page
 * that is mostly dates between 43 and 2024 that is the cheaper side of the
 * trade — and the one part of it that will actually change, what the church is
 * building next, is deliberately not told here. It links to Future Plans, which
 * is still a `content` document and can be edited without a developer.
 *
 * It keeps its entry in `ABOUT_PAGES`, so the header menu, the `/about` index
 * and the sitemap needed no change at all.
 * ---------------------------------------------------------------------------
 */

const META = aboutPage('who-we-are');

export const metadata: Metadata = {
  title: META?.title ?? 'Who We Are',
  description:
    'The Coptic Orthodox Church from St. Mark in Alexandria to the emigration of the 1960s, the first Coptic churches in America and New England, and how this church in Wayland began.',
  alternates: { canonical: aboutHref('who-we-are') },
};

export default function WhoWeArePage() {
  return (
    <>
      {/* Hidden, like every page's. The visible opening is the band below. */}
      <PageHeader title={META?.title ?? 'Who We Are'} />

      {/*
        No `PageBody`. That is the centred `--shell-width` column, and this page
        is built from full-bleed bands; a container around it would put the
        alternating grounds inside an 80rem box with paper down both sides.
      */}
      <WhoScreen />

      {/*
        The foot: the other four parts of About, and the way back to the index.
        It replaced a bare `.wrap` holding one "All of About" link — see
        `MoreOfAbout` for why a correct link still looked wrong there.
      */}
      <MoreOfAbout current="who-we-are" />
    </>
  );
}
