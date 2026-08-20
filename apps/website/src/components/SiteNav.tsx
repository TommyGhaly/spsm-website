'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { HeaderAuth } from './HeaderAuth';

/**
 * The main navigation, in two forms.
 *
 * The link list does not fit across a phone — it was ten items, it is eight now,
 * and eight still wraps. The old markup let it, which produced ragged rows above
 * the fold on every page. So: an inline row on a wide screen, and a disclosure
 * panel below 64rem. Both trees are always rendered and CSS picks — see `.nav` /
 * `.nav-panel` in globals.css.
 *
 * The panel also carries the sign-in control, because the inline one is hidden
 * at the same width this appears at — see HeaderAuth, which is rendered once
 * here and once beside `.nav` in the layout.
 *
 * A client component, and the only one in the chrome. That buys two things
 * worth the boundary: `aria-current` on the page you are on, and a panel that
 * closes when you navigate. Nothing here reads Firestore, so it adds no data
 * dependency to every page — which is the reason the link list stays a
 * hardcoded prop from the server layout rather than being fetched.
 */

export type NavChild = { href: string; label: string; caption?: string };
export type NavItem = { href: string; label: string; children?: readonly NavChild[] };

export function SiteNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  /** The href of the top-level item whose dropdown is showing, if any. */
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  /*
   * Closing is delayed; opening is not.
   *
   * The pointer has to cross from the word "Events" to the panel below it, and
   * people do that on a diagonal that clips the edge of both. Closing the
   * instant the pointer leaves makes the menu snap shut just as somebody
   * reaches for it — the single most common way a hover menu feels broken.
   * A short grace period costs nothing and fixes it.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNow = (href: string) => {
    cancelClose();
    setOpenMenu(href);
  };

  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenMenu(null), 220);
  };

  // A timer outliving the component would call setState on an unmounted tree.
  useEffect(() => cancelClose, []);
  const panelId = useId();

  // Close on navigation. Without this the panel stays open over the new page,
  // which reads as the link having done nothing.
  useEffect(() => {
    setOpen(false);
    setOpenMenu(null);
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

  /*
   * Escape closes an open dropdown too, and a click anywhere else dismisses it.
   *
   * Separate from the panel's handler above because they are separate things: a
   * dropdown can be open on a wide screen where the panel does not exist. The
   * pointer listener is what makes the menu dismissible for a touch user, who
   * has no hover to leave and no Escape key to press.
   */
  useEffect(() => {
    if (openMenu === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.nav__group')) return;
      setOpenMenu(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [openMenu]);

  /**
   * Marks the section you are in, not just the exact URL.
   *
   * `/events/summer-camp` should light up "Events" — a visitor reading an event
   * has not left the section they came from. The `startsWith` needs the `/`
   * guard or `/about` would also match a hypothetical `/about-our-school`.
   *
   * Note this marks "Events" and not "Calendar" for an individual event, even
   * though `/calendar` also links to those pages. Two nav items lit at once
   * would be `aria-current="page"` twice, which tells a screen-reader user they
   * are in two places; the event lives under `/events/`, so that is the one.
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
        {items.map((item) =>
          item.children && item.children.length > 0 ? (
            /*
              The link and the disclosure are two controls, deliberately.
              Making the parent itself toggle the menu would leave no way to
              reach /events, and making it only a link would leave no way to
              open the menu without a mouse. So: the word navigates, the
              chevron beside it opens.
            */
            <span
              key={item.href}
              className="nav__group"
              onMouseEnter={() => openNow(item.href)}
              onMouseLeave={closeSoon}
              // Focus opens it too, so tabbing to Events reveals the same list
              // a mouse user gets by pointing at it.
              onFocus={() => openNow(item.href)}
              // Closes when focus leaves the group entirely, which is what
              // tabbing off the last item in the dropdown should do.
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  cancelClose();
                  setOpenMenu(null);
                }
              }}
            >
              <Link href={item.href} aria-current={isCurrent(item.href) ? 'page' : undefined}>
                {item.label}
              </Link>
              <button
                type="button"
                className="nav__chevron"
                aria-expanded={openMenu === item.href}
                aria-label={`${item.label} sections`}
                /*
                  Hover is the primary way in and this is the fallback: a
                  keyboard user who has not tabbed into the group, and a touch
                  user, who has no hover at all. Nobody with a mouse needs to
                  click it.
                */
                onClick={() => {
                  cancelClose();
                  setOpenMenu((current) => (current === item.href ? null : item.href));
                }}
              >
                <Chevron />
              </button>

              <ul className="nav__menu" hidden={openMenu !== item.href}>
                {item.children.map((child) => (
                  <li key={child.href}>
                    <Link href={child.href} aria-current={isCurrent(child.href) ? 'page' : undefined}>
                      <span className="nav__menu-label">{child.label}</span>
                      {child.caption && <span className="nav__menu-caption">{child.caption}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </span>
          ) : (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ),
        )}
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

                {/*
                  Always expanded rather than an accordion. The panel is already
                  a disclosure the visitor opened on purpose; making them open a
                  second one to reach Summercamp is a tap for nothing, and five
                  short lines cost little scrolling.
                */}
                {item.children && item.children.length > 0 && (
                  <ul className="nav-panel__sublinks">
                    {item.children.map((child) => (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          aria-current={isCurrent(child.href) ? 'page' : undefined}
                        >
                          {child.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          {/*
            Below the links, not above them. The nav is what almost everyone
            opened the panel for; sign-in matters weekly to a few dozen people
            and should not be the first thing a visitor's thumb lands on.
          */}
          <HeaderAuth variant="panel" />
        </div>
      </div>
    </>
  );
}

/** Decorative — the button beside it is labelled for a screen reader. */
function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 9l7 7 7-7" />
    </svg>
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
