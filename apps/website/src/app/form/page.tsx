import type { Metadata } from 'next';
import { FormScreen } from '@/features/forms';

/**
 * The shell every parish form is served through.
 *
 * ---------------------------------------------------------------------------
 * One exported page, many URLs.
 *
 * This exports to `/form.html`, and Firebase Hosting rewrites `/forms/**` onto
 * it — the same arrangement `/events/**` uses to reach `/gallery.html`.
 * `next.config.mjs` adds the equivalent rewrite for `next dev`, where Hosting is
 * not in the picture. The slug is read from `location.pathname` inside
 * `FormScreen`, because under a rewrite the served file's own path is `/form`
 * and a route param would be empty on every request.
 *
 * There is deliberately no `app/forms/[slug]` route and no
 * `generateStaticParams`. Baking a page per form would mean a form published on
 * Tuesday is a 404 until somebody with deploy rights runs a build — which turns
 * "add a form" from something the parish office does into something it files a
 * request for, and that is the whole point of the feature.
 *
 * Nobody should ever see this page at `/form` itself. If they do, `FormScreen`
 * finds no slug in the path and says the form was not found, which is the
 * correct answer.
 * ---------------------------------------------------------------------------
 */
export const metadata: Metadata = {
  title: 'Form',
  /*
   * Kept out of search on purpose, and it costs nothing here: the form is
   * fetched in the browser, so this file's HTML never contains one. `robots.ts`
   * excludes the path as well — the two agree rather than one relying on the
   * other.
   */
  robots: { index: false, follow: false },
};

export default function FormPage() {
  return <FormScreen />;
}
