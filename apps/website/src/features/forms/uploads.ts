'use client';

import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { FORM_UPLOAD_PREFIX, toFormSlug } from '@spsm/shared';
import { firebaseApp } from '@/lib/firebase';
import { getStorage } from 'firebase/storage';

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

export type UploadResult =
  | { ok: true; path: string; url: string }
  | { ok: false; reason: string };

/**
 * A filename that cannot collide and cannot escape its folder.
 *
 * The original name is kept as a suffix because it is genuinely useful to staff
 * reviewing a queue — "dented-wing.jpg" beats an opaque id — but it is stripped
 * to a safe character set first. A name arrives from a file picker, which means
 * it arrives from the person's disk, which means it can contain anything.
 */
function safeName(original: string): string {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  const cleaned = original
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-40);
  return `${stamp}${random}-${cleaned || 'photo'}`;
}

/**
 * Staff uploads: the file has to be an image, and nothing else is asked of it.
 *
 * The type check is not about size. A bucket that accepts `text/html` from a
 * browser is one that will serve it back on our own domain to whoever follows
 * a link, so `isImage()` still refuses it in the rules and this says so first.
 */
function checkFile(file: File): string | null {
  return file.type.startsWith('image/') ? null : 'That is not an image file.';
}

/** The public attachment path, which keeps a bound. See `PUBLIC_MAX_BYTES`. */
function checkPublicFile(file: File): string | null {
  const problem = checkFile(file);
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
  const problem = checkFile(file);
  if (problem) return { ok: false, reason: problem };

  const path = `forms/${toFormSlug(formId) || 'form'}/${safeName(file.name)}`;

  try {
    const target = ref(getStorage(firebaseApp()), path);
    await uploadBytes(target, file, { contentType: file.type });
    return { ok: true, path, url: await getDownloadURL(target) };
  } catch (error) {
    console.error('[forms] picture upload failed', error);
    return {
      ok: false,
      reason:
        'The upload was refused. If you are signed in as staff and this keeps ' +
        'happening, the Storage rules may not be deployed.',
    };
  }
}

/**
 * A photograph attached by whoever is filling in a form.
 *
 * ---------------------------------------------------------------------------
 * Returns a path, and deliberately never a URL.
 *
 * `formUploads/` is unreadable to the person who just wrote to it — that is the
 * point of the quarantine — so `getDownloadURL` would fail here, and a URL is
 * not what should be stored anyway. The submission records the path; the staff
 * panel resolves it to a URL with a staff token when somebody reviews it.
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

  const path = `${FORM_UPLOAD_PREFIX}/${slug}/${safeName(file.name)}`;

  try {
    await uploadBytes(ref(getStorage(firebaseApp()), path), file, { contentType: file.type });
    return { ok: true, path };
  } catch (error) {
    console.error('[forms] photo upload failed', error);
    return { ok: false, reason: 'The photograph could not be uploaded. Please try again.' };
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
