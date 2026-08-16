/**
 * Validator for the one bulletin field that carries presentation, not text.
 *
 * ---------------------------------------------------------------------------
 * Why the URL is not just used raw.
 *
 * `BulletinEvent.image` comes out of a Firestore project this site does not
 * own — `weeklyannouncements-1d046`, read through at build time and never
 * mirrored. The shared parser passes it across as whatever string it found,
 * deliberately, because its job is to be faithful to the source rather than to
 * guess at its meaning.
 *
 * That makes it **untrusted input on its way into a CSS `url()`.** Not a place
 * to put a string because it happened to be in a database: anyone with write
 * access to the announcements app — a different project, a different admin
 * list — would otherwise be choosing what the parish's homepage loads and from
 * where.
 *
 * So: an allow-list of hosts, and null for anything else. Null is always safe,
 * because every caller treats the picture as enrichment that may be absent —
 * about a third of a week's services have none, so the no-image path is the
 * normal path, not an error path.
 *
 * `BulletinEvent.color` is deliberately **not** validated or read here. The
 * editor's hex looked like a category system from one week's data — brown
 * liturgies, green classes — but Tommy confirmed on 2026-08-16 that it carries
 * no meaning, so presenting it as though it grouped anything was the site
 * inventing a taxonomy the parish does not have. Do not reintroduce it.
 * ---------------------------------------------------------------------------
 */

/**
 * Where the announcements project actually serves its images from.
 *
 * Both forms are in live data: the classic download host, and the newer
 * per-bucket domain. Anything else — including another Google host — is a
 * signal that the field no longer means what this code thinks it means.
 */
const IMAGE_HOST = 'firebasestorage.googleapis.com';
const IMAGE_HOST_SUFFIX = '.firebasestorage.app';

/**
 * Characters that would let a URL escape the `url("…")` it gets written into.
 *
 * `URL.toString()` percent-encodes all of these already, so this can only fire
 * if the parser's behaviour changes underneath us. It is here because the cost
 * of being wrong is a CSS injection and the cost of the check is nothing.
 */
const CSS_UNSAFE = /["'()\\\s]/;

/** The image URL if it is one we are willing to load, otherwise null. */
export function bulletinImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // `https` only. These are hotlinked into a page served over TLS, and an
  // `http` image would be blocked as mixed content anyway.
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (host !== IMAGE_HOST && !host.endsWith(IMAGE_HOST_SUFFIX)) return null;

  const normalised = url.toString();
  return CSS_UNSAFE.test(normalised) ? null : normalised;
}
