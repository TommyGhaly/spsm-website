/**
 * Naming and vetting a file somebody just picked off their own disk.
 *
 * Three features upload staff photographs now — forms, the About pages, and
 * the galleries — and the first two had the same forty lines twice. Moved here
 * rather than imported across a feature boundary, because a filename rule that
 * differs between two upload paths is a filename rule that is wrong in one of
 * them.
 */

export type UploadResult =
  | { ok: true; path: string; url: string }
  | { ok: false; reason: string };

/**
 * A filename that cannot collide and cannot escape its folder.
 *
 * The original name is kept as a suffix because it is genuinely useful to staff
 * reviewing a folder — "dented-wing.jpg" beats an opaque id — but it is
 * stripped to a safe character set first. A name arrives from a file picker,
 * which means it arrives from the person's disk, which means it can contain
 * anything.
 */
export function safeName(original: string): string {
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
 * browser is one that will serve it back on our own domain to whoever follows a
 * link, so `isImage()` still refuses it in the rules and this says so first.
 */
export function checkImageFile(file: File): string | null {
  return file.type.startsWith('image/') ? null : 'That is not an image file.';
}
