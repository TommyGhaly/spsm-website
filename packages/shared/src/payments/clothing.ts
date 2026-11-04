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

/** How many of one size of one product an order takes. */
export interface SizeDemand {
  slug: string;
  size: string;
  quantity: number;
}

/**
 * An order's lines, reduced to what it takes from size stock: one entry per
 * product-and-size, quantities summed. Lines without a size take nothing.
 */
export function sizeDemand(
  items: readonly { slug: string; size?: string | null; quantity: number }[],
): SizeDemand[] {
  const totals = new Map<string, SizeDemand>();
  for (const item of items) {
    if (!item.size || !(item.quantity > 0)) continue;
    const key = `${item.slug}\n${item.size}`;
    const entry = totals.get(key);
    if (entry) entry.quantity += item.quantity;
    else totals.set(key, { slug: item.slug, size: item.size, quantity: item.quantity });
  }
  return [...totals.values()];
}

/**
 * One product's sizes with an order's demand taken out — or the sizes that
 * cannot cover it.
 *
 * All or nothing: a basket with two shirts, one of which has run out, takes
 * neither, because checkout then refuses the basket and nothing was sold. A
 * size the list no longer has (staff removed it after the basket was filled)
 * is short too, not silently free.
 */
export function takeSizes(
  sizes: readonly ProductSize[],
  slug: string,
  demand: readonly SizeDemand[],
): { next: ProductSize[]; short: { size: string; left: number }[] } {
  const wanted = demand.filter((entry) => entry.slug === slug);
  const short: { size: string; left: number }[] = [];
  for (const entry of wanted) {
    const size = sizes.find((one) => one.label === entry.size);
    if (!size || size.count < entry.quantity) short.push({ size: entry.size, left: size?.count ?? 0 });
  }
  if (short.length > 0) return { next: sizes.map((size) => ({ ...size })), short };
  return {
    next: sizes.map((size) => {
      const taken = wanted.find((entry) => entry.size === size.label)?.quantity ?? 0;
      return taken > 0 ? { ...size, count: size.count - taken } : { ...size };
    }),
    short,
  };
}

/**
 * One product's sizes with an order's demand put back. A size staff have since
 * removed stays removed — putting it back would re-offer something the parish
 * stopped selling — and a count never passes `MAX_SIZE_COUNT`.
 */
export function returnSizes(
  sizes: readonly ProductSize[],
  slug: string,
  demand: readonly SizeDemand[],
): ProductSize[] {
  return sizes.map((size) => {
    const back = demand
      .filter((entry) => entry.slug === slug && entry.size === size.label)
      .reduce((sum, entry) => sum + entry.quantity, 0);
    return back > 0 ? { ...size, count: Math.min(MAX_SIZE_COUNT, size.count + back) } : { ...size };
  });
}

/**
 * Whether an order moving to `status` puts its sizes back on the shelf.
 *
 * A payment that failed or was cancelled sold nothing, so always. A refund only
 * when staff said so when they issued it (`refund.restock`) — a refund made in
 * Square's own dashboard has no such answer, and guessing "yes" would offer a
 * shirt that may be in somebody's wardrobe. Never twice: `sizesCounted` false
 * means they are already back, or were never taken.
 */
export function shouldReturnSizes(
  status: string,
  order: { sizesCounted?: boolean; refund?: { restock?: boolean } | null },
): boolean {
  if (order.sizesCounted !== true) return false;
  if (status === 'failed' || status === 'canceled') return true;
  return status === 'refunded' && order.refund?.restock === true;
}

/**
 * Whether an order may move from `from` to `to` — forwards only.
 *
 * Square's events arrive late and out of order, and three writers act on them
 * (checkout, the webhook, the stale-order sweep). Without this a late APPROVED
 * would move a paid order back to pending and out of the staff lists, and a
 * late cancellation would put a refunded order's sizes back on the shelf.
 *
 *   pending → anything; failed/canceled → paid (the buyer's next card worked)
 *   or pending (a retry); paid → refunded; refunded → nothing.
 */
export function mayMoveOrder(from: string | undefined, to: string): boolean {
  if (from === undefined || from === to) return true;
  switch (from) {
    case 'pending':
      return true;
    case 'failed':
    case 'canceled':
      return to === 'paid' || to === 'pending' || to === 'failed' || to === 'canceled';
    case 'paid':
      return to === 'refunded';
    default:
      return false;
  }
}

/**
 * Sizes taken again for an order that came back to life — marked failed, its
 * sizes returned, and then found paid after all. It is paid, so it cannot be
 * refused: counts go down as far as zero and no further, and anything short is
 * reported so somebody can tell the buyer.
 */
export function retakeSizes(
  sizes: readonly ProductSize[],
  slug: string,
  demand: readonly SizeDemand[],
): { next: ProductSize[]; short: { size: string; missing: number }[] } {
  const short: { size: string; missing: number }[] = [];
  const next = sizes.map((size) => {
    const taken = demand
      .filter((entry) => entry.slug === slug && entry.size === size.label)
      .reduce((sum, entry) => sum + entry.quantity, 0);
    if (taken > size.count) short.push({ size: size.label, missing: taken - size.count });
    return taken > 0 ? { ...size, count: Math.max(0, size.count - taken) } : { ...size };
  });
  return { next, short };
}
