/**
 * Microsoft-only sign-in.
 *
 * There is deliberately no public authentication on this site. A parishioner
 * never signs in — the calendar, the bulletin, giving, and contact details are
 * all public, and vehicle registration and the parish forms are written
 * anonymously. Sign-in exists for exactly two things: the servants schedule and
 * the admin surface. Being able to sign in *is* the qualification for the first
 * of those and buys nothing towards the second — see
 * packages/shared/src/claims.ts.
 *
 * That is why Microsoft is the only provider enabled on the project (verified:
 * `defaultSupportedIdpConfigs` lists `microsoft.com` and nothing else). Servants
 * already have a parish M365 account, so there is no new password to issue,
 * forget, or reset, and no account-recovery flow to build for a volunteer
 * organisation that cannot staff one.
 *
 * **Nothing in here may be imported by a public page.** `firebase/auth` is
 * ~150KB and today the Firestore SDK only reaches the browser on /parking;
 * pulling either into the shared layout chunk would put the whole admin
 * dependency tree on the homepage. Import this from /admin and /servants only.
 */
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  OAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  CONFIRM_LOCKOUT_FIELD,
  DEFAULT_CLAIMS,
  parseClaims,
  type SpsmClaims,
} from '@spsm/shared';
import { firebaseApp, usingEmulators } from './firebase';
import { setSessionHint } from './authHint';

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` by literal textual match, so this
 * has to be spelled out rather than looked up dynamically — same reason as
 * `publicEnv()` in ./firebase.
 */
const AZURE_TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID;

let instance: Auth | null = null;

/**
 * The Auth instance, pinned to localStorage rather than IndexedDB.
 *
 * `initializeAuth` instead of `getAuth`, and that is the whole point of this
 * function. `getAuth` installs Firebase's default persistence chain, which
 * tries `indexedDBLocalPersistence` first — and IndexedDB is where sign-in was
 * dying: the popup returned from Microsoft cleanly and the SDK then threw
 * `InvalidStateError: the database connection is closing` while writing the
 * session, so a completed sign-in surfaced as a failure. Safari is the usual
 * offender, and a second tab on the same origin closing the connection is the
 * usual trigger; neither is something the site can control.
 *
 * `browserLocalPersistence` is plain localStorage. It costs nothing that
 * matters here — a session is per-device either way, and this app has no
 * multi-tab handoff to preserve — and it removes the failure mode outright.
 *
 * `browserPopupRedirectResolver` has to be passed explicitly. `getAuth` wires
 * it up for you; `initializeAuth` does not, and without it `signInWithPopup`
 * throws `auth/argument-error` — trading one broken sign-in for another.
 *
 * Cached, because `initializeAuth` throws `auth/already-initialized` on a
 * second call for the same app. The `getAuth` fallback covers the case where
 * something else got there first, which should be impossible — this is the
 * only accessor — but a hard failure in the header on every page is a bad way
 * to discover otherwise.
 */
export function auth(): Auth {
  if (instance) return instance;

  try {
    instance = initializeAuth(firebaseApp(), {
      persistence: browserLocalPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    instance = getAuth(firebaseApp());
  }

  // See `usingEmulators` — the admin cannot be developed against the real
  // project, because getting an account there means being a real member of the
  // parish directory. Connected here, inside the one-time construction, so it
  // cannot run twice: `connectAuthEmulator` throws once the instance is used.
  if (usingEmulators()) {
    connectAuthEmulator(instance, 'http://127.0.0.1:9099', { disableWarnings: true });
  }

  return instance;
}

/**
 * Sign in against the parish's Entra tenant.
 *
 * `tenant` sends the user straight to the parish's login page instead of the
 * multi-tenant `common` endpoint. Treat that as ergonomics, **not** as a
 * security control: it is a request to Microsoft, and a determined caller can
 * ask for a different one. The actual restriction is the app registration being
 * single-tenant, backed by the `tid` check in `beforeUserCreated`.
 *
 * Popup rather than redirect. Redirect flows break under Safari's third-party
 * cookie rules whenever the auth handler is on a different origin than the
 * site, which is exactly our situation until `authDomain` is moved onto
 * spsmwayland.org. Revisit after the domain cutover.
 */
export async function signInWithMicrosoft(): Promise<User> {
  const provider = new OAuthProvider('microsoft.com');

  if (AZURE_TENANT_ID) {
    provider.setCustomParameters({ tenant: AZURE_TENANT_ID });
  } else {
    // Not fatal — the app registration still gates it — but it means everyone
    // lands on the generic Microsoft picker, which is confusing enough that
    // people report it as broken.
    console.warn('[auth] NEXT_PUBLIC_AZURE_TENANT_ID is not set; using the common endpoint.');
  }

  const credential = await signInWithPopup(auth(), provider);
  return credential.user;
}

export function signOut(): Promise<void> {
  // Cleared before the await, not after. `onAuthChange` will clear it too, but
  // a sign-out that is still in flight when the user navigates would otherwise
  // leave the hint set, and the next page would load the SDK to discover a
  // session that is already gone.
  setSessionHint(false);
  return fbSignOut(auth());
}

/**
 * Delete the signed-in account, and end the session.
 *
 * ---------------------------------------------------------------------------
 * Two things are removed and only one of them can be removed from here.
 *
 * An account on this site is a Firebase Auth user *and* a `members/{uid}`
 * document — the second is what says which areas the person administers, and no
 * rule lets a member delete their own. So this does not call the SDK's
 * `deleteUser()`; it posts to `/api/account/delete`, which does both halves
 * with the Admin SDK in the one order that fails safe. `functions/src/account.ts`
 * carries that argument at length.
 *
 * The ID token is the whole of the request. There is no uid in the body and
 * there must never be one: the endpoint acts on whoever the verified token says
 * is calling, which is what makes it impossible to aim at somebody else.
 * ---------------------------------------------------------------------------
 *
 * `getIdToken(true)` forces a refresh rather than using the cached token, and
 * that is not caution for its own sake. The endpoint verifies with
 * `checkRevoked: true`, so a token minted up to an hour ago — the ordinary case
 * for a tab that has been open all morning — is re-checked against the tenant
 * anyway; forcing the refresh here means a stale-token 401 surfaces as a
 * sign-in problem before anything is deleted, rather than as a failure halfway
 * through.
 *
 * The local sign-out at the end is deliberate and is not merely tidying. The
 * user is gone from Firebase, but this tab still holds their session in
 * localStorage: `onAuthChange` would not necessarily hear about it until the
 * SDK next tried to refresh the token, leaving the header showing the initials
 * of an account that no longer exists. Signing out locally is what makes the
 * menu agree with reality immediately.
 *
 * ---------------------------------------------------------------------------
 * **It happens on success only, and that is a fix rather than a preference.**
 *
 * This was written as a `finally`, on the reasoning that a session whose fate
 * we are unsure of is one to get out of. Tried against an endpoint that was not
 * deployed yet, that reasoning produced the worst behaviour this whole feature
 * has: the request 404s, nothing is deleted, and the person is signed out
 * anyway — which unmounts the confirmation dialog, throws away the error
 * message with it, and leaves them looking at a signed-out masthead. From the
 * outside that is indistinguishable from having worked. They would have gone
 * away believing an account that still exists had been deleted.
 *
 * There is no case that wants the old behaviour. A network failure, a 401, a
 * 404, a 429 and the superadmin 409 all mean nothing was deleted, so the
 * session is still valid and still theirs. The one genuinely partial outcome —
 * the 500 where the member document went but the auth user did not — leaves an
 * account that can sign in and holds no areas, which is a state worth *staying*
 * in long enough to read the sentence telling them to contact the office.
 *
 * So: sign out when the account is actually gone, and otherwise leave the
 * session alone and let the error reach the screen.
 * ---------------------------------------------------------------------------
 */
export async function deleteOwnAccount(
  /**
   * Set by the confirmation panel when the person holds `superadmin` and has
   * ticked the acknowledgement.
   *
   * Not read from the token here, deliberately. This function could look up its
   * own claims and always send the flag — and that would defeat the guard
   * entirely, because the flag would then mean "a superadmin asked" rather than
   * "a superadmin was told what this does and agreed". It has to come from the
   * checkbox, which is the only thing that knows a human read the sentence.
   */
  options: { confirmLockout?: boolean } = {},
): Promise<void> {
  const user = auth().currentUser;
  if (!user) throw new Error('You are not signed in.');

  let token: string;
  try {
    token = await user.getIdToken(true);
  } catch {
    throw new Error('Your sign-in has expired. Sign in again and retry.');
  }

  let response: Response;
  try {
    response = await fetch('/api/account/delete', {
      method: 'POST',
      /*
       * The content type is what makes the body readable at the other end —
       * `onRequest`'s JSON parser is keyed on it, and without it the Function
       * sees a raw string. `lockoutAcknowledged` copes with either, but sending
       * the header is the half of that we control.
       *
       * Still no uid in the body, and there must never be one: the endpoint acts
       * on whoever the verified token says is calling. `confirmLockout` is a
       * statement about the caller's own intent, not about a target.
       */
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        options.confirmLockout ? { [CONFIRM_LOCKOUT_FIELD]: true } : {},
      ),
    });
  } catch {
    // A network failure, not a refusal. Worth saying differently: nothing has
    // been deleted, and retrying is the right move.
    throw new Error('Could not reach the church server. Check your connection and retry.');
  }

  const body = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    /*
     * A non-JSON body here means the Hosting rewrite for this path is missing
     * in production, or there is no Functions emulator behind the dev proxy
     * locally — the same pair of causes `features/forms/data.ts` documents on
     * its own endpoint. Neither is something the person clicking can fix, so
     * they get a sentence and the console gets the detail.
     */
    if (!body.error) {
      console.error(
        `[account] ${response.status} from /api/account/delete with no JSON error. ` +
          'In production that is a missing Hosting rewrite; locally it is a missing ' +
          'Functions emulator. See docs/local-dev.md.',
      );
    }
    throw new Error(body.error ?? 'The account could not be deleted. Please try again.');
  }

  // Deleted. Now, and only now, is this session over.
  await signOut().catch((error: unknown) => {
    // The account is gone from Firebase either way, so this is not worth
    // reporting as a failure to delete — but it does mean the header may lag
    // until the SDK next fails to refresh the token, which is worth a line.
    console.warn('[account] the account was deleted but the local sign-out failed:', error);
  });
}

/**
 * Sign in as a seeded emulator account. **Local development only.**
 *
 * Throws unless `usingEmulators()`, so this cannot run against the real project
 * even if a button for it were left on screen — and the real project has no
 * password provider enabled anyway, deliberately.
 *
 * It exists because the admin is otherwise undevelopable: every check needs a
 * signed-in user with an allocation, and against production the only way to get
 * one is to be a real member of the parish directory. Seed a user in the Auth
 * emulator, give it a `superadmin` claim and a member document, and the whole
 * admin becomes testable — and destructive actions can be tried without doing
 * them to the parish.
 */
export async function signInWithEmulatorAccount(email: string, password: string): Promise<User> {
  if (!usingEmulators()) {
    throw new Error('Emulator sign-in is only available with NEXT_PUBLIC_USE_EMULATORS=1.');
  }
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const credential = await signInWithEmailAndPassword(auth(), email, password);
  return credential.user;
}

/**
 * The two claims, read off the ID token.
 *
 * `superadmin` decides things. `screens` decides nothing here — it is a lagging
 * mirror of the member document kept for `storage.rules`, which cannot read
 * Firestore — and the only reason a browser looks at it at all is
 * `useScreenGrants`, which compares it against the document to know whether the
 * token needs refreshing. Read the grants from `useScreenGrants`, never here.
 *
 * `forceRefresh` matters more than it looks: `enforceTenantOnCreate` sets the
 * block while the very first token is being minted, so a first-time signer-in
 * has its shape immediately — but a *change*, made by `grant-admin.mjs` or by
 * the grant mirror, does not appear until the token refreshes, which is up to
 * an hour. Anywhere that has to take effect now, pass `true`.
 */
export async function claimsOf(user: User | null, forceRefresh = false): Promise<SpsmClaims> {
  if (!user) return DEFAULT_CLAIMS;

  const token = await user.getIdTokenResult(forceRefresh);
  return parseClaims(token.claims as Record<string, unknown>);
}

/**
 * Fires on sign-in, sign-out, and token refresh, with claims already resolved.
 * Returns the unsubscribe function.
 */
export function onAuthChange(
  callback: (user: User | null, claims: SpsmClaims) => void,
): () => void {
  return onAuthStateChanged(auth(), (user) => {
    // The one place the hint in ./authHint.ts is written from, because this is
    // the one callback that sees every transition. Set synchronously, ahead of
    // the claims round-trip, so a reload during that window still guesses right.
    setSessionHint(user !== null);
    void claimsOf(user).then((claims) => callback(user, claims));
  });
}
