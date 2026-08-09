import type { DocOf, Money, Product } from '@spsm/shared';

/**
 * Money arrives as integer minor units plus a currency, never a float or a
 * pre-formatted string. Formatting happens here, at the edge, so the boundary
 * with Square stays lossless.
 */
export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount / 100);
}

export function ProductGrid({ products }: { products: DocOf<Product>[] }) {
  return (
    <ul className="grid">
      {products.map((product) => (
        <li key={product.id} className="card">
          <h3>{product.name}</h3>
          <p className="meta">{formatMoney(product.price)}</p>
          <p>{product.description}</p>
          {/* Deliberately distinct: null means stock is not tracked, 0 means
              sold out. Collapsing them would hide real inventory. */}
          {product.stockCount === 0 && <p className="meta">Out of stock</p>}
        </li>
      ))}
    </ul>
  );
}
