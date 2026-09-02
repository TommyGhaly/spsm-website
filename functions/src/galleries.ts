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
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { CAPS } from './rateLimit.js';
import { getStorage } from 'firebase-admin/storage';
import { FieldValue } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { COLLECTIONS, type GalleryMedia } from '@spsm/shared';

/** See the note at the top — this must match the Firestore database's region. */
const REGION = 'us-east1';

/**
 * Transcoding a 12MB HEIC needs real memory and is not instant. 1GiB and five
 * minutes are generous on purpose: the alternative to an over-provisioned
 * function here is a submission that silently never appears, and this runs
 * once per photograph ever uploaded rather than once per page view.
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
 * 2000 rather than something larger: the biggest a gallery photograph is ever
 * displayed is full-bleed on a retina desktop, and beyond this the file grows
 * faster than anybody can see. It is also the ceiling on what the parish pays
 * to serve — forty photographs at 8MB each is a real number on a church budget.
 */
const MAX_EDGE = 2000;

/**
 * A photograph the parish will serve for years, weighed against a bill.
 *
 * WebP at 82 is visually indistinguishable from the original at roughly a fifth
 * the size, and every browser the parish's visitors use has supported it since
 * 2020. There is deliberately no JPEG fallback: maintaining two renditions
 * doubles the storage to serve a browser share that rounds to zero.
 */
const WEBP_QUALITY = 82;

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
export const onGalleryMediaCreated = onDocumentCreated(
  { ...RUNTIME, document: `${COLLECTIONS.galleryMedia}/{mediaId}` },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;

    const media = snapshot.data() as GalleryMedia;
    const mediaId = event.params['mediaId'] as string;

    // Only ever the anonymous submission path. A document created by an
    // administrator, or one restored from a backup with its rendition already
    // set, has nothing to do here.
    if (media.status !== 'pending' || media.previewPath) return;
    if (media.kind !== 'photo') return;

    const bucket = getStorage().bucket();

    try {
      const [original] = await bucket.file(media.sourcePath).download();

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
      await snapshot.ref.update({
        previewPath,
        width: info.width,
        height: info.height,
        updatedAt: FieldValue.serverTimestamp(),
      });
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
      }
      return;
    }

    if (after.status === 'rejected') {
      /*
       * The rendition first, because it is the one that is publicly reachable.
       * If this dies halfway, the file left on the internet should be the one
       * that was never public in the first place.
       */
      const paths = [after.renditionPath, after.previewPath].filter(
        (path): path is string => typeof path === 'string' && path.length > 0,
      );

      for (const path of paths) {
        try {
          await bucket.file(path).delete({ ignoreNotFound: true });
        } catch (error) {
          console.warn(`[galleries] could not delete ${path} for rejected ${mediaId}:`, error);
        }
      }

      /*
       * `sourcePath` is deliberately left alone. It is the archive — §2 of
       * docs/gallery-console-setup.md sets the lifecycle rule at 120 days
       * rather than 30 precisely so an original outlives the decision made
       * about it, and a rejection reversed a week later can still be published.
       */
      await ref.update({
        renditionPath: null,
        previewPath: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  },
);
