import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Book covers that ship in the bundle, indexed by product slug.
 *
 * The same arrangement as `features/content/portraits.ts`, for the same reason:
 * the directory is listed once at build time, and only slugs that actually have
 * a file get an `<img>`. Emitting `/img/products/${slug}.webp` and hoping puts a
 * broken image on the shop the first time a book is added in Square and the
 * covers have not been re-synced.
 *
 * ---------------------------------------------------------------------------
 * These are the *preferred* source, not a fallback — the opposite of portraits.
 *
 * `Product.imagePaths` holds Square's own CDN URLs, which always work and are
 * always current. They are also the parish's original photographs: mostly
 * 3105×3105 JPEGs, 37.75 MB across the nine covers that have one, and there is
 * no resize parameter to ask S3 for something smaller.
 *
 * So `scripts/sync-catalog.mjs` writes optimised WebP copies here, and this is
 * what the shop shows when it exists. Square's URL remains in the document as
 * the honest source of truth and as the fallback for a product synced after the
 * last cover run — a slow image beats no image, and both beat a build that has
 * to be re-run before a new book can appear.
 * ---------------------------------------------------------------------------
 *
 * This is a static export: every call here happens during `next build`, and
 * nothing in this file reaches the browser.
 */

/** Where `sync-catalog.mjs` writes them, relative to the Next project root. */
const COVER_DIR = join(process.cwd(), 'public', 'img', 'products');

export interface BundledCover {
  src: string;
  /** 400w and 800w, for a 2× panel. */
  srcSet: string;
}

/**
 * Read once per build rather than per product. Eleven `existsSync` calls is not
 * the cost; a directory read inside a render loop is the kind of thing that
 * quietly becomes a hundred when the catalog grows.
 */
let cache: Set<string> | null = null;

function available(): Set<string> {
  if (cache) return cache;

  if (!existsSync(COVER_DIR)) {
    // Quiet rather than loud, unlike portraits: an unsynced catalog is an
    // ordinary state here — every product still renders, using Square's URL —
    // whereas a missing clergy portrait directory means the homepage lost its
    // photographs. Worth a line on the build log, not a warning.
    cache = new Set();
    return cache;
  }

  cache = new Set(
    readdirSync(COVER_DIR)
      .filter((file) => file.endsWith('.webp') && !file.includes('@'))
      .map((file) => file.slice(0, -'.webp'.length)),
  );
  return cache;
}

/** The bundled cover for a product slug, or null if none has been produced. */
export function bundledCover(slug: string): BundledCover | null {
  if (!available().has(slug)) return null;

  return {
    src: `/img/products/${slug}.webp`,
    srcSet: `/img/products/${slug}.webp 400w, /img/products/${slug}@2x.webp 800w`,
  };
}
