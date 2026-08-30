import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ABOUT_PAGES, aboutHref, aboutPage, getContentPage, ContentPageBody } from '@/features/content';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

/**
 * One part of About — Who we are, Our belief, Our patron saints, Welcome
 * newcomers, Future plans.
 *
 * **The five routes exist whether or not anybody has written them.** They come
 * from `ABOUT_PAGES`, a literal, rather than from whatever the `content`
 * collection happens to hold at build time — which is the only way the header
 * menu can be wired up before the prose is. A part nobody has written yet is a
 * real page saying so; it is never a 404 from a link in the masthead.
 *
 * The prose itself is a `content` document looked up by slug, so staff write
 * these the same way they write every other page on the site, and filling one in
 * needs a Firestore write and a rebuild rather than a code change.
 *
 * `getContentPage` matches on slug across every section, not just `about`. These
 * five slugs are distinctive enough that a collision would have to be
 * deliberate, and the alternative — a slug-plus-section query — needs a
 * composite index for a problem nobody has.
 */

type Params = { page: string };

/**
 * Parts of About that this template must not emit.
 *
 * `welcome-newcomers` has its own route — `app/about/welcome-newcomers/page.tsx`
 * — because it is the festival tour rather than prose: six stations with their
 * own URL fragments, a passport held in `localStorage`, and a gallery per
 * station, none of which a `content` document can express. Under
 * `output: 'export'` both files would write the same HTML, so the slug is
 * excluded here and the dedicated page wins.
 *
 * `our-belief` left for a different reason — `app/about/our-belief/page.tsx`.
 * It is prose, but it is prose with ten pictures in it, each carrying its own
 * alt text, caption, srcset and licence credit, and a `content` document is a
 * title and a markdown body. The Creed in it also needs its line breaks to
 * survive, which markdown's single newline does not.
 *
 * `patron-saints` left third — `app/about/patron-saints/page.tsx`. Same shape
 * as `our-belief`: two lives told in paragraphs with seven credited pictures
 * set into them, two feast tables and an iconography grid, against a `content`
 * document's single markdown body.
 *
 * `who-we-are` left fourth — `app/about/who-we-are/page.tsx`. Same shape again:
 * the history from Alexandria to Rice Road, told with seven credited pictures
 * set into it and two chronologies rendered as description lists, none of which
 * survives a single markdown body.
 *
 * All four stay in `ABOUT_PAGES`, so the header menu, the `/about` index and
 * the sitemap are unaffected. Exactly the shape `NOT_A_PAGE` has in
 * `app/[section]/page.tsx`, for exactly the same reason. Note what is left:
 * `future-plans` is the only part of About still read from `content`, which is
 * also the only one whose text will keep changing.
 */
const NOT_PROSE: readonly string[] = [
  'welcome-newcomers',
  'our-belief',
  'patron-saints',
  'who-we-are',
];

export async function generateStaticParams(): Promise<Params[]> {
  return ABOUT_PAGES.filter((page) => !NOT_PROSE.includes(page.slug)).map((page) => ({
    page: page.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { page } = await params;
  const meta = aboutPage(page);
  if (!meta) return { title: 'Not found' };
  return {
    title: meta.title,
    description: meta.lede,
    alternates: { canonical: aboutHref(meta.slug) },
  };
}

export default async function AboutSectionPage({ params }: { params: Promise<Params> }) {
  const { page } = await params;
  const meta = aboutPage(page);
  if (!meta) notFound();

  const content = await getContentPage(meta.slug);

  return (
    <>
      <PageHeader title={meta.title} />
      <PageBody>
        {/*
          No visible title. `PageHeader` renders a hidden `h1` and every prose
          page on this site opens with its lede — the visible heading is the
          `h2` that `ContentPageBody` prints from the document's own title, and
          adding one here would print the name of the page twice on every page
          that has been written. The banner was cut sitewide for a reason; this
          is not the place to bring one back.
        */}
        <p className="note">{meta.lede}</p>

        {content ? (
          <ContentPageBody page={content} />
        ) : (
          /* `what` lands inside "has no published …", so it has to be a mass
             noun — "the page" there reads as broken English. */
          <EmptyState what={`prose for "${meta.label}"`} collection="content" />
        )}

        {/*
          Back to the index rather than to the previous page: this is reached
          from the header menu as often as from `/about`, so "back" in the
          browser sense is not reliably where the reader wants to go.
        */}
        <p className="about-page__back">
          <Link href="/about">All of About</Link>
        </p>
      </PageBody>
    </>
  );
}
