import type { AuditFields, Timestamped } from './common.js';

/**
 * Prayer requests.
 *
 * Privacy model: Firestore at-rest encryption (Open Decision #1, resolved —
 * see docs/decisions.md). Bodies are stored as plaintext in Firestore and are
 * readable by clergy, which is the point: clergy need to pray over and follow
 * up on them. Confidentiality is enforced by security rules, not cryptography.
 *
 * Two consequences worth being explicit about, because they are the whole
 * trade-off of choosing Option A:
 *   1. A Firestore admin (or anyone with the service account) can read every
 *      request. Say so plainly in the submission UI — do not imply otherwise.
 *   2. `anonymous: true` means we genuinely do not store the uid. It is not a
 *      display flag over a retained identity, so it cannot be un-anonymized
 *      later. That also means the submitter cannot edit or withdraw it.
 */
export interface PrayerRequest extends AuditFields {
  /** The request itself. Plaintext — see the note above. */
  body: string;

  /**
   * uid of the submitter, or null when submitted anonymously.
   * Enforced in rules: anonymous ⇒ must be null.
   */
  authorUid: string | null;

  /** Display name the submitter chose to attach. Null when anonymous. */
  authorName: string | null;

  /** True ⇒ `authorUid` and `authorName` are both null. Irreversible. */
  anonymous: boolean;

  /**
   * `public`  — visible to the prayer team and congregation.
   * `clergy`  — visible only to the clergy group and admins.
   */
  visibility: PrayerVisibility;

  status: PrayerStatus;

  /** Optional contact-back channel, if the submitter wants follow-up. */
  contactEmail: string | null;

  /** Set by the notification Cloud Function so it never double-sends. */
  notifiedAt: Timestamped | null;
}

export const PRAYER_VISIBILITIES = ['public', 'clergy'] as const;
export type PrayerVisibility = (typeof PRAYER_VISIBILITIES)[number];

export const PRAYER_STATUSES = ['active', 'answered', 'archived'] as const;
export type PrayerStatus = (typeof PRAYER_STATUSES)[number];

/** What a submission form is allowed to send. Everything else is server-set. */
export type PrayerRequestInput = Pick<
  PrayerRequest,
  'body' | 'visibility' | 'anonymous' | 'authorName' | 'contactEmail'
>;

export const PRAYER_BODY_MAX_LENGTH = 2000;

/**
 * Shared by the client form and the Cloud Function that accepts the write, so
 * the two can never disagree about what counts as valid.
 */
export function validatePrayerRequest(input: PrayerRequestInput): string[] {
  const errors: string[] = [];
  const body = input.body?.trim() ?? '';

  if (body.length === 0) errors.push('A prayer request cannot be empty.');
  if (body.length > PRAYER_BODY_MAX_LENGTH) {
    errors.push(`Please keep requests under ${PRAYER_BODY_MAX_LENGTH} characters.`);
  }
  if (!PRAYER_VISIBILITIES.includes(input.visibility)) {
    errors.push('Choose whether this request is public or clergy-only.');
  }
  if (input.anonymous && input.authorName) {
    errors.push('An anonymous request cannot carry a name.');
  }
  return errors;
}
