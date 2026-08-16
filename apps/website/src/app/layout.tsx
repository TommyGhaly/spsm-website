import type { Metadata } from 'next';
import Link from 'next/link';
import { formatAddress } from '@spsm/shared';
import { getParishConfig } from '@/lib/config';
import { SiteNav } from '@/components/SiteNav';
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
 */
const NAV = [
  // The wordmark also links home, which is the convention a regular web user
  // knows. This is here because plenty of parishioners do not, and looking for
  // the word "Home" and not finding it is a worse first impression than one
  // redundant link.
  { href: '/', label: 'Home' },
  { href: '/about', label: 'About' },
  { href: '/beliefs', label: 'Our Faith' },
  { href: '/events', label: 'Calendar' },
  { href: '/livestream', label: 'Watch Live' },
  { href: '/giving', label: 'Giving' },
  { href: '/contact', label: 'Contact' },
] as const;

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
  { href: '/beliefs', label: 'Our faith' },
  { href: '/#clergy', label: 'Our clergy' },
  { href: '/ministries', label: 'Ministries' },
  { href: '/events', label: 'Parish calendar' },
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
  const address = formatAddress(parish.address);

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
          <header className="masthead">
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
              <SiteNav items={NAV} />
            </div>
          </header>

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
                  <p className="footer__name">
                    St. Philopater Mercurius
                    <br />
                    &amp; St. Mina
                  </p>
                  <p>Coptic Orthodox Church</p>
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
