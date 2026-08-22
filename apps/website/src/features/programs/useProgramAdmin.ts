'use client';

import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import {
  canAdminProgram,
  hasRole,
  type ProgramAdmin,
  type SpsmClaims,
} from '@spsm/shared';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Who is looking at this public page, and what may they change on it.
 *
 * ## The bundle constraint this is built around
 *
 * `/events` is a public page. `firebase/auth` is ~150KB, and the rule the
 * codebase repeats in three places is that it must never reach a page a
 * parishioner opens. So this does **not** import it — it subscribes to
 * `lib/authStore`, the module singleton the masthead already uses, which
 * lazy-loads the SDK only when a session hint says somebody is signed in or
 * when they click sign in.
 *
 * The practical effect: a visitor reading the galleries downloads nothing extra
 * and sees no controls. An administrator has already paid for the SDK by having
 * a session at all, so the editing affordances cost them nothing new either.
 *
 * ## Not a security boundary
 *
 * Same statement as the top of AdminGate.tsx, and it matters more here because
 * these controls sit on a page anyone can open. Everything below decides what to
 * *draw*. `firestore.rules` decides what can be written, it reads the ID token
 * rather than anything this returns, and a visitor who edits `canEdit` to `true`
 * in their own browser gets a form whose every submission is refused.
 */
export interface ProgramAdminSession {
  /** True once we know the answer. Controls are hidden until then. */
  ready: boolean;
  uid: string | null;
  claims: SpsmClaims | null;
  grants: ProgramAdmin | null;
  /** May create and delete programs — superadmin only. */
  canManagePrograms: boolean;
  /** May edit this particular program and its gatherings. */
  canEditProgram: (programId: string) => boolean;
}

const NOBODY: ProgramAdminSession = {
  ready: false,
  uid: null,
  claims: null,
  grants: null,
  canManagePrograms: false,
  canEditProgram: () => false,
};

export function useProgramAdmin(): ProgramAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [grants, setGrants] = useState<ProgramAdmin | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const signedIn = auth.kind === 'signed-in';
  const claims = signedIn ? auth.claims : null;

  useEffect(() => {
    // Signed out, or still restoring. Nothing to fetch and nothing to draw.
    if (!signedIn) {
      setGrants(null);
      setUid(null);
      setReady(auth.kind === 'signed-out');
      return;
    }

    let live = true;

    void (async () => {
      /*
       * Both imports are dynamic, and both have to be.
       *
       * `./review` reaches `lib/firebase`, and `lib/auth` is the 150KB module
       * this whole file exists to keep off the page. Importing either statically
       * would put it in the chunk that every public gallery page loads, which is
       * exactly the regression the comment at the top of lib/auth.ts warns
       * about. Reached only here, inside a branch that requires a session.
       */
      const [{ myProgramAdmin }, { auth: firebaseAuth }] = await Promise.all([
        import('./review'),
        import('@/lib/auth'),
      ]);

      const user = firebaseAuth().currentUser;
      if (!user) {
        if (live) setReady(true);
        return;
      }

      /*
       * A missing member document is an ordinary state, not an error: the
       * document is written on first sign-in and an administrator created by
       * `grant-admin.mjs` may predate it. `myProgramAdmin` already returns empty
       * grants for that case, and an `admin` does not need them anyway.
       */
      const mine = await myProgramAdmin(user.uid).catch(() => null);
      if (!live) return;
      setUid(user.uid);
      setGrants(mine);
      setReady(true);
    })();

    return () => {
      live = false;
    };
  }, [signedIn, auth.kind]);

  if (!signedIn) return { ...NOBODY, ready };

  return {
    ready,
    uid,
    claims,
    grants,
    // Creating a ministry is the superadmin's alone, matching
    // `allow create, delete: if hasRole('admin')` on /programs in the rules.
    // Drawing the control for somebody the rules will refuse is worse than not
    // drawing it — see the `denied` branch of AdminGate for the same argument.
    canManagePrograms: claims !== null && hasRole(claims, 'admin'),
    canEditProgram: (programId: string) => canAdminProgram(claims, grants, programId),
  };
}
