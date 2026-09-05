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
 *
 * ## 2560 -> 3840, on 2026-09-05
 *
 * Tommy: *"the quality drop is too significant."* He is right, and 2560 was
 * only half of why. A phone photograph is 4032px on its long edge, so 2560 threw
 * away a third of the detail before anything else happened — and the *thing a
 * gallery is for* is opening a picture full-screen, which is exactly where that
 * shows. 3840 is a 4K long edge: it is not larger than the screens the parish
 * actually opens these on, and a modern phone's own picture survives it nearly
 * intact.
 *
 * The other half was that every photograph was encoded twice. See
 * `alreadyWebReady` in functions/src/galleries.ts for the fix.
 */
export const PHOTO_MAX_EDGE = 3840;

/**
 * The WebP quality the ladder starts at. Equal to `WEBP_QUALITY` there.
 *
 * 82 -> 92 on 2026-09-05, with the edge above. 82 is the number every "web
 * image" guide prints, and it is the right number for a photograph inside an
 * article at 800px wide. It is the wrong number for one that will be opened
 * full-screen on a retina laptop, which is what the lightbox and the projector
 * presentation both do — at 82 the smooth areas of a photograph, a wall or a
 * sky or a face out of focus, go visibly blotchy at that size.
 *
 * Above roughly 95 WebP stops buying anything and the file grows quickly, so
 * this is near the top of the useful range rather than at it.
 */
export const PHOTO_QUALITY = 92;

/**
 * Where the browser stops accepting its own output and tries harder.
 *
 * Raised with the quality above: a 3840px WebP at 92 is a two-to-four megabyte
 * file for an ordinary photograph, and a budget of 6MB would have sent a good
 * proportion of them down to the second rung of the ladder — undoing the
 * quality rise for precisely the detailed pictures that most needed it.
 */
export const PHOTO_BUDGET_BYTES = 12 * 1024 * 1024;

/**
 * The hard bound the endpoint puts on an image. A script guard, not a limit.
 *
 * Twice the budget, because the ladder's last rung sends whatever it has and a
 * pathological input could land above it.
 */
export const PHOTO_CEILING_BYTES = 24 * 1024 * 1024;

/** A clip from a stranger. Refused above this, because it cannot be shrunk. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/**
 * What a program's own administrator may send.
 *
 * Photographs only. It bounds the transcode Function's memory rather than the
 * administrator's patience — `sharp` decodes the whole image into RAM, and an
 * arbitrarily large one is an out-of-memory crash that leaves the submission
 * pending with no preview and nothing on screen to explain it.
 *
 * **Video is uncapped for them, and no longer passes through here at all.** See
 * `maxBytesFor`. Nothing decodes a clip: it is copied between buckets by the
 * storage service on approval, so its size costs the parish storage and nothing
 * else, and Tommy asked for the cap gone.
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
 *
 * ## An administrator's video has no bound at all
 *
 * `Infinity`, deliberately, and it is the one unbounded thing on the site.
 * Tommy: *"admins can upload any sized video."*
 *
 * It is safe in a way an unbounded *photograph* would not be, and the asymmetry
 * is the whole reason this returns two different answers. Nothing ever decodes a
 * clip: the transcode Function passes video straight over (`media.kind !==
 * 'photo'`), and approval is `bucket.file(a).copy(b)`, which happens inside the
 * storage service without the bytes ever reaching our memory. A clip therefore
 * costs storage and egress and no RAM. A photograph is decoded by `sharp` into
 * an uncompressed buffer, so its bound is what stands between a 400MP scan and
 * an out-of-memory crash that leaves a submission pending with no preview.
 *
 * `Infinity` works through the endpoint's `byteSize > ceiling` unchanged — every
 * finite number is below it — and `formatBytes` is never reached with it,
 * because that message is only built on the branch this can no longer take.
 */
export function maxBytesFor(kind: 'photo' | 'video', isProgramAdmin: boolean): number {
  if (kind === 'video') {
    return isProgramAdmin ? Number.POSITIVE_INFINITY : VIDEO_MAX_BYTES;
  }
  return isProgramAdmin ? ADMIN_MAX_BYTES : PHOTO_CEILING_BYTES;
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

/**
 * What `sharp` can tell us about an uploaded file, reduced to what the decision
 * below needs. Structurally a subset of `sharp.Metadata`.
 */
export interface ImageFacts {
  format?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** 1 is upright; absent means the format carries no orientation at all. */
  orientation?: number | undefined;
  exif?: unknown;
  xmp?: unknown;
  iptc?: unknown;
}

/**
 * Whether this file is already the web rendition, so re-encoding it is pure loss.
 *
 * ---------------------------------------------------------------------------
 * Here rather than in `functions/src/galleries.ts` because it is the one
 * judgement in the transcode pipeline with a wrong answer in both directions,
 * and because a test can reach a pure function and cannot reach a Cloud
 * Function's handler.
 *
 * ## What it is for
 *
 * Every submitted photograph used to be encoded twice — once by the browser
 * (`downscalePhoto`) and again here — and WebP is lossy, so the second pass does
 * not preserve the first's quality, it re-quantises what the first already
 * quantised. Generation loss compounds fastest in smooth gradients, which is
 * where the first pass has already put its artefacts, so a sky or a wall or a
 * face out of focus is where it shows. Measured on a parish photograph, the
 * second pass changed the file size by about two per cent: it was throwing away
 * detail for no saving at all. Tommy: *"the quality drop is too significant."*
 *
 * ## Why every clause is checked rather than assumed
 *
 * The browser's downscale produces exactly this file, so it would be tempting to
 * decide from *who* uploaded it. That is not available and must not be invented:
 * `POST /api/gallery/upload-url` can be called by anything, so "our JavaScript
 * ran" is not a fact the server may hold. Every clause below is instead read out
 * of the bytes:
 *
 *  - **format** — anything else has to be converted anyway.
 *  - **the long edge** — anything larger has to be resized, which is a decode.
 *  - **orientation** — `.rotate()` is the load-bearing line in this pipeline; a
 *    phone writes the sensor orientation into a tag rather than rotating pixels,
 *    and skipping it would publish a third of a camp sideways.
 *  - **exif / xmp / iptc** — a phone photograph carries GPS coordinates, and
 *    these are pictures of other people's children. The full pass strips all
 *    metadata; a file with any of it present must take that pass. A canvas
 *    re-encode has none, which is what makes the browser's output eligible.
 *
 * So a hostile WebP with a GPS tag fails on the fourth clause and is stripped
 * exactly as before. The privacy property is preserved by testing for it.
 * ---------------------------------------------------------------------------
 */
export function isAlreadyWebReady(facts: ImageFacts, maxEdge: number = PHOTO_MAX_EDGE): boolean {
  const longEdge = Math.max(facts.width ?? 0, facts.height ?? 0);
  return (
    facts.format === 'webp' &&
    longEdge > 0 &&
    longEdge <= maxEdge &&
    (facts.orientation ?? 1) === 1 &&
    !facts.exif &&
    !facts.xmp &&
    !facts.iptc
  );
}
