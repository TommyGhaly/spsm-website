import type { Metadata } from 'next';
import { ServantSignUpScreen } from '@/features/camp/ServantSignUpScreen';

/**
 * The servant sign-up — the one form with a route of its own.
 *
 * It was the whole camp screen until 2 Sep 2026: the family registration, the
 * roster, the billing and the sign-up queue were all behind this address, gated
 * on a program grant. All of that moved to /admin/camp, where the rest of the
 * camp's work now lives, and what is left here is the half that was always
 * meant to be public — one person saying which days they can serve.
 *
 * ---------------------------------------------------------------------------
 * Why this is an exception, and why the exception is safe.
 *
 * Every other parish form is served through the `/form` shell: there is no
 * `app/forms/[slug]` route and no `generateStaticParams`, because baking a page
 * per form would mean a form published on Tuesday is a 404 until somebody with
 * deploy rights runs a build. See `app/form/page.tsx` for the full argument —
 * it is a good one and this file does not weaken it.
 *
 * Summer camp cannot go through that shell. The shell reads a slug out of the
 * address bar and looks up a `FormDefinition` in Firestore; a camp registration
 * is not one, and never will be — it repeats a child, carries a payment ledger
 * written to over weeks, and has roles appended long after it was taken. There
 * is nothing for the shell to find, so it needs a route.
 *
 * The two coexist because **Firebase Hosting resolves redirects, then exact
 * static files, then rewrites**. This page exports to `out/forms/summer-camp.html`,
 * which is a file, so it answers `/forms/summer-camp` before the `/forms/**`
 * rewrite is ever considered — exactly the ordering the `//forms-shell` note in
 * firebase.json relies on to keep `/forms` itself off the shell. Every other
 * slug still has no file and still falls through.
 *
 * `next dev` needed a matching change: its `/forms/:slug` rewrite ran in
 * `beforeFiles`, which is *before* the filesystem, and would have swallowed
 * this route locally while production served it correctly. It is a `fallback`
 * rewrite now, which is where Hosting's own order puts it. See next.config.mjs.
 * ---------------------------------------------------------------------------
 */
export const metadata: Metadata = {
  title: 'Serve at summer camp',
  /*
   * Out of search, like the rest of `/forms/*`, and here it costs nothing: the
   * page is gated on a program grant, so the exported HTML holds a heading and
   * nothing else. `robots.ts` already disallows `/forms/`; this agrees with it
   * rather than relying on it.
   */
  robots: { index: false, follow: false },
};

export default function SummerCampPage() {
  return <ServantSignUpScreen />;
}
