import type { DocOf, Product } from '@spsm/shared';
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
  /** Null means "not tracked"; 0 means sold out. */
  stockCount: number | null;
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
      stockCount: product.stockCount,
    };
  });
}
