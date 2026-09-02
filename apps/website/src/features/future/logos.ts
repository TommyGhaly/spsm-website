import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The consultants' logos that ship in the bundle, indexed by firm slug.
 *
 * ---------------------------------------------------------------------------
 * **Read off the filesystem rather than emitted and hoped for**, which is the
 * same call `features/content/portraits.ts` makes for the clergy and for the
 * same reason: the obvious version — print `/img/future/logos/${slug}.webp` for
 * every firm in `TEAM` — puts nine broken images on the page the moment one
 * file is missing, and two of the nine have no published mark at all. Listing
 * the directory once means a firm without artwork renders as its name, which is
 * a complete row rather than a hole.
 *
 * This is a static export. Every call here happens during `next build`; nothing
 * in this file reaches the browser.
 *
 * The marks themselves are **third-party trademarks**, used to identify the
 * firms working on this project and nothing else. They are resized and
 * converted to WebP and not otherwise touched — no crop, no recolour, no
 * redraw. Same treatment, and same reasoning, as the app icons on /apps; see
 * `assets/README.md`.
 * ---------------------------------------------------------------------------
 */

/** Where `optimize-assets.mjs` writes them, relative to the Next project root. */
const LOGO_DIR = join(process.cwd(), 'public', 'img', 'future', 'logos');

export interface TeamLogo {
  src: string;
  srcSet: string;
}

/**
 * Read once per build rather than once per firm. Nine `existsSync` calls is not
 * the cost; a directory read inside a render loop is the kind of thing that
 * quietly becomes ninety when the loop grows.
 */
let cache: Set<string> | null = null;

function available(): Set<string> {
  if (cache) return cache;

  if (!existsSync(LOGO_DIR)) {
    /*
     * Deliberately quiet, unlike the clergy portraits' warning. That directory
     * is expected to exist and its absence means a path bug; this one legally
     * may not exist — nobody has to give a church permission to publish their
     * mark, and the page is designed to read correctly without any of them.
     *
     * **And deliberately not cached.** Every other branch here memoises,
     * because a build reads this once per page and a directory read inside a
     * render loop is how three calls quietly become ninety. Caching *absence*
     * is different: it is the state that changes. `npm run assets` creates this
     * directory the first time a mark is added, and a dev server that has
     * already looked once would go on rendering no band until somebody thinks
     * to restart it — which is exactly what happened the day the marks arrived.
     * A `existsSync` per page on a page that does not exist yet is free.
     */
    return new Set();
  }

  cache = new Set(
    readdirSync(LOGO_DIR)
      .filter((file) => file.endsWith('-240.webp'))
      .map((file) => file.slice(0, -'-240.webp'.length)),
  );
  return cache;
}

/** The bundled logo for a firm slug, or null if we do not have one. */
export function teamLogo(slug: string): TeamLogo | null {
  if (!available().has(slug)) return null;

  return {
    src: `/img/future/logos/${slug}-240.webp`,
    srcSet: `/img/future/logos/${slug}-240.webp 240w, /img/future/logos/${slug}-480.webp 480w`,
  };
}

/**
 * Whether *any* logo was built.
 *
 * The row of marks is a different thing from the list of names: one is a wall
 * of trademarks, the other is the actual information. With no artwork at all
 * the row would be nine empty boxes, so the component drops it entirely — which
 * is why this is a separate question from `teamLogo`.
 */
export function haveAnyLogos(): boolean {
  return available().size > 0;
}
