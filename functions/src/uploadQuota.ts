/**
 * The daily counter behind every anonymous upload on the site.
 *
 * ---------------------------------------------------------------------------
 * Two endpoints hand out signed upload URLs to strangers — `galleryUploadUrl`
 * for a photograph sent to a ministry gallery, and `formUploadUrl` for one
 * attached to a form — and both need the same thing: a total that holds across
 * instances.
 *
 * This lived inside `galleries/uploadUrl.ts` until the second endpoint existed.
 * It is here rather than copied because the two must agree about what a day is
 * and what a key looks like; a quota that resets at a different hour in one of
 * them is a quota with a hole in it, and nothing would ever have surfaced that.
 *
 * ## Why this and not `throttled()`
 *
 * `rateLimit.ts` is a per-instance `Map`, so its true allowance is the budget
 * times `maxInstances`. It runs first anyway, because it costs a map lookup and
 * the token verifications cost network calls — but it cannot bound a day. This
 * can, because Firestore is shared.
 *
 * Neither key is a strong identity. An anonymous uid is free to mint and
 * `x-forwarded-for` is forgeable, so this bounds the accident and the lazy
 * abuser rather than the determined one. App Check is the wall; this is what
 * stops a script that has one from emptying the parish's budget overnight.
 * ---------------------------------------------------------------------------
 */
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { COLLECTIONS } from '@spsm/shared';

/**
 * The submitter's address, hashed.
 *
 * Stored rather than the address itself because a quota document would
 * otherwise be a log of who visited which gallery and when — personal data the
 * site does not otherwise keep, and `/privacy` names the file behind every
 * claim it makes, so keeping it would mean changing that page. A hash counts
 * just as well and answers no question about anybody.
 *
 * Not salted, and it does not need to be: this is not protecting the address
 * from us, it is avoiding storing it. Anyone with the database already has the
 * request logs.
 */
export function addressKey(ip: string): string {
  return `ip:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`;
}

/** The day a quota resets on, in UTC. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Count one upload against a key, or refuse.
 *
 * A transaction because two photographs from the same batch land within
 * milliseconds of each other and a read-then-write would lose one of the
 * increments — which sounds harmless until it is the mechanism a flood uses to
 * stay under the cap. Resets by comparing the stored day rather than by any
 * scheduled job; a document nobody touches for a year simply reads as stale on
 * the next attempt.
 *
 * @param key already namespaced by its caller — `uid:…`, or `addressKey()`.
 *   Callers that want separate allowances for separate features must prefix it
 *   further, which is what `formUploadUrl` does; sharing a key would let a
 *   form attachment spend a gallery submission's budget.
 */
export async function countAgainst(key: string, limit: number): Promise<boolean> {
  const reference = getFirestore().collection(COLLECTIONS.submissionQuota).doc(key);
  const day = today();

  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const stored = snapshot.exists ? snapshot.data() : null;
    const count = stored?.['day'] === day ? Number(stored['count'] ?? 0) : 0;

    if (count >= limit) return false;

    transaction.set(
      reference,
      { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return true;
  });
}
