import type { ContentPage, DocOf } from '@spsm/shared';
import { Prose } from '@/components/Prose';

/**
 * One prose page within a section.
 *
 * Renders as an `h2` because the section's own title is the page `h1` — heading
 * level tracks document structure, not font size.
 *
 * The heading id is the **slug**, not the document id. A section renders all of
 * its pages at one URL, so the slug is the only way to link to a particular one
 * — `/ministries#mother-of-mercy` — and it is the thing a person can read,
 * guess, and type. The document id happens to equal the slug for anything
 * seed-content.mjs wrote, but that is a coincidence of that script rather than a
 * property of the collection, and it would not hold for a page created any
 * other way.
 */
export function ContentPageBody({ page }: { page: DocOf<ContentPage> }) {
  return (
    <section className="prose" aria-labelledby={page.slug}>
      <h2 id={page.slug}>{page.title}</h2>
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
  );
}
