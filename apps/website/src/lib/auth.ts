/**
 * Microsoft-only sign-in.
 *
 * There is deliberately no public authentication on this site. A parishioner
 * never signs in — the calendar, the bulletin, giving, and contact details are
 * all public, and vehicle registration and the parish forms are written
 * anonymously. Sign-in exists for exactly two things: the servants schedule and
 * the admin surface.
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
import { DEFAULT_CLAIMS, isKnownRole, type SpsmClaims, type Group, GROUPS } from '@spsm/shared';
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
  // project, because getting a role there means being a real member of the
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
 * Sign in as a seeded emulator account. **Local development only.**
 *
 * Throws unless `usingEmulators()`, so this cannot run against the real project
 * even if a button for it were left on screen — and the real project has no
 * password provider enabled anyway, deliberately.
 *
 * It exists because the admin is otherwise undevelopable: every role check
 * needs a signed-in user with a claim, and against production the only way to
 * get one is to be a real member of the parish directory. Seed a user in the
 * Auth emulator, give it a claim, and the whole admin becomes testable — and
 * destructive actions can be tried without doing them to the parish.
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
 * Roles come from the ID token, never from a Firestore document.
 *
 * `forceRefresh` matters more here than it looks: `beforeUserCreated` sets the
 * role while the very first token is being minted, so a first-time signer-in
 * has it immediately — but a role *change* made by an admin does not appear
 * until the token refreshes, which is up to an hour. Anywhere a promotion needs
 * to take effect now, pass `true`.
 */
export async function claimsOf(user: User | null, forceRefresh = false): Promise<SpsmClaims> {
  if (!user) return DEFAULT_CLAIMS;

  const token = await user.getIdTokenResult(forceRefresh);
  const role = token.claims['role'];
  const groups = token.claims['groups'];

  return {
    role: isKnownRole(role) ? role : DEFAULT_CLAIMS.role,
    groups: Array.isArray(groups)
      ? groups.filter((g): g is Group => (GROUPS as readonly unknown[]).includes(g))
      : [],
  };
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
