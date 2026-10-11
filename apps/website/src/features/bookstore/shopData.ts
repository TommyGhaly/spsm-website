import { cleanSizes, type DocOf, type Product, type ProductSize } from '@spsm/shared';
import { bundledCover, bundledCovers } from './covers';

/**
 * A product flattened for the client.
 *
 * The shop is interactive — a dialog, a cart — so it is a client component, and
 * everything it needs has to cross the server/client boundary as plain data.
 * `bundledCover` reads the filesystem and cannot, so cover resolution happens
 * here, at build time, and the result travels as two strings.
 */
export interface ShopProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Integer minor units, as everywhere else. */
  amount: number;
  currency: 'USD';
  cover: string | null;
  coverSrcSet: string | null;
  /**
   * The largest copy available, for the zoom.
   *
   * The 2x file the sync writes, at 800px. Worth stating what that ceiling
   * means: Square's originals are 3105px, but these are re-encoded locally
   * because the nine covers come to 37.75 MB otherwise. So the zoom shows 800px
   * and stops — past that it would be enlarging, which shows nothing new and
   * makes an already-soft photograph look worse.
   */
  coverLarge: string | null;
  /**
   * Every image for this product, for the detail gallery.
   *
   * One entry per book today — no item in the parish's catalog carries a second
   * photograph — so the gallery renders as a plain image and hides its strip
   * and arrows. Adding a photo in Square and re-running `npm run catalog` is
   * the whole of the work to light it up.
   */
  gallery: { src: string; srcSet: string | null; large: string }[];
  /**
   * The Square URLs the bundled covers above were made from — or null when the
   * build did not use bundled covers for this product.
   *
   * -------------------------------------------------------------------------
   * This is what lets the live refresh tell "nothing has changed" from "the
   * picture was replaced", and it exists because *counting* the two lists
   * cannot: a book with one baked cover and an empty `imagePaths` sits at
   * 1-vs-0, so adding its first photograph takes it to 1-vs-1 — a match — and
   * the shop went on showing the old file. That was reported as the photograph
   * not being added at all.
   *
   * Identity, not arity. `useLiveCatalog` keeps the optimised WebP pair only
   * when the document still lists exactly these URLs in exactly this order; any
   * other answer, including an emptied list, means Square is the honest source
   * and its own URLs are used. So a photograph deleted in the Square app really
   * does leave the shop, which is the whole point of the mirror.
   *
   * Travels as part of the baked catalog, so it costs one array of strings in
   * the prerendered HTML and no schema field, no Firestore write, and nothing
   * for the mobile app to know about.
   * -------------------------------------------------------------------------
   */
  bakedFrom: string[] | null;
  /** Null means "not tracked"; 0 means sold out. */
  stockCount: number | null;
  /**
   * Which division of the shop this belongs in. Null means unfiled, which the
   * shop shows in its own group rather than hiding.
   *
   * Square's subcategories of the Bookstore, by id — see `Product.categoryIds`.
   * Several allowed; empty means unfiled.
   */
  categoryIds: string[];
  /** `SPSM-0007`, or null until the sync has numbered it. Square's, like the price. */
  sku: string | null;
  /** Ounces per copy, or null when not weighed. The parish's, like `section`. */
  weightOz: number | null;
  mediaMail: boolean;
  /** Sales tax applies. The parish's, like `section`. */
  taxable: boolean;
  /** The price before clearance, or null. See `Product.wasPriceCents`. */
  wasPriceCents: number | null;
  /** Clothing sizes, cleaned; null for anything that is not clothing. */
  sizes: ProductSize[] | null;
}

/**
 * The bundled images where the sync has produced them, Square's own URLs
 * otherwise — the same fallback `covers.ts` describes, applied per image so a
 * product synced since the last cover run still shows something.
 */
function galleryFor(product: DocOf<Product>): ShopProduct['gallery'] {
  const bundled = bundledCovers(product.slug);
  if (bundled.length > 0) {
    return bundled.map((cover) => ({
      src: cover.src,
      srcSet: cover.srcSet,
      large: cover.src.replace(/\.webp$/, '@2x.webp'),
    }));
  }
  return product.imagePaths.map((url) => ({ src: url, srcSet: null, large: url }));
}

export function toShopProducts(products: DocOf<Product>[]): ShopProduct[] {
  return products.map((product) => {
    const bundled = bundledCover(product.slug);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      amount: product.price.amount,
      currency: product.price.currency,
      // The optimised local copy where the sync produced one, Square's own URL
      // otherwise — see covers.ts for why that fallback exists.
      cover: bundled?.src ?? product.imagePaths[0] ?? null,
      coverSrcSet: bundled?.srcSet ?? null,
      // Square's own URL when there is no bundled copy: it is the 3105px
      // original, which is slow but is only fetched if someone zooms.
      coverLarge: bundled ? bundled.src.replace(/\.webp$/, '@2x.webp') : (product.imagePaths[0] ?? null),
      gallery: galleryFor(product),
      /*
       * Claimed only when the two lists line up one-for-one. A build that ran
       * after a photograph was added in Square but before `npm run catalog`
       * re-downloaded the covers has more URLs than files, and claiming identity
       * there would pin the shop to a stale set. No claim simply means the live
       * URLs win, which is the safe direction.
       */
      bakedFrom:
        bundled && bundledCovers(product.slug).length === product.imagePaths.length
          ? product.imagePaths
          : null,
      stockCount: product.stockCount,
      categoryIds: Array.isArray(product.categoryIds) ? product.categoryIds : [],
      sku: product.sku ?? null,
      weightOz: typeof product.weightOz === 'number' ? product.weightOz : null,
      mediaMail: product.mediaMail === true,
      taxable: product.taxable === true,
      wasPriceCents: typeof product.wasPriceCents === 'number' ? product.wasPriceCents : null,
      sizes: cleanSizes(product.sizes),
    };
  });
}
