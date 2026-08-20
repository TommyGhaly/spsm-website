import type { Metadata } from 'next';
import Link from 'next/link';
import { formatAddress } from '@spsm/shared';
import { getParishConfig } from '@/lib/config';
import { Masthead } from '@/components/Masthead';
import { SiteNav, type NavItem } from '@/components/SiteNav';
import { programNavChildren } from '@/features/programs/nav';
import { HeaderAuth } from '@/components/HeaderAuth';
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
    'St. Philopater Mercurius & St. Mina Coptic Orthodox Church in Wayland, Massachusetts — liturgy times, parish calendar, and ministries.',
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
 * eight literals that no data can empty.
 */
const NAV: NavItem[] = [
  // The wordmark also links home, which is the convention a regular web user
  // knows. This is here because plenty of parishioners do not, and looking for
  // the word "Home" and not finding it is a worse first impression than one
  // redundant link.
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
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
  { href: '/bookstore', label: 'Bookstore' },
  { href: '/livestream', label: 'Live' },
  { href: '/giving', label: 'Giving' },
  { href: '/contact', label: 'Contact' },
];

// `/beliefs` has come off the top bar pending a decision to make it a
// subcategory of something rather than a seventh sibling. The page, its footer
// link and its sitemap entry are all untouched — this is a change to the header
// only, and nothing 404s.

// `/bookstore` is intentionally absent. The route works, but `products` is
// empty, so a nav item leads a visitor to an empty state — which reads as a
// broken site rather than an unfinished one. Restore it when there is a catalog.

// `/welcome` and `/prayer` are absent for the reason `/parking` is: they are
// entry points for an NFC tap — a card in the pew, a tag by the door — and not
// pages a visitor browses to. Both routes still build and still work; nothing on
// the site links to them, and robots.ts and sitemap.ts keep them out of search
// so the tag stays the only way in.
//
// `/ministries` is absent for a plainer reason: it is read once, not weekly,
// and it crowds out the links that are. It stays reachable from the footer.
//
// The clergy are not a route at all any more — they are the disclosures under
// the week's schedule on the homepage. The footer link is `/#clergy`.

/**
 * Practical links that don't earn a spot in the main nav.
 *
 * `/parking` is not here: it is reached by tapping an NFC tag in the car park,
 * not by browsing, so a footer link is the wrong entry point and would be the
 * site's most prominent route to its only unauthenticated write.
 */
const FOOTER_LINKS = [
  { href: '/contact', label: 'Contact the parish office' },
  // Gated, and in the footer rather than the nav: it matters weekly to a few
  // dozen people and not at all to everyone else the main nav is for.
  { href: '/servants', label: 'Servants schedule' },
] as const;

/**
 * Repeated in the footer, where a visitor who scrolled past the nav ends up.
 *
 * Clergy and ministries are here and nowhere else in the chrome, so taking them
 * off the top bar does not strand them. `/welcome` is not here at all — see NAV.
 *
 * "Our clergy" is a fragment rather than a page: the biographies are disclosures
 * on the homepage. It is still worth a line here — a visitor looking for the
 * priest's name looks in the footer, and being sent to the right part of the
 * homepage is a better answer than not being answered.
 */
const FOOTER_EXPLORE = [
  // "Our faith" carries more weight here now that `/beliefs` is off the top bar.
  { href: '/beliefs', label: 'Our faith' },
  { href: '/#clergy', label: 'Our clergy' },
  { href: '/ministries', label: 'Ministries' },
  // Was `/events` under this label, which is now the *other* page's name. One
  // link, pointed at the page that actually is the calendar; `/events` is in
  // the top bar and does not need a second entry point down here.
  { href: '/calendar', label: 'Parish calendar' },
  { href: '/giving', label: 'Giving' },
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
                <div className="footer__brand">
                  <img
                    className="footer__seal"
                    src="/brand/seal-128.png"
                    srcSet="/brand/seal-128.png 1x, /brand/seal-192.png 2x"
                    alt=""
                    width={140}
                    height={128}
                  />
                  {/*
                    No hardcoded `<br />` any more.

                    It forced the break after "Mercurius", which left "& St.
                    Mina" alone on a short second line at every width — a ragged
                    two-line name beside a centred seal. The name now wraps
                    where the column actually ends, and `text-wrap: balance`
                    evens the lines out; see `.footer__name`.
                  */}
                  <p className="footer__name">St. Philopater Mercurius &amp; St. Mina</p>
                  <p className="footer__kicker">Coptic Orthodox Church</p>

                  {/*
                    Only rendered when the parish has actually filled these in.
                    See `ParishSocial` — the defaults are empty strings, because
                    an icon pointing at a guessed account is worse than no icon.
                  */}
                  {social.length > 0 && (
                    <ul className="footer__social">
                      {social.map((account) => (
                        <li key={account.name}>
                          <a
                            href={account.href}
                            /*
                              `noopener` for the usual reason, and `noreferrer`
                              with it. `rel="me"` is the one worth explaining:
                              it is how a profile and a site claim each other,
                              and it is what makes a Mastodon-style verified
                              link resolve back here.
                            */
                            rel="me noopener noreferrer"
                            target="_blank"
                          >
                            {/*
                              The mark is painted by CSS `mask-image` from
                              `public/brand/<name>.svg` — see `.social-icon`.
                              The path data therefore lives in exactly one
                              place, the file in `assets/brand/`, rather than
                              being duplicated into a React component that can
                              drift from it.
                            */}
                            <span
                              className={`social-icon social-icon--${account.name}`}
                              aria-hidden="true"
                            />
                            {/* The link's accessible name. The mark is a
                                background, so without this the link announces
                                as its bare URL. */}
                            <span className="visually-hidden">
                              {account.label} (opens in a new tab)
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <nav aria-labelledby="footer-explore">
                  <h2 id="footer-explore">Explore</h2>
                  <ul className="footer__links">
                    {FOOTER_EXPLORE.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href}>{item.label}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>

                <section aria-labelledby="footer-visit">
                  <h2 id="footer-visit">Visit</h2>
                  {/* Each line is conditional for the same reason ContactDetails
                      is: a parish that has published a phone number but not an
                      address should show the phone number, not a blank row. */}
                  {address ? (
                    <address style={{ fontStyle: 'normal' }}>
                      {parish.address.line1}
                      <br />
                      {[parish.address.city, parish.address.state].filter(Boolean).join(', ')}{' '}
                      {parish.address.postalCode}
                    </address>
                  ) : (
                    <p>Wayland, Massachusetts</p>
                  )}
                  {parish.phone && (
                    <p>
                      <a href={`tel:${parish.phone.replace(/[^\d+]/g, '')}`}>{parish.phone}</a>
                    </p>
                  )}
                  {parish.email && (
                    <p>
                      <a href={`mailto:${parish.email}`}>{parish.email}</a>
                    </p>
                  )}
                </section>

                <nav aria-labelledby="footer-parish">
                  <h2 id="footer-parish">Parish</h2>
                  <ul className="footer__links">
                    {FOOTER_LINKS.map((item) => (
                      <li key={item.href}>
                        <Link href={item.href}>{item.label}</Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </div>

              <div className="footer__bottom">
                {/* The build year, frozen into the HTML — there is no server to
                    re-evaluate it. Correct as long as the site is rebuilt at
                    least once a year, which rebuild-on-publish makes near
                    certain; a stale year in a footer is also the mildest
                    possible symptom of a site nobody has deployed in 12 months. */}
                <p>
                  &copy; {new Date().getFullYear()} St. Philopater Mercurius &amp; St. Mina
                  Coptic Orthodox Church
                </p>
                <p>Wayland, Massachusetts</p>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
