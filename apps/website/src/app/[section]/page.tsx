import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CONTENT_SECTIONS, type ContentSection } from '@spsm/shared';
import { getContentPages, SECTION_META, ContentPageBody } from '@/features/content';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

/**
 * One route for Our Faith / Welcome.
 *
 * This is a dynamic segment at the root, so it would in principle also match
 * `/events`, `/forms`, and the rest. Next resolves static routes before
 * dynamic ones, so those win — but the real guard is `generateStaticParams`
 * below, which only ever emits the five known content sections.
 */

type Params = { section: string };

/**
 * Sections this route must not emit. Each for its own reason.
 *
 * `contact` has a dedicated route — it is structured data (address, phone,
 * service times) served from `config/parish` — and with `output: 'export'`
 * both would write the same HTML file. Any prose in the `contact` content
 * section is still rendered, by that page rather than this one.
 *
 * `clergy` is rendered on the homepage, as the disclosures under the week's
 * schedule. Three biographies did not justify a page, and a visitor asking who
 * the priest is should not have to leave the page they landed on. The section
 * still exists in the content collection and staff still edit it the same way;
 * it simply has no URL of its own. `/#clergy` is where the footer points.
 *
 * `misc` is a catch-all for content that belongs nowhere else. It has no lede,
 * nothing links to it, and emitting `/misc` produced a page for nobody. The
 * section still exists so a page can be filed there without inventing a
 * section; it just does not get a URL of its own.
 *
 * `about` joined them when About grew its five parts. It has a real route at
 * `app/about/page.tsx` now, because it has to render an index of those parts and
 * this template has no way to. Same collision as `contact`: two pages writing
 * `/about` under `output: 'export'`. The `about` section itself is untouched —
 * that page reads it, and prose filed there still appears.
 *
 * `ministries` is last, and it is the only one here that lost a page somebody
 * could reach. `/events` is the standing work of the church — each ministry with
 * its photographs and its gatherings — and this section was a second page of
 * prose answering the same question less well; its footer link is gone with it.
 * Like `clergy` and `misc`, the section itself stays, so anything already filed
 * there survives without a URL of its own.
 */
const NOT_A_PAGE: readonly string[] = ['contact', 'clergy', 'misc', 'about', 'ministries'];

export async function generateStaticParams(): Promise<Params[]> {
  return CONTENT_SECTIONS.filter((section) => !NOT_A_PAGE.includes(section)).map(
    (section) => ({ section }),
  );
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
      <PageHeader title={meta.title} />
      <PageBody>
        {meta.lede && <p className="note">{meta.lede}</p>}
        {pages.length === 0 ? (
          <EmptyState what={`${section} pages`} collection="content" />
        ) : (
          pages.map((page) => <ContentPageBody key={page.id} page={page} />)
        )}
      </PageBody>
    </>
  );
}
