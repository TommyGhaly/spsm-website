import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  ADMIN_MAX_BYTES,
  CONDENSED_NOTICE_MIN_SAVING,
  CONDENSED_NOTICE_RATIO,
  DAILY_LIMIT_PER_IP,
  DAILY_LIMIT_PER_UID,
  formatBytes,
  isAlreadyWebReady,
  MAX_FILES_PER_BATCH,
  maxBytesFor,
  mediaKindForContentType,
  PHOTO_BUDGET_BYTES,
  PHOTO_CEILING_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_QUALITY,
  submissionObjectPath,
  VIDEO_MAX_BYTES,
  worthMentioning,
} from '@spsm/shared';

/**
 * What POST /api/gallery/upload-url decides, in the parts that are decidable
 * without the Admin SDK.
 *
 * The endpoint is the only way a photograph reaches the parish's bucket now —
 * `storage.rules` refuses every client write to `submissions/` and
 * `firestore.rules` refuses every client create of `galleryMedia` — so these
 * are the checks that used to be forty lines of rules and are covered by
 * `tests/rules/program-galleries.test.ts` no longer. The orchestration around
 * them (App Check, the ID token, the quota transaction, the signed URL) needs
 * real services and is verified in the browser instead.
 */

describe('submissionObjectPath', () => {
  it('names the object after the media id, not the uploaded filename', () => {
    expect(submissionObjectPath('week-1', 'abc123', 'image/jpeg')).toBe(
      'submissions/week-1/abc123.jpeg',
    );
  });

  /*
   * The extension is the one part of this path a stranger influences, so these
   * are the tests that matter. Every case below must land inside
   * `submissions/{programEventId}/` with exactly two slashes — the worst a
   * hostile content type may achieve is an oddly named file in the right place.
   */
  it('cannot be made to climb out of the quarantine prefix', () => {
    for (const contentType of [
      'image/../../etc/passwd',
      'image/..%2F..%2Fescape',
      'image/a/b/c',
      'image/\\\\windows\\\\path',
      'image/;rm -rf',
      'image/<script>',
    ]) {
      const path = submissionObjectPath('week-1', 'abc123', contentType);
      expect(path.startsWith('submissions/week-1/abc123.')).toBe(true);
      expect(path.split('/')).toHaveLength(3);
      expect(path).not.toContain('..');
    }
  });

  it('caps a long extension rather than carrying it', () => {
    const path = submissionObjectPath('week-1', 'abc', `image/${'x'.repeat(500)}`);
    expect(path).toBe('submissions/week-1/abc.xxxxx');
  });

  it('falls back to bin when nothing survives the scrub', () => {
    expect(submissionObjectPath('week-1', 'abc', 'image/---')).toBe('submissions/week-1/abc.bin');
    expect(submissionObjectPath('week-1', 'abc', 'image')).toBe('submissions/week-1/abc.bin');
  });

  it('lowercases, because HEIC off a phone arrives shouting', () => {
    expect(submissionObjectPath('w', 'a', 'image/HEIC')).toBe('submissions/w/a.heic');
  });
});

describe('mediaKindForContentType', () => {
  it('sorts photographs from clips', () => {
    expect(mediaKindForContentType('image/heic')).toBe('photo');
    expect(mediaKindForContentType('image/webp')).toBe('photo');
    expect(mediaKindForContentType('video/quicktime')).toBe('video');
  });

  /*
   * A bucket that accepts `text/html` from a browser is a bucket that serves it
   * back, on the parish's own domain, to somebody who followed a link.
   */
  it('refuses anything that is neither', () => {
    for (const type of ['text/html', 'application/x-sh', 'application/pdf', '', 'image']) {
      expect(mediaKindForContentType(type)).toBeNull();
    }
  });
});

describe('maxBytesFor', () => {
  /*
   * A photograph is never refused for its size — it is condensed and sent. So
   * this ceiling is a script guard, and the number that matters is that it sits
   * far above anything the downscale ladder can produce.
   */
  it('gives a photograph a ceiling well above what the ladder produces', () => {
    expect(maxBytesFor('photo', false)).toBe(PHOTO_CEILING_BYTES);
    expect(PHOTO_CEILING_BYTES).toBeGreaterThan(PHOTO_BUDGET_BYTES);
  });

  it('gives a video the one real size limit left on the site', () => {
    expect(maxBytesFor('video', false)).toBe(VIDEO_MAX_BYTES);
  });

  it("lets a ministry's own administrator send a photographic original", () => {
    expect(maxBytesFor('photo', true)).toBe(ADMIN_MAX_BYTES);
    expect(ADMIN_MAX_BYTES).toBeGreaterThan(VIDEO_MAX_BYTES);
  });

  /*
   * Tommy, 2026-09-05: *"admins can upload any sized video."*
   *
   * The asymmetry with the photograph above is the point, and it is about
   * memory rather than generosity: nothing ever decodes a clip — approval is a
   * bucket-to-bucket copy — while a photograph is decoded into an uncompressed
   * buffer by `sharp`, so its ceiling is what stands between a very large scan
   * and an out-of-memory crash.
   *
   * Asserted as "above any real file" rather than as `Infinity` alone, because
   * what has to hold is that the endpoint's `byteSize > ceiling` can never be
   * true — a finite ADMIN_MAX_BYTES creeping back in here is the regression.
   */
  it('puts no ceiling at all on an administrator video', () => {
    expect(maxBytesFor('video', true)).toBe(Number.POSITIVE_INFINITY);
    expect(4 * 1024 * 1024 * 1024 > maxBytesFor('video', true)).toBe(false);
  });
});

describe('formatBytes', () => {
  it('reads the way the note on a row reads', () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12.4 MB');
    expect(formatBytes(680 * 1024)).toBe('680 KB');
  });

  /*
   * "Video clips up to 100.0 MB" is how the drop-zone hint first read in the
   * browser, and it is the sort of thing that makes a church website sound like
   * a machine. A round limit gets a round number.
   */
  it('drops a trailing zero, so a stated limit reads like a person wrote it', () => {
    expect(formatBytes(VIDEO_MAX_BYTES)).toBe('100 MB');
    expect(formatBytes(6 * 1024 * 1024)).toBe('6 MB');
  });

  /* Never "0 KB", which reads as an empty file rather than a small one. */
  it('never rounds a real file down to nothing', () => {
    expect(formatBytes(1)).toBe('1 KB');
    expect(formatBytes(200)).toBe('1 KB');
  });
});

describe('the numbers themselves', () => {
  /*
   * The one cross-file invariant in the feature.
   *
   * `MAX_EDGE` in functions/src/galleries.ts imports PHOTO_MAX_EDGE precisely so
   * these cannot drift, because the failure is silent: a browser downscaling to
   * a larger edge than the server resizes to means every submitted photograph
   * is shrunk twice and compressed twice, and it still looks fine enough that
   * nobody notices.
   */
  it('keeps the browser and the transcode pointed at one edge and one quality', () => {
    const transcode = readFileSync(
      new URL('../../functions/src/galleries.ts', import.meta.url),
      'utf8',
    );

    /*
     * The assertion is that the Function *derives* both numbers rather than
     * that either number is any particular value.
     *
     * It used to read `expect(PHOTO_MAX_EDGE).toBe(2560)`, which is a different
     * test wearing this one's name: it passes whether or not the two files
     * agree, and it fails the moment anybody tunes the quality — which is
     * exactly what happened on 2026-09-05, when both numbers went up together
     * and this was the only thing that objected.
     */
    expect(transcode).toMatch(/const MAX_EDGE = PHOTO_MAX_EDGE;/);
    expect(transcode).toMatch(/const WEBP_QUALITY = PHOTO_QUALITY;/);

    /*
     * And that they are still numbers a photograph can live with. The upper
     * bounds are what a browser can actually encode on a phone without running
     * out of memory; the lower ones are where a picture opened full-screen
     * starts to look like a picture of a picture.
     */
    expect(PHOTO_MAX_EDGE).toBeGreaterThanOrEqual(2560);
    expect(PHOTO_MAX_EDGE).toBeLessThanOrEqual(6000);
    expect(PHOTO_QUALITY).toBeGreaterThanOrEqual(85);
    expect(PHOTO_QUALITY).toBeLessThanOrEqual(95);
  });

  it('leaves the daily limits loose enough for a coffee hour', () => {
    // The parish shares a building and therefore an address, and the church
    // wifi puts the whole congregation behind it — so the address limit has to
    // be the looser of the two or a busy Sunday locks everybody out.
    expect(DAILY_LIMIT_PER_IP).toBeGreaterThan(DAILY_LIMIT_PER_UID);
    expect(DAILY_LIMIT_PER_UID).toBeGreaterThan(MAX_FILES_PER_BATCH);
  });

  it('sets the condensed notice below one, so it cannot fire on every file', () => {
    expect(CONDENSED_NOTICE_RATIO).toBeGreaterThan(0);
    expect(CONDENSED_NOTICE_RATIO).toBeLessThan(1);
  });
});

describe('worthMentioning', () => {
  const KB = 1024;
  const MB = 1024 * 1024;

  /*
   * These three ratios are measurements, not guesses — taken in the browser
   * from a web-sized JPEG, a 2000px JPEG and a full phone photograph run
   * through the real downscale path. WebP beats JPEG about two to one on
   * ordinary pictures, so a ratio test *alone* flagged all three, which is the
   * wallpaper the note exists to avoid.
   */
  it('says nothing about small files, however well they compressed', () => {
    expect(worthMentioning(66 * KB, 37 * KB)).toBe(false); // ratio 0.56
    expect(worthMentioning(153 * KB, 76 * KB)).toBe(false); // ratio 0.50
    expect(worthMentioning(603 * KB, 104 * KB)).toBe(false); // ratio 0.17
  });

  it('speaks up for a phone photograph, which is the case it is for', () => {
    expect(worthMentioning(12 * MB, 680 * KB)).toBe(true);
    expect(worthMentioning(6.5 * MB, 113 * KB)).toBe(true);
  });

  /* A large file that barely shrank is not "condensed" in any useful sense. */
  it('says nothing when a large file barely changed', () => {
    expect(worthMentioning(10 * MB, 9 * MB)).toBe(false);
  });

  it('needs a real megabyte saved, not just a good ratio', () => {
    expect(CONDENSED_NOTICE_MIN_SAVING).toBe(MB);
    // Ratio passes at 0.1, but only 900KB is saved.
    expect(worthMentioning(1000 * KB, 100 * KB)).toBe(false);
  });
});

/**
 * The second encode, and when there is nothing for it to do.
 *
 * ---------------------------------------------------------------------------
 * Until 2026-09-05 every submitted photograph was encoded twice — once by the
 * browser and again by the transcode Function — and the second pass was
 * measured, on a real parish photograph, to change the file size by about two
 * per cent. It was re-quantising an already-quantised image for no saving:
 * pure generation loss, worst in the smooth gradients where the first pass has
 * already left its artefacts. Tommy: *"the quality drop is too significant."*
 *
 * Every case below is a `sharp.metadata()` reading taken from a real file (see
 * the probe in the 2026-09-05 session): a canvas WebP, the same bytes with an
 * EXIF block, a JPEG, an oversized WebP, and one whose EXIF says it is sideways.
 * The four that must not skip are the point of the test — three of them are
 * privacy or correctness, not tidiness.
 * ---------------------------------------------------------------------------
 */
describe('isAlreadyWebReady', () => {
  /** What `downscalePhoto` produces: canvas WebP, no metadata of any kind. */
  const browserOutput = { format: 'webp', width: 3840, height: 2560 };

  it('skips the second encode for what the browser already prepared', () => {
    expect(isAlreadyWebReady(browserOutput)).toBe(true);
  });

  /*
   * The clause that carries the privacy property. A phone photograph's EXIF
   * holds GPS coordinates and these are pictures of other people's children —
   * the full pass strips all metadata, so anything carrying some must take it.
   * Skipping on trust ("the browser strips EXIF") is exactly the assumption the
   * endpoint cannot make, since it can be called without our JavaScript.
   */
  it('re-encodes anything carrying metadata, whatever else is true of it', () => {
    expect(isAlreadyWebReady({ ...browserOutput, exif: Buffer.from('x') })).toBe(false);
    expect(isAlreadyWebReady({ ...browserOutput, xmp: Buffer.from('x') })).toBe(false);
    expect(isAlreadyWebReady({ ...browserOutput, iptc: Buffer.from('x') })).toBe(false);
  });

  /*
   * `.rotate()` is the load-bearing line in the pipeline: a phone writes the
   * sensor orientation into a tag rather than rotating pixels, so skipping the
   * pass on one of these publishes the photograph on its side.
   */
  it('re-encodes a photograph whose pixels have not been turned upright', () => {
    expect(isAlreadyWebReady({ ...browserOutput, orientation: 6 })).toBe(false);
    // 1 and absent both mean upright, and both must still qualify.
    expect(isAlreadyWebReady({ ...browserOutput, orientation: 1 })).toBe(true);
  });

  it('re-encodes an original, which has to be converted anyway', () => {
    expect(isAlreadyWebReady({ format: 'jpeg', width: 3000, height: 2000 })).toBe(false);
    expect(isAlreadyWebReady({ format: 'heif', width: 3000, height: 2000 })).toBe(false);
  });

  /* Larger than the edge has to be resized, and a resize is a decode. */
  it('re-encodes anything that still has to be made smaller', () => {
    expect(isAlreadyWebReady({ format: 'webp', width: PHOTO_MAX_EDGE + 1, height: 10 })).toBe(
      false,
    );
    expect(isAlreadyWebReady({ format: 'webp', width: PHOTO_MAX_EDGE, height: 10 })).toBe(true);
  });

  /* A file sharp could not measure. Nothing is known, so nothing is skipped. */
  it('re-encodes a file it could read nothing out of', () => {
    expect(isAlreadyWebReady({})).toBe(false);
    expect(isAlreadyWebReady({ format: 'webp' })).toBe(false);
  });
});
