/**
 * Who gets an account, and what it is worth.
 *
 * Sign-in is Microsoft-only and exists for two things: the servants schedule
 * and the admin surface. A parishioner never signs in. So the question these
 * functions answer is not "who are you" — Entra already answered that — but
 * "are you from *this* parish, and what does that entitle you to."
 *
 * The model:
 *   tenant membership  -> `servant`, automatically, on first sign-in
 *   staff / admin      -> granted per person via `setMemberRole`, never inferred
 *
 * That first line makes the Entra app registration a security control rather
 * than a convenience: if it is switched from single-tenant to multi-tenant,
 * every Microsoft account on earth becomes a servant. `beforeUserCreated`
 * re-checks the tenant so that a change in the Azure portal cannot silently
 * open the door here.
 */
import { beforeUserCreated, HttpsError as AuthHttpsError } from 'firebase-functions/identity';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_SIGNIN_ROLE,
  GROUPS,
  ROLES,
  defaultScreenAdmin,
  isKnownRole,
  type Group,
  type Role,
} from '@spsm/shared';

/**
 * The parish's Entra directory (tenant) id. Not a secret — it is a public
 * identifier that appears in every sign-in URL — so it is a param, not a
 * Secret Manager entry.
 */
const AZURE_TENANT_ID = defineString('AZURE_TENANT_ID');

const MICROSOFT_PROVIDER = 'microsoft.com';

/**
 * The Entra directory the sign-in actually came from, or null.
 *
 * Two sources, checked in that order, and the fallback is the one that works.
 * `credential.claims` is where the decoded OIDC claims are *documented* to
 * live, and against the Auth emulator that key is present but empty while the
 * claims — `tid` included — arrive under `additionalUserInfo.profile`. Reading
 * only the documented location produced a check that rejected every sign-in,
 * legitimate ones included, with the tenant reported as null.
 *
 * So read both. Getting this wrong is not a subtle bug: too strict locks the
 * whole parish out of the servants schedule, too loose hands `servant` to any
 * Microsoft account that reaches us.
 */
/**
 * The claims inside a raw provider ID token.
 *
 * Decoded, not verified — and that is deliberate rather than lazy. Firebase has
 * already validated this token against Microsoft's signing keys as part of
 * completing the sign-in; a blocking function runs *after* that, on a
 * credential Firebase has accepted. Re-verifying here would mean fetching and
 * caching JWKS inside a function that must answer in milliseconds, to re-derive
 * a decision the platform already made. If Firebase's verification is wrong,
 * re-checking the signature does not save us — the whole flow is already lost.
 *
 * Never log the return value. It is a live credential.
 */
function claimsFromIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== 'string') return null;

  const payload = idToken.split('.')[1];
  if (!payload) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A malformed token is somebody else's problem: the caller reads this as
    // "no tenant", and the check below fails closed.
    return null;
  }
}

/**
 * The Entra directory the sign-in actually came from, or null.
 *
 * Three sources, and the order is the order of how much they can be trusted to
 * exist — every one of them was necessary at some point:
 *
 *   1. `credential.claims` — where the decoded OIDC claims are *documented* to
 *      live. Against production this key is present and its value is `null`.
 *   2. `additionalUserInfo.profile` — populated, but it is the Microsoft Graph
 *      `/me` response (`@odata.context`, `mail`, `userPrincipalName`), not the
 *      ID token. There is no `tid` in it. It carries one under the Auth
 *      emulator, which is why it stays.
 *   3. `credential.idToken` — the raw JWT, decoded here. This is the one that
 *      works against the real project, and `tid` is always in it.
 *
 * Getting this wrong is not subtle: too strict locks the whole parish out of
 * the servants schedule — which is exactly what reading only (1) and (2) did,
 * rejecting every legitimate sign-in with `presentedTenant: null` — and too
 * loose hands `servant` to any Microsoft account that reaches us.
 */
function presentedTenant(event: {
  credential?: { claims?: Record<string, unknown> | null; idToken?: unknown } | undefined;
  additionalUserInfo?: { profile?: Record<string, unknown> | null } | undefined;
}): string | null {
  const asTenant = (value: unknown): string | null =>
    typeof value === 'string' && value.length > 0 ? value : null;

  return (
    asTenant(event.credential?.claims?.['tid']) ??
    asTenant(event.additionalUserInfo?.profile?.['tid']) ??
    asTenant(claimsFromIdToken(event.credential?.idToken)?.['tid'])
  );
}

/**
 * Runs while the very first ID token is being minted, which is the entire
 * reason it is a blocking function rather than an `onUserCreated` trigger.
 * Claims returned here are present in that first token, so a servant signs in
 * once and is immediately a servant. The non-blocking version would set the
 * claim *after* the token existed, leaving a first session that is
 * authenticated but role-less — a state every caller then has to handle.
 */
export const enforceTenantOnCreate = beforeUserCreated(
  // `idToken: true` is load-bearing, not a tuning knob. Blocking functions do
  // not forward the provider credential unless you ask, so without it
  // `event.credential` arrives empty, `tid` is undefined, and the tenant check
  // below rejects every sign-in including legitimate ones. Verified: with it
  // off, a correct-tenant sign-in is refused with presentedTenant: null.
  { idToken: true },
  async (event) => {
    const user = event.data;
    const expected = AZURE_TENANT_ID.value();
    const tenant = presentedTenant(event);

    if (!user) {
      throw new AuthHttpsError('invalid-argument', 'No user on the creation event.');
    }

    if (event.credential?.providerId && event.credential.providerId !== MICROSOFT_PROVIDER) {
      // Microsoft is the only provider enabled on the project, so this is
      // unreachable unless someone enables another one in the console. Refusing
      // here means that turning on a provider cannot, by itself, mint servants.
      logger.error('Rejected sign-in from an unexpected provider', {
        providerId: event.credential.providerId,
      });
      throw new AuthHttpsError(
        'permission-denied',
        'This site only supports church Microsoft accounts.',
      );
    }

    if (!expected) {
      // Fail closed. An unset param is a deployment mistake, and the failure it
      // would otherwise cause — granting `servant` to anyone who can reach
      // Microsoft — is exactly the one worth refusing to guess about.
      logger.error('AZURE_TENANT_ID is not configured; refusing to create an account.');
      throw new AuthHttpsError('failed-precondition', 'Sign-in is not configured yet.');
    }

    if (tenant !== expected) {
      logger.error('Rejected sign-in from outside the parish tenant', {
        email: user.email ?? null,
        // Logged so a legitimate second tenant is diagnosable in one look rather
        // than by guesswork. A tenant id is not a secret.
        presentedTenant: tenant,
        /*
         * The shape of what we were handed, when there was no tenant in it.
         *
         * `presentedTenant: null` means the claim was absent, not that it
         * disagreed — a completely different fault with a completely different
         * fix, and the two are indistinguishable in the log without this. It
         * cost a debugging session to learn that once.
         *
         * **Key names only, never values.** This event carries the provider's
         * ID token and the user's profile; logging the values would put a live
         * credential and personal data into Cloud Logging, where it would be
         * readable by anyone with project access and retained for 30 days.
         */
        ...(tenant === null
          ? {
              sawCredential: event.credential != null,
              credentialKeys: event.credential ? Object.keys(event.credential) : null,
              claimKeys: event.credential?.claims ? Object.keys(event.credential.claims) : null,
              profileKeys: event.additionalUserInfo?.profile
                ? Object.keys(event.additionalUserInfo.profile)
                : null,
              signInProvider: event.additionalUserInfo?.providerId ?? null,
            }
          : {}),
      });
      throw new AuthHttpsError(
        'permission-denied',
        'That account is not part of the church directory. Use your church Microsoft account.',
      );
    }

    logger.info('Provisioning a new servant', {
      uid: user.uid,
      email: user.email ?? null,
    });

    // Best-effort, and deliberately not awaited into the rejection path: the
    // profile is a display record — a name for an admin list — while the claims
    // below are what actually decide anything. Firestore being briefly unhappy is
    // not a reason to refuse someone entry to the servants schedule, and the
    // record is recreated by `setMemberRole` the first time their role changes.
    //
    // (`onUserCreated` would be the natural home for this, but firebase-functions
    // v7 ships it at runtime without type declarations, so it is not a supported
    // API to build on.)
    await createMemberProfile(user.uid, user.email ?? null, user.displayName ?? null);

    return { customClaims: { role: DEFAULT_SIGNIN_ROLE } };
  },
);

async function createMemberProfile(
  uid: string,
  email: string | null,
  displayName: string | null,
): Promise<void> {
  try {
    await getFirestore()
      .collection(COLLECTIONS.members)
      .doc(uid)
      .set(
        {
          displayName: displayName ?? email ?? 'Unnamed',
          email: email ?? '',
          phone: null,
          photoPath: null,

          // Display mirrors, never authoritative — firestore.rules reads the
          // token and never this document.
          roleMirror: DEFAULT_SIGNIN_ROLE,
          groupsMirror: [],

          /*
           * Per-screen admin, every screen closed. See @spsm/shared/screens.
           *
           * Unlike the mirrors above this one *is* authoritative — it is the
           * only record of which areas a non-admin may manage, and there is no
           * claim behind it. Which makes the `screenAdmin` clause in
           * firestore.rules load-bearing: without it the `allow update: if
           * isSelf(uid)` rule for profile edits would let anyone flip their own
           * flags to true and walk into every admin screen on the site.
           *
           * Written on creation rather than lazily, so the document always has
           * a complete map and a missing key means "older document" rather than
           * "not decided yet". `parseScreenAdmin` still defaults absent keys to
           * false, because that guarantee is worth having twice.
           */
          screenAdmin: defaultScreenAdmin(),

          authProvider: 'microsoft',

          notificationPrefs: {
            announcements: true,
            orderUpdates: false,
          },

          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: null,
        },
        // Merge so a re-created auth user does not blank an existing profile.
        { merge: true },
      );
  } catch (error) {
    logger.error('Could not write the member profile; sign-in continues', {
      uid,
      error,
    });
  }
}

/**
 * Grant or change a role.
 *
 * Writes the claims *and* the display mirror on the member document, because
 * those are two different stores that drift the moment anything updates one
 * without the other. Claims stay authoritative — `firestore.rules` reads the
 * token and never this document, so a stale mirror is a cosmetic bug rather
 * than a privilege escalation.
 */
export const setMemberRole = onCall<{
  uid: string;
  role: Role;
  groups?: Group[];
}>({ cors: false }, async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can change roles.');
  }

  const { uid, role, groups = [] } = request.data ?? {};

  if (typeof uid !== 'string' || uid.length === 0) {
    throw new HttpsError('invalid-argument', 'uid is required.');
  }
  if (!isKnownRole(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${ROLES.join(', ')}`);
  }
  if (!Array.isArray(groups) || groups.some((g) => !(GROUPS as readonly string[]).includes(g))) {
    throw new HttpsError('invalid-argument', `groups must be from: ${GROUPS.join(', ')}`);
  }
  if (uid === request.auth?.uid && role !== 'admin') {
    // Locking yourself out is recoverable only by someone else with admin, or
    // by the bootstrap script. Cheap to prevent, expensive to undo.
    throw new HttpsError('failed-precondition', 'You cannot demote yourself.');
  }

  await getAuth().setCustomUserClaims(uid, { role, groups });

  await getFirestore()
    .collection(COLLECTIONS.members)
    .doc(uid)
    .set(
      {
        roleMirror: role,
        groupsMirror: groups,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: request.auth?.uid ?? null,
      },
      { merge: true },
    );

  logger.info('Role changed', { uid, role, groups, by: request.auth?.uid });

  // The subject keeps their old claims until their ID token refreshes, which
  // is up to an hour. Anything acting on this immediately must force-refresh.
  return { uid, role, groups };
});
