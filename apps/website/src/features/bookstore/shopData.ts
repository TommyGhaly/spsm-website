import type { DocOf, Product } from '@spsm/shared';
import { bundledCover } from './covers';

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
  /** Null means "not tracked"; 0 means sold out. */
  stockCount: number | null;
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
      stockCount: product.stockCount,
    };
  });
}
