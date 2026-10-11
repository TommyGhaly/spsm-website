/**
 * Clothing sizes and clearance prices — the two parish-owned price facts.
 *
 * Shared because three places must agree on them: the shop page shows them, the
 * editing panel writes them, and the checkout Function charges by them. A size
 * the page offers that checkout reads differently is a buyer charged for
 * something other than what they chose.
 */
import type { Product, ProductSize } from '../schema/commerce.js';

/**
 * The sizes the parish can offer, in the order they are shown. A fixed list
 * rather than free text so a shopper never meets "Lg" beside "Large", and so the
 * shop can always sort sizes small to large.
 */
export const SIZE_PRESETS = [
  'Youth XS',
  'Youth S',
  'Youth M',
  'Youth L',
  'Youth XL',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  '2XL',
  '3XL',
  '4XL',
] as const;

/** A size may add up to $100. Matches `isSizeList` in firestore.rules. */
export const MAX_SIZE_EXTRA_CENTS = 10_000;
export const MAX_SIZE_COUNT = 99_999;

/**
 * A stored size list, cleaned: known labels only, in preset order, once each,
 * whole non-negative counts and add-ons within bounds. Null when the value is
 * not a list at all — not clothing.
 *
 * The checkout Function charges from this, so anything it cannot read is
 * dropped rather than guessed at. Firestore rules check the list's shape, but
 * cannot look inside its entries.
 */
export function cleanSizes(raw: unknown): ProductSize[] | null {
  if (!Array.isArray(raw)) return null;
  const byLabel = new Map<string, ProductSize>();
  for (const entry of raw as Partial<ProductSize>[]) {
    const label = typeof entry?.label === 'string' ? entry.label : '';
    if (!(SIZE_PRESETS as readonly string[]).includes(label) || byLabel.has(label)) continue;
    const count = Number(entry?.count);
    const extra = Number(entry?.extraCents ?? 0);
    byLabel.set(label, {
      label,
      count: Number.isInteger(count) ? Math.min(MAX_SIZE_COUNT, Math.max(0, count)) : 0,
      extraCents: Number.isInteger(extra) ? Math.min(MAX_SIZE_EXTRA_CENTS, Math.max(0, extra)) : 0,
    });
  }
  return SIZE_PRESETS.flatMap((label) => byLabel.get(label) ?? []);
}

/** True when nothing can be bought: every size gone, or no sizes offered at all. */
export function sizesSoldOut(sizes: readonly ProductSize[]): boolean {
  return sizes.every((size) => size.count <= 0);
}

/**
 * A product on clearance, as the shop shows it: the old price, the new one, and
 * the saving as a whole percent. Null unless the old price is the higher one.
 */
export function clearanceOf(
  product: Pick<Product, 'wasPriceCents'> & { amountCents: number },
): { wasCents: number; nowCents: number; percentOff: number } | null {
  const was = product.wasPriceCents;
  const now = product.amountCents;
  if (typeof was !== 'number' || !(was > now) || now <= 0) return null;
  return { wasCents: was, nowCents: now, percentOff: Math.round(((was - now) / was) * 100) };
}
