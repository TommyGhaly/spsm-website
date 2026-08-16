/**
 * URLs for images in Firebase Storage.
 *
 * Why a URL is built by hand rather than fetched with `getDownloadURL`: this is
 * a static export, so these resolve at build time. `getDownloadURL` is an
 * authenticated round trip per image and returns a URL containing a `token`
 * query parameter — a token that is baked into the HTML and is revoked whenever
 * anyone regenerates it in the console, at which point every portrait on the
 * deployed site breaks until the next build.
 *
 * The unauthenticated `?alt=media` form has neither problem. It works precisely
 * because `storage.rules` makes `clergy/`, `events/`, `products/`, and
 * `content/` world-readable — which they must be, being images on a public
 * church website. Anything not world-readable in those rules cannot be served
 * this way, and should not be linked from a public page anyway.
 */

/**
 * @param path an object path within the bucket, like `clergy/fr-armia.webp`.
 *   This is what `ClergyBio.portraitPath` holds.
 * @returns the public URL, or null when the bucket is not configured — in which
 *   case callers must render without the image rather than emitting a broken
 *   `src`. A missing portrait is a gap; a broken image icon looks like a fault.
 */
export function storageUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket) {
    console.warn(
      `[storage] NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is unset, so "${path}" cannot be ` +
        `resolved to a URL. The image will be omitted.`,
    );
    return null;
  }

  // Leading slashes are a common way to write these by hand and produce a path
  // that 404s in a way nothing explains.
  const objectPath = path.replace(/^\/+/, '');

  // The whole path is one path segment in this API's URL space, so the slashes
  // inside it must be percent-encoded too — `encodeURIComponent`, not
  // `encodeURI`. Getting this wrong yields a 400 that reads like a permissions
  // problem.
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    objectPath,
  )}?alt=media`;
}
