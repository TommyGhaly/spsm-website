'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

/**
 * The main navigation, in two forms.
 *
 * The link list does not fit across a phone — it was ten items, it is seven now,
 * and seven still wraps. The old markup let it, which produced ragged rows above
 * the fold on every page. So: an inline row on a wide screen, and a disclosure
 * panel below 64rem. Both trees are always rendered and CSS picks — see `.nav` /
 * `.nav-panel` in globals.css.
 *
 * A client component, and the only one in the chrome. That buys two things
 * worth the boundary: `aria-current` on the page you are on, and a panel that
 * closes when you navigate. Nothing here reads Firestore, so it adds no data
 * dependency to every page — which is the reason the link list stays a
 * hardcoded prop from the server layout rather than being fetched.
 */

export type NavItem = { href: string; label: string };

export function SiteNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Close on navigation. Without this the panel stays open over the new page,
  // which reads as the link having done nothing.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape closes it, as it must for anything that behaves like a menu.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /**
   * Marks the section you are in, not just the exact URL.
   *
   * `/events/summer-camp` should light up "Calendar" — a visitor reading an
   * event has not left the calendar. The `startsWith` needs the `/` guard or
   * `/about` would also match a hypothetical `/about-our-school`.
   *
   * Home is exact-match only. Every path begins with `/`, so the prefix rule
   * would mark it as the current page on every page of the site — two nav items
   * highlighted at once, and `aria-current="page"` lying to a screen reader
   * about where the user is.
   */
  const isCurrent = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <nav className="nav" aria-label="Main">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <MenuGlyph open={open} />
        Menu
      </button>

      {/*
        Rendered always, hidden with `hidden` rather than by unmounting, so the
        `aria-controls` above always points at an element that exists. A
        reference to a missing id is worse than no reference.
      */}
      <div
        id={panelId}
        hidden={!open}
        className={open ? 'nav-panel nav-panel--open' : 'nav-panel'}
      >
        <div className="wrap">
          <ul className="nav-panel__links">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

/** Three lines that become a cross. Decorative — the button says "Menu". */
function MenuGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" />
      )}
    </svg>
  );
}
