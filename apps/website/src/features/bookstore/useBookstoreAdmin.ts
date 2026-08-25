'use client';

import { useSyncExternalStore } from 'react';
import { hasRole, inGroup, type SpsmClaims } from '@spsm/shared';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Whether the person reading the shop may review its orders.
 *
 * ## The bundle constraint this is built around
 *
 * This subscribes to `lib/authStore` — the module singleton the masthead already
 * maintains, which lazy-loads `firebase/auth` only when a session hint says
 * somebody is signed in — rather than importing the auth SDK itself. Same
 * reasoning as `useEventsAdmin`, which this is otherwise a copy of.
 *
 * **A correction to what that file and `lib/auth.ts` claim, measured against the
 * export build on 2026-08-23.** Both say the Firestore SDK reaches the browser
 * only on /parking. It does not: every exported page pulls in about 604KB of it,
 * /bookstore included, and that was already true before any of the bookstore
 * work. So the argument for care here is not "keep the first SDK off this page"
 * — that ship has sailed and is worth its own investigation — it is the ordinary
 * one: do not make it worse, and do not ship a back office to people buying a
 * book. Which is why the section this gates is behind two `lazy` boundaries.
 *
 * ## The one difference from the events version, and why
 *
 * The group. `useEventsAdmin` asks only `hasRole(claims, 'staff')`, because
 * `firestore.rules` says exactly that for `/events/{eventId}`. The `orders` rule
 * is `inGroup('bookstore') || hasRole('staff')`, and a bookstore volunteer is
 * `member` plus the group — so asking for the role alone would hide the section
 * from the only people it was built for, while the rules happily served them
 * every document in it. A check stricter than the policy is not caution, it is
 * a bug that looks like caution.
 *
 * ## Not a security boundary
 *
 * This decides what to *draw*, and on this page that matters more than usual:
 * the section it gates lists real orders with real people's names on them. It is
 * still not what protects them. `firestore.rules` refuses the `orders` read
 * outright unless the ID token carries the claim, so somebody who flips
 * `canReview` to true in their own browser gets a panel that renders "Could not
 * read the orders" and nothing else.
 */
export interface BookstoreAdminSession {
  /** True once the answer is known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  /** May they see the orders queue and the sales figures? */
  canReview: boolean;
}

export function useBookstoreAdmin(): BookstoreAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const signedIn = auth.kind === 'signed-in';
  const claims = signedIn ? auth.claims : null;

  return {
    // `restoring` and `signing-in` are both "we do not know yet". Reporting
    // ready on those would flash the Edit control away again a moment later for
    // somebody who does have the claim.
    ready: auth.kind === 'signed-out' || signedIn,
    claims,
    canReview: claims !== null && (hasRole(claims, 'staff') || inGroup(claims, 'bookstore')),
  };
}
