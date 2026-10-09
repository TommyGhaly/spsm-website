'use client';

import { useEffect, useRef, useState } from 'react';
import {
  decodeFirestoreFields,
  parseBookstoreConfig,
  type BookstoreSection,
  type BookstoreShipping,
  type Product,
} from '@spsm/shared';
import type { ShopProduct } from './shopData';

/**
 * The catalog as it is *now*, not as it was at the last build.
 *
 * ---------------------------------------------------------------------------
 * Why a static page reads the database at all.
 *
 * /bookstore is prerendered: `getProducts()` runs during `next build` and the
 * eleven books are baked into the HTML. That is right for a shop — it renders
 * instantly, it works with no JavaScript, and search engines see the catalog.
 *
 * It is also why a product added in the admin drawer would sit invisible until
 * somebody redeployed the site, which defeats the point of being able to add
 * one. Tommy chose the arrangement the homepage bulletin already uses for
 * exactly this problem: bake it, then read through to the live copy and swap.
 *
 * So a visitor sees the baked shop immediately and, a moment later, the real
 * one. In the overwhelmingly common case they are identical and nothing moves.
 *
 * ## Over REST, with no SDK
 *
 * `decodeFirestoreFields` from @spsm/shared exists for precisely this: reading a
 * public document from a browser with a bare `fetch`. `products` is
 * world-readable where `published == true`, and the query below asks for exactly
 * that, so no credential is involved.
 *
 * (The Firestore SDK does reach this page anyway — every exported page carries
 * about 604KB of it, contrary to what `lib/auth.ts` claims. Using it here would
 * still mean initialising an app and a listener on a page that needs one read,
 * so REST remains the right call; it just is not the *bundle* argument it would
 * have been.)
 *
 * ## Failure is silence
 *
 * Every error path leaves the baked catalog on screen. A shop that shows
 * last week's eleven books is a working shop; a shop that shows an error because
 * a refresh failed is not. Nothing here is awaited by anything a shopper does.
 * ---------------------------------------------------------------------------
 */

export interface LiveCatalog {
  /** Null until a fresher copy actually arrives. Callers keep their baked one. */
  products: ShopProduct[] | null;
  sections: BookstoreSection[] | null;
  /**
   * The delivery charge as `config/bookstore` holds it *now*, not as the build
   * baked it.
   *
   * It comes free: this hook already fetches that document for `sections` and
   * threw the rest of it away. Reading it matters because the checkout shows
   * this figure to the payer and Apple Pay and Google Pay ask them to authorize
   * it — and the charge itself is computed by `functions/src/checkout.ts` from
   * the live document, so a baked copy a fortnight old is a sheet that says one
   * number against a card statement that says another.
   */
  deliveryCents: number | null;
  /** Live-postage settings, read from the same document for the same reason. */
  shipping: BookstoreShipping | null;
}

interface RestDocument {
  name?: string;
  fields?: unknown;
}

function restBase(): { url: string; key: string } | null {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!project) return null;

  const path = `projects/${project}/databases/(default)/documents`;
  if (process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
    return { url: `http://127.0.0.1:8080/v1/${path}`, key: '' };
  }
  return apiKey ? { url: `https://firestore.googleapis.com/v1/${path}`, key: apiKey } : null;
}

/**
 * Turn a decoded product document into the shape the shop renders.
 *
 * ---------------------------------------------------------------------------
 * The baked product's images win, and that is not an optimisation — it is the
 * difference between this feature being free and it being a serious regression.
 *
 * `covers.ts` resolves an optimised WebP for each product at build time: an
 * 800px 1× and 2× pair, written by `sync-catalog.mjs`. None of that can be
 * recomputed in a browser, and the document only carries Square's own CDN URLs
 * — which are the parish's originals, mostly 3105×3105 JPEGs coming to 37.75MB
 * across nine covers, with no resize parameter available.
 *
 * So a naive swap would replace every optimised cover with a multi-megabyte
 * original on every visit, for every shopper, in exchange for nothing: those
 * products' pictures had not changed. Caught by looking at `srcset` on the
 * rendered page after the swap and finding it gone.
 *
 * A product the build never saw has no baked copy to keep, and uses Square's
 * URL. That is the same fallback the build itself uses for a product synced
 * after the last cover run — slow, but visible, which is the whole point.
 * ---------------------------------------------------------------------------
 */
/**
 * Whether the build's images survive the swap.
 *
 * ---------------------------------------------------------------------------
 * **Identity, not arity.** The optimised WebP pair the build produced is a copy
 * of specific Square photographs, so it is only still correct while the document
 * still lists exactly those photographs, in that order. `bakedFrom` carries the
 * URLs they were made from — see `shopData.ts`.
 *
 * Counting them instead cost two bugs in one day, in opposite directions:
 *
 *   - `length === length && length > 0` blanked every cover on the shop, because
 *     the mirror lists no pictures at all when it is pointed at a Square account
 *     that has none, and 1-vs-0 is not a match.
 *   - Then `length === length || live === 0` hid a *newly added* photograph: a
 *     book with one baked cover and an empty list goes to 1-vs-1 when its first
 *     picture arrives, which counts as a match. Tommy uploaded a photo to The
 *     Eucharist and the card never changed.
 *
 * Neither could have happened against the URLs themselves, and a third counting
 * rule would only have found a third way to be wrong.
 *
 * The one case left is a product the build baked and the document has since
 * emptied — a photograph deleted in the Square app. The live list wins, the
 * placeholder shows, and the picture really is gone from the shop. That is the
 * behaviour asked for: *"when I decide to delete them they should delete."*
 * ---------------------------------------------------------------------------
 */
export function keepsBakedImages(
  bakedFrom: readonly string[] | null | undefined,
  live: readonly string[],
): boolean {
  if (!bakedFrom || bakedFrom.length === 0) return false;
  if (bakedFrom.length !== live.length) return false;
  return bakedFrom.every((url, index) => url === live[index]);
}

function toShopProduct(
  id: string,
  raw: Record<string, unknown>,
  baked: ShopProduct | undefined,
): ShopProduct | null {
  const product = raw as unknown as Product;
  if (!product?.name || !product.slug) return null;

  const images = Array.isArray(product.imagePaths) ? product.imagePaths.filter(Boolean) : [];
  const squareCover = images[0] ?? null;
  const keepBaked = baked != null && keepsBakedImages(baked.bakedFrom, images);

  return {
    id,
    slug: product.slug,
    name: product.name,
    description: product.description ?? '',
    amount: product.price?.amount ?? 0,
    currency: 'USD',
    cover: keepBaked ? baked.cover : squareCover,
    coverSrcSet: keepBaked ? baked.coverSrcSet : null,
    coverLarge: keepBaked ? baked.coverLarge : squareCover,
    gallery: keepBaked ? baked.gallery : images.map((src) => ({ src, srcSet: null, large: src })),
    /* Carried through unchanged: it describes the *build*, not this read, so a
       later refresh must be able to make the same comparison. */
    bakedFrom: baked?.bakedFrom ?? null,
    stockCount: product.stockCount ?? null,
    section: product.section ?? null,
    sku: product.sku ?? null,
    weightOz: typeof product.weightOz === 'number' ? product.weightOz : null,
    mediaMail: product.mediaMail === true,
  };
}

/**
 * @param nonce Bump to re-read. Editing the shop in place changes the documents
 *   this queries, and the panel doing the editing is the only thing that knows
 *   a write landed — without this the shelf behind it would keep showing the
 *   catalog as it was when the page loaded, which is the whole problem the live
 *   refresh exists to solve, one layer up.
 */
export function useLiveCatalog(
  baked: readonly ShopProduct[],
  enabled = true,
  nonce = 0,
): LiveCatalog {
  const [live, setLive] = useState<LiveCatalog>({
    products: null,
    sections: null,
    deliveryCents: null,
    shipping: null,
  });

  /*
   * The baked list is read through a ref rather than depended on.
   *
   * It is a new array identity on every render of the shop, so listing it in
   * the dependency array would refetch the whole catalog on every keystroke in
   * the search box.
   */
  const bakedRef = useRef(baked);
  bakedRef.current = baked;

  useEffect(() => {
    if (!enabled) return;
    const base = restBase();
    if (!base) return;

    const controller = new AbortController();

    void (async () => {
      try {
        /*
         * A structured query rather than a plain collection GET, because the
         * rule is `allow read: if isPublished(resource.data)` — Firestore
         * evaluates a list against the documents it *could* return, so the query
         * has to prove from its own constraints that nothing unpublished comes
         * back. `where('published','==',true)` is that proof. Without it the
         * whole read is denied, which is decision #10 in this repo's docs and
         * the mistake it records.
         */
        const suffix = base.key ? `?key=${base.key}` : '';
        const [productsRes, configRes] = await Promise.all([
          fetch(`${base.url}:runQuery${suffix}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              structuredQuery: {
                from: [{ collectionId: 'products' }],
                where: {
                  fieldFilter: {
                    field: { fieldPath: 'published' },
                    op: 'EQUAL',
                    value: { booleanValue: true },
                  },
                },
                limit: 200,
              },
            }),
          }),
          fetch(`${base.url}/config/bookstore${suffix}`, { signal: controller.signal }),
        ]);

        if (!productsRes.ok) return;

        const rows = (await productsRes.json()) as { document?: RestDocument }[];
        const bySlug = new Map(bakedRef.current.map((product) => [product.slug, product]));
        const products: ShopProduct[] = [];
        for (const row of rows) {
          const id = row.document?.name?.split('/').pop();
          if (!id) continue;
          const fields = decodeFirestoreFields(row.document?.fields);
          const shaped = toShopProduct(id, fields, bySlug.get(String(fields['slug'] ?? id)));
          if (shaped) products.push(shaped);
        }
        products.sort((a, b) => a.name.localeCompare(b.name));

        /*
         * A 404 on the config is the ordinary state — nothing seeds that
         * document — and means no sections, not a failed refresh.
         */
        let sections: BookstoreSection[] = [];
        let deliveryCents: number | null = null;
        let shipping: BookstoreShipping | null = null;
        if (configRes.ok) {
          const doc = (await configRes.json()) as RestDocument;
          /*
           * The shared parser rather than two field reads, so the delivery
           * charge is range-checked here exactly as the checkout Function
           * range-checks it — same guard against a stray zero, same fallback
           * when the document is half-written.
           */
          const config = parseBookstoreConfig(decodeFirestoreFields(doc.fields));
          sections = config.sections;
          deliveryCents = config.deliveryCents;
          shipping = config.shipping;
        }

        // An empty result is treated as a failed read, not as an emptied shop.
        // A transient permission or network fault must never blank the catalog.
        if (products.length === 0) return;

        setLive({ products, sections, deliveryCents, shipping });
      } catch {
        /* Baked copy stays. See the header. */
      }
    })();

    return () => controller.abort();
  }, [enabled, nonce]);

  return live;
}
