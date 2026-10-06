/**
 * The half of program galleries that cannot run in a browser.
 *
 * A parishioner uploads a photograph straight off a phone. That file is
 * routinely 12MB, frequently rotated by an EXIF tag rather than by its pixels,
 * and — on any iPhone since 2017 — HEIC, which no browser on earth can decode.
 * None of that is displayable, and none of it can be fixed on the client: the
 * uploader has no account, so nothing they run is trusted, and asking a
 * grandmother with forty camp photographs to convert them first is the same as
 * not collecting them.
 *
 * So there are two triggers here, and the split between them is the whole
 * design:
 *
 *   onGalleryMediaCreated   transcode into a viewable rendition, kept PRIVATE
 *   onGalleryMediaReviewed  copy it into the public bucket, or take it down
 *
 * ## Why the transcode happens on submission rather than on approval
 *
 * The schema's original note said the rendition was "written by the transcode
 * Function on approval", and building it that way leaves the approval queue
 * with nothing to show. An administrator must look at a photograph before
 * approving it, and `sourcePath` is unviewable twice over — it lives under
 * `submissions/`, which no unauthenticated URL may read, and it is very often
 * HEIC regardless. The queue would have been a list of filenames.
 *
 * Transcoding first fixes that and costs nothing extra: the work happens once
 * either way, and doing it early means approval is a byte copy rather than a
 * re-decode. It also makes the guarantee exact — the bytes an administrator
 * looked at are, byte for byte, the bytes that get published.
 *
 * The rendition stays inside `submissions/` until approved, so it is staff-
 * readable and world-unreadable, exactly like the original beside it. Nothing
 * reaches `galleries/` — the world-readable prefix — until somebody says so.
 *
 * ## Region
 *
 * `us-east1`, unlike the Square and auth functions, which are in `us-central1`.
 * That is not a preference: a v2 Firestore trigger must be deployed in the same
 * region as the database, and `spsm-database` is `us-east1`. Deploying these to
 * us-central1 fails at deploy time with a region mismatch, which is at least
 * loud — the reverse mistake, moving the others here, would be silent and
 * pointless. The bucket is US-EAST1 too, so the bytes never leave the region.
 */
import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { CAPS } from './rateLimit.js';
import { announceGallerySubmission } from './notify/triggers.js';
import { getStorage } from 'firebase-admin/storage';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  COLLECTIONS,
  isAlreadyWebReady,
  PHOTO_MAX_EDGE,
  PHOTO_QUALITY,
  type GalleryMedia,
} from '@spsm/shared';

/** See the note at the top — this must match the Firestore database's region. */
const REGION = 'us-east1';

/**
 * 1GiB and five minutes, and the memory figure has moved twice for the same
 * reason both times: what `sharp` has to hold, not what arrives.
 *
 * It was 1GiB for a 12MB HEIC off a phone, then 512MiB once the browser started
 * downscaling first, and it is 1GiB again now. `sharp` decodes to uncompressed
 * pixels — four bytes each — so the number that matters is the *pixel count* of
 * the largest thing that can reach here, and that is `ADMIN_MAX_BYTES` worth of
 * camera original rather than the few hundred kilobytes a parishioner's browser
 * sends. A 50-megapixel photograph is 200MB decoded, plus the encoder's own
 * working set, and 512MiB is a coin-toss on it.
 *
 * The failure it buys off is a bad one and a quiet one: an out-of-memory kill
 * leaves the submission pending with no preview and nothing on screen that
 * explains why, which is indistinguishable from a file `sharp` could not read.
 *
 * The pass itself stays, and deliberately. A canvas re-encode in the browser
 * does drop EXIF — including the GPS tag on a photograph of somebody's child —
 * but we cannot *know* it ran, because anyone can call the upload endpoint
 * without running our JavaScript. `alreadyWebReady` below is how that is turned
 * from an assumption into a test, and `.rotate()` stays load-bearing for
 * everything that fails it.
 */
const RUNTIME = {
  region: REGION,
  memory: '1GiB' as const,
  timeoutSeconds: 300,
  /*
   * The cap with the largest bill behind it: one 1GiB instance per photograph,
   * for up to five minutes each, and a batch of forty arrives as forty
   * documents within a minute or two of each other.
   *
   * Meeting it costs a queue rather than a failure. A Firestore trigger that is
   * shed is retried, so the fortieth photograph is transcoded a little later
   * and the submitter sees nothing different — the queue on /events is a review
   * queue, and a rendition arriving a minute after its row does not change what
   * an administrator does with it.
   */
  maxInstances: CAPS.transcode,
};

/**
 * The long edge of a web rendition, in pixels.
 *
 * Imported rather than written here, and that is the point: the browser now
 * downscales to the same number before uploading, so this file and
 * `submissionLimits.ts` disagreeing would mean the server quietly shrinking
 * every submitted photograph a second time and charging a second lossy pass
 * for it. One number, one place.
 *
 * It was 2000, then 2560, and is 3840 since 2026-09-05 — see the note on
 * `PHOTO_MAX_EDGE` itself for why. The short version is that a phone photograph
 * is 4032px on its long edge and a gallery exists to be opened full-screen, so
 * every step down here was detail thrown away at precisely the moment somebody
 * went looking for it.
 */
const MAX_EDGE = PHOTO_MAX_EDGE;

/**
 * A photograph the parish will serve for years, weighed against a bill.
 *
 * Every browser the parish's visitors use has supported WebP since 2020. There
 * is deliberately no JPEG fallback: maintaining two renditions doubles the
 * storage to serve a browser share that rounds to zero.
 *
 * The claim that used to be here — "82 is visually indistinguishable from the
 * original" — is the one this file got wrong. It is true of a single pass at
 * article width and false of two passes viewed full-screen, which is what the
 * pipeline actually did and what the gallery actually does. Both halves of that
 * are fixed: the number is `PHOTO_QUALITY` and the second pass is gone.
 */
const WEBP_QUALITY = PHOTO_QUALITY;

/**
 * Make a Firebase download token so the approval queue can display this object.
 *
 * The public gallery builds unauthenticated `?alt=media` URLs and needs no
 * token — see `packages/shared/src/gallery/urls.ts`. A preview cannot do that,
 * because the whole point is that it is *not* world-readable, so the queue uses
 * `getDownloadURL()` instead. That call only works when the object carries this
 * metadata, and an object written by the Admin SDK does not have it unless it
 * is set here. Omitting it produces a 404 from `getDownloadURL` on a file that
 * demonstrably exists, which is a miserable thing to debug.
 */
function withDownloadToken(contentType: string) {
  return {
    contentType,
    metadata: { firebaseStorageDownloadTokens: randomUUID() },
  };
}

/**
 * Where a rendition lives while it is still in quarantine.
 *
 * Under the same `submissions/{programEventId}/` prefix as the original, so one
 * lifecycle rule covers both and a rejected submission leaves nothing behind
 * anywhere else. Named by media id rather than by the uploaded filename —
 * two people submitting `IMG_0042.HEIC` from the same camp is not a rare
 * coincidence, it is the normal case.
 */
function previewPathFor(programEventId: string, mediaId: string): string {
  return `submissions/${programEventId}/preview-${mediaId}.webp`;
}

/** Where it lives once an administrator has approved it. World-readable. */
function renditionPathFor(programEventId: string, mediaId: string, extension: string): string {
  return `galleries/${programEventId}/${mediaId}.${extension}`;
}

/**
 * Build the viewable rendition for a freshly submitted photograph.
 *
 * Videos are passed over rather than transcoded, and that is a scope decision
 * worth stating plainly: re-encoding video needs ffmpeg, a much larger
 * container, and a poster-frame extraction step. Until that exists a clip is
 * published as it arrived — which works, because the browsers that matter play
 * H.264 MP4 directly — and `posterPath` stays null, so the grid shows it
 * without a still. A clip in a format a browser cannot play will not play.
 * That is a real limitation, not an oversight; it is written down here so the
 * next person does not go looking for the video path.
 */
export const onGalleryMediaCreated = onObjectFinalized(
  RUNTIME,
  async (event) => {
    const objectName = event.data.name;

    /*
     * This is a Storage trigger and not, as it once was, a Firestore one.
     *
     * It fired on the creation of the `galleryMedia` document, which worked for
     * exactly as long as the browser wrote the file first and the document
     * second. Uploads now go through `galleryUploadUrl`, which writes the
     * document when it issues the signed URL — *before* any bytes exist — so
     * the old trigger would have raced the upload and lost it every single
     * time, downloading a path with nothing behind it and swallowing the error.
     *
     * Keying on the object's arrival instead makes the ordering unracebale:
     * there is a file by definition when this runs. The media id is recoverable
     * because the endpoint names the object after it.
     */
    if (!objectName?.startsWith('submissions/')) return;

    const fileName = objectName.slice(objectName.lastIndexOf('/') + 1);

    // Our own output, landing under the same prefix so that one lifecycle rule
    // covers both. Without this the preview would re-trigger this function.
    if (fileName.startsWith('preview-')) return;

    const mediaId = fileName.slice(0, fileName.lastIndexOf('.')) || fileName;
    const reference = getFirestore().collection(COLLECTIONS.galleryMedia).doc(mediaId);
    const snapshot = await reference.get();

    /*
     * No document means the object was not put there by the endpoint. That is
     * not reachable while `storage.rules` refuses every client write to this
     * prefix, but it costs one read to be certain, and the alternative is
     * transcoding whatever anybody manages to place in the bucket.
     */
    if (!snapshot.exists) return;

    const media = snapshot.data() as GalleryMedia;

    // Only ever the anonymous submission path. A document created by an
    // administrator, or one restored from a backup with its rendition already
    // set, has nothing to do here.
    if (media.status !== 'pending' || media.previewPath) return;

    const bucket = getStorage().bucket();

    /*
     * The bytes are here, whatever else happens below. Recorded before the
     * transcode rather than after it so that a photograph sharp cannot decode
     * is still not an orphan — it has a real file behind it and belongs in the
     * queue for somebody to look at and reject, which is precisely what the
     * hourly sweep must not delete out from under them.
     */
    await reference.update({ sourceUploaded: true, updatedAt: FieldValue.serverTimestamp() });

    // A clip is published as it arrived. See the note above.
    if (media.kind !== 'photo') {
      await publishWithoutReview(reference, media);
      return;
    }

    try {
      const [original] = await bucket.file(media.sourcePath).download();

      /*
       * The re-encode, skipped when there is nothing for it to do.
       *
       * ----------------------------------------------------------------------
       * This is the larger half of the 2026-09-05 quality fix, and the half that
       * is invisible from any one number.
       *
       * Every submitted photograph was encoded **twice**: the browser produced a
       * WebP at the shared quality, and this function then decoded that WebP and
       * encoded another one at the same quality. WebP is lossy, so a second pass
       * at quality 92 does not preserve quality 92 — it re-quantises what the
       * first pass already quantised, and generation loss compounds fastest in
       * exactly the smooth gradients where the first pass has already put its
       * artefacts. The parish was paying twice to look worse.
       *
       * Tommy: *"the quality drop is too significant."* Raising the numbers
       * alone would have raised the floor and kept the second pass.
       *
       * So: when the bytes that arrived are already a web rendition — WebP,
       * inside the edge, no orientation to apply and no metadata to strip — they
       * *are* the preview, and the file is copied rather than re-encoded. The
       * result is exactly one lossy generation between the camera and the
       * gallery, which is the best this pipeline can do.
       *
       * The condition is checked rather than assumed, and that distinction is
       * the security of it — the endpoint can be called without running our
       * JavaScript, so "the browser downscaled it" is not a fact this function
       * may take on trust. `isAlreadyWebReady` reads every clause of it out of
       * the file itself, and lives in @spsm/shared so a test can reach it; its
       * note is where the reasoning for each clause is written down.
       * ----------------------------------------------------------------------
       */
      const probe = await sharp(original).metadata();
      const alreadyWebReady = isAlreadyWebReady(probe, MAX_EDGE);

      if (alreadyWebReady) {
        /*
         * Written rather than returned, so the `publishWithoutReview` below the
         * `catch` is still the single place an administrator's own upload is
         * waved through. An early return here would need a second copy of that
         * call, and two of them is how one of the two eventually stops matching.
         */
        const previewPath = previewPathFor(media.programEventId, mediaId);
        await bucket.file(previewPath).save(original, withDownloadToken('image/webp'));
        await reference.update({
          previewPath,
          width: probe.width,
          height: probe.height,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        /*
         * `.rotate()` with no argument is the load-bearing call in this pipeline.
         *
         * A phone does not rotate the pixels it captures; it writes the sensor
         * orientation into an EXIF tag and leaves the image on its side. Browsers
         * honour that tag, so the original *looks* upright — and every transcode
         * that does not call this drops the tag along with the rest of the
         * metadata, producing a gallery where a third of the photographs are
         * sideways and the source files all look fine. Called with no argument it
         * means "apply whatever the EXIF says", which is exactly the intent.
         *
         * Stripping the rest of the metadata is deliberate and is not merely a
         * size saving: a phone photograph carries GPS coordinates, and these are
         * pictures of other people's children at a parish camp. Publishing the
         * location they were taken at is not something anybody consented to.
         * `sharp` drops all metadata unless told otherwise, so this is the safe
         * default — but it is the kind of default that gets "helpfully" changed,
         * hence the note.
         */
        const { data, info } = await sharp(original)
          .rotate()
          .resize({
            width: MAX_EDGE,
            height: MAX_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer({ resolveWithObject: true });

        const previewPath = previewPathFor(media.programEventId, mediaId);
        await bucket.file(previewPath).save(data, withDownloadToken('image/webp'));

        /*
         * Dimensions are written here rather than guessed later because the
         * layout packer needs an aspect ratio to choose a shape, and it runs in
         * the browser where the file is not available to measure. `info` is the
         * output's size, post-rotation and post-resize — which is what the grid
         * actually renders, and therefore the only correct answer.
         */
        await reference.update({
          previewPath,
          width: info.width,
          height: info.height,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      /*
       * Left pending with no preview, on purpose.
       *
       * The realistic causes are a file that is not really an image, a format
       * this build of sharp cannot decode, and a truncated upload — none of
       * which a retry fixes, so throwing (which would make Cloud Functions
       * retry) only burns the same failure repeatedly. The submission stays in
       * the queue where an administrator can see it and reject it, and the
       * approval path below falls back to copying the original, so a photograph
       * that merely defeated the transcoder can still be published.
       */
      console.error(
        `[galleries] could not transcode ${media.sourcePath} for ${mediaId}. It stays ` +
          `pending with no preview; the queue will offer it for rejection.`,
        error,
      );
    }

    /*
     * After the transcode either way, and that placement is the point.
     *
     * On success the preview exists, so `onGalleryMediaReviewed` copies *that*
     * into the public bucket rather than the original — which for an
     * administrator is the untouched file off their camera, since `prepare`
     * deliberately skips condensing for them.
     *
     * On failure it still runs, and publishes the original. That is the same
     * fallback the manual queue offers for a photograph the transcoder could
     * not read, taken here without asking because the person who uploaded it is
     * the person who would have been asked.
     */
    await publishWithoutReview(reference, media);

    /*
     * And last of all, tell whoever looks after this gallery.
     *
     * After `publishWithoutReview` rather than before it, for one reason: that
     * call is what decides whether this photograph needs reviewing at all, and
     * a notification about a review queue must not fire for something that was
     * just waved through. `announceGallerySubmission` re-reads
     * `media.autoApproveBy` to make the same decision — see its note — so the
     * ordering here is belt to that braces rather than the whole of it.
     *
     * Awaited, but it cannot throw. A failed push must not fail this trigger:
     * Cloud Functions would retry it, and a retried Storage trigger is a second
     * transcode of a photograph that already has its preview.
     */
    await announceGallerySubmission(media);
  },
);

/**
 * Approve an administrator's own upload, without anybody pressing anything.
 *
 * A no-op for everything else — `autoApproveBy` is null on every submission
 * that came from a stranger, which is nearly all of them, so this costs one
 * field read on the document already in hand.
 *
 * ## Why this is a second write rather than part of the first
 *
 * It has to be an *update*, because `onGalleryMediaReviewed` is the thing that
 * copies bytes into the public bucket and it is an `onDocumentUpdated` that
 * returns early unless `status` actually changed. Writing `approved` at create
 * time in `galleryUploadUrl` would produce a document that is approved, has no
 * rendition, and never will have one.
 *
 * Note what this does *not* do: it does not copy anything itself, and it must
 * not. The asymmetry that makes the whole model safe is that `galleries/` is
 * `allow write: if false` for every client and one Function moves bytes there.
 * Adding a second would mean two places to get it wrong.
 *
 * The placement matches `approveInto` in the browser exactly — on the page, in
 * the slideshow, not on the homepage. A photograph waved through must land in
 * the same state as one approved by hand, or the shortcut becomes a different
 * feature with its own defaults to remember.
 */
async function publishWithoutReview(
  reference: DocumentReference,
  media: GalleryMedia,
): Promise<void> {
  const uid = media.autoApproveBy;
  if (!uid) return;

  await reference.update({
    status: 'approved',
    placement: { onPage: true, slideshow: true, homepage: false },
    reviewedAt: FieldValue.serverTimestamp(),
    reviewedBy: uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * A deleted photograph takes its files with it.
 *
 * ---------------------------------------------------------------------------
 * ## The bug this is the fix for
 *
 * Deleting a picture in the gallery's picture manager removed the document and
 * left the file. Tommy: *"when i delete a photo it no longer shows on the app
 * but it stays in the storage it should delete it even if its the only image."*
 *
 * `deleteMediaForever` in the browser tried to delete all three paths itself,
 * and its own comment admitted the hole: **`galleries/` is
 * `allow write: if false` for every client**, so the attempt on `renditionPath`
 * — the copy in the world-readable prefix, the only one a stranger can actually
 * fetch — was refused every single time, logged, and carried on past. An
 * approved photograph deleted from the gallery therefore vanished from the site
 * and stayed on the internet at the URL it had been shared under, indefinitely:
 * `galleries/` has no lifecycle rule, only `submissions/` does.
 *
 * That refusal is not a mistake to be relaxed. A client that could write
 * `galleries/` could publish any object into the parish's public bucket without
 * anybody approving it, which is the entire moderation model. The asymmetry is
 * the design; what was missing was the other half of it — something on this side
 * of the wall that deletes when the document does.
 *
 * ## Why a delete trigger rather than a status change
 *
 * The old comment guessed the fix would be "a status change that lets the
 * Function do it": write `status: 'rejected'`, let `onGalleryMediaReviewed`
 * remove the files, then delete the document. That is two round trips racing
 * each other, it leaves a rejected document behind if the second one fails, and
 * `onGalleryMediaReviewed` finishes by *updating* the document — which is a
 * `NOT_FOUND` once the browser has deleted it.
 *
 * Keying on the deletion itself has none of that. The deleted snapshot still
 * carries every path the document held, so this knows exactly what to remove;
 * there is one write from the browser; and a Firestore trigger that fails is
 * retried by the platform, which a browser that has been closed is not.
 *
 * It also covers every other way a document can disappear — a console delete, a
 * script, a future screen — none of which would have remembered to delete files.
 *
 * ## What it does not cover, deliberately
 *
 * Deleting a *level* or a *ministry* does not delete photographs; they are
 * re-pointed at the ministry or at `UNFILED_PROGRAM_ID`. Those are updates, not
 * deletes, so this never sees them, and that is correct — see the note on
 * `deleteProgram` in the website's adminData.ts. Only deleting the photograph
 * itself destroys the photograph.
 * ---------------------------------------------------------------------------
 */
export const onGalleryMediaDeleted = onDocumentDeleted(
  { ...RUNTIME, document: `${COLLECTIONS.galleryMedia}/{mediaId}` },
  async (event) => {
    const gone = event.data?.data() as GalleryMedia | undefined;
    if (!gone) return;

    const mediaId = event.params['mediaId'] as string;
    const bucket = getStorage().bucket();

    /*
     * The rendition first, because it is the one that is publicly reachable. If
     * this dies halfway, the file left behind should be the one that was never
     * public — and unlike the other two, nothing else will ever come for it:
     * the 120-day lifecycle rule in docs/gallery-console-setup.md §2 covers
     * `submissions/` and does not touch `galleries/`.
     *
     * `posterPath` is in the list too. A clip's poster frame lives beside it in
     * the public prefix and is as much a photograph of somebody as the clip is.
     */
    const paths = [gone.renditionPath, gone.posterPath, gone.previewPath, gone.sourcePath].filter(
      (path): path is string => typeof path === 'string' && path.length > 0,
    );

    /*
     * In sequence rather than in parallel, and thrown on rather than swallowed.
     *
     * This is the opposite of what the browser version did, and both reversals
     * are the point. A browser had to give up quickly — the person is waiting,
     * and the Storage SDK retries for two minutes before it rejects — so it
     * raced the deletes against a six-second budget and carried on regardless.
     * Nobody is waiting here. A failure should make the whole invocation fail,
     * because a failed Firestore trigger is retried, and a retry is exactly what
     * a transient bucket error deserves.
     *
     * `ignoreNotFound` is what keeps that safe: a retry re-runs every path,
     * including the ones that already went, and those must not be what fails it.
     */
    for (const path of paths) {
      await bucket.file(path).delete({ ignoreNotFound: true });
    }

    console.log(`[galleries] deleted ${mediaId}, and ${paths.length} file(s) with it.`);
  },
);

/**
 * Act on an administrator's decision: publish it, or take it down.
 *
 * **One trigger for both, and that is not tidiness.** Approval and rejection
 * are the same Firestore event — an update to `status` — so two
 * `onDocumentUpdated` functions on this collection would both be invoked on
 * every single write to every gallery item, each doing nothing most of the
 * time, and both billed. Cloud Functions has no way to filter a Firestore
 * trigger by field value; the filtering has to happen inside one handler.
 *
 * ## Publishing
 *
 * A copy rather than a second transcode. The expensive work already happened on
 * submission, the output has already been looked at, and re-deriving it here
 * would mean the published file was never the file an administrator saw.
 *
 * `galleries/` is `allow write: if false` in storage.rules — no client may put
 * anything there under any circumstances. This runs on the Admin SDK, which
 * bypasses rules entirely, and that asymmetry is the enforcement: the only way
 * for bytes to become public is for this function to move them, and the only
 * thing that makes this function move them is a status an administrator set.
 *
 * ## Taking down
 *
 * Without the rejection branch, "reject" is a word in a database and the file
 * stays served. The lifecycle rule in docs/gallery-console-setup.md §2 sweeps
 * `submissions/` after 120 days, which is a backstop rather than a plan — and
 * it does not touch `galleries/` at all, so an item approved and then rejected
 * would otherwise stay world-readable at its URL indefinitely.
 */
export const onGalleryMediaReviewed = onDocumentUpdated(
  { ...RUNTIME, document: `${COLLECTIONS.galleryMedia}/{mediaId}` },
  async (event) => {
    const before = event.data?.before.data() as GalleryMedia | undefined;
    const after = event.data?.after.data() as GalleryMedia | undefined;
    if (!before || !after || !event.data) return;

    // Nothing to do unless the decision itself changed. This is also the loop
    // guard: both branches below write to the document that triggered them, so
    // without it each one re-invokes itself forever, billed by the invocation.
    if (after.status === before.status) return;

    const mediaId = event.params['mediaId'] as string;
    const bucket = getStorage().bucket();
    const ref = event.data.after.ref;

    if (after.status === 'approved' && !after.renditionPath) {
      /*
       * The preview when there is one, the original when there is not.
       *
       * The fallback covers the two cases the transcode above does not handle:
       * a video, which is passed through deliberately, and a photograph whose
       * transcode failed, which an administrator may still have judged worth
       * publishing from its filename and context. Both are better than an
       * approved document that can never acquire a file.
       */
      const source = after.previewPath ?? after.sourcePath;
      const extension = source.split('.').pop()?.toLowerCase() || 'bin';
      const renditionPath = renditionPathFor(after.programEventId, mediaId, extension);

      try {
        await bucket.file(source).copy(bucket.file(renditionPath));
        await ref.update({
          renditionPath,
          previewPath: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (error) {
        /*
         * Approved, published in Firestore, and with no file behind it. The
         * gallery already renders that state — `posterUrlFor` returns null and
         * the grid shows the item as still processing — so the page does not
         * break, and re-approving after a fix runs this again.
         */
        console.error(
          `[galleries] approved ${mediaId} but could not copy ${source} to ` +
            `${renditionPath}. It will show as still processing until retried.`,
          error,
        );
        return;
      }

      /*
       * A move, not a copy. Once the public file exists, everything left in
       * `submissions/` is dead weight: the preview is byte-for-byte the file
       * just published, and the original is a format nobody can display. Kept,
       * they tripled what every approved photograph cost to store, for up to
       * 120 days or forever if the lifecycle rule was never set.
       *
       * After the document update, so a failure here leaves files the lifecycle
       * rule will sweep rather than a document pointing at nothing. Un-rejecting
       * still works without them — the rejection branch below moves the public
       * file back into quarantine instead of deleting it.
       */
      for (const path of new Set([after.previewPath, after.sourcePath])) {
        if (!path) continue;
        try {
          await bucket.file(path).delete({ ignoreNotFound: true });
        } catch (error) {
          console.warn(`[galleries] published ${mediaId} but could not delete ${path}:`, error);
        }
      }
      return;
    }

    if (after.status === 'rejected') {
      /*
       * Back into quarantine rather than deleted.
       *
       * Approval no longer keeps a private copy, so for a photograph that was
       * published the public file is the only one left. Deleting it would make
       * the rejection permanent; moving it back to `submissions/` takes it off
       * the internet just as surely, keeps it in the review queue, and lets a
       * rejection reversed a week later publish it again. The lifecycle rule in
       * docs/gallery-console-setup.md §2 clears it if nobody does.
       *
       * A submission rejected straight from pending has no rendition and keeps
       * its preview and original where they are, for the same reason.
       */
      if (!after.renditionPath) return;

      const extension = after.renditionPath.split('.').pop()?.toLowerCase() || 'bin';
      const previewPath = `submissions/${after.programEventId}/preview-${mediaId}.${extension}`;

      try {
        await bucket.file(after.renditionPath).move(bucket.file(previewPath));
      } catch (error) {
        /*
         * Fall back to a plain delete: taking it off the internet matters more
         * than keeping it, and an `approved` document is what the reviewer
         * would have to re-set to get it back either way.
         */
        console.warn(`[galleries] could not move ${after.renditionPath} back for rejected ${mediaId}:`, error);
        await bucket.file(after.renditionPath).delete({ ignoreNotFound: true });
        await ref.update({ renditionPath: null, updatedAt: FieldValue.serverTimestamp() });
        return;
      }

      await ref.update({
        renditionPath: null,
        previewPath,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);
