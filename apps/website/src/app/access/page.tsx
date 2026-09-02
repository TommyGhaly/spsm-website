import type { Metadata } from 'next';
import { AccessScreen } from '@/features/access';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeading } from '@/components/SectionHeading';

/**
 * Who administers what. Superadmins only.
 *
 * ---------------------------------------------------------------------------
 * ## Why this is a route at all, when /admin was deleted
 *
 * The site's rule is that editing is reached from the thing being edited — an
 * Edit control that appears for whoever may use it — and the /admin section was
 * removed for being a second place to do what the pages already did. That rule
 * holds here and points the other way: **there is no page whose contents are
 * "what Marina may administer"**. The subject of this screen is a person, and a
 * person is not a page on this site. It is the one screen with nowhere in-place
 * to live, which is exactly the carve-out the note in HeaderAuth.tsx names.
 *
 * ## Unlisted, and reached from the account menu
 *
 * Not in the header, not in the footer, not in `sitemap.ts`. The only door is a
 * row in the account menu that renders for the superadmin and for nobody else.
 * That is a convenience rather than a protection — this is a static export, so
 * the chunk is public and the address is guessable — and it does not need to be
 * a protection: `allow update: if isSuper()` on `/members/{uid}` refuses every
 * write from anybody else, and the screen itself refuses to draw.
 *
 * ## `noindex`, and it matters more here than the usual
 *
 * A search result for this page would be a list of the parish's staff by name
 * and email to anybody who clicked it — which the page would then refuse to
 * show them, after the search engine had already published the title. The
 * directory is read client-side so no name is ever in the exported HTML, and
 * this keeps the address itself out of the index too.
 * ---------------------------------------------------------------------------
 */
export const metadata: Metadata = {
  title: 'Areas',
  robots: { index: false, follow: false },
};

export default function AccessPage() {
  return (
    <>
      <PageHeader title="Areas" />

      {/*
        A band rather than a bare `PageBody`. `PageHeader` renders nothing
        visible, so a page that opens straight into a control column opens hard
        against the masthead and reads as a fragment.
      */}
      <section className="band" aria-labelledby="access-heading">
        <div className="wrap">
          <SectionHeading
            id="access-heading"
            eyebrow="Superadmin"
            title="Who administers what"
            note="Give somebody one part of the site without giving them the rest. Changes take effect the next time they load a page."
          />
          <AccessScreen />
        </div>
      </section>
    </>
  );
}
