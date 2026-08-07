import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CONTENT_SECTIONS, type ContentSection } from '@spsm/shared';
import { getContentPages } from '@/lib/content';
import { Prose } from '@/components/Prose';
import { EmptyState } from '@/components/Notice';

/**
 * One route for About / Our Faith / Clergy / Contact.
 *
 * These were bespoke hand-built pages on Wix. They are all the same thing —
 * ordered prose within a section — so they get one template driven by
 * `ContentPage.section` and `.order`. Adding a page to a section is a Firestore
 * write plus a rebuild, not a code change.
 *
 * Note this is a dynamic segment at the root, so it would in principle match
 * `/events` too. Next resolves static routes before dynamic ones, so
 * `app/events/page.tsx` wins — but the `SECTION_META` allowlist below is what
 * actually keeps this route honest, since generateStaticParams only emits the
 * five known sections.
 */

const SECTION_META: Record<ContentSection, { title: string; lede: string }> = {
  about: {
    title: 'About the Parish',
    lede: 'Who we are, and how we came to be here.',
  },
  beliefs: {
    title: 'Our Faith',
    lede: 'What the Coptic Orthodox Church believes and confesses.',
  },
  clergy: {
    title: 'Our Clergy',
    lede: 'The fathers who serve this parish.',
  },
  contact: {
    title: 'Contact Us',
    lede: 'How to reach the parish office.',
  },
  misc: {
    title: 'Parish Information',
    lede: '',
  },
};

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
      <header className="prose">
        <h1>{meta.title}</h1>
        {meta.lede && <p className="lede">{meta.lede}</p>}
      </header>

      {pages.length === 0 ? (
        <EmptyState what={`${section} pages`} collection="content" />
      ) : (
        pages.map((page) => (
          <section key={page.id} className="prose" aria-labelledby={`page-${page.id}`}>
            {/* The section's own h1 is above, so a page within it is an h2 —
                heading level tracks document structure, not font size. */}
            <h2 id={`page-${page.id}`}>{page.title}</h2>
            {page.person && (
              <p className="meta">
                {page.person.rank}
                {page.person.email && (
                  <>
                    {' · '}
                    <a href={`mailto:${page.person.email}`}>{page.person.email}</a>
                  </>
                )}
              </p>
            )}
            <Prose>{page.body}</Prose>
          </section>
        ))
      )}
    </>
  );
}
