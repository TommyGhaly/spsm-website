/**
 * The one door into a gallery submission.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, when a browser could write to Storage on its own.
 *
 * It could, and it used to. `submitOne` uploaded the bytes with the client SDK
 * and then wrote the `galleryMedia` document, in that order and deliberately —
 * a document without a file behind it is worse than a file without a document.
 *
 * That ordering is also the hole this Function closes. A script that uploaded
 * bytes and simply never wrote the document skipped **every** control the
 * project had, because all of them lived in `firestore.rules`: the program
 * check, the `submissionsOpen` flag, the field literals. The orphaned objects
 * never appeared in the review queue, so nobody would have noticed them; they
 * would have sat in a billed bucket until the 120-day lifecycle rule.
 *
 * There is no rule that fixes this, because the two writes are to two different
 * services and only one of them was ever guarded. So: browsers no longer write
 * to either. `storage.rules` refuses every client write to `submissions/`,
 * `firestore.rules` refuses every client create of `galleryMedia`, and this
 * endpoint does both on the caller's behalf after deciding they may.
 *
 * ## Three layers, because none of them is sufficient alone
 *
 *   1. **App Check** is the wall. `rateLimit.ts` says so itself in its header —
 *      "the real defence against a sustained flood is App Check… enforcing an
 *      App Check token there is the next step, not a bigger map" — and this is
 *      the endpoint that needed it. It is the only thing here that a determined
 *      script cannot walk around, because it cannot mint a reCAPTCHA
 *      Enterprise assessment without a real browser.
 *   2. **`throttled()`** is a speed bump, and honest about being one: its window
 *      is a per-instance `Map`, so its true allowance is the budget times
 *      `maxInstances`. It runs first anyway, because it costs a map lookup and
 *      the two token verifications below cost network calls.
 *   3. **The daily quota** in Firestore is what actually binds a total, because
 *      it is shared across instances. It is keyed on both the uid and the
 *      address, and neither is a strong identity — an anonymous uid is free to
 *      mint and `x-forwarded-for` is forgeable. It bounds the accident and the
 *      lazy abuser; layer 1 handles the rest.
 *
 * ## What it deliberately does not do
 *
 * It never touches the photograph. The bytes go from the browser straight to
 * the bucket over a signed URL, which is why this can run at 256MiB and why a
 * batch of sixty pictures costs sixty cheap calls rather than sixty transfers.
 *
 * It does not decide whether an upload is *good*. Everything it admits is
 * `status: 'pending'` and invisible to the public until somebody holding the
 * program's grant approves it in the queue. This is a cost and abuse boundary,
 * not a moderation one.
 * ---------------------------------------------------------------------------
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  COLLECTIONS,
  DEFAULT_FOCAL,
  DAILY_LIMIT_PER_IP,
  DAILY_LIMIT_PER_UID,
  canAdminProgram,
  mediaKindForContentType,
  submissionObjectPath,
  formatBytes,
  maxBytesFor,
  parseProgramAdmin,
  type Program,
} from '@spsm/shared';
import { BUDGETS, CAPS, callerIp, throttled } from '../rateLimit.js';
import { addressKey, countAgainst } from '../uploadQuota.js';

/**
 * How long a signed URL is good for.
 *
 * Long enough for a slow phone on parish wifi to finish one photograph, short
 * enough that a URL scraped from a browser's network log is worthless by the
 * time anybody looks at it. The browser requests one URL per file immediately
 * before sending that file, so this never has to cover a whole batch.
 */
const URL_TTL_MS = 5 * 60 * 1000;

/** The bucket, resolved once. */
function bucket() {
  return getStorage().bucket();
}

export const galleryUploadUrl = onRequest(
  { cors: false, maxInstances: CAPS.galleryUpload },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }

    /*
     * Layer 2, first, because it is the cheapest thing here. Sixty per minute
     * per address: a batch is sixty files and one call is made per file, so a
     * person emptying a camp's worth of photographs must not trip it halfway
     * through their own upload.
     */
    if (
      throttled(req, res, {
        bucket: 'galleryUpload',
        max: BUDGETS.galleryUpload,
        message: 'Too many photographs at once from here. Please wait a minute.',
      })
    ) {
      return;
    }

    /*
     * Layer 1. Before any Firestore read, so a flood of unattested requests
     * costs two token verifications and nothing billed per-document.
     *
     * This is the first App Check verification in this codebase. Every Function
     * here is `onRequest` rather than `onCall`, so the `enforceAppCheck: true`
     * option does not apply and the header has to be read by hand.
     *
     * The 401 is answered with a message the browser shows verbatim, because
     * this is the one refusal in the feature with no self-service remedy: a
     * visitor with a hard privacy blocker, a very old browser, or Tor will fail
     * here through no fault of their own, and enforcement cannot be selective.
     * Leaving them at "upload failed" would be the cruellest error on the site.
     */
    const appCheckToken = req.header('X-Firebase-AppCheck');
    if (!appCheckToken) {
      res.status(401).json({ error: 'unattested' });
      return;
    }
    try {
      await getAppCheck().verifyToken(appCheckToken);
    } catch {
      // Not logged with the token, and not at error level: the overwhelming
      // majority of these are a blocked third-party script, not an attack.
      console.info('[gallery] refused an unattested upload request');
      res.status(401).json({ error: 'unattested' });
      return;
    }

    /*
     * The anonymous session the browser signed in for. `checkRevoked` is left
     * off here, unlike `callerOf`: that helper guards refunds and account
     * deletion, where a token minted before somebody was removed from the
     * parish is worth a billed read to catch. This token belongs to an
     * anonymous account that holds nothing to revoke.
     */
    const header = String(req.headers.authorization ?? '');
    const match = /^Bearer (.+)$/.exec(header.trim());
    let uid: string;
    let superadmin = false;
    try {
      if (!match?.[1]) throw new Error('no token');
      const decoded = await getAuth().verifyIdToken(match[1]);
      uid = decoded.uid;
      superadmin = decoded['superadmin'] === true;
    } catch {
      res.status(401).json({ error: 'Your session has expired. Please reload the page.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const programId = typeof body['programId'] === 'string' ? body['programId'] : '';
    const programEventId =
      typeof body['programEventId'] === 'string' ? body['programEventId'] : '';
    const contentType = typeof body['contentType'] === 'string' ? body['contentType'] : '';
    const byteSize = Number(body['byteSize']);

    if (!programId || !programEventId) {
      res.status(400).json({ error: 'That gallery could not be identified.' });
      return;
    }
    const kind = mediaKindForContentType(contentType);
    if (!kind) {
      res.status(400).json({ error: 'That file is not a photograph or a video.' });
      return;
    }
    if (!Number.isFinite(byteSize) || byteSize <= 0) {
      res.status(400).json({ error: 'That file could not be read.' });
      return;
    }

    const db = getFirestore();

    /*
     * Whether this caller is the program's own administrator — decided here,
     * from a verified token and their member document, and never from anything
     * the request said about itself. The browser makes the same decision to
     * choose whether to downscale, but `useProgramAdmin` says in its own header
     * that it decides what to *draw*; this decides what is allowed.
     *
     * `canAdminProgram` is the shared predicate `firestore.rules` mirrors, so
     * an administrator refused here would be refused there too.
     */
    let isProgramAdmin = superadmin;
    if (!isProgramAdmin) {
      const member = await db.collection(COLLECTIONS.members).doc(uid).get();
      isProgramAdmin = canAdminProgram(
        { superadmin },
        parseProgramAdmin(member.get('programAdmin')),
        programId,
      );
    }

    /*
     * Layer 3, skipped for administrators. Both keys are checked, and the uid
     * one first: it is the tighter of the two and the likelier to stop a
     * runaway, and failing it costs one document rather than two.
     */
    if (!isProgramAdmin) {
      if (!(await countAgainst(`uid:${uid}`, DAILY_LIMIT_PER_UID))) {
        res.status(429).json({
          error: 'That is a great many photographs for one day. Please try again tomorrow.',
        });
        return;
      }
      if (!(await countAgainst(addressKey(callerIp(req.headers, req.ip)), DAILY_LIMIT_PER_IP))) {
        res.status(429).json({
          error: 'A great many photographs have come from this network today. Please try tomorrow.',
        });
        return;
      }
    }

    /*
     * The size bound. A photograph's is a script guard rather than a limit —
     * the browser condenses instead of refusing, and no real picture survives
     * that ladder anywhere near the ceiling. A video's is the one real size
     * limit left on the site, because a browser cannot re-encode one, so its
     * message names the actual number.
     */
    const ceiling = maxBytesFor(kind, isProgramAdmin);
    if (byteSize > ceiling) {
      res.status(413).json({
        error:
          kind === 'video'
            ? `That clip is ${formatBytes(byteSize)}. Videos have to be under ${formatBytes(ceiling)} — a photograph can be any size, but a video cannot be made smaller in a web browser.`
            : 'That photograph could not be prepared for sending. Please try another.',
      });
      return;
    }

    /*
     * The program, read here rather than trusted from the page. The browser's
     * copy may be minutes old and `submissionsOpen` is the flag a program lead
     * turns off when the parish has finished collecting; a stale `true` used to
     * mean the upload succeeded and the document write then failed, leaving the
     * file stored and the submission lost. Absent means open, matching what the
     * rule used to say.
     */
    const programSnapshot = await db.collection(COLLECTIONS.programs).doc(programId).get();
    if (!programSnapshot.exists) {
      res.status(404).json({ error: 'That ministry could not be found.' });
      return;
    }
    if ((programSnapshot.data() as Program).submissionsOpen === false) {
      res.status(409).json({ error: 'This gallery has stopped taking photographs.' });
      return;
    }

    /*
     * The level, when it is not the ministry itself. A submitter now chooses
     * where a photograph belongs, which need not be the page they are standing
     * on, so the claim has to be checked: an occurrence belonging to a
     * different ministry would file a stranger's picture where that ministry's
     * administrators would never be shown it.
     */
    if (programEventId !== programId) {
      const level = await db.collection(COLLECTIONS.programEvents).doc(programEventId).get();
      if (!level.exists || level.get('programId') !== programId) {
        res.status(400).json({ error: 'That gallery could not be identified.' });
        return;
      }
    }

    const mediaId = db.collection(COLLECTIONS.galleryMedia).doc().id;
    const sourcePath = submissionObjectPath(programEventId, mediaId, contentType);

    /*
     * The document, written with the Admin SDK because no client may create one
     * any more. The field set is exactly what `submit.ts` used to write and what
     * the deleted `firestore.rules` create block used to check field by field —
     * that rule is gone, so this is now the only thing holding the shape, which
     * is why it is spelled out in full rather than spread from a partial.
     */
    await db
      .collection(COLLECTIONS.galleryMedia)
      .doc(mediaId)
      .set({
        programId,
        programEventId,
        // Legacy, and null forever: the third level is a `programEvents`
        // document of its own now.
        groupId: null,

        kind,
        /*
         * Pending for everybody, including the ministry's own administrator.
         *
         * Their photographs do not wait for a queue, but the waving-through
         * happens at the *end* of the pipeline rather than here — see
         * `autoApproveBy` below and the long note on it in the schema. Writing
         * `approved` at this point would skip the transcode and strand the
         * document with no file the sweep could see.
         */
        status: 'pending',

        sourcePath,
        /*
         * False until the bytes actually arrive.
         *
         * This is the seam the signed URL opens: the document is written when
         * the URL is issued, but the upload happens afterwards and may never
         * happen at all — a dropped connection, a closed tab, or a script that
         * asks for URLs it never uses. `onGalleryMediaCreated` flips it true
         * when it has read the file, and the sweep in `orphans.ts` deletes
         * anything still false an hour later, so a reviewer never meets a row
         * with nothing behind it.
         */
        sourceUploaded: false,

        renditionPath: null,
        previewPath: null,
        posterPath: null,

        width: null,
        height: null,
        durationSeconds: null,

        caption: '',
        focal: DEFAULT_FOCAL,
        placement: { onPage: false, slideshow: false, homepage: false },
        layout: null,
        order: 0,

        submittedAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,

        /*
         * The one thing on this document that says "this photograph belongs to
         * somebody who did not need to be asked".
         *
         * `isProgramAdmin` was decided above from a verified ID token and the
         * caller's own member document — the same predicate `firestore.rules`
         * would use to let them approve it by hand a moment later. Waving it
         * through here saves them the second act, and nothing is granted that
         * they did not already hold.
         *
         * The uid rather than a boolean, because `reviewedBy` has to name
         * somebody when the Function publishes it, and "the parish's data says
         * a person approved this" must stay true.
         */
        autoApproveBy: isProgramAdmin ? uid : null,

        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        /*
         * Null for a stranger even though there is a uid. `AuditFields` reads
         * this as "a person did this", and an anonymous session is a browser,
         * not a person — putting a uid nobody can look up into an audit field
         * would make the queue claim to know who sent a photograph when it does
         * not.
         *
         * An administrator's uid *is* a person, and one the parish can look up,
         * so theirs is recorded.
         */
        updatedBy: isProgramAdmin ? uid : null,
      });

    /*
     * The signed URL, last, so nothing hands out an upload slot for a
     * submission that then fails to record.
     *
     * v4, and pinned three ways: to this one object name, to the content type
     * the size was checked against, and — through `extensionHeaders` — to a
     * content length that must match what was declared. Without the last of
     * these the URL would be a five-minute licence to upload a file of any
     * size, which would make every check above decorative.
     *
     * This needs `roles/iam.serviceAccountTokenCreator` on the Functions
     * runtime service account. It creates no key; it lets the account sign as
     * itself. See docs/gallery-console-setup.md — without the grant this line
     * throws at runtime and every upload fails.
     */
    const [uploadUrl] = await bucket()
      .file(sourcePath)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + URL_TTL_MS,
        contentType,
        extensionHeaders: { 'x-goog-content-length-range': `${byteSize},${byteSize}` },
      });

    res.status(200).json({
      uploadUrl,
      mediaId,
      sourcePath,
      contentType,
      expiresAt: Timestamp.fromMillis(Date.now() + URL_TTL_MS).toMillis(),
    });
  },
);
