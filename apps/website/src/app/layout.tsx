import type { Metadata } from 'next';
import Link from 'next/link';
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
  { href: '/welcome', label: 'Welcome' },
  { href: '/about', label: 'About' },
  { href: '/beliefs', label: 'Our Faith' },
  { href: '/clergy', label: 'Clergy' },
  { href: '/ministries', label: 'Ministries' },
  { href: '/events', label: 'Calendar' },
  { href: '/livestream', label: 'Watch Live' },
  { href: '/prayer', label: 'Prayer' },
  { href: '/giving', label: 'Giving' },
  { href: '/contact', label: 'Contact' },
] as const;

// `/bookstore` is intentionally absent. The route works, but `products` is
// empty, so a nav item leads a visitor to an empty state — which reads as a
// broken site rather than an unfinished one. Restore it when there is a catalog.

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        <div className="shell">
          <header className="masthead">
            <div className="wrap masthead__inner">
              <Link href="/" className="wordmark">
                St. Philopater Mercurius &amp; St. Mina
                <span>Coptic Orthodox Church · Wayland, MA</span>
              </Link>
              <nav className="nav" aria-label="Main">
                {NAV.map((item) => (
                  <Link key={item.href} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>

          <main id="main">
            <div className="wrap">{children}</div>
          </main>

          <footer className="footer">
            <div className="wrap footer__inner">
              <p>
                St. Philopater Mercurius &amp; St. Mina Coptic Orthodox Church
                <br />
                Wayland, Massachusetts
              </p>
              <nav aria-label="Footer">
                <ul className="footer__links">
                  {FOOTER_LINKS.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href}>{item.label}</Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
