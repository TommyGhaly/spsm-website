import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@spsm/shared';
import { callerOf } from './httpAuth.js';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';

/**
 * A servant deleting their own account.
 *
 * ---------------------------------------------------------------------------
 * Why this is a Function and not a client call plus a rule.
 *
 * `firebase/auth` has `deleteUser()`, and a signed-in user may call it on
 * themselves — so the auth half of this could be done in the browser. The
 * Firestore half cannot: `members/{uid}` is the document that says which areas
 * somebody administers, and no rule grants a member `delete` on their own
 * member document. Giving them one would be the wrong shape of permission to
 * introduce for this — a member document is the parish's record of an
 * allocation, not the member's property, and a rule that let one be deleted
 * from a browser is a rule that lets a compromised session erase the audit of
 * what it was allowed to do.
 *
 * So both halves happen here, with the Admin SDK, in one order, behind one
 * verified token.
 *
 * ## The order is fail-closed, and it is the only defensible one
 *
 * The member document goes first, then the auth user.
 *
 * Interrupted between the two, that leaves an account that can still sign in
 * and holds no areas — a person with less access than they started with, which
 * is the safe side of the failure. The other order leaves the opposite: no way
 * to sign in, and a live `members/{uid}` document still granting every area it
 * granted before. Firebase never reuses a uid, so nothing can inherit that
 * grant, but it is still a stale allocation sitting in the collection /access
 * reads, and the person it belonged to cannot sign in to notice.
 *
 * ## What is deleted, and what deliberately is not
 *
 * Deleted: the Firebase Auth user, and `members/{uid}` — which is the whole of
 * what this site knows as an account. Deleting the member document also fires
 * `mirrorGrantsToClaims`, so the `screens` claim that `storage.rules` reads is
 * cleared by the same write rather than by a second step here.
 *
 * Kept: every `updatedBy` on everything they ever edited, and `reviewedBy` on
 * gallery items they approved. Those are an audit trail, not profile data —
 * they record that a change was made by somebody rather than describing a
 * person, and clearing them would quietly rewrite the history of who published
 * what. A parish that cannot answer "who put this on the website" has lost
 * something it needs more than the departed servant needs the field blanked.
 *
 * Untouched: their Microsoft account. This site does not own it and cannot
 * delete it — the church's M365 tenant does, and offboarding there is a
 * different job done by a different person.
 *
 * ## Deleting is not a ban
 *
 * `enforceTenantOnCreate` mints an account for any sign-in from the parish
 * tenant, so somebody who deletes their account and then signs in again gets a
 * new one, with a new uid and no areas at all. That is the intended behaviour
 * and it is what the confirmation text in the account menu says: this removes
 * you and your allocations, it does not lock you out of the church tenant.
 * Anyone who needs to be genuinely locked out is removed in Entra.
 * ---------------------------------------------------------------------------
 */
export const deleteOwnAccount = onRequest(
  { cors: false, maxInstances: CAPS.accountDelete },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — same arrangement as every
    // other authenticated endpoint here. See rateLimit.ts.
    if (throttled(req, res, { bucket: 'account-delete:address', max: BUDGETS.adminAddress })) {
      return;
    }

    const caller = await callerOf(req);
    if (!caller) {
      res.status(401).json({ error: 'Sign in again and retry.' });
      return;
    }

    /*
     * The uid gate. Tight, because deleting an account is idempotent in effect
     * but not in cost: a retry loop on a token that has already had its user
     * removed would otherwise keep verifying and keep writing.
     */
    if (
      throttled(req, res, {
        bucket: 'account-delete:uid',
        identity: caller.uid,
        max: BUDGETS.accountDelete,
      })
    ) {
      return;
    }

    /*
     * A superadmin may not delete themselves here, and this is a lockout guard
     * rather than a permission check.
     *
     * `superadmin` is a custom claim set by `scripts/grant-admin.mjs`, which
     * needs project credentials to run. It is the claim that /access reads to
     * decide who may allocate areas to anybody — so an administrator who
     * deleted their own account through the website could remove the last
     * person able to grant that claim to a replacement, and the way back is a
     * developer with a service account rather than anything the parish can do
     * on a Sunday.
     *
     * Not conditioned on being the *last* superadmin, deliberately. Counting
     * them means paginating every user in the project and reading their claims,
     * which is a slow and rate-limited call to make a destructive decision
     * against — and the answer would be a race the moment two administrators
     * did this at once. Refusing all of them is one sentence to read and has no
     * failure mode; there are a very small number of these accounts and the
     * remedy is the script that made them.
     */
    if (caller.superadmin) {
      res.status(409).json({
        error:
          'A superadmin account cannot be deleted from the website, so the church cannot ' +
          'lose its last administrator by accident. Ask a developer to remove it.',
      });
      return;
    }

    const members = getFirestore().collection(COLLECTIONS.members).doc(caller.uid);

    try {
      /*
       * `delete()` on a document that is not there succeeds and writes nothing,
       * which is what we want: the parish's first accounts predate the members
       * collection, and a servant who has never been allocated an area may have
       * no document at all. That is not a reason to refuse to delete them.
       */
      await members.delete();
    } catch (error) {
      // The member document is the half that must not be skipped — stop here
      // rather than deleting the auth user and stranding the grant.
      console.error('[account] could not delete the member document', {
        uid: caller.uid,
        error,
      });
      res.status(500).json({ error: 'The account could not be deleted. Please try again.' });
      return;
    }

    try {
      await getAuth().deleteUser(caller.uid);
    } catch (error) {
      /*
       * The member document is already gone, so the caller holds no areas
       * whatever happens next. Reported as a failure anyway: they asked for the
       * account to be removed and it is still there, and telling them it worked
       * would leave them believing something untrue about their own account.
       */
      console.error('[account] deleted the member document but not the auth user', {
        uid: caller.uid,
        error,
      });
      res.status(500).json({
        error:
          'Your permissions were removed but the account itself could not be deleted. ' +
          'Contact the church office.',
      });
      return;
    }

    // Logged without the email. A deletion is worth a record, and the uid is
    // the part that identifies it in every other log line; the address would
    // put a departed person's contact detail in Cloud Logging for 30 days.
    console.info('[account] deleted an account at its owner’s request', { uid: caller.uid });

    res.status(200).json({ ok: true });
  },
);
