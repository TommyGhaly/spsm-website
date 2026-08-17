import type { DocOf, Money, Product } from '@spsm/shared';
import { CopticCross } from '@/components/Ornament';
import { bundledCover } from './covers';

/**
 * Money arrives as integer minor units plus a currency, never a float or a
 * pre-formatted string. Formatting happens here, at the edge, so the boundary
 * with Square stays lossless.
 */
export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
    // Whole-dollar prices are the norm in this catalog — $8, $15, $35 — and
    // "$8" reads as a shop price where "$8.00" reads as an invoice line.
    minimumFractionDigits: money.amount % 100 === 0 ? 0 : 2,
  }).format(money.amount / 100);
}

/**
 * The shop front.
 *
 * A picture-led grid rather than the text list this was, because a bookstore is
 * browsed by cover: a reader recognises the icon on a Pascha book long before
 * they parse its title, and the previous markup — an `h3`, a price, and a
 * paragraph — gave them nothing to recognise.
 *
 * The covers come from Square, hotlinked from its CDN, and **most of these
 * books have one while some do not**. That is the constraint the layout is
 * built around: a grid that only looks right when every cell has a photograph
 * is a grid that looks broken on this catalog. So a missing cover becomes a
 * deliberate placeholder — the parish's own cross on the sunken paper ground —
 * rather than a gap, a grey box, or a stretched neighbour.
 */
export function ProductGrid({ products }: { products: DocOf<Product>[] }) {
  return (
    <ul className="shop">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </ul>
  );
}

function ProductCard({ product }: { product: DocOf<Product> }) {
  /*
   * The optimised local copy where the sync has produced one, Square's own URL
   * otherwise. See `covers.ts` — Square serves the parish's 3105×3105
   * originals, which come to 37.75 MB across the catalog, and a static export
   * has nothing to resize them at request time.
   */
  const bundled = bundledCover(product.slug);
  const remote = product.imagePaths[0];
  // Distinct from null, which means stock is not tracked. Nothing in this
  // catalog tracks inventory today, so this is nearly always false — but
  // collapsing the two would turn "untracked" into "sold out" and empty the
  // shop the day someone switches tracking on.
  const soldOut = product.stockCount === 0;

  return (
    <li className={soldOut ? 'shop-item shop-item--sold' : 'shop-item'}>
      <div className="shop-item__frame">
        {bundled || remote ? (
          /*
           * A plain `img`, not `next/image`: this is a static export with the
           * default loader disabled (see next.config.mjs), so there is nothing
           * to resize on demand and the bytes below are the bytes downloaded.
           *
           * `alt` is the book's name rather than a description of the artwork —
           * the cover *is* the book here, so a screen reader hearing the title
           * has been told what the picture is for.
           */
          <img
            className="shop-item__cover"
            src={bundled?.src ?? remote}
            {...(bundled ? { srcSet: bundled.srcSet, sizes: '(max-width: 48rem) 46vw, 14rem' } : {})}
            alt={product.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="shop-item__placeholder" aria-hidden="true">
            <CopticCross size={34} />
          </span>
        )}

        {soldOut && <span className="shop-item__flag">Sold out</span>}
      </div>

      <div className="shop-item__body">
        <h3 className="shop-item__name">{product.name}</h3>
        {product.description && <p className="shop-item__blurb">{product.description}</p>}
        <p className="shop-item__price">{formatMoney(product.price)}</p>
      </div>
    </li>
  );
}
