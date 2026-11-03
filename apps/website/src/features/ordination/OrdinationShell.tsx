'use client';

import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { getServerSnapshot, getSnapshot, signIn, subscribe } from '@/lib/authStore';
import type { OrdinationAdminSession } from './useOrdinationAdmin';

/**
 * The frame every ordination screen sits in: the guard, the heading, the tabs.
 *
 * `CampShell`'s three guard states and its band, so the two back offices read
 * as one site. Not a security boundary — firestore.rules refuses every read
 * behind it without the `ordination` screen.
 */
export interface OrdinationShellProps {
  session: OrdinationAdminSession;
  tab: 'home' | 'signature';
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}

const TABS: { id: OrdinationShellProps['tab']; href: string; label: string }[] = [
  { id: 'home', href: '/admin/ordination', label: 'Ordinations' },
  { id: 'signature', href: '/admin/ordination/signature', label: 'My signature' },
];

export function OrdinationShell({ session, tab, title, actions, children }: OrdinationShellProps) {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (auth.kind === 'restoring' || auth.kind === 'signing-in' || (auth.kind === 'signed-in' && !session.ready)) {
    return (
      <>
        <PageHeader title="Ordinations" />
        <PageBody>
          <p className="note">Loading…</p>
        </PageBody>
      </>
    );
  }

  if (auth.kind !== 'signed-in') {
    return (
      <>
        <PageHeader title="Ordinations" />
        <PageBody>
          <div className="notice">
            <h2>Sign in first</h2>
            <p>These screens are for the parish priests and whoever prepares nominations for them.</p>
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
    return (
      <>
        <PageHeader title="Ordinations" />
        <PageBody>
          <div className="notice">
            <h2>This screen is not open to you</h2>
            <p>
              The ordination screens open for whoever is given them on the access page. Ask the
              church office, or go back to <a href="/admin">the admin screen</a>.
            </p>
          </div>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <div className="camp-bar band">
          <div className="camp-bar__title">
            <h2 className="camp-bar__name">Ordinations</h2>
          </div>
          <nav className="camp-tabs" aria-label="Ordinations">
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

/** A failure that is worth showing rather than logging. */
export function OrdinationError({ error }: { error: string }) {
  return (
    <div className="notice notice--warn">
      <h2>That did not work</h2>
      <p>{error}</p>
    </div>
  );
}
