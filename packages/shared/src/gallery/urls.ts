/**
 * Turning a stored path into something an `<img>` can load.
 *
 * `GalleryMedia.renditionPath` is a Storage path (`galleries/…/x.webp`), never
 * a URL — the same rule the rest of the schema follows, because a URL baked
 * into a document is a URL that cannot be changed when the bucket moves.
 *
 * ## Why this builds the URL rather than calling `getDownloadURL`
 *
 * `getDownloadURL()` is an async network round trip **per image**, and it
 * returns a URL carrying a `?token=` — a per-object access token that exists to
 * let a *private* object be shared. Neither property is wanted here:
 *
 *   - a gallery renders forty photographs at once, so forty round trips have to
 *     resolve before anything appears, on a page whose whole cost model is
 *     already "client-rendered, so first paint is slow"
 *   - `galleries/` is `allow read: if true` in storage.rules. The object is
 *     public. A token guarding a public object is ceremony
 *
 * The unauthenticated media endpoint below serves any object the rules make
 * world-readable, needs no token and no SDK call, and the resulting URL is
 * stable — so a browser and a CDN can both cache it.
 *
 * The consequence, stated so it is not discovered later: **this only works for
 * paths the rules make public.** Point it at `submissions/` and it 403s, which
 * is correct — quarantine is unreadable by everyone, deliberately.
 */

/** Where Firebase serves object bytes from in production. */
export const FIREBASE_STORAGE_ORIGIN = 'https://firebasestorage.googleapis.com';

/**
 * @param bucket `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, e.g.
 *               `spsm-database.firebasestorage.app`.
 * @param path   A storage path. Every segment is encoded, including the
 *               slashes — the Firebase media API takes the whole object name as
 *               one path parameter, so an unencoded `/` reads as a URL
 *               separator and the request 404s.
 * @param origin The host serving the bytes. Defaults to production.
 *
 * **The origin is a parameter because it was once hardcoded, and that was a
 * bug worth remembering.** With the whole site pointed at the emulators, every
 * `<img>` still resolved to `firebasestorage.googleapis.com` — so no gallery
 * image could ever load locally (the layout editor and the presentation would
 * have been built against grey boxes), and a developer's machine quietly
 * fetched from the parish's real bucket while believing it was isolated.
 */
export function mediaUrl(
  bucket: string,
  path: string,
  origin: string = FIREBASE_STORAGE_ORIGIN,
): string {
  return `${origin}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

/**
 * The URL for one item, or null when there is nothing to show yet.
 *
 * Null is a real state rather than a defensive check: a photograph is approved
 * the moment an administrator says so, and the transcode Function writes
 * `renditionPath` some seconds later. In between, the document is approved,
 * publicly readable, and has no displayable file — so a gallery has to be able
 * to render "this one is still processing" rather than a broken image.
 *
 * For a video this returns the poster frame. The clip itself is `videoUrl`,
 * because a grid should show a still and only fetch megabytes when somebody
 * asks to play it.
 */
export function posterUrlFor(
  bucket: string,
  media: { kind: string; renditionPath: string | null; posterPath: string | null },
  origin?: string,
): string | null {
  const path = media.kind === 'video' ? media.posterPath : media.renditionPath;
  return path === null ? null : mediaUrl(bucket, path, origin);
}

/** The clip itself. Null for a photograph, or a video still being processed. */
export function videoUrlFor(
  bucket: string,
  media: { kind: string; renditionPath: string | null },
  origin?: string,
): string | null {
  if (media.kind !== 'video' || media.renditionPath === null) return null;
  return mediaUrl(bucket, media.renditionPath, origin);
}

/**
 * `object-position` for a crop, from the focal point.
 *
 * A gallery cell has a fixed shape and the photograph does not, so something
 * gets cut. CSS crops from the centre by default, which is how a group
 * photograph loses the people on the ends. The focal point an administrator set
 * says what must survive; this is that point expressed as the percentage
 * `object-position` wants.
 */
export function focalPosition(focal: { x: number; y: number } | null | undefined): string {
  const x = clamp01(focal?.x ?? 0.5);
  const y = clamp01(focal?.y ?? 0.5);
  return `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}
