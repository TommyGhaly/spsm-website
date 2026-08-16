'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { hasRole, type Role, type SpsmClaims } from '@spsm/shared';
import {
  claimsOf,
  onAuthChange,
  signInWithEmulatorAccount,
  signInWithMicrosoft,
  signOut,
} from '@/lib/auth';
import { usingEmulators } from '@/lib/firebase';
import type { User } from 'firebase/auth';

/**
 * Sign-in and the role check for everything under /admin and /servants.
 *
 * This is a convenience, not a security boundary, and the distinction is worth
 * being blunt about: /admin is a static export, so every byte of this file is
 * public and anyone can read what it checks for. Hiding the form stops an
 * honest person wandering in. `firestore.rules` is what stops a dishonest one —
 * a member who edits this check out of their own browser still cannot write an
 * event, because the rules read the token, not this component.
 *
 * The client boundary lives here rather than in the layout so the layout stays
 * a server component and `firebase/auth` never reaches a public page.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'signing-in' }
  | { kind: 'denied'; claims: SpsmClaims; email: string | null }
  | { kind: 'ready'; user: User; claims: SpsmClaims }
  | { kind: 'error'; message: string };

export function AdminGate({
  children,
  requires = 'staff',
  area = 'admin area',
}: {
  children: React.ReactNode;
  requires?: Role;
  area?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    return onAuthChange((user, claims) => {
      if (!user) return setState({ kind: 'signed-out' });
      if (!hasRole(claims, requires)) {
        return setState({ kind: 'denied', claims, email: user.email });
      }
      setState({ kind: 'ready', user, claims });
    });
  }, [requires]);

  async function onSignIn() {
    setState({ kind: 'signing-in' });
    try {
      await signInWithMicrosoft();
      // onAuthChange drives the next state; nothing to do here.
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed.';
      // Closing the popup is a normal thing to do, not an error worth shouting
      // about — it puts you back where you started.
      if (message.includes('popup-closed-by-user') || message.includes('cancelled-popup')) {
        return setState({ kind: 'signed-out' });
      }
      setState({ kind: 'error', message });
    }
  }

  if (state.kind === 'loading') {
    return <p className="note">Checking your sign-in…</p>;
  }

  if (state.kind === 'signed-out' || state.kind === 'signing-in' || state.kind === 'error') {
    return (
      <div className="prose">
        <h1>Parish sign-in</h1>
        <p className="lede">
          Sign in with your parish Microsoft account. There is no separate password to
          remember, and no account to create.
        </p>

        {state.kind === 'error' && (
          <div className="notice notice--alarm" role="alert">
            <h2>That didn&apos;t work</h2>
            <p>{state.message}</p>
          </div>
        )}

        <p>
          <button className="button" type="button" onClick={onSignIn} disabled={state.kind === 'signing-in'}>
            {state.kind === 'signing-in' ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
          </button>
        </p>

        <p className="note">
          Only accounts in the parish directory can sign in. If you are a parishioner
          looking for the calendar or a prayer request, you don&apos;t need an account —{' '}
          <Link href="/">everything public is on the main site</Link>.
        </p>

        {usingEmulators() && <EmulatorSignIn onError={(m) => setState({ kind: 'error', message: m })} />}
      </div>
    );
  }

  if (state.kind === 'denied') {
    return (
      <div className="prose">
        <h1>Not your area</h1>
        <div className="notice notice--alarm">
          <p>
            You&apos;re signed in as {state.email ?? 'an unrecognised account'}, which has the{' '}
            <strong>{state.claims.role}</strong> role. The {area} needs{' '}
            <strong>{requires}</strong> or higher.
          </p>
          <p>
            If that&apos;s wrong, ask an administrator to update your role. It takes effect
            the next time you sign in.
          </p>
        </div>
        <p>
          <button className="button" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="admin-bar">
        <span className="note">
          {state.user.email} · {state.claims.role}
        </span>
        <button className="button button--quiet" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      {children}
    </>
  );
}

/**
 * Local-only sign-in, rendered only when pointed at the emulators.
 *
 * Never reachable in production: `usingEmulators()` is false there, and
 * `signInWithEmulatorAccount` throws regardless. The real project has no
 * password provider enabled either — Microsoft is the only one, deliberately.
 */
function EmulatorSignIn({ onError }: { onError: (message: string) => void }) {
  const [email, setEmail] = useState('staff@spsmwayland.org');
  const [password, setPassword] = useState('emulator-only');

  return (
    <div className="notice">
      <h2>Emulator sign-in</h2>
      <p className="note">
        Local development only. Seed a user in the Auth emulator and give it a role
        claim — see docs/local-dev.md.
      </p>
      <div className="field-row">
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      </div>
      <button
        className="button button--quiet"
        type="button"
        onClick={() => {
          signInWithEmulatorAccount(email, password).catch((error: unknown) =>
            onError(error instanceof Error ? error.message : 'Emulator sign-in failed.'),
          );
        }}
      >
        Sign in locally
      </button>
    </div>
  );
}

/** Re-reads the token so a role change lands without waiting up to an hour. */
export async function refreshClaims(user: User): Promise<SpsmClaims> {
  return claimsOf(user, true);
}
