import type { Metadata } from 'next';
import Link from 'next/link';
import { formatAddress } from '@spsm/shared';
import { getParishConfig } from '@/lib/config';
import { Masthead } from '@/components/Masthead';
import { SiteNav, type NavItem } from '@/components/SiteNav';
import { programNavChildren } from '@/features/programs/nav';
// A leaf module — five literals and two helpers, no Firestore import — so
// pulling it in here adds nothing to what the chrome already costs.
import { ABOUT_PAGES, aboutHref } from '@/features/content/about';
// Build-time, and one query for the whole footer — see `filled` below.
import { getContentPages } from '@/features/content';
import { HeaderAuth } from '@/components/HeaderAuth';
import { Icon } from '@/components/Icon';
import { ThemeBootScript, ThemeRuntime } from '@/components/ThemeRuntime';
import './globals.css';

/**
 * The canonical origin. **`www`, not the apex** — spsmwayland.org 301s to
 * www.spsmwayland.org today, and the migration has to keep that or every
 * existing inbound link picks up an extra redirect hop.
 */
export const SITE_ORIGIN = 'https://www.spsmwayland.org';

export const metadata: Metadata = {
  // Without this, Open Graph and canonical URLs render relative, and a relative
  // og:image is simply dropped by every scraper — so a shared link shows no
  // preview at all. WhatsApp and Facebook are how a parish actually circulates
  // anything, which makes this one line disproportionately load-bearing.
  metadataBase: new URL(SITE_ORIGIN),
  alternates: { canonical: '/' },
  title: {
    default: 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
    template: '%s · St. Philopater Mercurius & St. Mina',
  },
  description:
    'St. Philopater Mercurius & St. Mina Coptic Orthodox Church in Wayland, Massachusetts — liturgy times, the church calendar, and ministries.',
  openGraph: {
    type: 'website',
    siteName: 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
    locale: 'en_US',
    url: '/',
  },
};

/**
 * Nav is hardcoded rather than generated from the `content` collection.
 *
 * Generating it would mean every page in the site depends on a Firestore read
 * succeeding, so one bad read empties the navigation everywhere at once. The
 * cost is that adding a top-level section is a code change — which, for
 * something that changes about once a decade, is the better trade.
 *
 * **The programs under Events are the one exception, and it does not weaken the
 * rule.** They are attached below, from a build-time read, because the parish
 * creates programs and a developer should not have to. A failed read yields an
 * empty list, so the worst case is a missing dropdown — "Events" itself stays
 * in the bar and still leads to a page listing them. The top level is still
 * nine literals that no data can empty.
 */
const NAV: NavItem[] = [
  // The wordmark also links home, which is the convention a regular web user
  // knows. This is here because plenty of parishioners do not, and looking for
  // the word "Home" and not finding it is a worse first impression than one
  // redundant link.
  { href: '/', label: 'Home' },
  /*
   * About has a dropdown, like Events — but built from literals rather than
   * from a read, so the exception below still stands as written.
   *
   * Its five parts are the same shape as the ministries under Events and behave
   * the same way: hover or focus opens the menu, and a touch visitor who taps
   * the word simply lands on `/about`, which lists all five. What it does not
   * have is photographs. A ministry is a thing you can take a picture of; "Our
   * belief" is not, and a tile carrying a name over a blank ground is the same
   * plain light tile a program with no approved pictures already gets — see
   * `NavTile`, which decides on `has-cover` from what actually loaded. So the
   * menu needs no new markup and no new CSS: no `coverPaths`, no cover.
   */
  {
    href: '/about',
    label: 'About',
    children: ABOUT_PAGES.map((page) => ({ href: aboutHref(page.slug), label: page.label })),
  },
  // Two entries, two views of the `events` collection, and they are not
  // duplicates: `/calendar` is the month grid you scan by date, `/events` the
  // ordered list of what is coming up. See the note at the top of
  // app/calendar/page.tsx.
  { href: '/calendar', label: 'Calendar' },
  { href: '/events', label: 'Events' },
  // Directly after Events, which is where it belongs: both are things the
  // parish is asking you to do something about. `/forms` is a hub rather than a
  // form — see app/forms/page.tsx — so this one item covers every form the
  // parish adds without the nav growing again each time.
  { href: '/forms', label: 'Forms' },
  // The catalog page has existed since the bookstore feature shipped and was
  // reachable only by typing the URL — nothing on the site linked to it. It is
  // in the sitemap now for the same reason.
  //
  // It briefly became a child of a "More" menu, to buy room in the row for the
  // announcements board and the apps page. Tommy put it back: those two belong
  // in the footer, and the shop is a section of the site in its own right.
  { href: '/bookstore', label: 'Bookstore' },
  { href: '/livestream', label: 'Live' },
  { href: '/giving', label: 'Giving' },
  { href: '/contact', label: 'Contact' },
];

// `/beliefs` came off the top bar pending a decision to make it a subcategory of
// something rather than a seventh sibling. The decision went the other way in
// the end: About grew its own "Our belief" page rather than adopting this one,
// because `/beliefs` is the Church's faith as a content section and the new page
// is this parish's account of it. `/beliefs` is unchanged — still built, still
// in the footer, still in the sitemap, still off the header. Nothing 404s.

// `/gallery` is absent and must stay absent. It is not a page: it is the shell
// that `firebase.json` rewrites `/events/**` into, and visiting it directly
// renders "no such gallery", which is correct behaviour for machinery and a dead
// end for a visitor. The photographs are reached through their program.

// `/welcome` is absent for the reason `/parking` is: it is an entry point for
// an NFC tap — a tag by the door — and not a page a visitor browses to. The
// route still builds and still works; nothing on the site links to it, and
// robots.ts and sitemap.ts keep it out of search so the tag stays the only way
// in.
//
// `/ministries` is absent for a plainer reason: it is read once, not weekly,
// and it crowds out the links that are. It stays reachable from the footer.
//
// The clergy are not a route at all any more — the roster is a section of
// `/about/who-we-are`, and the footer link is `/about/who-we-are#clergy`.

/**
 * The parish's weekly announcements board, which is not part of this site.
 *
 * It is its own Firebase site — a rotating display of the week's meetings and
 * services, the thing that runs on the screen in the hall — and it is linked
 * rather than embedded or copied. Copying it would mean two places to update and
 * one of them wrong by Wednesday; the board reads live from its own source,
 * which is the same rule the bulletin follows (read through, never mirror).
 */
export const WEEKLY_ANNOUNCEMENTS = 'https://weeklyannouncements-1d046.web.app/';

/**
 * The footer's links, in two short columns.
 *
 * ---------------------------------------------------------------------------
 * Chosen by what somebody is actually trying to do, which is a different list
 * from "the pages the header does not have".
 *
 * That earlier rule produced a tidy footer of four links, two of which — the
 * clergy biographies and the servants' schedule — are read once a year and once
 * a week by a few dozen people. Meanwhile the things a parishioner opens on a
 * Sunday were left out on the grounds that the header already had them. A person
 * at the bottom of a page is not thinking about which bar a link came from; they
 * are looking for the liturgy, the calendar, or the form somebody asked them to
 * fill in. Repeating four header links costs four lines and saves a scroll back
 * to the top.
 *
 * So: the weekly errands first, then the occasional ones. "Our clergy" stays
 * because somebody looking for the priest's name looks down here. It points at
 * `/about/who-we-are#clergy` — the written roster, three fathers and three
 * deacons — rather than the old `/#clergy`, which was a homepage band built
 * from the `content/clergy` pages. Those are all unpublished, so that band
 * renders nothing and the fragment matched nothing: the link left a reader at
 * the top of the homepage with no clergy anywhere on it.
 *
 * `/servants` used to be the last entry, and the note here said the footer was
 * its only door. It has no door now because it has no room: the servants
 * schedule is part of `/calendar`, shown to whoever signs in with a church
 * account. One fewer link, and the people who needed it no longer have to
 * remember a URL nobody would link to them.
 *
 * `/parking` is still not here, and must not be. It is reached by tapping an NFC
 * tag in the car park, so a footer link is the wrong entry point and would be the
 * site's most prominent route to its only unauthenticated write.
 * ---------------------------------------------------------------------------
 */
const FOOTER_MORE = [
  { href: '/livestream', label: 'Watch live', external: false },
  { href: '/calendar', label: 'Church calendar', external: false },
  { href: WEEKLY_ANNOUNCEMENTS, label: 'Weekly announcements', external: true },
  { href: '/about/who-we-are#clergy', label: 'Our clergy', external: false },
  { href: '/giving', label: 'Giving', external: false },
  { href: '/forms', label: 'Forms', external: false },
  { href: '/apps', label: 'Our apps', external: false },
] as const;

/**
 * Two links that appear only once there is something behind them.
 *
 * `/beliefs` and `/ministries` are `content` sections, and both are empty: each
 * renders "Nothing here yet", which is honest of the page and useless as a
 * destination. They sat in the footer anyway, which made two of its five links a
 * dead end.
 *
 * Deleting them outright would have stranded two real routes with no way back —
 * nobody would remember to restore the link the day staff publish something. So
 * the link is conditional on the read instead: publish a page in either section
 * and it appears at the next build, with no code change. The same shape the
 * social icons and `ParishMap` already use — render nothing rather than render a
 * promise the data cannot keep.
 */
const FOOTER_SECTIONS = [
  { section: 'beliefs', href: '/beliefs', label: 'Our faith' },
  { section: 'ministries', href: '/ministries', label: 'Ministries' },
] as const;

/**
 * `children` is not wrapped in `.wrap` here, unlike before.
 *
 * The redesign has full-bleed bands — the hero, the sunken section grounds, the
 * footer — and none of them can exist inside a max-width container. So each page
 * owns its own bands and applies `.wrap` within them. The cost is one more line
 * per page; the alternative is every page fighting a container it did not ask
 * for.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The parish document is still read at build time — it is content (an address,
  // service times), not styling, and it belongs in the HTML for SEO and for
  // anyone without JavaScript. The *theme* is deliberately not read here any
  // more; see ThemeRuntime.
  const parish = await getParishConfig();

  /*
   * The programs, read once here at build time and baked into every page's
   * header. Nothing fetches them in the browser — see features/programs/nav.ts
   * for why that matters and what it costs.
   */
  const programs = await programNavChildren();

  /*
   * Which `content` sections actually have a published page in them.
   *
   * One query for every section rather than one per section, and it is the same
   * query `/beliefs` and `/ministries` each run for themselves — so the footer
   * cannot offer a link to a page that will greet the visitor with "Nothing here
   * yet". See FOOTER_SECTIONS.
   *
   * A failed read yields `[]` through `safely()`, which hides both links. That
   * is the right way round: a missing link is a smaller fault than a link into
   * an empty room.
   */
  const filled = new Set((await getContentPages()).map((page) => page.section));
  const sections = FOOTER_SECTIONS.filter((item) => filled.has(item.section));

  const nav: NavItem[] = NAV.map((item) =>
    item.href === '/events' && programs.length > 0 ? { ...item, children: programs } : item,
  );
  const address = formatAddress(parish.address);

  /*
   * The parish's social accounts, in a fixed order, minus any that are unset.
   *
   * Built here rather than in the markup so the footer can ask one question —
   * "are there any?" — instead of three, and so the empty case renders no list
   * at all rather than an empty `<ul>`. `parseParishConfig` has already
   * rejected anything that is not an absolute http(s) URL, so these are safe to
   * put straight in an `href`.
   */
  const social = [
    { name: 'instagram', label: 'Instagram', href: parish.social.instagram },
    { name: 'facebook', label: 'Facebook', href: parish.social.facebook },
    { name: 'youtube', label: 'YouTube', href: parish.social.youtube },
  ].filter((account) => account.href !== '');

  return (
    <html lang="en">
      <head>
        {/*
          Restores the cached theme before first paint. Carries no token values
          — only the code to read them back out of localStorage — so nothing
          about the parish's styling is baked into this HTML, which is the whole
          point: a theme edit takes effect on reload, with no rebuild.
        */}
        <ThemeBootScript />
      </head>
      <body>
        {/* Fetches the current theme and applies it. Renders nothing. */}
        <ThemeRuntime />
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <div className="shell">
          {/*
            A client component, and only for its scroll behaviour — everything
            inside it is still rendered on the server and passed through as
            children. See Masthead.tsx: the bar slides away as you read and
            comes back on a scroll up, a pointer at the top of the window, or
            focus landing inside it.
          */}
          <Masthead>
            <div className="wrap masthead__inner">
              <Link href="/" className="wordmark">
                {/*
                  Decorative, hence the empty alt: the parish seal and the text
                  beside it say the same thing, and a screen reader announcing
                  both reads the name twice.

                  Plain <img> rather than next/image — the loader is disabled
                  under `output: 'export'` anyway, so all next/image would add
                  here is a wrapper around an <img> we can write ourselves. The
                  intrinsic width and height are set to reserve the space before
                  the PNG arrives, so the nav does not jump on first paint.
                */}
                <img
                  className="wordmark__seal"
                  src="/brand/seal-64.png"
                  srcSet="/brand/seal-64.png 1x, /brand/seal-128.png 2x, /brand/seal-192.png 3x"
                  alt=""
                  width={70}
                  height={64}
                />
                <span className="wordmark__name">
                  St. Philopater Mercurius &amp; St. Mina
                  <span>Coptic Orthodox Church · Wayland, MA</span>
                </span>
              </Link>
              <SiteNav items={nav} />
              {/*
                Sign-in, at the right-hand end. A client component, but not one
                that costs the page anything: it statically imports only
                lib/authStore.ts, which reaches `firebase/auth` through a
                dynamic import and therefore keeps the ~150KB SDK in its own
                chunk. See the rule at the top of lib/auth.ts — this is the
                first thing in the chrome that touches auth at all, and it is
                only allowed to because it does not load it.
              */}
              <HeaderAuth />
            </div>
          </Masthead>

          <main id="main">{children}</main>

          <footer className="footer">
            <div className="wrap">
              <div className="footer__inner">
                {/*
                  Who and where, in one block.

                  It was two — an identity block and a "Visit" column under its
                  own heading — which is two headings and a column of width for
                  four short lines that all answer the same question. The seal
                  now sits beside the name rather than above it, which is worth
                  about 60px of the footer's height on every page, and the
                  address follows the name it belongs to.
                */}
                <div className="footer__brand">
                  <div className="footer__lockup">
                    <img
                      className="footer__seal"
                      src="/brand/seal-128.png"
                      srcSet="/brand/seal-128.png 1x, /brand/seal-192.png 2x"
                      alt=""
                      width={70}
                      height={64}
                    />
                    <div>
                      {/*
                        One line, at every width — the same requirement the
                        masthead wordmark carries, and met the same way: `nowrap`
                        plus a size that is a function of the room it has. See
                        `.footer__name`. This has been a hardcoded `<br />` and
                        then a balanced two-line wrap; it is neither now.
                      */}
                      <p className="footer__name">St. Philopater Mercurius &amp; St. Mina</p>
                      <p className="footer__kicker">Coptic Orthodox Church</p>
                    </div>
                  </div>

                  {/* Each line is conditional for the same reason ContactDetails
                      is: a church that has published a phone number but not an
                      address should show the phone number, not a blank row. */}
                  <address className="footer__contact">
                    {address ? (
                      <span>
                        {parish.address.line1},{' '}
                        {[parish.address.city, parish.address.state].filter(Boolean).join(', ')}{' '}
                        {parish.address.postalCode}
                      </span>
                    ) : (
                      <span>Wayland, Massachusetts</span>
                    )}
                    {/* Both on one line, which they fit on: a phone number and
                        an email address are 250px together and the narrowest
                        this block ever gets is 339. Two lines here were two lines
                        of footer on every page. */}
                    {(parish.phone || parish.email) && (
                      <span className="footer__reach">
                        {parish.phone && (
                          <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>
                        )}
                        {parish.phone && parish.email && (
                          <span aria-hidden="true">·</span>
                        )}
                        {parish.email && <a href={`mailto:${parish.email}`}>{parish.email}</a>}
                      </span>
                    )}
                  </address>

                  {/*
                    One link, to the page with the map on it, rather than the two
                    directions buttons themselves.

                    `ParishMap` has an Apple Maps link and a Google Maps link and
                    a note explaining why it needs both — each is shaped for the
                    app it opens, and both were checked against the live apps.
                    Reproducing that pair down here would be two more links and a
                    second copy of a decision that is already made; sending
                    somebody to the map is one link and lets them pick.
                  */}
                  <p className="footer__directions">
                    <Link href="/contact">
                      Map and directions
                      <Icon name="arrow" size={14} />
                    </Link>
                  </p>
                </div>

                {/*
                  The regular weekly schedule, in the footer of every page.

                  "When is liturgy?" is the most asked question a church website
                  answers, and until this it was on the homepage and on /contact
                  and nowhere else — so anybody reading a form, an event or the
                  bookstore had to navigate to find it.

                  It is `config/parish.serviceTimes`, the same source both those
                  pages read, so there is no second copy to fall out of date. The
                  whole block is dropped when the church has not published any: a
                  heading over nothing is worse than no heading.

                  These are the times that hold *every* week; a feast is an
                  exception to them, which is what the calendar link in the next
                  column is for. See the note in `ServiceTimes`.
                */}
                {parish.serviceTimes.length > 0 && (
                  <section aria-labelledby="footer-services">
                    <h2 id="footer-services">Services</h2>
                    <ul className="footer__services">
                      {parish.serviceTimes.map((service) => (
                        <li key={`${service.day}-${service.time}-${service.name}`}>
                          <span className="footer__service-when">
                            {service.day} · {service.time}
                          </span>{' '}
                          <span className="footer__service-name">{service.name}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/*
                  Two short columns rather than one long one — eight links in a
                  single stack is eight rows, and the footer is as tall as its
                  tallest block. `sections` is the pair that only exists when the
                  `content` collection has something published in them; see
                  FOOTER_SECTIONS.
                */}
                <nav aria-labelledby="footer-more">
                  <h2 id="footer-more">More</h2>
                  <ul className="footer__links footer__links--split">
                    {FOOTER_MORE.map((item) =>
                      item.external ? (
                        <li key={item.href}>
                          <a href={item.href} rel="noopener noreferrer" target="_blank">
                            {item.label}
                            {/* The link's text alone does not say it leaves the
                                site; an icon could not say it either. */}
                            <span className="visually-hidden"> (opens in a new tab)</span>
                          </a>
                        </li>
                      ) : (
                        <li key={item.href}>
                          <Link href={item.href}>{item.label}</Link>
                        </li>
                      ),
                    )}
                    {sections.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href}>{item.label}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>

              {/*
                The bottom bar carries the social marks now.

                They were a fourth row inside the identity block, which made that
                block the tallest thing in the footer and therefore set the height
                of the whole strip. Down here they cost nothing: the copyright
                line was one item in a `space-between` row with an empty
                right-hand end.
              */}
              <div className="footer__bottom">
                {/* The build year, frozen into the HTML — there is no server to
                    re-evaluate it. Correct as long as the site is rebuilt at
                    least once a year, which rebuild-on-publish makes near
                    certain; a stale year in a footer is also the mildest
                    possible symptom of a site nobody has deployed in 12 months.

                    One line, not two: "Wayland, Massachusetts" used to be its own
                    paragraph, three inches under the address it repeats. */}
                <p>
                  &copy; {new Date().getFullYear()} St. Philopater Mercurius &amp; St. Mina
                  Coptic Orthodox Church, Wayland, Massachusetts
                </p>

                {/*
                  Only rendered when the church has actually filled these in.
                  See `ParishSocial` — the defaults are empty strings, because an
                  icon pointing at a guessed account is worse than no icon.
                */}
                {social.length > 0 && (
                  <ul className="footer__social">
                    {social.map((account) => (
                      <li key={account.name}>
                        <a
                          href={account.href}
                          /*
                            `noopener` for the usual reason, and `noreferrer`
                            with it. `rel="me"` is the one worth explaining: it
                            is how a profile and a site claim each other, and it
                            is what makes a Mastodon-style verified link resolve
                            back here.
                          */
                          rel="me noopener noreferrer"
                          target="_blank"
                        >
                          {/*
                            The mark is painted by CSS `mask-image` from
                            `public/brand/<name>.svg` — see `.social-icon`. The
                            path data therefore lives in exactly one place, the
                            file in `assets/brand/`, rather than being duplicated
                            into a React component that can drift from it.
                          */}
                          <span
                            className={`social-icon social-icon--${account.name}`}
                            aria-hidden="true"
                          />
                          {/* The link's accessible name. The mark is a
                              background, so without this the link announces as
                              its bare URL. */}
                          <span className="visually-hidden">
                            {account.label} (opens in a new tab)
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
