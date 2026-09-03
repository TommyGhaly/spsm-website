/**
 * The five parts of About, as one list.
 *
 * This is read in three places that must not drift apart — the header menu, the
 * `/about` index, and the route that renders each part — so it is declared once
 * here and imported by all of them. Adding a sixth part is one entry in this
 * array; nothing else has to be touched.
 *
 * **Literals, not Firestore.** The header's top level is hardcoded on purpose
 * (see the note above `NAV` in `app/layout.tsx`): a bad read must never be able
 * to empty the navigation. The Events submenu is the deliberate exception,
 * because the parish creates ministries and a developer should not have to. This
 * submenu is not an exception — the parish is not going to invent a sixth thing
 * it wants to say about itself between deploys, and these five names are part of
 * how the site is laid out rather than part of its content.
 *
 * **Every one of the five now has its own route, and the shared template that
 * rendered them from `content` is gone.** That is a reversal worth reading
 * before undoing. The five were built as `content` documents so staff could
 * rewrite them from the Firebase console without a deploy, and one by one they
 * outgrew it: `welcome-newcomers` became the festival tour with a passport in
 * `localStorage`, `our-belief`, `patron-saints` and `who-we-are` became prose
 * with credited plates and dated spines in it, and on 2026-09-01
 * `future-plans` became ten renderings, a video and a sourced area schedule. A
 * `content` document is a title and a markdown body; none of those five is.
 * `app/about/[page]/page.tsx` was deleted the same day, because with all five
 * slugs excluded it returned an empty `generateStaticParams()` and
 * `output: 'export'` refuses that.
 *
 * **So adding a sixth part is now two things, not one: an entry here *and* a
 * page under `app/about/`.** The entry alone puts a link in the header menu
 * that 404s. That is a real regression against what this comment used to
 * promise, and it is the price of five pages that are each worth more than a
 * markdown body.
 *
 * The cost of the reversal used to be stated here plainly: *staff can no longer
 * rewrite any of these five from the console, and changing a word in one is a
 * deploy.* **That is no longer true, and it was the half of the trade worth
 * buying back.**
 *
 * `features/about` is an overlay on these five routes: each band declares a few
 * named slots — a heading, a paragraph, a photograph — and
 * `aboutOverrides/{slug}` may override them. The page keeps its layout, its
 * widgets and its srcsets; the document is read at build time and re-read in the
 * browser, so a correction is live without a deploy. Staff can also append
 * sections to the foot of any of the five.
 *
 * What is deliberately *not* editable is the reason this is an overlay rather
 * than a return to `content`: the Creed, the dated spines, the feast tables, the
 * tour's station bodies and the area schedule are all computed or structured,
 * and none of them is prose a volunteer should be handed a markdown box for. The
 * manifest of what is reachable is `features/about/slots.ts`, and a slot that is
 * not in it cannot be written by anything, including the console.
 *
 * **The sixth-part warning above still stands, and the database now enforces
 * it.** `firestore.rules` refuses any `aboutOverrides` id outside these five
 * slugs, because a document with no route file behind it is copy nothing
 * renders.
 *

 * Note what this does **not** do: `/beliefs` and `/welcome` still exist and are
 * untouched. "Our belief" and "Welcome newcomers" here are new pages under
 * `/about`, not links to those two. That was chosen over reusing them — the two
 * old routes were built for other jobs (`/welcome` is an NFC destination that
 * `robots.ts` keeps out of search) and pointing a header menu at them would drag
 * both jobs into one page.
 */

export type AboutPage = {
  /** The last segment of the URL, and the `content` slug the prose is read by. */
  slug: string;
  /** The short name, for the header menu and the index. */
  label: string;
  /** The page's own title — its `h1` and its `<title>`. */
  title: string;
  /** One line saying what the page is. Shown under the title and used as the
   *  meta description, so it has to read as a sentence on its own. */
  lede: string;
};

export const ABOUT_PAGES: readonly AboutPage[] = [
  {
    slug: 'who-we-are',
    label: 'Who we are',
    title: 'Who We Are',
    lede: 'A Coptic Orthodox church in Wayland, Massachusetts, and the Church it belongs to.',
  },
  {
    slug: 'our-belief',
    label: 'Our belief',
    title: 'Our Belief',
    lede: 'What the Coptic Orthodox Church confesses, and where that confession comes from.',
  },
  {
    slug: 'patron-saints',
    label: 'Our patron saints',
    title: 'Our Patron Saints',
    lede: 'St. Philopater Mercurius and St. Mina, whose names this church carries.',
  },
  {
    slug: 'welcome-newcomers',
    label: 'Welcome newcomers',
    title: 'Welcome, Newcomers',
    lede: 'What happens in the liturgy, and what to expect if you have not been before.',
  },
  {
    slug: 'future-plans',
    label: 'Future plans',
    title: 'Future Plans',
    lede: 'What the church is building, and where the work stands.',
  },
];

/** `/about/who-we-are`, and so on. One place that knows the URL shape. */
export function aboutHref(slug: string): string {
  return `/about/${slug}`;
}

export function aboutPage(slug: string): AboutPage | undefined {
  return ABOUT_PAGES.find((page) => page.slug === slug);
}
