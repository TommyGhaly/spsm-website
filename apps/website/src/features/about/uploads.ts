'use client';

import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import type { AboutSlug } from '@spsm/shared';
import { firebaseApp } from '@/lib/firebase';
import { explainUploadFailure } from '@/lib/storageErrors';
import { checkImageFile, safeName, type UploadResult } from '@/lib/uploadNaming';

/**
 * A photograph for an About page, uploaded by staff.
 *
 * ---------------------------------------------------------------------------
 * Filed under `content/about/{slug}/`, which needed no new rule: `storage.rules`
 * already carries `match /content/{allPaths=**}` with `allow read: if true` and
 * `create, update: if hasScreen('content') && isImage()`. The same flag governs
 * the Firestore document, which is what makes the pair coherent — somebody who
 * can write the words can write the picture, and nobody else can do either.
 *
 * Returns the download URL rather than a path, because the folder is
 * world-readable and a URL is what `AboutImage.src` holds and what an
 * `<img src>` needs. Contrast `uploadFormPhoto`, which returns a path precisely
 * because *its* folder is a quarantine nobody can read back.
 *
 * ## No derivatives, and the picker is where that is answered
 *
 * The coded plates have a srcset because `optimize-assets.mjs` built a 640 and
 * a 1280 of each at commit time. Nothing can do that in a browser, so an
 * uploaded photograph is served at whatever size it was uploaded at — which is
 * why the picker offers every picture the site already ships first, and the
 * upload second. A parish photograph of the hall is worth a large file; a
 * replacement for a plate that already has one is not.
 * ---------------------------------------------------------------------------
 */
export async function uploadAboutPicture(slug: AboutSlug, file: File): Promise<UploadResult> {
  const problem = checkImageFile(file);
  if (problem) return { ok: false, reason: problem };

  const path = `content/about/${slug}/${safeName(file.name)}`;

  try {
    const target = ref(getStorage(firebaseApp()), path);
    await uploadBytes(target, file, { contentType: file.type });
    return { ok: true, path, url: await getDownloadURL(target) };
  } catch (error) {
    console.error('[about] picture upload failed', error);
    return { ok: false, reason: (await explainUploadFailure(error)).message };
  }
}
