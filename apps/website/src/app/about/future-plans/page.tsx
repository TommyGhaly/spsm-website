import type { Metadata } from 'next';
import { aboutHref, aboutPage } from '@/features/content';
import { FutureScreen } from '@/features/future';
import { AboutOverlay, AboutSections, getAboutOverride } from '@/features/about';
import { PageHeader } from '@/components/PageHeader';

/**
 * Future Plans — the three buildings that have been designed for 169 Rice Road.
 *
 * ---------------------------------------------------------------------------
 * **The fifth part of About to leave the `content` collection, and the one the
 * template's own comment said would stay.** That comment was right when it was
 * written: this was the part of About whose text would keep changing, so it was
 * the part worth leaving editable from the Firebase console. What changed is
 * what there is to say. The page is now ten renderings with their own alt text,
 * captions and srcsets, a 33 MB video with a poster, four sourced figures, a
 * seven-row area schedule and a dated spine — and a `content` document is a
 * title and a markdown body.
 *
 * `app/about/[page]/page.tsx` refuses this slug (`NOT_PROSE`), so the static
 * export does not write `/about/future-plans` twice. If this file is ever
 * deleted, take the slug back out of that list or the page 404s from the header
 * menu. Note what that leaves: `NOT_PROSE` now names every slug in
 * `ABOUT_PAGES`, and the `[page]` template renders nothing at all. It is kept
 * rather than deleted because the next part of About somebody adds should get a
 * real page from the header menu on the day the slug is added, not on the day a
 * developer gets to it — which is exactly what it was built for.
 *
 * The cost is the one the other four pay: staff can no longer rewrite this page
 * from the console, and changing a word in it is a deploy. That cost is higher
 * here than anywhere else on the site, because this is the page whose facts go
 * stale — a planning board decision would date it in an afternoon. Two things
 * make it survivable. The dated spine ends on an undated "Next" rather than on
 * a prediction, and the closing paragraph sends anybody who needs the current
 * answer to the office instead of implying this page is it.
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

const META = aboutPage('future-plans');

export const metadata: Metadata = {
  title: META?.title ?? 'Future Plans',
  description:
    'Three buildings designed for 169 Rice Road: a church seating 570, a youth centre with Sunday school and senior housing, and a diocese centre. Renderings, a flythrough, and where the town review has got to.',
  alternates: { canonical: aboutHref('future-plans') },
};

export default async function FuturePlansPage() {
  const baked = await getAboutOverride('future-plans');

  return (
    <AboutOverlay page="future-plans" baked={baked}>
      {/* Hidden, like every page's. The visible opening is the band below. */}
      <PageHeader title={META?.title ?? 'Future Plans'} />

      {/*
        No `PageBody`. That is the centred `--shell-width` column, and this page
        is built from full-bleed bands; a container around it would put the
        alternating grounds inside an 80rem box with paper down both sides.
      */}
      {/*
        No back link here. It used to be a bare "All of About" in a `.wrap`
        under the screen, and on this page — which ends on a dark band, above
        the site's dark footer — that put eight words on a strip of pale paper
        between the two and read as a hole. `FutureScreen`'s own last band is
        the foot now: the four other parts of About with their ledes, and the
        `BackLink` to the index inside it. See `components/MoreOfAbout`, which
        the other four parts of About now end on too.
      */}
      {/*
        The appended sections go in as `foot` rather than after the screen,
        because this is the one page of the five whose `MoreOfAbout` is inside
        its screen — see the note above and `FutureScreen`.
      */}
      <FutureScreen foot={<AboutSections baked={baked.sections} />} />
    </AboutOverlay>
  );
}
