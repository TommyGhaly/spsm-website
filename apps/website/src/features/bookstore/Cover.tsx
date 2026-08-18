import type { ShopProduct } from './shopData';

/**
 * A book's cover, wherever one is shown.
 *
 * Presentational and hook-free, so it works in a server component as well as
 * inside the client-side shop — which is why it is here rather than in
 * `Shop.tsx`. The `cover--none` case is styled once in globals.css and shared
 * by every context that renders a cover.
 */
export function Cover({
  product,
  className,
  sizes = '(max-width: 48rem) 46vw, 14rem',
}: {
  product: ShopProduct;
  className: string;
  /** Only meaningful when the product has a `coverSrcSet`. */
  sizes?: string;
}) {
  if (!product.cover) {
    /*
     * No cover in Square. The title itself stands in — a plain binding, which
     * is an honest thing for a book to look like.
     *
     * This was the parish's cross, used as a generic "no image" mark. A cross
     * is not a decoration to scatter over missing data, and it said nothing
     * about which book was missing its picture.
     */
    return (
      <span className={`${className} cover--none`} aria-hidden="true">
        <span className="cover--none__title">{product.name}</span>
      </span>
    );
  }
  return (
    <img
      className={className}
      src={product.cover}
      {...(product.coverSrcSet ? { srcSet: product.coverSrcSet, sizes } : {})}
      alt={product.name}
      loading="lazy"
      decoding="async"
    />
  );
}
