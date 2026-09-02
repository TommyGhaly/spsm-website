/**
 * Authorization model.
 *
 * ---------------------------------------------------------------------------
 * ## One question, answered in one place
 *
 * There used to be three axes here: a linear `role` tier
 * (`member < servant < staff < admin`), a set of cross-cutting `groups`
 * (`clergy`, `bookstore`, `parking`), and the per-screen grants in ./screens.ts.
 * Every one of them was a claim except the third, every one of them could open
 * a door the others could not, and answering "may this person do X" meant
 * checking all three and knowing which one won.
 *
 * They are gone. What is left is:
 *
 *   - **Signing in.** Sign-in is Microsoft-only and restricted to the parish's
 *     Entra tenant, so being able to authenticate at all means being clergy,
 *     staff or a servant of this church. That is the qualification, and what it
 *     buys is the servants' rota — reading it, because needing a grant to see
 *     when you are serving is exactly backwards — and nothing else.
 *   - **An allocation.** Every other privilege on this site is a flag in the
 *     `screenAdmin` map or an id in the `programAdmin` list, both on the
 *     person's member document, both handed out at /access. There is no tier
 *     that quietly includes them, so there is no way to give somebody the
 *     bookstore and accidentally give them the parish calendar.
 *   - **`superadmin`.** One boolean claim. It short-circuits every check on the
 *     site, and it is the only thing that can open /access and hand out the
 *     allocations above. Set by `scripts/grant-admin.mjs` and by nothing else —
 *     deliberately, because the power to grant must not itself be grantable.
 *
 * ## Why the allocation is not a claim
 *
 * Claims ride in the ID token, and a token refreshes at most hourly. A grant
 * that took an hour to arrive would be reported as broken every time it was
 * used. The maps live on the member document instead, `firestore.rules` reads
 * them with a `get()`, and a grant is live on the grantee's next page load.
 *
 * `superadmin` can be a claim precisely because it is *not* handed out in the
 * course of ordinary work: it is set once, by hand, from a terminal.
 *
 * ## `screens` — a mirror, and the one thing that does lag
 *
 * Firebase **Storage** rules cannot read Firestore. They can only see the
 * token. So a bucket rule cannot ask whether somebody holds the `events` flag,
 * which would leave every hero image, form picture and product photo writable
 * only by a superadmin — or by anybody signed in, which is worse.
 *
 * `screens` is the answer: a flat list of granted screen keys, mirrored into
 * the claims by `mirrorGrantsToClaims` in functions/src/auth.ts whenever a
 * member document changes, and read by `storage.rules` and by nothing else.
 * Firestore keeps reading the document, so nothing there lags.
 *
 * The mirror does lag by up to a token refresh, and the site closes that gap
 * rather than living with it: `useScreenGrants` compares this list against the
 * document it just read and forces a refresh when they disagree, so the person
 * who was granted Events a moment ago can upload a photograph now.
 *
 * Client-side checks using these helpers are for hiding UI only — never treat
 * them as security. `firestore.rules` and `storage.rules` are the policy.
 * ---------------------------------------------------------------------------
 */
import { isAdminScreen, type AdminScreen, type ScreenAdmin } from './screens.js';

/** Shape of the custom claims block we set via the Admin SDK. */
export interface SpsmClaims {
  /**
   * May do anything, including hand out every allocation on the site.
   *
   * Not a tier and not the top of a ladder — there is nothing below it. A
   * person is either the parish's site administrator or they are somebody with
   * an allocation, and the second is how nearly everyone works.
   */
  superadmin: boolean;
  /**
   * The screen grants, mirrored out of the member document for `storage.rules`.
   *
   * Never read this to decide anything in the browser or in Firestore rules —
   * it is a lagging copy. `useScreenGrants` reads the document, which is
   * authoritative. This exists because Storage rules have nothing else to read.
   */
  screens: readonly AdminScreen[];
}

/**
 * What an unauthenticated visitor effectively is, and what a signed-in person
 * starts as.
 *
 * The two being identical is the point: signing in is not a privilege ladder
 * any more. It grants the servants' rota — enforced by `signedIn()` in
 * firestore.rules, not by anything here — and everything else is allocated.
 */
export const DEFAULT_CLAIMS: SpsmClaims = { superadmin: false, screens: [] };

/** The parish's site administrator. Everything else is an allocation. */
export function isSuperadmin(claims: { superadmin?: boolean } | null | undefined): boolean {
  return claims?.superadmin === true;
}

/**
 * Read the claim block off a decoded ID token.
 *
 * Tolerant on the way in and exact on the way out: a token minted before this
 * model existed carries `role` and `groups` and no `superadmin`, and it has to
 * resolve to "signed in, nothing granted" rather than to `undefined` leaking
 * into a check. Unknown screen keys are dropped rather than carried, so a
 * stale mirror cannot name a screen the code no longer knows how to check.
 */
export function parseClaims(token: Record<string, unknown> | null | undefined): SpsmClaims {
  if (!token) return DEFAULT_CLAIMS;
  const screens = token['screens'];
  return {
    superadmin: token['superadmin'] === true,
    screens: Array.isArray(screens) ? screens.filter(isAdminScreen) : [],
  };
}

/**
 * The mirror, derived from the authoritative map.
 *
 * One function so the trigger that writes the claim and any test that checks it
 * cannot disagree about ordering or about which keys count. Sorted because
 * `setCustomUserClaims` rewrites the whole block and an unstable order would
 * make every member write look like a change.
 */
export function screensFromGrants(screenAdmin: ScreenAdmin | null | undefined): AdminScreen[] {
  if (!screenAdmin) return [];
  return (Object.keys(screenAdmin) as AdminScreen[])
    .filter((screen) => isAdminScreen(screen) && screenAdmin[screen] === true)
    .sort();
}

/**
 * Whether the token's mirror already agrees with the document.
 *
 * Used by `useScreenGrants` to decide whether to force a token refresh. Order
 * is not compared — `screensFromGrants` sorts, but a token minted by an older
 * deploy need not have — so this asks about membership only.
 */
export function claimsMirrorGrants(
  claims: SpsmClaims | null | undefined,
  screenAdmin: ScreenAdmin | null | undefined,
): boolean {
  const wanted = screensFromGrants(screenAdmin);
  const held = claims?.screens ?? [];
  return wanted.length === held.length && wanted.every((screen) => held.includes(screen));
}
