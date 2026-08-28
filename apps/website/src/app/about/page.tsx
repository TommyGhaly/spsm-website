import type { Metadata } from 'next';
import Link from 'next/link';
import { ABOUT_PAGES, aboutHref, getContentPages, ContentPageBody } from '@/features/content';
import { SECTION_META } from '@/features/content';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

/**
 * About, as an index of its five parts.
 *
 * A real route rather than the generic `[section]` one, for the reason `contact`
 * is: under `output: 'export'` both would write the same HTML file, so `about`
 * is listed in `NOT_A_PAGE` over there. What it buys is this index — the five
 * parts, named and linked, which the generic template has no way to render.
 *
 * **This page is also the touch fallback for the header menu.** There is no
 * hover on a phone, so tapping "About" in the bar simply follows this link, and
 * the menu is only a shortcut past a page that says the same thing with more
 * room for it. Exactly how "Events" behaves. That is why the five links have to
 * be here and not only in the masthead: without them the top-level item is a
 * dead end for every touch visitor.
 *
 * Any other prose filed under the `about` section still renders, below the
 * index. The five are excluded from that run because each one has its own page
 * — rendering them here as well would print the whole of About twice.
 */

export const metadata: Metadata = {
  title: SECTION_META.about.title,
  description: SECTION_META.about.lede,
  alternates: { canonical: '/about' },
};

export default async function AboutPage() {
  const pages = await getContentPages('about');
  const ownSlugs = new Set(ABOUT_PAGES.map((page) => page.slug));
  const loose = pages.filter((page) => !ownSlugs.has(page.slug));

  return (
    <>
      <PageHeader title={SECTION_META.about.title} />
      <PageBody>
        <p className="note">{SECTION_META.about.lede}</p>

        {/*
          A list of links, not a grid of tiles. The tiles on `/events` are tiles
          because a ministry has photographs of itself; these five are prose, and
          a card carrying a name over an empty ground is furniture. The name and
          the line under it are the whole of what a reader needs to choose.
        */}
        <ul className="about-index">
          {ABOUT_PAGES.map((page) => (
            <li key={page.slug}>
              <Link href={aboutHref(page.slug)}>
                <span className="about-index__name">{page.label}</span>
                <span className="about-index__note">{page.lede}</span>
              </Link>
            </li>
          ))}
        </ul>

        {loose.map((page) => (
          <ContentPageBody key={page.id} page={page} />
        ))}
      </PageBody>
    </>
  );
}
