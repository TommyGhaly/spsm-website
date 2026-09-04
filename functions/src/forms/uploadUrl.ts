/**
 * The one door into `formUploads/`.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, when a browser could write to Storage on its own.
 *
 * It could, and it used to. `storage.rules` carried this:
 *
 *     allow create: if isImage()
 *       && request.resource.size < 250 * 1024 * 1024
 *       && resource == null;
 *
 * No sign-in, no grant, no count. That is the correct shape for the *feature* —
 * a parishioner attaching a photograph to a form has no account and must never
 * be asked for one — and it was survivable only because App Check enforcement
 * on Cloud Storage stood in front of it. On 2026-09-03 that enforcement had to
 * come off, because it also refused every `<img>` on the public site: an image
 * tag cannot send an `X-Firebase-AppCheck` header, so enforcing the service
 * meant no gallery photograph, clergy portrait or content picture could load
 * for anybody. The wall came down, and this rule was what stood behind it.
 *
 * So the door moved rather than closing. `storage.rules` now refuses every
 * client create under `formUploads/`, and this endpoint does the write's
 * permission thinking on the caller's behalf before handing back a v4 signed
 * URL — which addresses the GCS API directly and is never evaluated against
 * `storage.rules`, which is exactly what makes shutting that door possible
 * without shutting the feature. It is the same shape as `galleryUploadUrl`,
 * deliberately, and for the same reason.
 *
 * ## What this can check that a rule never could
 *
 * A storage rule sees one request in isolation. It cannot count, and it cannot
 * read Firestore. So three of the four things worth knowing about an upload
 * were simply unaskable:
 *
 *   1. **Is this a real browser?** App Check, verified here in code. Every
 *      Function in this codebase is `onRequest` rather than `onCall`, so the
 *      `enforceAppCheck` option does not apply and the header is read by hand —
 *      which is *why* this survives the service-level enforcement being off.
 *      Turning that setting off did not turn this off.
 *   2. **How many has this person sent today?** `FORM_UPLOAD_DAILY_PER_UID`,
 *      counted in Firestore so the total holds across instances.
 *   3. **Does the form exist, and is it still open?** A photograph attached to
 *      a form that closed last month is bytes nobody will ever look at, and
 *      `formSubmit` would refuse the submission it belongs to anyway.
 *
 * The fourth — is it an image, and how big — a rule *could* ask, and did. It is
 * asked here too, because the rule that asked it is gone.
 *
 * ## Why the object name is chosen here
 *
 * `resource == null` in the old rule is what stopped one upload overwriting
 * another. A signed URL is not evaluated against rules, so that guard does not
 * survive the move and something else has to make collisions impossible. The
 * name is minted here from `randomUUID()`, and the caller's filename is kept
 * only as a sanitised suffix — useful to staff reading a folder, never trusted.
 * A caller cannot propose a path, so a caller cannot propose to overwrite one.
 * ---------------------------------------------------------------------------
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import {
  FORM_PHOTO_MAX_BYTES,
  FORM_UPLOAD_DAILY_PER_IP,
  FORM_UPLOAD_DAILY_PER_UID,
  FORM_UPLOAD_PREFIX,
  formatBytes,
  toFormSlug,
} from '@spsm/shared';
import { BUDGETS, CAPS, callerIp, throttled } from '../rateLimit.js';
import { addressKey, countAgainst } from '../uploadQuota.js';
import { loadForm } from './loadForm.js';

/**
 * How long a signed URL is good for.
 *
 * The same five minutes `galleryUploadUrl` uses, and for the same reason: long
 * enough for a slow phone on parish wifi to finish one photograph, short enough
 * that a URL scraped from a browser's network log is worthless by the time
 * anybody looks at it. One URL is requested per file, immediately before that
 * file is sent, so this never has to cover a batch.
 */
const URL_TTL_MS = 5 * 60 * 1000;

/**
 * A filename fit to sit in a bucket, from one that came off somebody's disk.
 *
 * Deliberately not `lib/uploadNaming.ts`'s `safeName`. That one runs in the
 * browser and may therefore be skipped, so it cannot be the thing that makes a
 * name safe — this is. It keeps the same shape so a folder still reads the
 * same to staff, and it is the uuid in front of it, not this, that makes the
 * path unique.
 */
function sanitiseName(original: unknown): string {
  if (typeof original !== 'string') return 'photo';
  const cleaned = original
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-40);
  return cleaned || 'photo';
}

export const formUploadUrl = onRequest(
  { cors: false, maxInstances: CAPS.formUpload },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    /*
     * The cheapest check first, as in the gallery endpoint: a map lookup before
     * two token verifications that each cost a network call.
     */
    if (
      throttled(req, res, {
        bucket: 'formUpload',
        max: BUDGETS.formUpload,
        message: 'Too many photographs at once from here. Please wait a minute.',
      })
    ) {
      return;
    }

    /*
     * The wall, and the reason this endpoint is worth building at all.
     *
     * Verified here rather than left to service-level enforcement, which is
     * off — see the header. The 401 carries a message the browser shows
     * verbatim, because this is the one refusal with no self-service remedy: a
     * visitor with a hard privacy blocker or a very old browser fails it
     * through no fault of their own.
     */
    const appCheckToken = req.header('X-Firebase-AppCheck');
    if (!appCheckToken) {
      res.status(401).json({ error: 'unattested' });
      return;
    }
    try {
      await getAppCheck().verifyToken(appCheckToken);
    } catch {
      // Not at error level: the overwhelming majority of these are a blocked
      // third-party script, not an attack.
      console.info('[forms] refused an unattested photograph request');
      res.status(401).json({ error: 'unattested' });
      return;
    }

    /*
     * The anonymous session the browser signed in for. Nobody filling in a form
     * has an account, and nobody will be asked for one — this buys attribution
     * rather than authentication: a stable key to count a day's uploads
     * against. An anonymous uid is free to mint, which is why it is the App
     * Check token above that does the real work.
     */
    const match = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? '').trim());
    let uid: string;
    try {
      if (!match?.[1]) throw new Error('no token');
      uid = (await getAuth().verifyIdToken(match[1])).uid;
    } catch {
      res.status(401).json({ error: 'Your session has expired. Please reload the page.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestedSlug = typeof body['formSlug'] === 'string' ? body['formSlug'] : '';
    const contentType = typeof body['contentType'] === 'string' ? body['contentType'] : '';
    const byteSize = Number(body['byteSize']);

    const slug = toFormSlug(requestedSlug);
    if (!slug) {
      res.status(400).json({ error: 'That form could not be identified.' });
      return;
    }

    /*
     * Images only, and checked on the declared content type — which is also
     * what the signed URL is pinned to below, so a caller cannot declare
     * `image/jpeg` here and then PUT something else. `isImage()` in the rules
     * asked exactly this question and is gone.
     */
    if (!contentType.startsWith('image/')) {
      res.status(400).json({ error: 'That file is not a photograph.' });
      return;
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0) {
      res.status(400).json({ error: 'That file could not be read.' });
      return;
    }
    if (byteSize > FORM_PHOTO_MAX_BYTES) {
      res.status(413).json({
        error:
          `That image is ${formatBytes(byteSize)}, which is too large to send. ` +
          `Photographs have to be under ${formatBytes(FORM_PHOTO_MAX_BYTES)}.`,
      });
      return;
    }

    /*
     * The form, read here rather than trusted from the page — and the same
     * `published` check `formSubmit` makes. A form closed at noon should stop
     * accepting photographs at noon, not merely stop accepting answers; the
     * alternative is bytes in a billed bucket belonging to a submission that
     * will be refused seconds later.
     */
    const found = await loadForm(getFirestore(), slug);
    if (!found) {
      res.status(404).json({ error: 'That form could not be found.' });
      return;
    }
    if (!found.form.published) {
      res.status(409).json({
        error: found.form.closedMessage ?? 'That form is no longer accepting submissions.',
      });
      return;
    }

    /*
     * The daily counts. Both keys are prefixed `form-` so that a photograph
     * attached to a form cannot spend a gallery submission's allowance, or the
     * reverse — the two features have very different shapes and their limits
     * differ by more than a factor of ten.
     *
     * The uid one first: it is the tighter of the two and the likelier to stop
     * a runaway, and failing it costs one document rather than two.
     */
    if (!(await countAgainst(`form-uid:${uid}`, FORM_UPLOAD_DAILY_PER_UID))) {
      res.status(429).json({
        error: 'That is a great many photographs for one day. Please try again tomorrow.',
      });
      return;
    }
    if (
      !(await countAgainst(
        `form-${addressKey(callerIp(req.headers, req.ip))}`,
        FORM_UPLOAD_DAILY_PER_IP,
      ))
    ) {
      res.status(429).json({
        error: 'A great many photographs have come from this network today. Please try tomorrow.',
      });
      return;
    }

    /*
     * `found.form.slug`, never the slug off the request. They are equal in the
     * ordinary case, but `formSubmit` refuses any answer whose path does not
     * start with `formUploads/<the form's own slug>/` — so taking it from the
     * loaded document is what guarantees the photograph this hands out a URL
     * for is one that the submit step will accept.
     */
    const path = `${FORM_UPLOAD_PREFIX}/${found.form.slug}/${randomUUID()}-${sanitiseName(body['fileName'])}`;

    /*
     * A download token, minted here and pinned into the URL as a signed
     * extension header the browser must echo.
     *
     * Without it the staff submissions panel cannot show the photograph at all.
     * `readFormPhotoUrl` uses `getDownloadURL`, which needs this metadata key
     * and returns a 404 on a file that demonstrably exists when it is missing —
     * the trap `galleries.ts` warns about in `withDownloadToken`. The SDK set
     * it automatically on every upload; a raw PUT to a signed URL does not, so
     * it has to be carried explicitly.
     *
     * GCS lowercases the metadata key to `firebasestoragedownloadtokens`, and
     * Firebase reads it back case-insensitively — verified against the live
     * bucket rather than assumed, because the casing looks like it should
     * matter and does not.
     *
     * This is not a secret worth guarding here: the token only ever unlocks a
     * file the person sending it just chose off their own disk.
     */
    const downloadToken = randomUUID();

    /*
     * v4, and pinned four ways: to this one object name, to the content type
     * the size was checked against, to a content length that must match what
     * was declared, and to the token above. Without the length pin the URL
     * would be a five-minute licence to upload a file of any size, which would
     * make every check above decorative.
     *
     * Needs `roles/iam.serviceAccountTokenCreator` on the Functions runtime
     * service account, exactly as `galleryUploadUrl` does. It is already
     * granted — docs/gallery-console-setup.md §5 — and one grant covers both.
     */
    const [uploadUrl] = await getStorage()
      .bucket()
      .file(path)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + URL_TTL_MS,
        contentType,
        extensionHeaders: {
          'x-goog-content-length-range': `${byteSize},${byteSize}`,
          'x-goog-meta-firebaseStorageDownloadTokens': downloadToken,
        },
      });

    /*
     * The path, not a URL, and that asymmetry with the gallery is deliberate:
     * `formUploads/` is unreadable to the person who just wrote to it, which is
     * the point of the quarantine. The submission records the path; the staff
     * panel resolves it when somebody reviews it.
     */
    res.status(200).json({
      uploadUrl,
      path,
      contentType,
      downloadToken,
      expiresAt: Timestamp.fromMillis(Date.now() + URL_TTL_MS).toMillis(),
    });
  },
);
