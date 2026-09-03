import { describe, it, expect } from 'vitest';
import {
  ADMIN_MAX_BYTES,
  CONDENSED_NOTICE_MIN_SAVING,
  CONDENSED_NOTICE_RATIO,
  DAILY_LIMIT_PER_IP,
  DAILY_LIMIT_PER_UID,
  MAX_FILES_PER_BATCH,
  PHOTO_BUDGET_BYTES,
  PHOTO_CEILING_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_QUALITY,
  VIDEO_MAX_BYTES,
  formatBytes,
  maxBytesFor,
  mediaKindForContentType,
  submissionObjectPath,
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

  it("lets a ministry's own administrator send an original of either kind", () => {
    expect(maxBytesFor('photo', true)).toBe(ADMIN_MAX_BYTES);
    expect(maxBytesFor('video', true)).toBe(ADMIN_MAX_BYTES);
    expect(ADMIN_MAX_BYTES).toBeGreaterThan(VIDEO_MAX_BYTES);
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
    expect(PHOTO_MAX_EDGE).toBe(2560);
    expect(PHOTO_QUALITY).toBe(82);
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
