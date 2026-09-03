'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { isSuperadmin } from '@spsm/shared';
import {
  deleteAccount,
  getServerSnapshot,
  getSnapshot,
  signIn,
  signOut,
  subscribe,
  type AuthState,
} from '@/lib/authStore';
import { adminRows, useAdminAccess, type AdminSection } from '@/features/admin/sections';

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
 * ## Why it navigates almost nowhere
 *
 * It used to carry a list of destinations, and both rows were wrong for it. One
 * pointed at /calendar, which is a nav link two inches to the left — a menu
 * whose only content is a link the header already shows is a menu that teaches
 * people it holds nothing. The other went to a staff-only events screen, which
 * is gone entirely. So this said who you are and let you stop being them, and
 * that was the whole of it: everywhere else, editing is reached from the page
 * being edited rather than from a link to a separate section.
 *
 * **One row is back, and it is the exception that rule always had.** /access
 * allocates areas to people, and its subject is a *person* — there is no page
 * on this site whose contents are "what Marina may administer", so there is
 * nowhere in-place for it to live. It renders for the superadmin and for
 * nobody else, which is the only reason a menu is the right home for it: it is
 * the one destination that depends on who is reading rather than on where they
 * are. The page repeats the argument at more length.
 *
 * Hiding the row is a convenience, not a security boundary. This is a static
 * export, so the address is in a public chunk and anybody can type it;
 * `allow update: if isSuper()` on `/members/{uid}` is what refuses them.
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

          {/*
            * The one label left, and it is drawn for almost nobody.
            *
            * This line used to print the role — "servant", "staff", "admin" —
            * which was a useful thing to see because it was the thing that
            * decided what you could do. There are no roles now: what somebody
            * may do is a list of areas on their member document, and printing
            * that here would mean a Firestore read on every menu open to render
            * a sentence nobody came for. So the row appears only when there is
            * something to say, which is when the person holds the one claim
            * that still decides anything.
            */}
          {isSuperadmin(state.claims) && (
            <p className="header-auth__role">
              <span className="header-auth__roleDot" aria-hidden="true" />
              Superadmin
            </p>
          )}

          <AdminLinks onNavigate={() => setOpen(false)} />

          {isSuperadmin(state.claims) && (
            <Link
              href="/access"
              className="header-auth__link"
              onClick={() => setOpen(false)}
            >
              <AreasGlyph />
              <span>Areas</span>
            </Link>
          )}

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

          <DeleteAccount variant="menu" superadmin={isSuperadmin(state.claims)} />
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
          {isSuperadmin(state.claims) && (
            <span className="nav-panel__role">Superadmin</span>
          )}
        </p>
        {isSuperadmin(state.claims) && (
          <Link href="/access" className="nav-panel__button">
            Areas
          </Link>
        )}
        <PanelAdminLinks />
        <button type="button" className="nav-panel__button" onClick={() => void signOut()}>
          Sign out
        </button>
        <DeleteAccount variant="panel" superadmin={isSuperadmin(state.claims)} />
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

/* ---- deleting your own account ----------------------------------------- */

/**
 * Leave, and take the account with you.
 *
 * ---------------------------------------------------------------------------
 * This reverses a decision, and the reversal is the point rather than an
 * oversight — the note at the top of this file says the menu navigates almost
 * nowhere and lists the two exceptions. This is not a third destination: it is
 * an action on the one subject the menu already has, which is you. There is no
 * page on this site whose contents are "your account", so unlike an edit to a
 * gallery or a form there is nowhere in-place for it to live, and the control
 * that already says who you are is the only honest home for the one that stops
 * you being them. Asked for directly by Tommy on 2026-09-02.
 *
 * ## Two clicks, in one place, with the sentence between them
 *
 * The first click does nothing but replace the row with what deleting actually
 * does; the second does it. A `window.confirm` was the alternative and is worse
 * for this: it cannot say which account, it cannot be styled to look like the
 * parish's site, and on a phone it is a system sheet over a nav panel that is
 * itself a disclosure — two things to dismiss, which is the same objection
 * `PanelAuth` already makes to a dropdown down there.
 *
 * Not a `<dialog>`, either. The confirmation belongs in the flow of the control
 * that opened it, and a modal would trap focus over a menu that already handles
 * Escape and outside-click for itself.
 *
 * ## The wording is not padding
 *
 * Two facts decide whether somebody wants this, and both are
 * counter-intuitive enough that leaving them out would produce clicks people
 * regret. Their Microsoft account is untouched — this site cannot delete it,
 * and a servant asked to "delete your account" reasonably fears otherwise.
 * And signing in again makes a *new* account with no areas, so this is not a
 * door that locks behind them. `functions/src/account.ts` is the authority on
 * both.
 *
 * ## A superadmin gets a third step, not a hidden row
 *
 * This row used to be withheld from a superadmin, because the endpoint refused
 * every one of them outright and there was no point showing a button that
 * could not work. Both halves of that have changed, and the old arrangement
 * had a consequence worth stating plainly: the parish's only account is its
 * superadmin, so "hidden from a superadmin" meant hidden from everybody who
 * actually uses the site.
 *
 * A superadmin now sees the row, and the confirmation grows a checkbox they
 * have to tick before the delete button will do anything. The tick is what
 * sends `confirmLockout`, and the endpoint refuses without it — see
 * `@spsm/shared/accountDeletion`, which is also where the recovery path is
 * written down. The extra step is not ceremony: this is the one delete on the
 * site that can leave the church unable to appoint an administrator from the
 * website, and the sentence beside the box says so and says how it is undone.
 *
 * Which text they get is still a convenience rather than a boundary. This is a
 * static export, so the code is public and anybody can call the endpoint; the
 * verified token and the flag are what decide.
 * ---------------------------------------------------------------------------
 */
function DeleteAccount({
  variant,
  superadmin,
}: {
  variant: 'menu' | 'panel';
  superadmin: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Only ever meaningful for a superadmin, and reset with the panel rather than
   * kept: cancelling and reopening should not still be holding a tick from a
   * decision somebody backed out of.
   */
  const [acknowledged, setAcknowledged] = useState(false);
  const ackId = useId();

  const prefix = variant === 'menu' ? 'header-auth' : 'nav-panel';
  // A superadmin's delete is inert until the box is ticked. Nobody else has one.
  const blocked = superadmin && !acknowledged;

  if (!confirming) {
    return (
      <button
        type="button"
        className={`${prefix}__delete`}
        onClick={() => {
          setError(null);
          setAcknowledged(false);
          setConfirming(true);
        }}
      >
        {variant === 'menu' && <TrashGlyph />}
        <span>Delete account</span>
      </button>
    );
  }

  return (
    /*
     * `role="group"` with a label rather than `alertdialog`. Nothing here traps
     * focus or blocks the page, so announcing it as a dialog would promise a
     * screen reader an interaction model this does not implement.
     */
    <div className={`${prefix}__confirm`} role="group" aria-label="Delete your account">
      <p className={`${prefix}__confirmLead`}>Delete this account?</p>
      <p className={`${prefix}__confirmBody`}>
        Your sign-in and everything you have been given to administer are removed.
        Your church Microsoft account is not touched, and signing in again will
        make a new account with no areas.
      </p>

      {/*
        The superadmin's extra step.

        A `label` wrapping its own input, so the whole sentence is the hit area
        — this is a 13px checkbox in a dropdown, and on a phone the box alone is
        not a target anybody should have to aim at. The text names what is lost
        that the paragraph above does not cover: not the sign-in, which comes
        back on the next Microsoft sign-in, but the superadmin claim, which
        comes back only from a terminal.
      */}
      {superadmin && (
        <label className={`${prefix}__confirmAck`} htmlFor={ackId}>
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => {
              setAcknowledged(event.target.checked);
              // A stale "confirm the lockout" refusal must not sit under a box
              // that is now ticked.
              setError(null);
            }}
          />
          <span>
            This is the superadmin account. The church may be left with nobody
            able to allocate areas, and restoring it needs
            <code> scripts/grant-admin.mjs</code> from a terminal.
          </span>
        </label>
      )}

      {/*
        The live region is on a wrapper that is always rendered while
        confirming, not on the message itself. A region that appears at the same
        moment as its text is not reliably announced — the assistive technology
        has to have been watching the node before it changed.
      */}
      <p className={`${prefix}__confirmError`} role="alert">
        {error}
      </p>

      <div className={`${prefix}__confirmActions`}>
        {/*
          Cancel first in the DOM, so it is what Tab reaches first and what a
          phone thumb meets at the top of the pair. The destructive one is never
          the default and never the nearest.
        */}
        <button
          type="button"
          className={`${prefix}__confirmCancel`}
          onClick={() => {
            setConfirming(false);
            setError(null);
            setAcknowledged(false);
          }}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${prefix}__confirmGo`}
          /*
           * Disabled rather than hidden while the box is unticked, so the
           * reason is visible: the button and the sentence that unlocks it are
           * both on screen, and the box is immediately above it.
           */
          disabled={busy || blocked}
          onClick={() => {
            setBusy(true);
            setError(null);
            void deleteAccount(superadmin ? { confirmLockout: true } : {})
              .catch((cause: unknown) => {
                /*
                 * Stay open, stay in the confirming state, and put the reason
                 * beside the button. `deleteAccount` throws rather than emitting
                 * an `error` auth state precisely so this is possible — see the
                 * note on it in lib/authStore.ts.
                 */
                setError(
                  cause instanceof Error
                    ? cause.message
                    : 'The account could not be deleted. Please try again.',
                );
              })
              /*
               * No `setConfirming(false)` on success, and no unmount guard. A
               * successful delete signs out, which flips the auth state and
               * unmounts this whole subtree from both trees — so there is
               * nothing left to tidy. `setBusy` runs only on the failure path
               * for the same reason; calling it after a successful unmount
               * would be a no-op React warns about in development.
               */
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </div>
  );
}

/* ---- the admin entry ---------------------------------------------------- */

/**
 * The ways into the screens that are not *about* a page — one row each.
 *
 * ---------------------------------------------------------------------------
 * The second exception to "this menu navigates almost nowhere", and it is the
 * same exception as /access rather than a new one. Arranging four hundred
 * children into camp groups, and reading what the church took in August, are
 * tasks with their own tools rather than edits to anything a visitor can see —
 * so there is no in-place home for either. Everything that *can* be edited in
 * place still is, and nothing has moved here.
 *
 * **One row per section, not one row for the section list.** This drew a single
 * row that named the screen when somebody had one and said "Admin" when they
 * had two; at Tommy's direction it now lists Summer camp and Finance
 * separately. `adminRows` carries the argument at length: the reason the row
 * ever named a screen rather than the hub is that a hub whose entire content is
 * the link you just clicked is a page nobody wants, and that is doubly true of
 * two links. /admin still exists and still works; nothing here points at it.
 *
 * These differ from the /access row in who sees them, which is why /access is
 * written out above rather than folded in here. That one is `superadmin` — a
 * question the token already answers, for free. These are "do you run the camp"
 * and "do you hold Finance", which live on the member document and cost a
 * Firestore read. That is why this is a component of its own: the hook inside it
 * mounts only when the menu is open, so the read never happens on the hundred
 * page loads where nobody opens it.
 *
 * Draws nothing while the answer is unknown, and nothing when the answer is no.
 * A greyed-out entry would be worse than an absent one — it would tell most of
 * the parish that a part of the site exists which is not theirs, which is
 * neither useful nor true. These screens are not a privilege; they are a job
 * somebody was given.
 * ---------------------------------------------------------------------------
 */
function AdminLinks({ onNavigate }: { onNavigate(): void }) {
  const rows = adminRows(useAdminAccess());

  return (
    <>
      {rows.map((row) => (
        <Link
          key={row.href}
          href={row.href}
          className="header-auth__link"
          onClick={onNavigate}
        >
          <DoorGlyph glyph={row.glyph} />
          <span>{row.menuLabel}</span>
        </Link>
      ))}
    </>
  );
}

/** The same, laid flat in the nav panel — which has no dropdown to close. */
function PanelAdminLinks() {
  const rows = adminRows(useAdminAccess());

  return (
    <>
      {rows.map((row) => (
        <Link key={row.href} href={row.href} className="nav-panel__button">
          {row.menuLabel}
        </Link>
      ))}
    </>
  );
}

/**
 * The mark beside the row.
 *
 * The label and the address come from `sections.ts`, and so does the choice of
 * which of these to draw — this file owns the drawing and not the deciding.
 * The row used to be hardcoded to the camp's sun and the word "Summer camp",
 * which was true while the camp allocation was the only screen behind this menu
 * and would have labelled the treasurer's row "Summer camp" the moment a second
 * one landed.
 */
function DoorGlyph({ glyph }: { glyph: AdminSection['glyph'] }) {
  return glyph === 'camp' ? <CampGlyph /> : <FinanceGlyph />;
}

/**
 * A sun. Decorative — the row it sits in carries the label.
 *
 * Was four panes, for a screen made of cards, back when the row said "Admin"
 * and led to the list. The row names the camp now, so the mark should too.
 */
function CampGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </svg>
  );
}

/**
 * A coin. Decorative — the row it sits in carries the label.
 *
 * Not a dollar sign, which reads as a price tag, and not a ledger, which reads
 * as bookkeeping somebody has to do. A coin is the money itself, which is what
 * the screen is about.
 */
function FinanceGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2v9.6M14.4 9.4a2.6 2.6 0 0 0-2.4-1.3c-1.4 0-2.4.8-2.4 1.9 0 2.6 4.8 1.4 4.8 4 0 1.1-1 1.9-2.4 1.9a2.6 2.6 0 0 1-2.4-1.3" />
    </svg>
  );
}

/*
 * There was a `HubGlyph` here — four panes, for a row that said "Admin" and led
 * to /admin. It went with that row: the panel lists the screens themselves now,
 * so there is no hub row for a hub mark to sit in. /admin is still a working
 * page; nothing links to it. See `adminRows` in features/admin/sections.ts.
 */

/* ---- bits -------------------------------------------------------------- */

/** "Mina Guirguis" → "MG". Falls back to one letter, then to nothing. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * Three sliders. Decorative — the row carries the label.
 *
 * Not a key or a shield, which is what a permissions screen usually gets. Both
 * read as *security*, and this screen is not security — it is the arrangement
 * of who looks after which part of the parish's site. Sliders say "set these",
 * which is what it does.
 */
function AreasGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
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

/* A waste bin, at the same 15px and the same stroke as the sign-out arrow — the
   two rows sit together and a glyph a hair heavier than its neighbour is the
   kind of difference that reads as a mistake rather than as emphasis. */
function TrashGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6" />
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
