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
export const PRAYER_NAME_MAX_LENGTH = 100;
/** RFC 5321's limit on a whole address. */
export const PRAYER_EMAIL_MAX_LENGTH = 254;

/**
 * Shared by the client form and `firestore.rules`, so the message someone sees
 * and the constraint that actually holds cannot drift.
 *
 * Every bound here has a counterpart in the rules. The rules are the
 * enforcement — this exists so a person gets a sentence instead of a
 * permission-denied.
 */
export function validatePrayerRequest(input: PrayerRequestInput): string[] {
  const errors: string[] = [];
  const body = input.body?.trim() ?? '';
  const name = input.authorName?.trim() ?? '';
  const email = input.contactEmail?.trim() ?? '';

  if (body.length === 0) errors.push('A prayer request cannot be empty.');
  if (body.length > PRAYER_BODY_MAX_LENGTH) {
    errors.push(`Please keep requests under ${PRAYER_BODY_MAX_LENGTH} characters.`);
  }
  if (!PRAYER_VISIBILITIES.includes(input.visibility)) {
    errors.push('Choose whether this request is public or clergy-only.');
  }

  if (input.anonymous) {
    if (name) errors.push('An anonymous request cannot carry a name.');
  } else {
    // Not a formality: without a uid — and a parishioner has no account, by
    // design — a name is the only thing telling the fathers who to pray for.
    if (name.length === 0) {
      errors.push('Enter the name to pray for, or choose to send it anonymously.');
    }
    if (name.length > PRAYER_NAME_MAX_LENGTH) {
      errors.push(`Please keep the name under ${PRAYER_NAME_MAX_LENGTH} characters.`);
    }
  }

  if (email.length > PRAYER_EMAIL_MAX_LENGTH) {
    errors.push('That email address is too long.');
  }
  if (email.length > 0 && !email.includes('@')) {
    errors.push('That does not look like an email address.');
  }
  return errors;
}
