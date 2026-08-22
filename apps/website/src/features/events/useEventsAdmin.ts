'use client';

import { useSyncExternalStore } from 'react';
import { hasRole, type SpsmClaims } from '@spsm/shared';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Whether the person reading an event page may change it.
 *
 * ## The bundle constraint this is built around
 *
 * An event page is a page parishioners open. `firebase/auth` is about 150KB, and
 * the rule this codebase repeats in several places is that it must never reach
 * one of those pages. So this does **not** import it: it subscribes to
 * `lib/authStore`, the module singleton the masthead already uses, which
 * lazy-loads the SDK only when a session hint says somebody is signed in.
 *
 * A visitor therefore downloads nothing extra and is offered nothing. Somebody
 * with a session has already paid for the SDK by having one, so the editing
 * affordances cost them nothing new either. Same reasoning, at more length, in
 * `features/programs/useProgramAdmin`.
 *
 * ## Simpler than the programs one, and it should stay that way
 *
 * `useProgramAdmin` has to fetch a member document, because editing a ministry
 * needs a per-ministry grant. Events do not: `firestore.rules` says
 * `allow write: if hasRole('staff')` on `/events/{eventId}` and nothing more, so
 * the claim in the token is the whole answer and there is nothing to await.
 *
 * ## Not a security boundary
 *
 * This decides what to *draw*. `firestore.rules` decides what can be written, it
 * reads the ID token rather than anything here, and somebody who flips `canEdit`
 * to true in their own browser gets controls whose every write is refused.
 */
export interface EventsAdminSession {
  /** True once the answer is known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  canEdit: boolean;
}

export function useEventsAdmin(): EventsAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const signedIn = auth.kind === 'signed-in';
  const claims = signedIn ? auth.claims : null;

  return {
    // `restoring` and `signing-in` are both "we do not know yet". Reporting
    // ready on those would flash the Edit control away again a moment later for
    // somebody who does have the role.
    ready: auth.kind === 'signed-out' || signedIn,
    claims,
    canEdit: claims !== null && hasRole(claims, 'staff'),
  };
}
