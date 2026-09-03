/**
 * Who gets an account, and what it is worth.
 *
 * Sign-in is Microsoft-only and exists for two things: the servants schedule
 * and the admin surface. A parishioner never signs in. So the question these
 * functions answer is not "who are you" — Entra already answered that — but
 * "are you from *this* parish, and what does that entitle you to."
 *
 * The model, since the role ladder was removed:
 *
 *   tenant membership  -> an account, and the servants' rota. Nothing else.
 *   everything else    -> allocated at /access, onto the member document.
 *   `superadmin`       -> `scripts/grant-admin.mjs`, by hand, and nowhere else.
 *
 * There is no `setMemberRole` callable any more, and its absence is the point:
 * the only privilege that is a *claim* is the one that hands out every other
 * privilege, and it is set from a terminal rather than from a screen. See
 * packages/shared/src/claims.ts.
 *
 * That first line makes the Entra app registration a security control rather
 * than a convenience: if it is switched from single-tenant to multi-tenant,
 * every Microsoft account on earth gets an account here and can read the rota.
 * `beforeUserCreated` re-checks the tenant so that a change in the Azure portal
 * cannot silently open the door.
 */
import { beforeUserCreated, HttpsError as AuthHttpsError } from 'firebase-functions/identity';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { CAPS } from './rateLimit.js';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  DEFAULT_CLAIMS,
  defaultScreenAdmin,
  parseScreenAdmin,
  screensFromGrants,
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
 * Claims returned here are present in that first token, so the shape every
 * caller reads is there from the first request. The non-blocking version would
 * set them *after* the token existed, leaving a first session whose claim block
 * is missing keys — a state every caller then has to handle.
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

    /*
     * The anonymous upload session, which is not a person and has no tenant.
     *
     * Gallery submissions are open to anyone — sign-in here is Microsoft-only
     * against the parish tenant, so requiring an account would mean only clergy
     * and servants could ever send a photograph, which is precisely backwards
     * for the parishioner with forty pictures of the camp. The upload endpoint
     * signs them in anonymously so the upload has a uid to be counted and
     * rate-limited against; nobody is shown a sign-in screen.
     *
     * Such an account reaches this hook with no credential at all, so
     * `presentedTenant` returns null and the tenant check below refuses it —
     * every anonymous upload would fail at account creation with a message
     * about the church directory. Hence this exemption, which must come first.
     *
     * `providerData` is the discriminator rather than the absent credential,
     * and that distinction is load-bearing. A missing credential is also what a
     * *legitimate* Microsoft sign-in looks like when `idToken: true` is dropped
     * from the options above — the failure the comment there warns about — so
     * keying on its absence would turn that misconfiguration into an open door
     * instead of the loud refusal it currently is. An anonymous user is the only
     * one Firebase gives an empty `providerData`.
     *
     * These accounts get no claims: they fall through with the empty block
     * below rather than being provisioned, they hold no grant anywhere, and
     * every rule that matters asks for a screen or a program grant they cannot
     * have. What they can do is exactly what the upload endpoint does on their
     * behalf, and nothing else.
     */
    if (user.providerData.length === 0) {
      // The same empty block a first Microsoft sign-in gets, for the reason
      // given where that one is returned: the shape is always present, so no
      // reader has to special-case a missing `screens`. Every value in it is
      // false or empty, and no member document is written.
      return { customClaims: { ...DEFAULT_CLAIMS, screens: [] } };
    }

    if (event.credential?.providerId && event.credential.providerId !== MICROSOFT_PROVIDER) {
      // Microsoft is the only provider enabled on the project, so this is
      // unreachable unless someone enables another one in the console. Refusing
      // here means that turning on a provider cannot, by itself, mint accounts.
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
      // would otherwise cause — handing the servants' rota to anyone who can
      // reach Microsoft — is exactly the one worth refusing to guess about.
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

    logger.info('Provisioning a new account', {
      uid: user.uid,
      email: user.email ?? null,
    });

    /*
     * Best-effort, and deliberately not awaited into the rejection path.
     *
     * This mattered less when the profile was a display record beside a `role`
     * claim that decided everything; it matters more now, because the document
     * this writes **is** the person's permissions and nothing else is. A member
     * with no document holds no grants — which is the correct failing direction,
     * and the reason a Firestore hiccup here is still not a reason to refuse
     * somebody entry to the servants schedule. The allocation screen writes to
     * this document with `updateDoc`, which needs it to exist; if it does not,
     * signing out and back in recreates it.
     *
     * (`onUserCreated` would be the natural home for this, but firebase-functions
     * v7 ships it at runtime without type declarations, so it is not a supported
     * API to build on.)
     */
    await createMemberProfile(user.uid, user.email ?? null, user.displayName ?? null);

    /*
     * The claims a first sign-in is worth: none of them true.
     *
     * Returned rather than omitted so the block always has its shape — the
     * `screens` mirror in particular, which `storage.rules` reads with a
     * default and which `mirrorGrantsToClaims` below overwrites the moment
     * anybody is granted anything.
     */
    return { customClaims: { ...DEFAULT_CLAIMS, screens: [] } };
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

          /*
           * A display copy of the one claim, never authoritative — rules read
           * the token and never this field. It exists so the allocation list at
           * /access can say "this person is a superadmin and ticking boxes for
           * them changes nothing", which is otherwise unanswerable from a
           * browser: claims are not readable across accounts.
           *
           * Written here as `false` and by `scripts/grant-admin.mjs` when it
           * promotes somebody. If the two ever disagree the claim wins and the
           * screen is wrong, which is a cosmetic bug by construction.
           */
          superadminMirror: false,

          /*
           * Per-screen admin, every screen closed. See @spsm/shared/screens.
           *
           * Unlike the mirror above this one *is* authoritative — it is the
           * only record of which areas somebody may manage, and there is no
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
 * Mirror the screen grants into the custom claims, for `storage.rules`.
 *
 * ---------------------------------------------------------------------------
 * ## Why this function has to exist
 *
 * Firebase **Storage rules cannot read Firestore.** Firestore rules can, and
 * do — `memberScreens()` in firestore.rules reads the allocation straight off
 * the member document, so a grant is live on the grantee's next page load. A
 * bucket rule has no such option: the token is the only thing it can see.
 *
 * Without a mirror the choices for every hero image, form picture, product
 * photo and clergy portrait were "superadmin only" — which would leave the
 * person who was given Events unable to upload the photograph for the event
 * they were given — or "anybody signed in", which hands the whole bucket to
 * every account in the parish directory. Neither is what /access promises.
 *
 * So the flags are copied into a `screens` claim whenever the document changes,
 * and `storage.rules` reads that. **Nothing else may read it.** It is a lagging
 * copy by construction, and the authoritative map is the document.
 *
 * ## The lag, and who closes it
 *
 * A claim reaches a browser when the ID token refreshes — up to an hour. This
 * function runs in seconds; the token is the slow part. `useScreenGrants` in
 * the website compares the token's list against the document it has just read
 * and forces a refresh when they disagree, so in practice the person who was
 * granted an area a moment ago can upload immediately. If that comparison is
 * ever removed, this lag comes back as "the grant works everywhere except
 * pictures, for a while".
 *
 * ## Preserving `superadmin`
 *
 * `setCustomUserClaims` replaces the entire block rather than merging, so the
 * existing claims are read and spread first. Getting this wrong would demote
 * the parish's administrator the first time anybody edited their profile —
 * silently, and recoverable only by re-running `grant-admin.mjs`.
 *
 * ## Why a write-triggered function rather than a callable
 *
 * The allocation screen writes the member document directly, guarded by
 * `firestore.rules`. Routing it through a callable instead would move that
 * policy out of the rules file and into TypeScript, which is the opposite of
 * how everything else here is arranged. A trigger keeps the rules
 * authoritative and makes the mirror a consequence of the write rather than a
 * thing a caller has to remember.
 * ---------------------------------------------------------------------------
 */
export const mirrorGrantsToClaims = onDocumentWritten(
  { document: `${COLLECTIONS.members}/{uid}`, maxInstances: CAPS.claims },
  async (event) => {
    const uid = event.params['uid'];
    if (!uid) return;

    const before = screensFromGrants(parseScreenAdmin(event.data?.before?.get('screenAdmin')));
    const after = screensFromGrants(parseScreenAdmin(event.data?.after?.get('screenAdmin')));

    // Every profile edit — a phone number, a notification preference — fires
    // this. Comparing first means only an actual permission change costs a
    // `getUser` and a `setCustomUserClaims`, which are not free and which
    // invalidate nothing else about the session.
    if (before.join(',') === after.join(',')) return;

    try {
      const existing = (await getAuth().getUser(uid)).customClaims ?? {};

      // Spread, never replace. `superadmin` lives in this same block and is set
      // only by `grant-admin.mjs`; overwriting it here would demote the parish's
      // administrator as a side effect of somebody editing their own profile.
      await getAuth().setCustomUserClaims(uid, { ...existing, screens: after });

      logger.info('Mirrored screen grants into claims', { uid, screens: after });
    } catch (error) {
      /*
       * Logged and swallowed, and the failing direction is the safe one.
       *
       * A member document exists for every account, but an account can be
       * deleted while its document survives — `getUser` then throws
       * `auth/user-not-found`, and there is nothing to fix. More importantly,
       * throwing here would retry the trigger against a document whose write
       * has already committed: the Firestore grant is live either way, and only
       * the picture uploads are affected. Failing loudly would not make the
       * mirror land any sooner.
       */
      logger.error('Could not mirror screen grants into claims', { uid, error });
    }
  },
);
