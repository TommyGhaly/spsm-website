import type { ContentPage, DocOf } from '@spsm/shared';
import { Prose } from '@/components/Prose';

/**
 * One prose page within a section.
 *
 * Renders as an `h2` because the section's own title is the page `h1` — heading
 * level tracks document structure, not font size.
 */
export function ContentPageBody({ page }: { page: DocOf<ContentPage> }) {
  return (
    <section className="prose" aria-labelledby={`page-${page.id}`}>
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
  );
}
