'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { HeaderAuth } from './HeaderAuth';
import { galleryPathUrl } from '@/features/programs/media';

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

export type NavChild = { href: string; label: string; coverPath?: string | null };
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
              No disclosure control beside the word — the menu opens on hover
              and on focus, and nothing else.
              
              What that leaves for each way of using the site:
              
                mouse    — pointing at "Events" opens it
                keyboard — tabbing to "Events" opens it (onFocus below), and the
                           next Tab walks into the list
                touch    — no hover, so tapping "Events" simply follows the
                           link to /events, which lists all five programs as
                           cards
              
              The touch path is the reason a chevron is not needed: the fallback
              is not a dead end, it is the same content on a page with more room
              for it.
            */
            <span
              key={item.href}
              className="nav__group"
              onMouseEnter={() => openNow(item.href)}
              onMouseLeave={closeSoon}
              // Focus opens it, which is the whole keyboard path now that there
              // is no button to press.
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

              {/*
                Tiles, each with its program's own photograph behind the name.
                
                A plain list of five names had nothing to look at, and the
                decorations tried instead — a heading, an ornament rule, a cross
                per item — were furniture rather than substance. This section is
                about photographs, so the photographs are the background. A
                program with none yet gets a plain warm ground, and the type
                stays dark either way so a half-filled menu still reads as one
                thing.
              */}
              <ul className="nav__menu" hidden={openMenu !== item.href}>
                {item.children.map((child) => (
                  <li key={child.href}>
                    <NavTile child={child} current={isCurrent(child.href)} />
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

/**
 * One program in the Events menu.
 *
 * The photograph is an `<img>` rather than a CSS `background-image`, and that is
 * the whole point of this component existing.
 *
 * A cover tile needs light type, because the type sits on a scrim over a
 * picture. A CSS background gives no way to know whether the picture arrived, so
 * the light type had to be committed to up front — and when the object was
 * missing the tile fell back to a dark ground to keep the words readable. That
 * dark tile among four light ones read as *selected*, which is what it looked
 * like on /events where nothing is selected at all.
 *
 * With an element, `onLoad` and `onError` decide. Until a photograph has
 * actually loaded the tile is an ordinary light one with dark type; a tile whose
 * photograph never arrives simply stays that way, indistinguishable from a
 * program that has none yet — which is the honest thing for it to look like.
 */
function NavTile({ child, current }: { child: NavChild; current: boolean }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <Link
      href={child.href}
      aria-current={current ? 'page' : undefined}
      className={loaded ? 'has-cover' : undefined}
    >
      {child.coverPath && (
        <img
          src={galleryPathUrl(child.coverPath)}
          // Decorative: the name is right on top of it.
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      )}
      <span>{child.label}</span>
    </Link>
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
