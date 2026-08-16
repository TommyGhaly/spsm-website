import type { ContentPage, DocOf } from '@spsm/shared';
import { Prose } from '@/components/Prose';
import { storageUrl } from '@/lib/storage';

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
  // A page with a `person` is a clergy or staff biography, which reads far
  // better as a portrait beside a name than as another run of prose under a
  // heading. `portrait` is null whenever nothing has been uploaded yet, and the
  // layout collapses to a single column rather than reserving an empty frame.
  const portrait = storageUrl(page.person?.portraitPath);

  if (page.person) {
    return (
      <article className={portrait ? 'person person--portrait' : 'person'} aria-labelledby={page.slug}>
        {portrait && (
          <img
            className="person__portrait"
            src={portrait}
            /*
             * The person's name, not "portrait of…" — a screen reader already
             * announces this as an image, so the word would be redundant.
             *
             * Intrinsic dimensions match what optimize-assets.mjs emits (800×1000,
             * cropped to the north edge so the crop never cuts a forehead). They
             * are stated so the text does not reflow when the image lands.
             */
            alt={page.person.name}
            width={800}
            height={1000}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="person__body">
          <h2 id={page.slug}>{page.title}</h2>
          <p className="meta">
            {page.person.rank}
            {page.person.email && (
              <>
                {' · '}
                <a href={`mailto:${page.person.email}`}>{page.person.email}</a>
              </>
            )}
          </p>
          <Prose>{page.body}</Prose>
        </div>
      </article>
    );
  }

  return (
    <section className="prose" aria-labelledby={page.slug}>
      <h2 id={page.slug}>{page.title}</h2>
      <Prose>{page.body}</Prose>
    </section>
  );
}
