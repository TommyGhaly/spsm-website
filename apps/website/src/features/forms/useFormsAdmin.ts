'use client';

import { useSyncExternalStore } from 'react';
import { hasRole, type SpsmClaims } from '@spsm/shared';
import { getServerSnapshot, getSnapshot, subscribe } from '@/lib/authStore';

/**
 * Whether the person reading /forms may build and review them.
 *
 * Subscribes to `lib/authStore` — the module singleton the masthead already
 * maintains — rather than importing `firebase/auth` here. Same arrangement as
 * `useBookstoreAdmin`, and for the same reason: the auth SDK is loaded lazily,
 * only when a session hint says somebody is signed in.
 *
 * ## The role, and why it is `staff` alone
 *
 * `firestore.rules` says `hasRole('staff')` for both `forms` and
 * `formSubmissions`, so this asks exactly that. No group is admitted, unlike the
 * bookstore's check which also lets a `bookstore` volunteer in — there is no
 * equivalent group in the rules here, and inventing one in the UI would show a
 * builder to somebody every write from which the rules would then refuse.
 *
 * A check *stricter* than the policy hides a feature from the people it was
 * built for; a check *looser* than the policy shows a panel that cannot save.
 * Both are bugs. This one matches.
 *
 * ## Not a security boundary
 *
 * This decides what to draw. The submissions panel it gates lists real people's
 * names, phone numbers, and answers — and what protects those is the rules
 * refusing the read without the claim, not this hook. Someone who flips
 * `canEdit` to true in their own browser gets an empty panel and an error.
 */
export interface FormsAdminSession {
  /** True once the answer is known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  canEdit: boolean;
}

export function useFormsAdmin(): FormsAdminSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const signedIn = auth.kind === 'signed-in';
  const claims = signedIn ? auth.claims : null;

  return {
    // `restoring` and `signing-in` are both "we do not know yet". Reporting
    // ready on those would flash the control away again a moment later for
    // somebody who does have the claim.
    ready: auth.kind === 'signed-out' || signedIn,
    claims,
    canEdit: claims !== null && hasRole(claims, 'staff'),
  };
}
