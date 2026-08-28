'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
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
 * that was deliberately not in the nav. That page is gone; the schedule is part
 * of /calendar now, and signing in from here is what reveals it.
 *
 * Rendered twice, like the nav: inline in the bar above 78rem, and inside the
 * disclosure panel below it. Both trees are always in the DOM and CSS picks —
 * see `.header-auth` and `.nav-panel__auth` in globals.css. The two instances
 * share one subscription and one SDK load, because the state lives in the
 * module singleton in lib/authStore.ts rather than in either component.
 *
 * ## Why it navigates nowhere
 *
 * It used to carry a list of destinations. Both rows were wrong for it. One
 * pointed at /calendar, which is a nav link two inches to the left — a menu
 * whose only content is a link the header already shows is a menu that teaches
 * people it holds nothing. The other went to a staff-only events screen, which
 * is gone entirely.
 *
 * So this says who you are and lets you stop being them, and that is the whole
 * of it. Everywhere else, editing is reached from the page being edited — an
 * Edit control that appears for whoever may use it — rather than from a link to
 * a separate section. Same argument as the top of AdminGate.tsx. Nothing here
 * is a security boundary either; `firestore.rules` is.
 */
export function HeaderAuth({ variant = 'bar' }: { variant?: 'bar' | 'panel' }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return variant === 'panel' ? <PanelAuth state={state} /> : <BarAuth state={state} />;
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
 * menu on a phone is two things to dismiss — so who you are and the way out are
 * laid flat under the nav links rather than folded behind a second toggle.
 */
function PanelAuth({ state }: { state: AuthState }) {
  if (state.kind === 'signed-in') {
    return (
      <div className="nav-panel__auth">
        <p className="nav-panel__who">
          <span>{state.name}</span>
          <span className="nav-panel__role">{state.claims.role}</span>
        </p>
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
          : 'For the servants schedule. Uses your church Microsoft account.'}
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

/** Decorative — the row it sits in carries the label. */
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
