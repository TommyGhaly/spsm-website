import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CONTENT_SECTIONS, type ContentSection } from '@spsm/shared';
import { getContentPages, SECTION_META, ContentPageBody } from '@/features/content';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';

/**
 * One route for About / Our Faith / Clergy / Contact.
 *
 * This is a dynamic segment at the root, so it would in principle also match
 * `/events`, `/prayer`, and the rest. Next resolves static routes before
 * dynamic ones, so those win — but the real guard is `generateStaticParams`
 * below, which only ever emits the five known content sections.
 */

type Params = { section: string };

export async function generateStaticParams(): Promise<Params[]> {
  return CONTENT_SECTIONS.map((section) => ({ section }));
}

function isSection(value: string): value is ContentSection {
  return (CONTENT_SECTIONS as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { section } = await params;
  if (!isSection(section)) return { title: 'Not found' };
  const meta = SECTION_META[section];
  return { title: meta.title, description: meta.lede };
}

export default async function SectionPage({ params }: { params: Promise<Params> }) {
  const { section } = await params;
  if (!isSection(section)) notFound();

  const meta = SECTION_META[section];
  const pages = await getContentPages(section);

  return (
    <>
      <PageHeader title={meta.title} lede={meta.lede} />
      {pages.length === 0 ? (
        <EmptyState what={`${section} pages`} collection="content" />
      ) : (
        pages.map((page) => <ContentPageBody key={page.id} page={page} />)
      )}
    </>
  );
}
