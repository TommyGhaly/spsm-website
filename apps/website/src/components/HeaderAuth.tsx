'use client';

import Link from 'next/link';
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { hasRole, type Role } from '@spsm/shared';
import {
  getServerSnapshot,
  getSnapshot,
  signIn,
  signOut,
  subscribe,
  type AuthState,
} from '@/lib/authStore';

/**
 * Sign in with Microsoft, at the right-hand end of the masthead.
 *
 * Sign-in used to exist only as a wall: you found out about it by navigating to
 * /servants and being stopped. That is wrong for the schedule — a servant who
 * wants to know when they are serving had to already know the URL of a page
 * that is deliberately not in the nav.
 *
 * Rendered twice, like the nav: inline in the bar above 78rem, and inside the
 * disclosure panel below it. Both trees are always in the DOM and CSS picks —
 * see `.header-auth` and `.nav-panel__auth` in globals.css. The two instances
 * share one subscription and one SDK load, because the state lives in the
 * module singleton in lib/authStore.ts rather than in either component.
 *
 * Nothing here is a security boundary, and nothing here is role-gated either:
 * the menu offers the schedule to anyone signed in, and `firestore.rules` is
 * what stops someone the token does not vouch for. Editing the site is reached
 * from the pages themselves — an Edit control that appears for whoever may use
 * it — rather than from a link to a separate section. Same argument as the top
 * of AdminGate.tsx.
 */
export function HeaderAuth({ variant = 'bar' }: { variant?: 'bar' | 'panel' }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return variant === 'panel' ? <PanelAuth state={state} /> : <BarAuth state={state} />;
}

/**
 * The links a signed-in person actually came for.
 *
 * ## Why the events entry is here and not on a page
 *
 * Creating an event and opening a draft are the two things the in-place editor
 * cannot do, and the reason is structural rather than an omission: a new event
 * has no page to be in place on, and a draft is not exported so it has no page
 * either. They lived at `/admin/events` until that section was deleted, and they
 * have had nowhere since.
 *
 * This menu is the one staff-only surface in the whole site that is not any
 * particular page, which makes it the only honest place for them. Tommy ruled
 * out putting it on /calendar.
 *
 * `roles` gates a row. Not a security boundary — `firestore.rules` is — but the
 * menu is offered to anybody signed in, and a servant with no staff claim
 * following this link would reach a screen whose every write is refused.
 */
const DESTINATIONS: {
  href: string;
  label: string;
  icon: ReactNode;
  roles?: Role;
}[] = [
  { href: '/servants', label: 'Servants schedule', icon: <CalendarGlyph /> },
  { href: '/staff/events', label: 'Events and drafts', icon: <PlusGlyph />, roles: 'staff' },
];

/** The rows this person may see. */
function destinationsFor(state: Extract<AuthState, { kind: 'signed-in' }>) {
  return DESTINATIONS.filter((item) => !item.roles || hasRole(state.claims, item.roles));
}

/* ---- the wide-screen control ------------------------------------------- */

function BarAuth({ state }: { state: AuthState }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  // Close on a click anywhere else. `pointerdown` rather than `click` so the
  // menu is gone before the thing underneath reacts.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A session that ends while the menu is open — a sign-out in another tab —
  // would otherwise leave the menu hanging over a "Sign in" button.
  useEffect(() => {
    if (state.kind !== 'signed-in') setOpen(false);
  }, [state.kind]);

  if (state.kind === 'restoring') {
    /*
     * The signed-in user's first paint, before the auth chunk lands.
     *
     * Holds the pill's footprint so the bar does not reflow when the real
     * control replaces it, and says nothing a screen reader needs to hear —
     * `aria-hidden` with the live region below carrying the announcement.
     */
    return (
      <div className="header-auth">
        <span className="header-auth__circle header-auth__circle--waiting" aria-hidden="true" />
        <span className="visually-hidden" role="status">
          Checking your sign-in
        </span>
      </div>
    );
  }

  if (state.kind !== 'signed-in') {
    const busy = state.kind === 'signing-in';
    return (
      <div className="header-auth" ref={root}>
        {/*
          Icon-only, so the accessible name has to come from `aria-label` —
          there is no text node to read. `title` gives the pointer user the
          same sentence on hover, which is the only affordance a bare circle
          has for saying what it does.
        */}
        <button
          type="button"
          className="header-auth__circle"
          onClick={() => void signIn()}
          disabled={busy}
          aria-label={busy ? 'Opening Microsoft sign-in' : 'Sign in with Microsoft'}
          title={busy ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
        >
          <MicrosoftGlyph />
        </button>

        {state.kind === 'error' && (
          <div className="header-auth__menu header-auth__menu--error" role="alert">
            <p>{state.message}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="header-auth" ref={root}>
      <button
        type="button"
        className="header-auth__circle header-auth__circle--me"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        /* The initials are decorative shorthand; the name is what to announce. */
        aria-label={`Signed in as ${state.name}. Account menu`}
        title={state.name}
      >
        <span aria-hidden="true">{initialsOf(state.name)}</span>
      </button>

      {/* Present only when open, unlike the nav panel: that one is referenced by
          `aria-controls` on a toggle that is always rendered, and this one is
          not rendered at all when signed out, so there is no dangling id. */}
      {open && (
        <div className="header-auth__menu" id={menuId}>
          {/*
            The identity block repeats the avatar the trigger already shows.
            That is deliberate: the trigger is 40px of initials with no context,
            and repeating it under the name is what connects "MG" to "Mina
            Guirguis" the first time somebody opens this.
          */}
          <div className="header-auth__who">
            <span className="header-auth__whoAvatar" aria-hidden="true">
              {initialsOf(state.name)}
            </span>
            <span className="header-auth__whoText">
              <span className="header-auth__whoName">{state.name}</span>
              {/* `title` carries the full address, since the line ellipsizes. */}
              {state.email && (
                <span className="header-auth__whoMail" title={state.email}>
                  {state.email}
                </span>
              )}
            </span>
          </div>

          <p className="header-auth__role">
            <span className="header-auth__roleDot" aria-hidden="true" />
            {state.claims.role}
          </p>

          <ul className="header-auth__links">
            {destinationsFor(state).map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setOpen(false)}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="header-auth__signout"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <SignOutGlyph />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- the same thing, unfolded inside the nav panel ---------------------- */

/**
 * No dropdown down here. The panel is already a disclosure, and a menu inside a
 * menu on a phone is two things to dismiss; these are laid out as rows in the
 * same list the nav links use.
 */
function PanelAuth({ state }: { state: AuthState }) {
  if (state.kind === 'signed-in') {
    return (
      <div className="nav-panel__auth">
        <p className="nav-panel__who">
          <span>{state.name}</span>
          <span className="nav-panel__role">{state.claims.role}</span>
        </p>
        <ul className="nav-panel__links">
          {destinationsFor(state).map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
        <button type="button" className="nav-panel__button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="nav-panel__auth">
      <button
        type="button"
        className="nav-panel__button"
        onClick={() => void signIn()}
        disabled={state.kind === 'signing-in' || state.kind === 'restoring'}
      >
        <MicrosoftGlyph />
        {state.kind === 'signing-in' ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
      </button>
      {/* Room for the whole sentence here, unlike the bar. */}
      <p className="nav-panel__note">
        {state.kind === 'error'
          ? state.message
          : 'For the servants schedule. Uses your parish Microsoft account.'}
      </p>
    </div>
  );
}

/* ---- bits -------------------------------------------------------------- */

/** "Mina Guirguis" → "MG". Falls back to one letter, then to nothing. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Line icons for the menu rows. Decorative — each row has its own label. */
function CalendarGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

/** For the events row. A calendar with a plus, since that is what it leads to. */
function PlusGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
      <path d="M3 10h18M8 3v4M16 3v4M18 15v6M15 18h6" />
    </svg>
  );
}

function SignOutGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

/**
 * The Microsoft four-square, in its published colours.
 *
 * Brand marks are the one place the parish palette does not apply — a
 * recoloured Microsoft logo is both wrong and, per their brand terms, not
 * allowed. It is decorative: the button says "Sign in".
 */
function MicrosoftGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 23 23"
      aria-hidden="true"
      focusable="false"
      className="header-auth__ms"
    >
      <path fill="#f25022" d="M0 0h11v11H0z" />
      <path fill="#7fba00" d="M12 0h11v11H12z" />
      <path fill="#00a4ef" d="M0 12h11v11H0z" />
      <path fill="#ffb900" d="M12 12h11v11H12z" />
    </svg>
  );
}
