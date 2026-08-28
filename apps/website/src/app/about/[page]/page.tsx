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

export async function generateStaticParams(): Promise<Params[]> {
  return ABOUT_PAGES.map((page) => ({ page: page.slug }));
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
