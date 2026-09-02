'use client';

import { type SpsmClaims } from '@spsm/shared';
import { useScreenGrants } from '@/lib/screenGrants';

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
 * ## It fetches a member document now, and the note here used to deny it
 *
 * This file said: *`useProgramAdmin` has to fetch a member document, because
 * editing a ministry needs a per-ministry grant. Events do not — the claim in
 * the token is the whole answer and there is nothing to await.* That was true
 * of `allow write: if hasRole('staff')`, and it stopped being true when the
 * allocation screen at /access was built: the rule is `hasScreen('events')`, so
 * whether somebody may edit the calendar is a fact on their member document.
 * With the role ladder now gone entirely, that is true of every permission on
 * this site bar one — see packages/shared/src/claims.ts.
 *
 * `useScreenGrants` does the fetch, once per session and shared with the other
 * gated panels, and answers from the token alone for the superadmin.
 *
 * The distinction from `useProgramAdmin` survives, and it is the one that
 * matters: this is the parish **calendar**. A ministry's gatherings are
 * `programAdmin`, a different axis, granted per program on the same screen. The
 * youth servant who runs Summercamp does not thereby get the liturgy schedule.
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
  const { ready, claims, canAdmin } = useScreenGrants();
  return { ready, claims, canEdit: canAdmin('events') };
}
