/**
 * What a stranger may send to a gallery, and what happens when it is too big.
 *
 * ---------------------------------------------------------------------------
 * Shared because the browser and the Function must agree, and only one of them
 * decides.
 *
 * The browser reads these to shrink a photograph before it leaves the laptop
 * and to say so on screen. The upload endpoint reads the same numbers to accept
 * or refuse. That split matters: the browser's use is a **courtesy and a cost
 * saving**, and an attacker simply skips it — they are not running our
 * JavaScript. `POST /api/gallery/upload-url` is the only enforcement, and it is
 * the reason these live here rather than in the browser bundle alone.
 *
 * ## Photographs are never refused for size
 *
 * This is the chosen behaviour and not an oversight. A parishioner sending
 * pictures of the camp should not have to know what a megabyte is; a photograph
 * that is too large is condensed and sent, and they are told it happened.
 * `PHOTO_BUDGET_BYTES` is therefore not a limit — it is the point at which the
 * browser starts trying harder. See `descend()` in the website's downscale
 * helper for the ladder, whose last rung is "send it anyway".
 *
 * `PHOTO_CEILING_BYTES` is the one hard photo bound, and it exists for scripts
 * rather than for people: no real photograph survives the ladder anywhere near
 * it. If it ever refuses a genuine upload, the ladder is broken and that is the
 * bug to fix — do not raise this number in response.
 *
 * ## Videos are the exception, because a browser cannot re-encode one
 *
 * There is no dependable way to transcode video client-side — `MediaRecorder`
 * and WebCodecs vary too much across Safari and phones to promise it — and the
 * transcode Function deliberately does not do video either. So a clip cannot be
 * condensed, which leaves refusing it as the only honest option, and makes this
 * the single remaining place the site tells somebody their file is too big. The
 * message that does it is worth writing carefully.
 * ---------------------------------------------------------------------------
 */

/**
 * The longest edge a submitted photograph is reduced to.
 *
 * Must equal `MAX_EDGE` in `functions/src/galleries.ts`. The browser downscales
 * to this and the transcode Function resizes to it again with
 * `withoutEnlargement`, so a larger number here than there is silently undone —
 * the server would shrink the picture back and charge a second lossy pass for
 * the privilege.
 */
export const PHOTO_MAX_EDGE = 2560;

/** The WebP quality the ladder starts at. Equal to `WEBP_QUALITY` there. */
export const PHOTO_QUALITY = 82;

/** Where the browser stops accepting its own output and tries harder. */
export const PHOTO_BUDGET_BYTES = 6 * 1024 * 1024;

/**
 * The hard bound the endpoint puts on an image. A script guard, not a limit.
 *
 * Twice the budget, because the ladder's last rung sends whatever it has and a
 * pathological input could land above it.
 */
export const PHOTO_CEILING_BYTES = 12 * 1024 * 1024;

/** A clip from a stranger. Refused above this, because it cannot be shrunk. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/**
 * What a program's own administrator may send, for either kind.
 *
 * They are not downscaled and not counted, because they are choosing and
 * exporting a file deliberately rather than emptying a camera roll. This is the
 * old `SUBMISSION_MAX_BYTES`, kept only for them.
 */
export const ADMIN_MAX_BYTES = 250 * 1024 * 1024;

/** Files in one go. A camp day is comfortably inside this; a script is not. */
export const MAX_FILES_PER_BATCH = 60;

/** Files per day, per anonymous session. */
export const DAILY_LIMIT_PER_UID = 300;

/**
 * Files per day, per address — deliberately far looser than the uid one.
 *
 * `rateLimit.ts` already notes twice that the parish shares a building and
 * therefore an address, and that the church wifi puts the whole congregation
 * behind it. This number has to survive a coffee hour where thirty people
 * upload from the same router; it is here to stop a rented host, and it is a
 * speed bump even then, since the address is read from `x-forwarded-for` and is
 * forgeable. App Check is the wall.
 */
export const DAILY_LIMIT_PER_IP = 600;

/**
 * When to tell somebody their photograph was made smaller.
 *
 * ---------------------------------------------------------------------------
 * Both conditions, and the second one is the one that was missing.
 *
 * The ratio alone flags *everything*. WebP beats JPEG roughly two to one on
 * ordinary photographs, so a 66KB picture saved off a message comes out at
 * 37KB — a ratio of 0.56, comfortably "condensed" by that test alone, and
 * utterly not worth a line of text. Measured in the browser across a web-sized
 * JPEG, a 2000px JPEG and a full phone photograph: 0.56, 0.50, 0.17. Every one
 * of them would have carried a note.
 *
 * That is the wallpaper this was meant to avoid. A note on every row is a note
 * nobody reads, and worse, it makes a list of perfectly ordinary photographs
 * look like a list of problems.
 *
 * So the saving has to be large in plain terms as well as proportionally. A
 * megabyte is the threshold because it is roughly where somebody starts
 * noticing an upload at all — below it the browser is doing something useful
 * and quietly, which is how it should be.
 * ---------------------------------------------------------------------------
 */
export const CONDENSED_NOTICE_RATIO = 0.6;

/** …and at least this much actually saved, in bytes. */
export const CONDENSED_NOTICE_MIN_SAVING = 1024 * 1024;

/** Whether a re-encode is worth mentioning to the person who sent it. */
export function worthMentioning(originalBytes: number, sentBytes: number): boolean {
  return (
    sentBytes < originalBytes * CONDENSED_NOTICE_RATIO &&
    originalBytes - sentBytes >= CONDENSED_NOTICE_MIN_SAVING
  );
}

/**
 * Human bytes, for the one message a person actually reads.
 *
 * One decimal, dropped when it is a zero: a limit stated as "100.0 MB" reads
 * like a machine talking, and these strings appear in the two places where the
 * site is refusing somebody or explaining itself to them. `12.4 MB` and
 * `100 MB` are both right; `100.0 MB` and `12 MB` are both worse.
 *
 * Never rounds down to "0 KB", which reads as an empty file rather than a
 * small one.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / 1024 / 1024;
    return `${Number.isInteger(Math.round(mb * 10) / 10) ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The size bound for one file, given who is sending it.
 *
 * Photographs get the script-guard ceiling; videos get the real limit. Returns
 * bytes, and the caller decides whether exceeding it is a refusal — for a photo
 * in the browser it never is.
 */
export function maxBytesFor(kind: 'photo' | 'video', isProgramAdmin: boolean): number {
  if (isProgramAdmin) return ADMIN_MAX_BYTES;
  return kind === 'video' ? VIDEO_MAX_BYTES : PHOTO_CEILING_BYTES;
}

/** `photo` or `video`, from a declared content type. Null for anything else. */
export function mediaKindForContentType(contentType: string): 'photo' | 'video' | null {
  if (contentType.startsWith('image/')) return 'photo';
  if (contentType.startsWith('video/')) return 'video';
  return null;
}

/**
 * Where one submission's bytes go.
 *
 * ---------------------------------------------------------------------------
 * Here, rather than in the Function, because it is the piece most worth testing
 * and the piece where a mistake is worst.
 *
 * The extension is the only part derived from what the caller sent, and it is
 * the one thing on this path that a stranger influences. Unscrubbed it is a
 * path injection: `../` climbs out of the quarantine prefix, a slash invents a
 * directory, and a very long one is a denial of service against the console.
 * So it is lowercased, stripped to `[a-z0-9]`, cut to five characters, and
 * falls back to `bin` when nothing survives — which means the *worst* a
 * hostile content type can produce is an oddly named file in the right folder.
 *
 * The media id, not the uploaded filename, is the name. Two people sending
 * `IMG_0042.HEIC` from the same camp is the ordinary case rather than a
 * coincidence to guard against, and the original filename is uncontrolled
 * input that is frequently somebody's name. It is also what lets the Storage
 * trigger find the document: the object's name *is* the media id.
 * ---------------------------------------------------------------------------
 */
export function submissionObjectPath(
  programEventId: string,
  mediaId: string,
  contentType: string,
): string {
  const guess = contentType.split('/')[1] ?? '';
  const extension = guess.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  return `submissions/${programEventId}/${mediaId}.${extension}`;
}
