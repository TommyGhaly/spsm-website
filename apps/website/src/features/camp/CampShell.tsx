'use client';

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { getServerSnapshot, getSnapshot, signIn, subscribe } from '@/lib/authStore';
import type { CampAdminSession } from './useCampAdmin';

/**
 * The frame every camp screen sits in: the guard, the heading, and the four tabs.
 *
 * ---------------------------------------------------------------------------
 * One shell, because there is now one camp section.
 *
 * The camp used to be two unrelated places — a form on /forms and a board under
 * /admin/camp-allocation — each with its own copy of the same three guard
 * states, its own heading, and no way to get from one to the other. That is
 * most of what made it feel complicated: the settings were in one place, the
 * people in another, the register in a third, and nothing on any of them said
 * the others existed.
 *
 * So: `/admin/camp` and three pages under it, and this draws the tabs on all
 * four. The tab strip is the whole navigation of the camp — there is nothing
 * else to find.
 *
 * ## Not a security boundary
 *
 * This decides what to draw. What protects a child's medical notes is
 * `firestore.rules` refusing the query without the camp's program grant.
 * ---------------------------------------------------------------------------
 */

export interface CampShellProps {
  session: CampAdminSession;
  /** Which tab is the current page. */
  tab: 'home' | 'registrations' | 'groups' | 'attendance';
  /** Shown under the masthead. The season is added by the shell. */
  title: string;
  /** Drawn to the right of the tabs — a save button, a day picker. */
  actions?: ReactNode;
  children: ReactNode;
}

const TABS: { id: CampShellProps['tab']; href: string; label: string }[] = [
  { id: 'home', href: '/admin/camp', label: 'Camp' },
  { id: 'registrations', href: '/admin/camp/registrations', label: 'Registrations' },
  { id: 'groups', href: '/admin/camp/groups', label: 'Groups' },
  { id: 'attendance', href: '/admin/camp/attendance', label: 'Attendance' },
];

export function CampShell({ session, tab, title, actions, children }: CampShellProps) {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (auth.kind === 'restoring' || auth.kind === 'signing-in' || !session.ready) {
    return (
      <>
        <PageHeader title="Summer camp" />
        <PageBody>
          <p className="note">Loading…</p>
        </PageBody>
      </>
    );
  }

  if (auth.kind !== 'signed-in') {
    return (
      <>
        <PageHeader title="Summer camp" />
        <PageBody>
          <div className="notice">
            <h2>Sign in first</h2>
            <p>These screens are for the people who run the camp.</p>
            <p>
              <button type="button" className="button" onClick={() => void signIn()}>
                Sign in with Microsoft
              </button>
            </p>
          </div>
        </PageBody>
      </>
    );
  }

  if (!session.canEdit) {
    /*
     * Said plainly rather than 404ed, for the reason /admin gives: somebody who
     * followed a link they were sent needs to know the difference between "you
     * have not been given this" and "this is broken".
     */
    return (
      <>
        <PageHeader title="Summer camp" />
        <PageBody>
          <div className="notice">
            <h2>This screen is not open to you</h2>
            <p>
              The camp&rsquo;s screens open for whoever is given the camp to run. Ask the
              church office, or go back to <a href="/admin">the admin screen</a>.
            </p>
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      {/* Hidden, like every other page's — see `PageHeader`. The heading that
          is actually read is in the band below, where it can carry the season
          and the tabs on one line. */}
      <PageHeader title={`${title} ${session.config.season}`} />
      <PageBody>
        <div className="camp-bar band">
          <div className="camp-bar__title">
            <span className="camp-bar__eyebrow">Summer camp</span>
            <strong className="camp-bar__season">{session.config.season}</strong>
          </div>
          <nav className="camp-tabs" aria-label="Summer camp">
            {TABS.map((entry) => (
              <a
                key={entry.id}
                className={`camp-tab${entry.id === tab ? ' is-on' : ''}`}
                href={entry.href}
                aria-current={entry.id === tab ? 'page' : undefined}
              >
                {entry.label}
              </a>
            ))}
          </nav>
          {actions ? <div className="camp-bar__actions">{actions}</div> : null}
        </div>
        {children}
      </PageBody>
    </>
  );
}

/**
 * The line a screen shows while it is still reading the season.
 *
 * Here rather than in each screen because all three say the same thing, and a
 * spinner that differs between tabs reads as three different kinds of waiting.
 */
export function CampLoading({ what }: { what: string }) {
  return <p className="note">Loading {what}…</p>;
}

/** A failure that is worth showing rather than logging. */
export function CampError({ error }: { error: string }) {
  return (
    <div className="notice notice--warn">
      <h2>That did not work</h2>
      <p>{error}</p>
    </div>
  );
}
