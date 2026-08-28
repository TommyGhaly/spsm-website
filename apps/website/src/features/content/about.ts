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
 * The *prose* inside each one is content, and that is read from the `content`
 * collection by slug — see `app/about/[page]/page.tsx`. So staff can write and
 * rewrite these pages without a code change; they just cannot add a sixth.
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
