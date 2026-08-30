import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ABOUT_PAGES,
  aboutHref,
  getContentPages,
  ContentPageBody,
  PICTURE_CREDITS,
  PICTURE_CREDIT_COUNT,
} from '@/features/content';
import { SECTION_META } from '@/features/content';
import { PageHeader } from '@/components/PageHeader';

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
 * ---------------------------------------------------------------------------
 * **Bands, not a `PageBody`.** This was a `.note` and a list inside the centred
 * column, and it opened hard against the masthead with nothing to say what the
 * page was — `PageHeader` renders an invisible `h1`, so a page whose first
 * visible thing is a bare list begins in the middle of itself. The four About
 * pages that are code rather than prose all open on a deep band, and this one
 * now does too, so the section reads as one thing from the index inward.
 *
 * Still no photographs on the five links, and still not the tile grid `/events`
 * uses — see the note over `.about-index` in `globals.css`. What changed is the
 * ground around them, not the links.
 * ---------------------------------------------------------------------------
 *
 * **The picture credits live here.** All forty-nine of them, from the four
 * About pages that carry photographs, in a drawer that starts shut. See the
 * note over `PICTURE_CREDITS` in `features/content/credits.ts` for why they are
 * gathered on this page and why each page nonetheless keeps its own hidden
 * copy.
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

      <section className="band band--deep about-hero">
        <div className="wrap about-hero__inner">
          {/*
            A `p`, not a heading, for the reason the same line on
            /about/who-we-are is: the page's `h1` is already rendered, hidden,
            by `PageHeader`, and the five links below need `h2` to be the level
            under it.
          */}
          <p className="about-hero__eyebrow">St. Philopater Mercurius &amp; St. Mina</p>
          <p className="about-hero__title">{SECTION_META.about.title}</p>
          <p className="about-hero__lede">
            Five pages: who this church is and where the Church it belongs to comes from, what that
            Church confesses, the two saints whose names it carries, what happens in the Liturgy,
            and what is being built next.
          </p>
        </div>
      </section>

      <section className="band about-parts" aria-labelledby="the-five">
        <div className="wrap">
          <h2 className="visually-hidden" id="the-five">
            The five parts of About
          </h2>

          {/*
            A list of links, not a grid of tiles. The tiles on `/events` are tiles
            because a ministry has photographs of itself; these five are prose, and
            a card carrying a name over an empty ground is furniture. The name and
            the line under it are the whole of what a reader needs to choose.

            The number down the left is the one thing added to them. It is not
            an ordering a reader has to obey — any of the five stands alone —
            but the five *are* in the order they are best read in, and an
            unnumbered list of five equal rectangles says nothing about that.
          */}
          <ol className="about-index">
            {ABOUT_PAGES.map((page, index) => (
              <li key={page.slug}>
                <Link href={aboutHref(page.slug)}>
                  <span className="about-index__num" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="about-index__text">
                    <span className="about-index__name">{page.label}</span>
                    <span className="about-index__note">{page.lede}</span>
                  </span>
                  <span className="about-index__arrow" aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {loose.length > 0 && (
        <section className="band band--sunken about-loose">
          <div className="wrap prose">
            {loose.map((page) => (
              <ContentPageBody key={page.id} page={page} />
            ))}
          </div>
        </section>
      )}

      <section className="band about-credits-band" aria-labelledby="picture-credits">
        <div className="wrap">
          {/*
            A `<details>`, so the drawer costs no JavaScript and no client
            boundary — this page is a server component and the rest of About is
            deliberately zero-JS. It also means find-in-page and a screen reader
            both still reach the fifty entries, and the browser's own state
            handles the toggle.

            Shut by default. Tommy's standing instruction is that the credits
            are off the page (`hide the photo credits`), and a drawer that opens
            itself is a page with a credits list on it.
          */}
          <details className="credits-drawer">
            <summary className="credits-drawer__toggle">
              <span className="credits-drawer__label">
                <span className="credits-drawer__title" id="picture-credits">
                  Picture credits
                </span>
                <span className="credits-drawer__count">
                  {PICTURE_CREDIT_COUNT} pictures, from Wikimedia Commons
                </span>
              </span>
              <span className="credits-drawer__mark" aria-hidden="true" />
            </summary>

            <div className="credits-drawer__body">
              <p className="credits-drawer__intro">
                None of these is a photograph of this church. They are icons, manuscripts, museum
                objects and photographs held on Wikimedia Commons, and every one is public domain,
                CC0, CC&nbsp;BY or CC&nbsp;BY&#8209;SA. Each name links to the page the file is
                held on, where the full licence terms are.
              </p>

              {PICTURE_CREDITS.map((group) => (
                <section key={group.href} className="credits-group">
                  <h3 className="credits-group__head">
                    <Link href={group.href}>{group.label}</Link>
                    <span className="credits-group__count">{group.items.length}</span>
                  </h3>
                  <p className="credits-group__note">{group.note}</p>

                  <ul className="credits-group__list">
                    {group.items.map((credit) => (
                      <li key={credit.page}>
                        <a href={credit.page} rel="noreferrer noopener" target="_blank">
                          {credit.what}
                        </a>
                        <span className="credits-group__meta">
                          {credit.author} · {credit.license}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </details>
        </div>
      </section>
    </>
  );
}
