import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'St. Philopater Mercurius & St. Mina Coptic Orthodox Church',
    template: '%s · St. Philopater Mercurius & St. Mina',
  },
  description:
    'St. Philopater Mercurius & St. Mina Coptic Orthodox Church in Wayland, Massachusetts — liturgy times, parish calendar, and ministries.',
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
  { href: '/about', label: 'About' },
  { href: '/beliefs', label: 'Our Faith' },
  { href: '/clergy', label: 'Clergy' },
  { href: '/events', label: 'Calendar' },
  { href: '/prayer', label: 'Prayer' },
  { href: '/bookstore', label: 'Bookstore' },
  { href: '/giving', label: 'Giving' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Practical links that don't earn a spot in the main nav. Vehicle registration
 * matters intensely on a festival weekend and not at all the rest of the year,
 * so the footer is the honest place for it.
 */
const FOOTER_LINKS = [
  { href: '/parking', label: 'Register a vehicle' },
  { href: '/contact', label: 'Contact the parish office' },
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
