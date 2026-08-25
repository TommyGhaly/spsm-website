'use client';

import { useEffect, useState } from 'react';
import type { DocOf, Product } from '@spsm/shared';

/**
 * The product documents as Firestore actually holds them, keyed by slug.
 *
 * ---------------------------------------------------------------------------
 * Why the shop cannot just edit what it is already rendering.
 *
 * The shelf renders `ShopProduct`, which is the *shopper's* view of a book, and
 * it differs from the document in exactly the way that matters here: its
 * pictures are the build's optimised 800px WebP pair, not the Square CDN URLs in
 * `imagePaths`. Detaching a photograph needs the URL Square knows, so a control
 * built from `ShopProduct.gallery` would ask Square to remove a path that only
 * exists in this repo's `public/` folder, and quietly do nothing.
 *
 * (See `useLiveCatalog` for why the baked images are kept — replacing them with
 * Square's originals would serve 3105×3105 JPEGs to every shopper.)
 *
 * So: one extra read, for staff who have pressed Edit, of the collection they
 * are about to write to. `listProducts` is behind a dynamic import and returns
 * unpublished rows too, which is correct — a book withdrawn from the shop is
 * exactly the one somebody may be trying to put back.
 *
 * Failure is silence, deliberately, and the cost is small and specific: an empty
 * map means the picture controls render as "no pictures yet". Everything else on
 * a card — stock, section, removal — is keyed by slug alone and works regardless.
 * ---------------------------------------------------------------------------
 */
export function useCatalogDocs(
  enabled: boolean,
  nonce: number,
): Map<string, DocOf<Product>> {
  const [docs, setDocs] = useState<Map<string, DocOf<Product>>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    let live = true;

    void (async () => {
      try {
        const { listProducts } = await import('./adminData');
        const rows = await listProducts();
        // Guarded, so a read that lands after Edit was switched off — or after a
        // faster one from a later nonce — does not overwrite fresher state.
        if (live) setDocs(new Map(rows.map((row) => [row.slug, row])));
      } catch {
        /* Cards fall back to slug-only controls. See the header. */
      }
    })();

    return () => {
      live = false;
    };
  }, [enabled, nonce]);

  return docs;
}
