import type { Metadata } from 'next';
import Link from 'next/link';
import { AdminGate } from './AdminGate';

/**
 * The admin shell.
 *
 * A server component that renders one client boundary (`AdminGate`) and passes
 * the pages through as children. Keeping the layout itself on the server is
 * what stops `firebase/auth` being pulled into the shared chunk that every
 * public page loads.
 *
 * Note the flat routes below. `firebase.json` has no catch-all rewrite — that
 * was removed because it turned every bad URL into an HTTP 200 — so a path only
 * resolves if the export actually emitted a file for it. A dynamic segment
 * under /admin would 404 on hard refresh, which is precisely how someone loses
 * a half-written event. Everything here is a static segment, and selecting a
 * record uses a query string, which needs no route of its own.
 */
export const metadata: Metadata = {
  title: 'Parish admin',
  // Belt and braces alongside robots.txt. There is nothing secret in the HTML —
  // the data all arrives client-side, behind rules — but an admin sign-in page
  // in search results is a support question nobody needs.
  robots: { index: false, follow: false },
};

const ADMIN_NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/events', label: 'Events' },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    // `wrap` here because the root layout no longer centres page content — the
    // public pages have full-bleed bands and do it themselves.
    <div className="admin wrap">
      <nav className="admin-nav" aria-label="Admin">
        {ADMIN_NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <AdminGate requires="staff" area="admin area">
        {children}
      </AdminGate>
    </div>
  );
}
