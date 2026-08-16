import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Clergy portraits that ship in the bundle, indexed by content slug.
 *
 * ---------------------------------------------------------------------------
 * Why the filesystem is read at all.
 *
 * The portraits are written by `scripts/optimize-assets.mjs` into
 * `public/img/clergy/<slug>.webp`, named after the content slug, so the
 * renderer can find a father's photograph without a lookup table in code
 * mapping people to files. The obvious version of that — emit
 * `/img/clergy/${slug}.webp` and hope — puts a broken image on the homepage
 * the day a fourth priest is appointed and no photograph exists yet.
 *
 * So the directory is listed instead, once, and only slugs that actually have a
 * file get an `<img>`. This is a static export: every one of these calls
 * happens during `next build`, and nothing here reaches the browser.
 * ---------------------------------------------------------------------------
 *
 * These are the fallback, not the source of truth. `person.portraitPath` — a
 * Firebase Storage path staff can set without a deploy — still wins where it is
 * set; see the caller. The bundle is what serves until someone uploads one.
 */

/** Where `optimize-assets.mjs` writes them, relative to the Next project root. */
const PORTRAIT_DIR = join(process.cwd(), 'public', 'img', 'clergy');

export interface BundledPortrait {
  src: string;
  /** 400w and 800w, for a 2× and 3× panel. */
  srcSet: string;
  width: number;
  height: number;
}

/**
 * Read once per build rather than per father: three `existsSync` calls is not
 * the cost, but a directory read inside a render loop is the kind of thing that
 * quietly becomes a hundred when the loop gets bigger.
 */
let cache: Set<string> | null = null;

function available(): Set<string> {
  if (cache) return cache;

  if (!existsSync(PORTRAIT_DIR)) {
    // Loud, because the alternative is portraits silently disappearing from the
    // homepage if this ever runs with a working directory other than the Next
    // project root — which looks like missing content, not like a path bug.
    console.warn(
      `[portraits] ${PORTRAIT_DIR} does not exist, so no bundled clergy portrait ` +
        `will be rendered. Run \`npm run assets\`; if the directory is there, this ` +
        `process is running from somewhere other than apps/website.`,
    );
    cache = new Set();
    return cache;
  }

  cache = new Set(
    readdirSync(PORTRAIT_DIR)
      .filter((file) => file.endsWith('.webp') && !file.includes('@'))
      .map((file) => file.slice(0, -'.webp'.length)),
  );
  return cache;
}

/** The bundled portrait for a content slug, or null if none was produced. */
export function bundledPortrait(slug: string): BundledPortrait | null {
  if (!available().has(slug)) return null;

  return {
    src: `/img/clergy/${slug}.webp`,
    srcSet: `/img/clergy/${slug}.webp 400w, /img/clergy/${slug}@2x.webp 800w`,
    // The 4:5 the build crops every portrait to, stated so the row does not
    // reflow when the images land.
    width: 400,
    height: 500,
  };
}
