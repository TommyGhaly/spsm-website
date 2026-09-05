/**
 * Sending a photograph to a program gallery, with no account.
 *
 * ---------------------------------------------------------------------------
 * This file used to write to Cloud Storage and Firestore directly. It no longer
 * writes to either, and cannot: `storage.rules` refuses every client write to
 * `submissions/` and `firestore.rules` refuses every client create of
 * `galleryMedia`. Both doors are shut, and `POST /api/gallery/upload-url` is
 * what they are shut in favour of.
 *
 * The reason is the ordering this file used to explain at length. The bytes
 * went first and the document second — the right way round, because a document
 * with no file behind it is worse than a file with no document — but it meant
 * that every check the project had lived in the *second* step. A script that
 * uploaded and simply never wrote the document skipped all of them, and left
 * objects in a billed bucket that never appeared in the review queue, so nobody
 * would have noticed. No rule fixes that, because the two writes are to two
 * different services and only one of them was ever guarded.
 *
 * What happens now, per file:
 *
 *   1. the photograph is condensed here in the browser (`downscalePhoto`)
 *   2. the endpoint is asked for a signed URL, and decides whether it may
 *   3. the bytes are `PUT` to that URL, straight to the bucket
 *
 * The endpoint writes the document in step 2. Nothing in this file does.
 *
 * ## What is left here, and why it is still worth doing
 *
 * Condensing, and the size check that goes with it, are a courtesy and a cost
 * saving rather than enforcement — an attacker skips this file entirely. They
 * stay because they make a batch of forty photographs upload in a minute
 * instead of twenty, and because somebody who picks a 400MB video should be
 * told before they wait for it rather than after.
 * ---------------------------------------------------------------------------
 */
import { uploadHeaders } from '@/lib/uploadSession';
import { downscalePhoto } from '@/lib/downscale';
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  worthMentioning,
  maxBytesFor,
  formatBytes,
  type MediaKind,
  type Program,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/** What one file is doing, for the list the submitter watches. */
export type SubmissionState =
  | { kind: 'waiting' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'failed'; message: string };

/**
 * The endpoint, through the Hosting rewrite. Same origin, so no CORS.
 *
 * In local development this is a Next proxy rather than a Hosting rewrite, the
 * same arrangement `/api/square/checkout` needs; see docs/local-dev.md.
 */
const UPLOAD_URL_ENDPOINT = '/api/gallery/upload-url';

/**
 * A photograph and a clip are different documents downstream, and the browser
 * already knows which is which.
 */
export function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/**
 * What the submitter is told about one file before anything is sent.
 *
 * `null` means there is nothing to say. This is deliberately not a validation
 * result: a photograph never fails, whatever its size, so the only refusal this
 * can carry is a video that is too large to be sent at all.
 */
export interface Prepared {
  file: File;
  kind: MediaKind;
  /** Set when the file cannot be sent. Only ever a video. */
  refusal: string | null;
  /** Set when it will be sent, but smaller than it arrived. */
  note: string | null;
  /** The bytes to send, once condensing has run. */
  payload: Blob;
  contentType: string;
}

/**
 * Condense a photograph and work out what to say about it.
 *
 * Runs when the file is *chosen*, not when it is sent, and that is the point:
 * the note has to be on screen before the upload starts, so that nobody is
 * surprised afterwards by what left their laptop.
 */
export async function prepare(file: File, isProgramAdmin: boolean): Promise<Prepared> {
  const kind = kindOf(file);
  if (!kind) {
    return {
      file,
      kind: 'photo',
      refusal: 'That file is not a photograph or a video.',
      note: null,
      payload: file,
      contentType: file.type,
    };
  }

  /*
   * A video, which cannot be made smaller here. There is no dependable
   * client-side transcode — `MediaRecorder` and WebCodecs vary too much across
   * Safari and phones to promise one — and the Function does not do video
   * either. So this is the single remaining place the site tells somebody their
   * file is too big, and the message says what the limit actually is.
   */
  if (kind === 'video') {
    /*
     * An administrator has no ceiling at all — `maxBytesFor` returns `Infinity`
     * for them, and this comparison is the browser saying the same sentence
     * before the upload starts rather than after it. Read from the shared
     * function rather than written out, because a browser that refused what the
     * endpoint would have accepted is a feature that looks broken and logs
     * nothing.
     */
    const ceiling = maxBytesFor('video', isProgramAdmin);
    const tooBig = file.size > ceiling;
    return {
      file,
      kind,
      refusal: tooBig
        ? `That clip is ${formatBytes(file.size)}. Videos have to be under ${formatBytes(ceiling)} — a photograph can be any size, but a video cannot be made smaller in a web browser.`
        : null,
      note: null,
      payload: file,
      contentType: file.type,
    };
  }

  /*
   * An administrator's own photograph goes up untouched. They are choosing and
   * exporting a file deliberately rather than emptying a camera roll, and the
   * gallery is theirs — if they want the full-resolution original in it, that
   * is a decision they are entitled to make.
   */
  if (isProgramAdmin) {
    return { file, kind, refusal: null, note: null, payload: file, contentType: file.type };
  }

  const result = await downscalePhoto(file);

  /*
   * Told only when it is worth telling.
   *
   * Every photograph goes through the re-encode, so a note on all of them would
   * be wallpaper nobody reads. The threshold is what separates "this was
   * resized, as everything is" from "this is a phone photograph and it is now a
   * twentieth of the size", which is the case somebody might actually want to
   * know about.
   */
  const worthSaying = result.changed && worthMentioning(file.size, result.blob.size);

  return {
    file,
    kind,
    refusal: null,
    note: worthSaying
      ? `${formatBytes(file.size)} → ${formatBytes(result.blob.size)}, condensed`
      : null,
    payload: result.blob,
    contentType: result.contentType,
  };
}

/** The refusal the endpoint sends when App Check will not attest the browser. */
export const UNATTESTED =
  'These photographs could not be sent from this browser — a privacy extension or a very ' +
  'old browser will do it. Please try another browser, or email them to the church office.';

/**
 * Send one prepared file.
 *
 * `event` is the level the submitter chose, which need not be the level whose
 * page they are standing on. The endpoint checks that the level really belongs
 * to the ministry; a stranger's opinion about where a photograph goes is
 * checked rather than trusted, and the queue is what turns it into a fact.
 */
export async function submitOne(
  prepared: Prepared,
  event: { id: string; programId: string },
): Promise<void> {
  if (prepared.refusal) throw new Error(prepared.refusal);

  const response = await fetch(UPLOAD_URL_ENDPOINT, {
    method: 'POST',
    headers: await uploadHeaders(),
    body: JSON.stringify({
      programId: event.programId,
      programEventId: event.id,
      contentType: prepared.contentType,
      byteSize: prepared.payload.size,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    /*
     * The one refusal with no self-service remedy, so it gets the one message
     * that names a way out. App Check enforcement cannot be selective: a
     * visitor with a hard privacy blocker or a very old browser fails it
     * through no fault of their own, and leaving them at "upload failed" would
     * be the cruellest error on the site.
     */
    if (body.error === 'unattested') throw new Error(UNATTESTED);
    throw new Error(body.error ?? 'That photograph could not be sent. Please try again.');
  }

  const { uploadUrl } = (await response.json()) as { uploadUrl: string };

  /*
   * Straight to the bucket. The signed URL is pinned to this object name, this
   * content type and this exact length, so the headers are not decoration —
   * a mismatch is refused by Cloud Storage rather than quietly accepted.
   */
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': prepared.contentType,
      'x-goog-content-length-range': `${prepared.payload.size},${prepared.payload.size}`,
    },
    body: prepared.payload,
  });

  if (!upload.ok) {
    /*
     * The document already exists at this point, with `sourceUploaded: false`.
     * Nothing is done about it here on purpose: the hourly sweep in
     * `functions/src/galleries/orphans.ts` removes it, which is more reliable
     * than a cleanup call from a browser that may be the thing that just died.
     */
    throw new Error('That photograph could not be sent. Please try again.');
  }
}

/**
 * Whether this ministry is still collecting, read fresh before a batch.
 *
 * A courtesy now rather than a necessity: the endpoint reads the same flag and
 * is the thing that decides, so a stale `true` here costs one refused upload
 * with a clear message rather than, as it once did, a stored file and a lost
 * submission. It stays because refusing forty photographs one at a time after
 * the fact is a worse afternoon than not offering the form.
 *
 * The **program**, not the level, and absent means open — matching the endpoint
 * exactly. A default that disagreed would hide a form the endpoint would have
 * accepted, or offer one it will refuse.
 */
export async function programAcceptsSubmissions(programId: string): Promise<boolean> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.programs, programId));
  if (!snapshot.exists()) return false;
  return (snapshot.data() as Program).submissionsOpen !== false;
}
