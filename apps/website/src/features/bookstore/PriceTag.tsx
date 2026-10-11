import { clearanceOf } from '@spsm/shared';
import type { ShopProduct } from './shopData';
import { money } from './money';

/**
 * A price as the shop shows it: crossed out beside the clearance price when it
 * is on clearance, and for clothing with sizes that cost more, the range — or
 * the one size's price once a size is chosen.
 */
export function PriceTag({ product, size = null }: { product: ShopProduct; size?: string | null }) {
  const sale = clearanceOf({ wasPriceCents: product.wasPriceCents, amountCents: product.amount });
  const chosen = size ? product.sizes?.find((one) => one.label === size) : undefined;
  const extras = chosen ? [chosen.extraCents] : product.sizes?.length ? product.sizes.map((one) => one.extraCents) : [0];
  const low = Math.min(...extras);
  const high = Math.max(...extras);
  const span = (base: number) =>
    low === high ? money(base + low, product.currency) : `${money(base + low)}–${money(base + high)}`;

  if (!sale) return <>{span(product.amount)}</>;
  return (
    <>
      <s className="price__was">
        <span className="visually-hidden">Was </span>
        {span(sale.wasCents)}
      </s>{' '}
      <span className="price__now">
        <span className="visually-hidden">now </span>
        {span(sale.nowCents)}
      </span>
    </>
  );
}
