/**
 * Deleting submissions whose photograph never arrived.
 *
 * ---------------------------------------------------------------------------
 * The seam this closes is the price of the signed-URL upload.
 *
 * `galleryUploadUrl` writes the `galleryMedia` document when it hands out the
 * URL, because the URL is named after the document and the two have to agree.
 * The bytes are then uploaded by the browser, separately, and may never arrive
 * at all: a dropped connection, a closed tab, a phone that slept, or a script
 * that asks for URLs it has no intention of using.
 *
 * Nothing is wrong with the document in that case — it is simply about a
 * photograph that does not exist. Left alone it would sit in the review queue
 * forever as a row with no picture, and an administrator would have to work out
 * what to do with it. That is the failure this sweep exists to prevent, and the
 * reason it is a scheduled job rather than a `try/finally` in the endpoint: the
 * endpoint has returned long before the upload succeeds or fails, and cannot
 * know which happened.
 *
 * ## Why an hour
 *
 * The signed URL expires in five minutes, so anything still unuploaded after an
 * hour is never going to be. The generous margin is deliberate: `sourceUploaded`
 * is set by a Storage trigger, and a trigger that is queued behind a batch of
 * sixty photographs may run minutes after its object landed. Deleting a
 * submission whose file *did* arrive, because its trigger was slow, would lose
 * a parishioner's photograph — so the margin is sized for the failure that
 * matters rather than for tidiness.
 * ---------------------------------------------------------------------------
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { COLLECTIONS } from '@spsm/shared';
import { CAPS } from '../rateLimit.js';

/** Local, as in stats.ts and finance.ts — it is not a shared export. */
const PARISH_TIME_ZONE = 'America/New_York';

/** How long a submission may go without its bytes before it is abandoned. */
const GRACE_MS = 60 * 60 * 1000;

/** Never delete more than this in one run. */
const BATCH = 200;

export const sweepUnuploadedSubmissions = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: PARISH_TIME_ZONE,
    timeoutSeconds: 300,
    maxInstances: CAPS.scheduled,
  },
  async () => {
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(Date.now() - GRACE_MS);

    /*
     * `sourceUploaded == false` rather than a missing-field check.
     *
     * Every document written since the endpoint landed carries the field, and
     * documents from before it do not — those had their file uploaded first, by
     * the old client path, so they are not orphans and must not be swept. An
     * equality filter skips them for free; `!=` or an existence test would
     * match them and delete real photographs.
     */
    const stale = await db
      .collection(COLLECTIONS.galleryMedia)
      .where('status', '==', 'pending')
      .where('sourceUploaded', '==', false)
      .where('createdAt', '<', cutoff)
      .limit(BATCH)
      .get();

    if (stale.empty) return;

    const bucket = getStorage().bucket();

    for (const document of stale.docs) {
      const sourcePath = document.get('sourcePath');

      /*
       * Delete the object first, and tolerate it being absent — which is the
       * expected case, since the whole premise is that it never arrived. What
       * this catches is the narrow race where the upload completed but the
       * trigger had not yet recorded it: the file is real, so removing it
       * before the document keeps the two from disagreeing.
       */
      if (typeof sourcePath === 'string' && sourcePath) {
        await bucket
          .file(sourcePath)
          .delete()
          .catch(() => undefined);
      }
      await document.ref.delete();
    }

    console.info(`[gallery] swept ${stale.size} submission(s) whose file never arrived`);
  },
);

/**
 * Delete yesterday's upload counters.
 *
 * The counting itself does not need this — `countAgainst` compares the stored
 * day and treats anything older as zero, so a stale document is already
 * harmless. This exists because `/privacy` says the church keeps these for a
 * day, and that page names the file behind every claim it makes. A document
 * that sat there indefinitely would make the sentence untrue, and the sentence
 * is the thing somebody relies on.
 *
 * It matters more than it looks. The `ip:` documents are hashes of visitors'
 * network addresses with timestamps beside them; keeping them for a year to
 * save an hourly query would be building a quiet record of who visited which
 * gallery and when, which is exactly what hashing them was meant to avoid.
 */
export const sweepStaleQuotas = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: PARISH_TIME_ZONE,
    timeoutSeconds: 300,
    maxInstances: CAPS.scheduled,
  },
  async () => {
    const db = getFirestore();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const stale = await db
      .collection(COLLECTIONS.submissionQuota)
      .where('day', '<=', yesterday)
      .limit(500)
      .get();

    if (stale.empty) return;

    const batch = db.batch();
    for (const document of stale.docs) batch.delete(document.ref);
    await batch.commit();

    console.info(`[gallery] removed ${stale.size} spent upload counter(s)`);
  },
);
