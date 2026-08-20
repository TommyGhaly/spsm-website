/**
 * URLs for images in Firebase Storage.
 *
 * Why a URL is built by hand rather than fetched with `getDownloadURL`: most of
 * these resolve at build time in a static export. `getDownloadURL` is an
 * authenticated round trip per image and returns a URL containing a `token`
 * query parameter — a token that is baked into the HTML and is revoked whenever
 * anyone regenerates it in the console, at which point every portrait on the
 * deployed site breaks until the next build.
 *
 * The unauthenticated `?alt=media` form has neither problem. It works precisely
 * because `storage.rules` makes `clergy/`, `events/`, `products/`, `content/`,
 * and `galleries/` world-readable — which they must be, being images on a public
 * church website. Anything not world-readable in those rules cannot be served
 * this way, and should not be linked from a public page anyway. Point one of
 * these at `submissions/` and it 403s, which is the point of a quarantine.
 *
 * ---------------------------------------------------------------------------
 * ## Why the origin is a variable
 *
 * This file used to hardcode `firebasestorage.googleapis.com`, and
 * `features/programs/media.ts` grew its own copy of the same two values because
 * of it. That is the bug recorded at length in
 * `packages/shared/src/gallery/urls.ts`: with the whole site pointed at the
 * emulators, every `<img>` still resolved to production, so no local image could
 * load *and* a developer's machine quietly fetched from the parish's real
 * bucket while believing it was isolated.
 *
 * There is now one bucket and one origin for the whole build, resolved here, and
 * every reader — clergy portraits, content images, event hero images, gallery
 * renditions — goes through it.
 * ---------------------------------------------------------------------------
 */
import { FIREBASE_STORAGE_ORIGIN, mediaUrl } from '@spsm/shared';
import { usingEmulators } from './firebase';

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` by literal textual match, so the
 * name is spelled out rather than looked up.
 */
export function storageBucket(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '';
}

/**
 * The Storage emulator serves the same `/v0/b/{bucket}/o/{path}` shape as the
 * real thing, so pointing at it is a host swap and nothing more.
 *
 * `connectStorageEmulator` in `lib/firebase.ts` only redirects calls made
 * *through the SDK*. These URLs are built by hand — deliberately, per the note
 * above — so they bypass that entirely and have to be redirected here as well.
 */
export function storageOrigin(): string {
  return usingEmulators() ? 'http://127.0.0.1:9199' : FIREBASE_STORAGE_ORIGIN;
}

/**
 * @param path an object path within the bucket, like `clergy/fr-armia.webp`.
 *   This is what `ClergyBio.portraitPath` and `Event.heroImagePath` hold.
 * @returns the public URL, or null when there is no path or the bucket is not
 *   configured — in which case callers must render without the image rather than
 *   emitting a broken `src`. A missing portrait is a gap; a broken image icon
 *   looks like a fault.
 */
export function storageUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  const bucket = storageBucket();
  if (!bucket) {
    console.warn(
      `[storage] NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is unset, so "${path}" cannot be ` +
        `resolved to a URL. The image will be omitted.`,
    );
    return null;
  }

  // Leading slashes are a common way to write these by hand and produce a path
  // that 404s in a way nothing explains.
  //
  // The encoding of the rest is `mediaUrl`'s job: the whole path is one path
  // segment in this API's URL space, so the slashes inside it are
  // percent-encoded too. Getting that wrong yields a 400 that reads like a
  // permissions problem.
  return mediaUrl(bucket, path.replace(/^\/+/, ''), storageOrigin());
}

/**
 * The same thing for a caller that already holds a real path and renders an
 * `<img>` directly, where `string | null` would only be widened back.
 *
 * Falls back to the empty string rather than throwing when the bucket is
 * missing: a misconfigured environment should show a missing image on a staff
 * screen, not unmount the form somebody is typing into.
 */
export function publicStorageUrl(path: string): string {
  return storageUrl(path) ?? '';
}
