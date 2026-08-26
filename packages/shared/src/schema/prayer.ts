import type { AuditFields, Timestamped } from './common.js';

/**
 * Prayer requests.
 *
 * ---------------------------------------------------------------------------
 * Privacy model: **application-level encryption**, superseding decision #1.
 *
 * `docs/decisions.md` #1 chose Option A — plaintext in Firestore, confidentiality
 * from `firestore.rules` — and said in as many words: "Revisit if the parish
 * ever wants true confidentiality. That's a schema migration, but the `body`
 * field is deliberately a single opaque string, so it's a contained one."
 *
 * The parish asked, on 2026-08-26. This is that migration, and the foresight
 * paid: `body` was already one opaque string, so it became one sealed string.
 *
 * What changed. The three fields that carry what somebody actually confided —
 * `body`, `authorName`, `contactEmail` — are now **sealed**: AES-256-GCM
 * ciphertext, keyed from Secret Manager, written and read only by Cloud
 * Functions. Firestore holds blobs. A console admin, a data export, a mistaken
 * rules edit, or a stolen database backup all yield nothing readable.
 *
 * What did NOT change, and must be said plainly rather than implied away:
 * **whoever holds the Functions service account can still decrypt.** This is
 * not end-to-end encryption. Decision #1's central objection — that clergy must
 * be able to read these, so somebody must hold a key — is still true and is
 * still the reason true E2E was not chosen. What this buys is that the *database*
 * is no longer a place where the plaintext exists.
 *
 * `anonymous: true` still means we genuinely do not store the uid. It is not a
 * display flag over a retained identity, so it cannot be un-anonymized later.
 * That also means the submitter cannot edit or withdraw it.
 * ---------------------------------------------------------------------------
 */
export interface PrayerRequest extends AuditFields {
  /**
   * The request itself, **sealed**. See `SealedText`.
   *
   * Never plaintext in the database, and never sent to a browser except by the
   * clergy read Function after it has opened it.
   */
  body: SealedText;

  /**
   * What is being asked for.
   *
   * `prayer`        — pray for someone living: illness, a journey, an exam.
   * `commemoration` — pray for someone who has died.
   *
   * Split because the two are different acts and the fathers read them at
   * different moments. Lumping a commemoration in with a request for a sick
   * child means someone has to sort them by reading each one, which is exactly
   * the work a category is for.
   */
  kind: PrayerKind;

  /**
   * When a commemoration is offered. Null for an ordinary prayer request.
   *
   * The three follow Coptic Orthodox practice rather than being invented:
   * the departed are commemorated soon after death, again on the fortieth day,
   * and thereafter each year.
   */
  commemoration: CommemorationWhen | null;

  /**
   * uid of the submitter, or null when submitted anonymously.
   * Enforced in rules: anonymous ⇒ must be null.
   */
  authorUid: string | null;

  /**
   * The name to pray for, **sealed**. Null when anonymous.
   *
   * Sealed as well as the body, because on a commemoration the name *is* the
   * sensitive part — "pray for the repose of X" tells you someone has died and
   * who, and a body that said nothing else would still be a disclosure.
   */
  authorName: SealedText | null;

  /** True ⇒ `authorUid` and `authorName` are both null. Irreversible. */
  anonymous: boolean;

  status: PrayerStatus;

  /** Optional contact-back channel, **sealed**, if the submitter wants follow-up. */
  contactEmail: SealedText | null;

  /** Set by the notification Cloud Function so it never double-sends. */
  notifiedAt: Timestamped | null;
}

/**
 * A sealed field, as stored.
 *
 * Deliberately a plain string rather than a record of iv/tag/ciphertext. The
 * envelope is self-describing — `v1.<iv>.<tag>.<ciphertext>`, all base64url —
 * which keeps a sealed field a drop-in replacement for the plaintext string it
 * replaced, and keeps the door open to a `v2` without a second migration.
 *
 * Typed as its own alias so a reviewer can see at a glance which fields are
 * sealed, and so `PrayerRequestInput` (what a browser sends, in the clear) can
 * never be mistaken for `PrayerRequest` (what the database holds).
 */
export type SealedText = string;

export const PRAYER_KINDS = ['prayer', 'commemoration'] as const;
export type PrayerKind = (typeof PRAYER_KINDS)[number];

export const COMMEMORATION_WHEN = ['recent', 'forty-days', 'annual'] as const;
export type CommemorationWhen = (typeof COMMEMORATION_WHEN)[number];

/** What each commemoration is called where a person has to read it. */
export const COMMEMORATION_LABELS: Record<CommemorationWhen, string> = {
  recent: 'Recently departed',
  'forty-days': 'Forty days',
  annual: 'Annual',
};

/*
 * There is no `visibility` field, and there never should have been.
 *
 * It offered `public` — "visible to the prayer team and congregation" — beside
 * `clergy`. **The parish has no prayer team. The priests read these, and nobody
 * else does.** So the choice was between one real audience and an audience that
 * does not exist, which is worse than no choice at all: "public" implied to a
 * parishioner that a congregation would see what they wrote.
 *
 * Removed rather than pinned to a constant. A field every record carries the
 * same value in is a question the next reader has to work out the answer to, and
 * `prayerList` would still have had to explain why it never filtered on it.
 *
 * Nothing was migrated because nothing had to be: the collection was empty when
 * this was corrected. Had it not been, this would be a backfill rather than a
 * deletion — worth knowing before reintroducing a field on the assumption it is
 * free.
 */

export const PRAYER_STATUSES = ['active', 'answered', 'archived'] as const;
export type PrayerStatus = (typeof PRAYER_STATUSES)[number];

/** What a submission form is allowed to send. Everything else is server-set. */
/**
 * What a submission form sends — in the clear, over TLS, to the Function that
 * seals it. Never written to Firestore in this shape.
 */
export interface PrayerRequestInput {
  body: string;
  anonymous: boolean;
  authorName: string | null;
  contactEmail: string | null;
  kind: PrayerKind;
  commemoration: CommemorationWhen | null;
}

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

  if (!PRAYER_KINDS.includes(input.kind)) {
    errors.push('Choose whether this is a prayer request or a commemoration.');
  }

  /*
   * The two halves have to agree, in both directions.
   *
   * A commemoration with no occasion is an unsorted commemoration, which is the
   * thing the split exists to prevent. And an ordinary prayer request carrying
   * `annual` is a record nobody can interpret — it arrived through a form that
   * never showed that question.
   */
  if (input.kind === 'commemoration') {
    if (!input.commemoration || !COMMEMORATION_WHEN.includes(input.commemoration)) {
      errors.push('Choose whether this is recently departed, forty days, or annual.');
    }
  } else if (input.commemoration !== null) {
    errors.push('Only a commemoration can carry an occasion.');
  }

  return errors;
}
