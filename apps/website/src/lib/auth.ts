/**
 * Microsoft-only sign-in.
 *
 * There is deliberately no public authentication on this site. A parishioner
 * never signs in — the calendar, the bulletin, giving, and contact details are
 * all public, and prayer requests and vehicle registration are written
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
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import { DEFAULT_CLAIMS, isKnownRole, type SpsmClaims, type Group, GROUPS } from '@spsm/shared';
import { firebaseApp } from './firebase';

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` by literal textual match, so this
 * has to be spelled out rather than looked up dynamically — same reason as
 * `publicEnv()` in ./firebase.
 */
const AZURE_TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID;

export function auth(): Auth {
  return getAuth(firebaseApp());
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
  return fbSignOut(auth());
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
    void claimsOf(user).then((claims) => callback(user, claims));
  });
}
