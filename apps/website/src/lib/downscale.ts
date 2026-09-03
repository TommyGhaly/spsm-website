/**
 * Shrinking a photograph in the browser, before it is uploaded.
 *
 * ---------------------------------------------------------------------------
 * This is a cost measure, not a security one, and the distinction matters.
 *
 * A parishioner's phone photograph is routinely 12MB. Sent as-is, the parish
 * pays to store it, pays to serve it, and pays for a Cloud Function to read all
 * of it back out again to make a web rendition. Re-encoded here first it is a
 * few hundred kilobytes, and every one of those costs falls with it.
 *
 * None of that stops an attacker, who simply does not run this file — they call
 * the upload endpoint directly. The endpoint's own size check is the
 * enforcement, and it has to be, because everything here happens on a machine
 * we do not control. Do not move a limit into this file and delete it there.
 *
 * ## Photographs are never refused
 *
 * The ladder below has no floor at which it gives up. Each rung tries harder,
 * and the last one sends whatever it managed — because the person on the other
 * end is somebody's grandmother with forty pictures of the camp, and telling
 * her that her photograph is the wrong size is not a thing this site does. The
 * only file that can still be refused for its size is a video, and only because
 * a browser cannot re-encode one.
 *
 * ## The two things that are easy to get wrong
 *
 * **EXIF orientation.** A phone does not rotate the pixels it captures; it
 * writes the sensor orientation into a tag and leaves the image on its side.
 * `createImageBitmap(file)` on its own ignores that tag in some engines, and a
 * canvas has no metadata to carry it in, so the re-encode would bake the
 * sideways image in permanently and the original would still look fine when you
 * went to check. `{ imageOrientation: 'from-image' }` is what prevents that and
 * is not optional.
 *
 * **The failure direction.** Every error path here returns the original file
 * rather than throwing. A browser too old to encode WebP, an image `decode()`
 * chokes on, a canvas that comes back null: all of them end with the photograph
 * being uploaded unshrunk, which costs money and works, rather than with a
 * refusal, which costs nothing and loses the photograph.
 * ---------------------------------------------------------------------------
 */
import {
  PHOTO_BUDGET_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_QUALITY,
} from '@spsm/shared';

/** What came back, and what it cost. */
export interface Downscaled {
  /** The bytes to upload. The original itself, if nothing better was possible. */
  blob: Blob;
  /** The content type of `blob` — not necessarily the original's. */
  contentType: string;
  /** What it was, for the note the submitter is shown. */
  originalBytes: number;
  /** Whether this is genuinely a re-encode rather than the original passed through. */
  changed: boolean;
}

/**
 * The rungs, in order. Quality falls before the edge does.
 *
 * Deliberately: dropping WebP quality from 82 to 62 is close to invisible on a
 * photograph of a room full of people, while dropping the long edge is a
 * permanent loss of detail that shows the moment anybody opens the picture
 * full-screen. Only the last rung gives up resolution, and by then the file is
 * pathological — a panorama or a flatbed scan rather than a photograph.
 */
const LADDER: ReadonlyArray<{ edge: number; quality: number }> = [
  { edge: PHOTO_MAX_EDGE, quality: PHOTO_QUALITY },
  { edge: PHOTO_MAX_EDGE, quality: 72 },
  { edge: PHOTO_MAX_EDGE, quality: 62 },
  { edge: 2048, quality: 62 },
];

/** Whether this browser can encode WebP at all. Asked once. */
let webpSupport: boolean | null = null;

function canEncodeWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    webpSupport = probe.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

/** `canvas.toBlob` as a promise, null rather than throwing on refusal. */
function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Draw a bitmap at one rung and encode it.
 *
 * `withoutEnlargement` semantics are kept by the `Math.min(1, …)`: a picture
 * already smaller than the target edge is drawn at its own size rather than
 * blown up, which would cost bytes to add nothing.
 */
async function render(
  bitmap: ImageBitmap,
  edge: number,
  quality: number,
  type: string,
): Promise<Blob | null> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return encode(canvas, type, quality);
}

/**
 * Prepare one photograph for upload.
 *
 * Always resolves. The worst case is the original file handed straight back,
 * which is a working upload rather than a lost photograph.
 */
export async function downscalePhoto(file: File): Promise<Downscaled> {
  const passthrough: Downscaled = {
    blob: file,
    contentType: file.type,
    originalBytes: file.size,
    changed: false,
  };

  // An animated GIF loses its animation through a canvas, and an SVG has no
  // business being re-rastered. Neither is what anybody submits from a camp.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return passthrough;

  const type = canEncodeWebp() ? 'image/webp' : 'image/jpeg';

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Not decodable here — an unusual HEIC, most likely. The Function has sharp
    // and will very probably manage it, so send the original and let it try.
    return passthrough;
  }

  try {
    let best: Blob | null = null;

    for (const rung of LADDER) {
      // JPEG's quality scale is not WebP's; 0.86 is the visual match for 82,
      // and the fallback path is rare enough not to deserve its own ladder.
      const quality = type === 'image/webp' ? rung.quality / 100 : 0.86;
      const encoded = await render(bitmap, rung.edge, quality, type);
      if (!encoded) break;

      best = encoded;
      if (encoded.size <= PHOTO_BUDGET_BYTES) break;
    }

    // Nothing encoded at all: send the original.
    if (!best) return passthrough;

    /*
     * The one case where the original wins. A picture that is already small and
     * well compressed — a web-sized JPEG somebody saved off a message — can come
     * out of a re-encode *larger* than it went in. Sending the bigger of the two
     * would be absurd, and the note in the UI would then have to explain that
     * we grew their file.
     */
    if (best.size >= file.size) return passthrough;

    return {
      blob: best,
      contentType: type,
      originalBytes: file.size,
      changed: true,
    };
  } catch {
    return passthrough;
  } finally {
    bitmap.close();
  }
}

/**
 * The bookstore's older need: a data URL for Square's base64 upload body.
 *
 * Kept here so there is one implementation of the canvas dance rather than two.
 * It stays JPEG because Square re-encodes whatever it is given, and it takes a
 * smaller default edge because a product photograph is displayed on a card.
 */
export async function downscaleToDataUrl(file: File, max = 1600): Promise<string> {
  const asDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return asDataUrl(file);
  }

  try {
    const encoded = await render(bitmap, max, 0.86, 'image/jpeg');
    return encoded ? asDataUrl(encoded) : asDataUrl(file);
  } catch {
    return asDataUrl(file);
  } finally {
    bitmap.close();
  }
}
