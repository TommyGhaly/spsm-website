/**
 * The one field a superadmin's own delete request has to carry.
 *
 * ---------------------------------------------------------------------------
 * Shared rather than written twice, for the reason `parseLookupRequest` is: the
 * browser composes this body and a Cloud Function reads it, and a field name
 * spelled slightly differently at one of those two ends produces the most
 * confusing possible failure — a delete that is refused with a message telling
 * the person to confirm something they just confirmed.
 *
 * ## What the flag is for
 *
 * `deleteOwnAccount` used to refuse every superadmin outright: *"A superadmin
 * account cannot be deleted from the website … Ask a developer to remove it."*
 * The reasoning was lockout — `superadmin` is the claim that decides who may
 * allocate areas at /access, it is set only by `scripts/grant-admin.mjs`, and
 * an administrator deleting themselves could leave the church with nobody able
 * to appoint a replacement.
 *
 * That reasoning is sound about accidents and wrong about intent, and the
 * refusal could not tell them apart. It also produced a website where the only
 * account that exists — the parish's single superadmin — was the one account
 * that could not use the delete button, and where the button was therefore
 * hidden from the only person likely to press it.
 *
 * So the guard is now a second, explicit acknowledgement rather than a wall.
 * Without the flag the endpoint still refuses, which is what protects the
 * mis-click, the stale tab and anything replaying an old request. With it, a
 * superadmin who has read the sentence gets what they asked for.
 *
 * ## Why the lockout is survivable, stated where the guard is
 *
 * Deleting the last superadmin is recoverable without touching the database by
 * hand, and every step is one the parish already has:
 *
 *   1. sign in again — `enforceTenantOnCreate` mints a fresh account for any
 *      sign-in from the church tenant, with a new uid and no claims;
 *   2. `node scripts/grant-admin.mjs <email> --write` promotes it again;
 *   3. /access re-allocates the areas.
 *
 * Step 2 needs project credentials from a terminal, which is exactly the
 * property the original guard was protecting — it is just no longer the same
 * thing as "impossible". What is *not* recoverable is the member document's
 * area allocation, which is deleted with the account and has to be granted
 * again; the confirmation text says so.
 * ---------------------------------------------------------------------------
 */

/** The request-body field. Sent by the browser, read by the Function. */
export const CONFIRM_LOCKOUT_FIELD = 'confirmLockout';

/**
 * Whether a request body carries the acknowledgement.
 *
 * Tolerates the three shapes a body actually arrives in: the parsed object
 * (`onRequest` runs a JSON body parser for `application/json`), a raw string
 * (no content type, or a parser that declined it), and absent altogether (the
 * ordinary non-superadmin delete, which sends no body at all).
 *
 * Strictly `=== true`. A truthy `"false"`, a `1`, or an object where the key
 * merely exists must not count: this is the one gate between a mis-click and an
 * irreversible delete, and every loose comparison here is a way for something
 * that never meant to confirm to be read as confirming.
 */
export function lockoutAcknowledged(body: unknown): boolean {
  if (typeof body === 'string') {
    if (!body) return false;
    try {
      return lockoutAcknowledged(JSON.parse(body));
    } catch {
      // Not JSON. A body we cannot read is not a confirmation.
      return false;
    }
  }
  if (!body || typeof body !== 'object') return false;
  return (body as Record<string, unknown>)[CONFIRM_LOCKOUT_FIELD] === true;
}

/**
 * The refusal a superadmin gets when the flag is missing.
 *
 * Here rather than inline in the handler so the test that pins the guard can
 * assert on the same sentence the browser will show, and so the sentence says
 * what to do rather than only that something was refused.
 */
export const LOCKOUT_NOT_CONFIRMED =
  'This is a superadmin account. Confirm that you understand the church may be ' +
  'left with no administrator, and the delete will go through.';
