'use client';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { toFormSlug } from '@spsm/shared';
import { firebaseApp } from '@/lib/firebase';
import { getStorage } from 'firebase/storage';
import { explainUploadFailure } from '@/lib/storageErrors';
import { checkImageFile, safeName, type UploadResult } from '@/lib/uploadNaming';
import { uploadHeaders } from '@/lib/uploadSession';
import { UNATTESTED } from '@/features/programs/submit';

/**
 * The endpoint, through the Hosting rewrite. Same origin, so no CORS.
 *
 * In local development this is a Next proxy rather than a Hosting rewrite, the
 * same arrangement `/api/gallery/upload-url` needs; see docs/local-dev.md.
 */
const UPLOAD_URL_ENDPOINT = '/api/forms/upload-url';

/**
 * Putting pictures into Storage — two paths, with opposite permissions.
 *
 * ---------------------------------------------------------------------------
 * `forms/` is staff writing. `formUploads/` is the public writing.
 *
 * They are separate prefixes in `storage.rules` rather than one folder with a
 * cleverer condition, because they want opposite things:
 *
 *   forms/        world-readable — it is the picture on a public card.
 *                 Staff-only write.
 *   formUploads/  NOT readable by anyone but staff. It holds photographs
 *                 members of the public send the parish, and a world-readable
 *                 quarantine would make every one of them findable by anyone
 *                 who guessed a path. Create-only, never overwrite.
 *
 * Collapsing them would mean one of those two is wrong.
 * ---------------------------------------------------------------------------
 */

/**
 * The only size left, and it applies to the public path alone.
 *
 * `isImage()` in storage.rules has no size in it any more — a staff photograph
 * of any size is fine, because a phone photograph routinely clears what used to
 * be an "8MB, generous" ceiling and the person hitting it has already been
 * trusted with the area. What stays bounded is the folder a *stranger* can
 * write to, and this is the polite half of that: the rule is the enforcement,
 * and checking here turns `storage/unauthorized` — which reads as "you are not
 * allowed" — into a sentence about the file. Keep the two numbers in step.
 */
const PUBLIC_MAX_BYTES = 250 * 1024 * 1024;

/*
 * `UploadResult`, `safeName` and the image-type check live in
 * `lib/uploadNaming` now — the About-pages editor uploads staff photographs
 * too, and a filename rule that differs between two upload paths is a filename
 * rule that is wrong in one of them. Re-exported because callers here import
 * the type from this module.
 */
export type { UploadResult };

/** The public attachment path, which keeps a bound. See `PUBLIC_MAX_BYTES`. */
function checkPublicFile(file: File): string | null {
  const problem = checkImageFile(file);
  if (problem) return problem;
  if (file.size > PUBLIC_MAX_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(0)}MB, which is too large to send.`;
  }
  return null;
}

/**
 * A picture for a form's card, uploaded by staff.
 *
 * Returns the download URL, because that is what `form.image` stores and what
 * an `<img src>` needs — this folder is world-readable, so a URL is the right
 * currency. Contrast `uploadFormPhoto` below, which returns a *path*.
 */
export async function uploadFormPicture(formId: string, file: File): Promise<UploadResult> {
  const problem = checkImageFile(file);
  if (problem) return { ok: false, reason: problem };

  const path = `forms/${toFormSlug(formId) || 'form'}/${safeName(file.name)}`;

  try {
    const target = ref(getStorage(firebaseApp()), path);
    await uploadBytes(target, file, { contentType: file.type });
    return { ok: true, path, url: await getDownloadURL(target) };
  } catch (error) {
    console.error('[forms] picture upload failed', error);
    // "the Storage rules may not be deployed" was a guess, and it was the wrong
    // one the first time it mattered — see lib/storageErrors.ts.
    return { ok: false, reason: (await explainUploadFailure(error)).message };
  }
}

/**
 * A photograph attached by whoever is filling in a form.
 *
 * ---------------------------------------------------------------------------
 * This no longer writes to Storage, and cannot: `storage.rules` refuses every
 * client create under `formUploads/`. `POST /api/forms/upload-url` is what it
 * is refused in favour of.
 *
 * The rule it replaced was `allow create: if isImage() && size < 250MB &&
 * resource == null` — anonymous, uncounted, and correct only for as long as
 * App Check enforcement on the Storage service stood in front of it. That
 * enforcement came off on 2026-09-03 because it was also refusing every `<img>`
 * on the public site: an image tag cannot send an `X-Firebase-AppCheck` header,
 * so enforcing the service meant no photograph on the site could load at all.
 * The endpoint verifies attestation in its own code instead, which is why it is
 * unaffected by that setting either way — and it can additionally count the
 * day's uploads and check that the form is open, neither of which a storage
 * rule is able to ask.
 *
 * Returns a path, and deliberately never a URL. `formUploads/` is unreadable to
 * the person who just wrote to it — that is the point of the quarantine — so a
 * URL is not what should be stored anyway. The submission records the path; the
 * staff panel resolves it with a staff token when somebody reviews it.
 *
 * The thumbnail the person sees before submitting is a local `blob:` URL made
 * from the file they picked, never a round trip.
 * ---------------------------------------------------------------------------
 */
export async function uploadFormPhoto(
  formSlug: string,
  file: File,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  const problem = checkPublicFile(file);
  if (problem) return { ok: false, reason: problem };

  const slug = toFormSlug(formSlug);
  if (!slug) return { ok: false, reason: 'This form cannot accept photographs.' };

  try {
    const response = await fetch(UPLOAD_URL_ENDPOINT, {
      method: 'POST',
      headers: await uploadHeaders(),
      body: JSON.stringify({
        formSlug: slug,
        fileName: file.name,
        contentType: file.type,
        byteSize: file.size,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      /*
       * The one refusal with no self-service remedy, so it gets the one message
       * that names a way out. Shared verbatim with the gallery path, because it
       * is the same fault with the same cause and the same answer.
       */
      if (body.error === 'unattested') return { ok: false, reason: UNATTESTED };
      return { ok: false, reason: body.error ?? 'That photograph could not be sent.' };
    }

    const { uploadUrl, path, downloadToken } = (await response.json()) as {
      uploadUrl: string;
      path: string;
      downloadToken: string;
    };

    /*
     * Straight to the bucket. All three headers are part of what was signed —
     * the content type, the exact length, and the download token the staff
     * panel needs to be able to see this at all. A mismatch on any of them is
     * refused by Cloud Storage rather than quietly accepted, so none of them is
     * decoration.
     */
    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type,
        'x-goog-content-length-range': `${file.size},${file.size}`,
        'x-goog-meta-firebaseStorageDownloadTokens': downloadToken,
      },
      body: file,
    });

    if (!upload.ok) {
      console.error('[forms] photo upload failed', upload.status, await upload.text());
      return { ok: false, reason: 'That photograph could not be sent. Please try again.' };
    }

    return { ok: true, path };
  } catch (error) {
    console.error('[forms] photo upload failed', error);
    return { ok: false, reason: (await explainUploadFailure(error)).message };
  }
}

/**
 * A staff-readable URL for a quarantined photograph.
 *
 * Only ever called from the submissions panel, which is behind the staff claim.
 * For anybody else the rules refuse the read and this rejects — which is the
 * intended behaviour, not a bug to work around.
 */
export async function readFormPhotoUrl(path: string): Promise<string | null> {
  try {
    return await getDownloadURL(ref(getStorage(firebaseApp()), path));
  } catch {
    return null;
  }
}
