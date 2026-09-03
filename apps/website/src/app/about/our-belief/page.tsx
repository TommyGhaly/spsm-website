import type { Metadata } from 'next';
import { aboutHref, aboutPage } from '@/features/content';
import { BeliefScreen } from '@/features/belief';
import { AboutOverlay, AboutSections, getAboutOverride } from '@/features/about';
import { PageHeader } from '@/components/PageHeader';
import { MoreOfAbout } from '@/components/MoreOfAbout';

/**
 * Our Belief — the Creed, and what it means.
 *
 * ---------------------------------------------------------------------------
 * The second part of About that is not prose from the `content` collection, for
 * a different reason than `welcome-newcomers` is. The tour left because it
 * needed client state; this one left because it needed **pictures**, and a
 * `content` document is a title and a markdown body. Ten plates with their own
 * alt text, captions, srcsets and licence credits cannot be expressed in that
 * shape, and the Creed itself wants line breaks that survive — markdown eats
 * single newlines.
 *
 * `app/about/[page]/page.tsx` refuses to emit this slug (`NOT_PROSE`), so the
 * static export does not write `/about/our-belief` twice. If this file is ever
 * deleted, take the slug back out of that list or the page 404s from the header
 * menu.
 *
 * The cost, and it is the same cost the tour pays: staff can no longer rewrite
 * this page from the Firebase console, and changing a word in it is a deploy.
 * For a page whose subject was settled in 325 that is the cheaper side of the
 * trade.
 *
 * It keeps its entry in `ABOUT_PAGES`, so the header menu, the `/about` index
 * and the sitemap needed no change at all.
 * ---------------------------------------------------------------------------
 */
/*
 * ## Staff can edit this page again, and that is not a return to `content`
 *
 * `AboutOverlay` reads `aboutOverrides/{slug}` at build time and hands it to
 * the `<Editable>` slots inside the screen below; the same document is re-read
 * in the browser a moment after load, so an edit is live without a deploy. The
 * page itself is still hand-written React and still server-rendered — only the
 * declared slots and the appended sections can be changed. See
 * `features/about/slots.ts` for what is declared and why the rest is not.
 */

const META = aboutPage('our-belief');

export const metadata: Metadata = {
  title: META?.title ?? 'Our Belief',
  description:
    'The Nicene Creed as the Coptic Orthodox Church confesses it, the councils that wrote it, and what each of its clauses means.',
  alternates: { canonical: aboutHref('our-belief') },
};

export default async function OurBeliefPage() {
  const baked = await getAboutOverride('our-belief');

  return (
    <AboutOverlay page="our-belief" baked={baked}>
      {/* Hidden, like every page's. The visible opening is the band below. */}
      <PageHeader title={META?.title ?? 'Our Belief'} />

      {/*
        No `PageBody`. That is the centred `--shell-width` column, and this page
        is built from full-bleed bands; a container around it would put the
        alternating grounds inside an 80rem box with paper down both sides.
      */}
      <BeliefScreen />

      {/* Sections staff have added, between the page and the links off it. */}
      <AboutSections baked={baked.sections} />

      {/*
        The foot: the other four parts of About, and the way back to the index.
        It replaced a bare `.wrap` holding one "All of About" link — see
        `MoreOfAbout` for why a correct link still looked wrong there.
      */}
      <MoreOfAbout current="our-belief" />
    </AboutOverlay>
  );
}
