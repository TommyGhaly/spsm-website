'use client';

import { type SpsmClaims } from '@spsm/shared';
import { useScreenGrants } from '@/lib/screenGrants';

/**
 * Whether the person reading /forms may build and review them.
 *
 * Subscribes to `lib/authStore` — the module singleton the masthead already
 * maintains — rather than importing `firebase/auth` here. Same arrangement as
 * `useBookstoreAdmin`, and for the same reason: the auth SDK is loaded lazily,
 * only when a session hint says somebody is signed in.
 *
 * ## The check, and why it is one grant and nothing else
 *
 * `firestore.rules` said `hasRole('staff')` for both `forms` and
 * `formSubmissions`, and this asked exactly that, on the principle stated below
 * — a check *stricter* than the policy hides a feature from the people it was
 * built for; a check *looser* than the policy shows a panel that cannot save.
 *
 * There is no role now. Both rules are `hasScreen('forms')`, which is "the
 * superadmin, or whoever holds the forms flag on their member document", and
 * `useScreenGrants` asks that same question — short-circuiting on `superadmin`
 * exactly as `hasScreen()` does, so the two cannot drift.
 *
 * Nothing else opens this. There was a `groups` axis alongside the ladder
 * (`clergy`, `bookstore`, `parking`) and it never had a forms entry; it is gone
 * too, and inventing a second door in the UI would show a builder to somebody
 * whose every write the rules would refuse.
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
  const { ready, claims, canAdmin } = useScreenGrants();
  return { ready, claims, canEdit: canAdmin('forms') };
}
