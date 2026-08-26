import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import type { SealedText } from '@spsm/shared';

/**
 * Sealing what somebody confided, so the database never holds it in the clear.
 *
 * ---------------------------------------------------------------------------
 * What this protects against, and what it does not.
 *
 * `docs/decisions.md` #1 chose plaintext-plus-rules and named the cost: "anyone
 * with the Firebase service account can read every request; so can a Firestore
 * console admin." The parish asked for that to stop being true of the database.
 *
 * **Protects against:** a Firestore console admin, a database export, a backup
 * that leaks, a mistaken `firestore.rules` edit that opens the collection, and
 * anybody who obtains read access to Firestore alone. All of them get blobs.
 *
 * **Does NOT protect against:** whoever holds the *Functions* service account,
 * or Secret Manager access. They can decrypt. That is not a flaw to be
 * apologised for — it is the direct consequence of the requirement that clergy
 * can read these, which means a key must exist somewhere a server can reach.
 * Decision #1's reasoning on that point still stands; only the storage changed.
 *
 * Say this plainly in the submission UI. Do not let a padlock imply more.
 * ---------------------------------------------------------------------------
 *
 * ## The construction
 *
 * AES-256-GCM. Authenticated, so a tampered ciphertext fails loudly at `open`
 * rather than decrypting to plausible rubbish — which matters here because the
 * thing being protected is read by a human who would have no way to tell.
 *
 * A **fresh 12-byte IV per field**, from `randomBytes`. Never a counter, never
 * derived from the document id: reusing an IV under one key with GCM is not a
 * weakness in the abstract, it leaks the XOR of the two plaintexts and destroys
 * the authentication guarantee outright. This is the single easiest way to get
 * AES-GCM wrong and it is why the IV is generated at the call site of every
 * seal, not once per request.
 */

/**
 * 32 random bytes, base64. Generate with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   npx firebase functions:secrets:set PRAYER_KEY
 *
 * **Rotating this orphans every request sealed under the old version.** Secret
 * Manager keeps old versions, so recovery means decrypting with the previous
 * one — which is why the envelope carries a version tag and why nothing here
 * silently falls back to "try the other key".
 */
export const PRAYER_KEY = defineSecret('PRAYER_KEY');

/** The only envelope this code writes. A `v2` would be added, not substituted. */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function key(): Buffer {
  const raw = PRAYER_KEY.value();
  if (!raw) {
    throw new Error(
      'PRAYER_KEY is not set. Prayer requests cannot be sealed or read. ' +
        'Set it with: npx firebase functions:secrets:set PRAYER_KEY',
    );
  }

  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== KEY_BYTES) {
    // Length is checked rather than assumed because the failure mode of a
    // short key is not an error — Node will happily throw at cipher creation
    // with a message about key length that reads like a code bug, on every
    // single submission, in production.
    throw new Error(
      `PRAYER_KEY must be ${KEY_BYTES} bytes of base64; got ${bytes.length}. ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return bytes;
}

/**
 * Plaintext in, envelope out.
 *
 * Empty and null seal to null rather than to an encrypted empty string. A
 * sealed empty value is indistinguishable from a sealed real one to anyone
 * reading the document, which sounds like a feature and is not: it means
 * "did they give a contact address?" can only be answered by decrypting, and
 * that question gets asked by code that has no business holding the key.
 */
export function seal(plaintext: string | null | undefined): SealedText | null {
  const text = (plaintext ?? '').trim();
  if (!text) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Envelope in, plaintext out — or null if it cannot be opened.
 *
 * Returns null rather than throwing, and that is deliberate. This is called in
 * a loop over a clergy member's list of requests, and one unreadable record
 * from a rotated key or a truncated write should render as "could not be read"
 * beside the others, not take down the whole page. The reason goes to the log,
 * where somebody can act on it.
 */
export function open(sealed: SealedText | null | undefined): string | null {
  if (!sealed) return null;

  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    console.error(`[prayer] unrecognised envelope (${parts[0] ?? 'empty'})`);
    return null;
  }

  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const ciphertext = Buffer.from(parts[3]!, 'base64url');

    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      console.error('[prayer] envelope has the wrong iv or tag length');
      return null;
    }

    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    /*
     * Almost always one of two things, and they are worth telling apart in the
     * log: the key has been rotated and this record predates it, or the stored
     * bytes have been altered. GCM cannot distinguish them — both surface as
     * "unable to authenticate data" — but the *count* does. One failing record
     * is corruption; every record failing at once is the key.
     */
    console.error('[prayer] could not open a sealed field', error);
    return null;
  }
}

/**
 * Whether the key is present and usable, without revealing anything about it.
 *
 * Used by the read Function to answer "is this configured?" before it walks a
 * collection, so a missing key produces one clear sentence instead of a page of
 * requests that all say "could not be read".
 */
export function sealingAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * A round-trip check, run once at submission time.
 *
 * Cheap insurance against the worst outcome this design has: sealing a
 * parishioner's request under a key that cannot open it, discovering that only
 * when a priest tries to read it, and having no plaintext left anywhere. If the
 * seal does not open, the submission is refused and the person is told to try
 * again — which is recoverable, unlike the alternative.
 */
export function sealRoundTrips(sample: string): boolean {
  try {
    const sealed = seal(sample);
    const opened = open(sealed);
    if (opened === null) return false;
    const a = Buffer.from(opened);
    const b = Buffer.from(sample);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
