'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  COLLECTIONS,
  allFinanceScopes,
  canAdminScreen,
  canSeeFinanceSource,
  claimsMirrorGrants,
  defaultScreenAdmin,
  parseFinanceScopes,
  parseScreenAdmin,
  type AdminScreen,
  type FinanceScopes,
  type FinanceSource,
  type ScreenAdmin,
  type SpsmClaims,
} from '@spsm/shared';
import { getServerSnapshot, getSnapshot, subscribe } from './authStore';

/**
 * The signed-in person's own per-screen grants, read once and shared.
 *
 * ---------------------------------------------------------------------------
 * ## Why the grants are read rather than taken from the token
 *
 * The four gating hooks — forms, bookstore, events, camp — each answer "may
 * this person edit here?", and three of them used to answer it from the ID
 * token alone: `hasRole(claims, 'staff')` and nothing more. The comment at the
 * top of `useFormsAdmin` is emphatic about why that had to match the rules
 * exactly: *a check stricter than the policy hides a feature from the people it
 * was built for; a check looser than the policy shows a panel that cannot
 * save.*
 *
 * There is no role now. `hasScreen()` in firestore.rules admits the superadmin
 * or somebody holding the flag on their member document, and nobody else — so
 * a hook that asked the token would be answering a question the policy no
 * longer asks. The grants are on the document deliberately, so that an
 * allocation takes effect on the grantee's next page load instead of after an
 * hour's token refresh. That means a Firestore `get`, which is a cost the
 * token-only hooks did not have. Hence one module doing it once.
 *
 * ## One read per session, not one per hook
 *
 * `/bookstore` mounts `useBookstoreAdmin`; `/forms` mounts `useFormsAdmin` and
 * `useCampAdmin` together. Without the cache below, a page with two gated
 * panels fetches the same member document twice on every mount, and React's
 * StrictMode doubles that again in development — four reads of one document to
 * answer one question. The promise is memoised per uid, so concurrent callers
 * share the in-flight request and later callers get the settled one.
 *
 * Keyed by uid rather than a bare module-level value because sign-out and
 * sign-in as somebody else happens constantly in development (`?as=lead`), and
 * a cache that survived that would show one person's grants to the next.
 *
 * ## The one thing this does write back: a token refresh
 *
 * `storage.rules` cannot read Firestore, so the grants are *also* mirrored into
 * a `screens` claim by `mirrorGrantsToClaims` — see packages/shared/src/
 * claims.ts. A claim only reaches the browser when the ID token refreshes,
 * which is up to an hour, and the symptom of that hour is precise and
 * baffling: the person granted Events can create the event and cannot upload
 * its photograph.
 *
 * So every read here compares the document against the token and forces a
 * refresh when they disagree. It costs one network round trip on the first load
 * after a grant changes and nothing at all afterwards, and it is the reason the
 * lag documented in claims.ts and storage.rules is a footnote rather than a
 * support call. **If this is ever removed, the lag comes back.**
 *
 * ## Not a security boundary
 *
 * The same statement every gating hook in this codebase carries, and it is
 * doubly worth making here because this reads a document rather than a token:
 * this decides what to *draw*. `firestore.rules` decides what can be read and
 * written, it does its own `get()` of this same map, and somebody who edits the
 * result in their own browser gets a panel whose every request is refused.
 * ---------------------------------------------------------------------------
 */

/**
 * Everything one member document says about what its owner administers.
 *
 * Two maps rather than one because `financeScopes` narrows `screenAdmin.finance`
 * and lives on the same document — so it is free to read and expensive to
 * forget. See `FINANCE_SOURCES` in packages/shared/src/screens.ts.
 */
export interface Grants {
  screens: ScreenAdmin;
  finance: FinanceScopes;
}

/** Resolved grant maps, and the in-flight reads, keyed by uid. */
const cache = new Map<string, Promise<Grants>>();

/**
 * Read one person's grants, sharing the request with anybody else asking.
 *
 * A missing member document is an ordinary state rather than an error — it is
 * written on first sign-in, and the administrator created by `grant-admin.mjs`
 * predates it. Every screen resolves to `false`, which is the safe direction
 * and costs that person nothing: they are `admin`, and `canAdminScreen`
 * short-circuits before it ever looks at this map.
 */
export function readScreenGrants(uid: string): Promise<Grants> {
  const cached = cache.get(uid);
  if (cached) return cached;

  const pending = (async (): Promise<Grants> => {
    try {
      /*
       * Dynamic, and it has to be. `lib/firebase` is reached from pages a
       * parishioner opens — the gated panels sit on /forms and /bookstore
       * alongside public content — and a static import here would pull it into
       * the chunk those pages load whether or not anybody is signed in. Same
       * arrangement as the dynamic imports in `useProgramAdmin`.
       */
      const [{ db }, { doc, getDoc }] = await Promise.all([
        import('./firebase'),
        import('firebase/firestore'),
      ]);
      const snapshot = await getDoc(doc(db(), COLLECTIONS.members, uid));
      return {
        screens: parseScreenAdmin(snapshot.data()?.['screenAdmin']),
        // A document that names no source reads as all three — the narrowing
        // is opt-in, so that this shipping does not revoke the treasurer who
        // was given `finance` back when it meant everything.
        finance: parseFinanceScopes(snapshot.data()?.['financeScopes']),
      };
    } catch (error) {
      // A failed read is "not granted", never "granted by default". Logged
      // rather than swallowed: the difference between somebody who was never
      // given an area and somebody whose grants could not be fetched is
      // invisible on screen, and only the console can tell them apart.
      console.warn('[access] could not read your screen grants', error);
      // Nothing granted, so the sources below it are moot — `canSeeFinance`
      // asks for the flag first and there is none.
      return { screens: defaultScreenAdmin(), finance: allFinanceScopes() };
    }
  })();

  cache.set(uid, pending);
  return pending;
}

/**
 * Drop a cached answer so the next read goes to Firestore.
 *
 * Called by the allocation screen after it writes somebody's grants. Without
 * it, an administrator who grants themselves an area — or revokes one — sees
 * the stale map until a full reload, which looks exactly like the write having
 * silently failed.
 */
export function forgetScreenGrants(uid?: string): void {
  if (uid) cache.delete(uid);
  else cache.clear();
}

/**
 * Bring the token's `screens` mirror up to date with the document, if it isn't.
 *
 * Best-effort and never awaited by anything that renders: the document is what
 * every check on this page uses, so a failure here costs nothing but the
 * picture uploads, and only until the token refreshes on its own.
 *
 * Dynamic import for the same reason as the Firestore one above — `lib/auth`
 * pulls ~150KB of Firebase Auth, and this module is reached from pages a
 * parishioner opens.
 */
async function refreshTokenIfStale(claims: SpsmClaims, grants: ScreenAdmin): Promise<void> {
  if (claimsMirrorGrants(claims, grants)) return;
  try {
    const { auth, claimsOf } = await import('./auth');
    /*
     * `true` is the whole point of the call: it forces Firebase to mint a new
     * token rather than return the cached one, which is what picks up the claim
     * the mirror trigger wrote.
     *
     * The return value is discarded on purpose. What matters is the side
     * effect — the Auth SDK now holds the new token, so the Storage SDK sends
     * it on the next upload. `authStore` is not updated by this and does not
     * need to be: the only claim it reports on is `superadmin`, which this
     * cannot change (`onAuthStateChanged` does not fire on a token refresh, so
     * there is nothing to keep in step).
     */
    await claimsOf(auth().currentUser, true);
  } catch (error) {
    console.warn('[access] could not refresh your sign-in after a grant changed', error);
  }
}

export interface ScreenGrantSession {
  /** True once the answer is known. Controls stay absent until then. */
  ready: boolean;
  claims: SpsmClaims | null;
  uid: string | null;
  grants: ScreenAdmin | null;
  /**
   * Which parts of the church's money this person may see.
   *
   * Null until the answer is known, exactly like `grants`. Meaningless without
   * `canAdmin('finance')` — the map narrows that flag and never stands in for
   * it — so read it through `canSeeFinance` rather than directly.
   */
  financeScopes: FinanceScopes | null;
  /** The superadmin, or specifically entrusted with this screen. */
  canAdmin: (screen: AdminScreen) => boolean;
  /** The finance grant *and* this source. `firestore.rules` asks it that way. */
  canSeeFinance: (source: FinanceSource) => boolean;
}

/**
 * The hook the gating hooks are built on.
 *
 * Subscribes to `lib/authStore` — the module singleton the masthead already
 * maintains — rather than importing `firebase/auth`, so a visitor with no
 * session downloads nothing extra and triggers no read.
 */
export function useScreenGrants(): ScreenGrantSession {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [grants, setGrants] = useState<Grants | null>(null);
  const [resolved, setResolved] = useState(false);

  const signedIn = auth.kind === 'signed-in';
  const uid = signedIn ? auth.uid : null;
  const claims = signedIn ? auth.claims : null;
  const superadmin = claims?.superadmin === true;

  useEffect(() => {
    if (!signedIn || !uid) {
      setGrants(null);
      /*
       * `error` counts as an answer, and leaving it out was a bug.
       *
       * The kinds are signed-out, restoring, signing-in, signed-in and error.
       * Only the first three-and-a-bit were considered here, so a failed
       * sign-in left `resolved` false for ever — and every screen gated on this
       * sat on "Checking your sign-in…" with no way out but a reload. A failed
       * sign-in is a settled state: the answer is "not signed in".
       */
      setResolved(auth.kind === 'signed-out' || auth.kind === 'error');
      return;
    }

    /*
     * ---------------------------------------------------------------------------
     * The superadmin is read like everybody else now, and that reverses a
     * deliberate saving.
     *
     * This used to answer a superadmin from the token with no read at all, on
     * the argument that `canAdminScreen` short-circuits on the claim so the map
     * could change no answer. That argument was exactly right about
     * `screenAdmin` and wrong about the map that arrived beside it:
     * `financeScopes` is not a permission a superadmin already holds, it is
     * which part of the church's money they look after, and skipping the read
     * meant the one person who can set it was the one person it could not
     * apply to. The reported symptom was precise — narrow yourself to the
     * bookstore on /access, open /admin/finance, see all three.
     *
     * The safety the old fast path bought is kept, because it never depended on
     * skipping the read:
     *
     *   - **A missing member document is fine.** The first administrator,
     *     bootstrapped by `grant-admin.mjs`, may have none. `getDoc` resolves
     *     for a document that does not exist, and both parsers answer from
     *     `undefined` — every screen `false`, every source `true`.
     *   - **A failed read is fine.** The catch below returns the same pair.
     *   - **Neither can lock them out.** `canAdmin` is `canAdminScreen`, which
     *     short-circuits on the claim before it looks at this map at all.
     *
     * The cost is one Firestore read per session for the parish's one or two
     * superadmins — cached by uid like everybody else's, so it is the first page
     * load and nothing after it.
     * ---------------------------------------------------------------------------
     */
    let live = true;
    void readScreenGrants(uid).then((mine) => {
      if (!live) return;
      setGrants(mine);
      setResolved(true);
      // Fire-and-forget, and deliberately outside the `live` guard: the token
      // belongs to the session rather than to this component, so a refresh
      // started here is still worth finishing after an unmount.
      if (claims) void refreshTokenIfStale(claims, mine.screens);
    });
    return () => {
      live = false;
    };
    // `claims` is deliberately not a dependency. It is a fresh object on every
    // store emission — including the one `refreshTokenIfStale` causes — so
    // listing it would re-run this effect, re-read the document and refresh the
    // token again, forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.kind, signedIn, uid, superadmin]);

  return {
    // `restoring` and `signing-in` are both "we do not know yet". Reporting
    // ready on those would flash a control away again for somebody who has it.
    // `signed-out` and `error` are both settled answers — see the effect above.
    ready:
      auth.kind === 'signed-out' || auth.kind === 'error' ? true : signedIn && resolved,
    claims,
    uid,
    grants: grants?.screens ?? null,
    financeScopes: grants?.finance ?? null,
    canAdmin: (screen: AdminScreen) => canAdminScreen(claims, grants?.screens ?? null, screen),
    canSeeFinance: (source: FinanceSource) =>
      canSeeFinanceSource(claims, grants?.screens ?? null, grants?.finance ?? null, source),
  };
}
