import Link from 'next/link';
import { BackLink } from '@/components/BackLink';
import { ABOUT_PAGES, aboutHref } from '@/features/content';

/**
 * The foot of a part of About: the other parts, and the way back up to the
 * index.
 *
 * ---------------------------------------------------------------------------
 * **This replaced a single bare "All of About" link, which Tommy said looked
 * out of place — and it did, for a structural reason rather than a stylistic
 * one.** Every one of the five pages ended the same way: a `.wrap` holding
 * eight words on a strip of plain paper, sitting hard against the dark oxblood
 * footer with no gap at all. On /about/future-plans, which ends on
 * `band--deep`, that read as something failing to load — deep, then a pale gap
 * with a link in it, then deep again. On the other four it read as blander
 * rather than broken, but it was the same empty band: no amount of restyling
 * one link fixes a strip that has nothing in it.
 *
 * So the foot was given something to be. The four other parts of About, each
 * with the one-line lede that already exists for it, on `band--sunken` so the
 * strip has a ground and a hairline of its own. A reader who has just come to
 * the end of one part of About is exactly the reader who might want the next
 * one, and a long article ending with "more from here" is a settled convention
 * rather than an invention.
 *
 * **The list comes from `ABOUT_PAGES` with `current` filtered out**, so a sixth
 * part of About appears here on the day its entry is added and this component
 * is never the reason a page is missing from it. `current` is a prop rather
 * than a hardcoded slug because this is now on all five pages; the earlier
 * version of this lived in `features/future/parts.tsx` and filtered out
 * `'future-plans'` by literal, which is exactly what stopped it being reusable.
 * A slug that matches nothing lists all five, which is wrong but not broken —
 * the page links to itself. There is no runtime guard for that: `ABOUT_PAGES`
 * types `slug` as a bare `string`, so a typo here is a typo the compiler cannot
 * see either way.
 *
 * `BackLink` for the return to `/about` rather than another inline anchor: it
 * exists because three hand-rolled back links on the events pages were
 * misaligned, drawn with a literal `←` glyph, and too small to hit. Using it
 * here means none of the five can reintroduce any of that.
 * ---------------------------------------------------------------------------
 */
export function MoreOfAbout({ current }: { current: string }) {
  const others = ABOUT_PAGES.filter((page) => page.slug !== current);

  return (
    <section className="band band--sunken about-more" aria-labelledby="more-about">
      <div className="wrap">
        <h2 id="more-about" className="about-more__head">
          More about the church
        </h2>

        <ul className="about-more__list">
          {others.map((page) => (
            <li key={page.slug}>
              <Link className="about-more__link" href={aboutHref(page.slug)}>
                <span className="about-more__label">{page.label}</span>
                <span className="about-more__lede">{page.lede}</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="about-more__back">
          <BackLink href="/about" label="All of About" />
        </p>
      </div>
    </section>
  );
}
