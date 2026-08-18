/**
 * Turning a basket into something Square can price and charge.
 *
 * ---------------------------------------------------------------------------
 * The browser never sends a price, and Square does the arithmetic.
 *
 * A cart arrives from a page anyone can edit, so a request saying "one Holy
 * Bible, $0.01" has to be impossible rather than merely unlikely. Two rules
 * make it so:
 *
 *   1. The request carries slugs and quantities. No money crosses the wire in
 *      that direction at all, so there is nothing to tamper with.
 *   2. Line items are sent to Square as `catalog_object_id`, not as an amount.
 *      Square looks the price up in its own catalog and returns the total, and
 *      that returned total is what gets charged. Even our Firestore mirror
 *      going stale or being edited cannot change what someone pays.
 *
 * The mirror is still consulted, but only to decide *whether a thing may be
 * sold* — published, in the shop, known to us — never for how much.
 * ---------------------------------------------------------------------------
 */
import type { Product } from '../schema/commerce.js';

/** What the browser is allowed to say. Quantities and slugs, nothing else. */
export interface CartRequestLine {
  slug: string;
  quantity: number;
}

export interface SquareOrderLine {
  /** Square's variation id. Square prices this; we never send an amount. */
  catalog_object_id: string;
  quantity: string;
}

export interface BuiltOrder {
  lines: SquareOrderLine[];
  /** Slug → name, so the order document can denormalize what was bought. */
  names: Record<string, string>;
  rejected: { slug: string; reason: RejectionReason }[];
}

export type RejectionReason =
  | 'unknown'
  | 'unpublished'
  | 'not-in-square'
  | 'sold-out'
  | 'bad-quantity';

/** Nobody needs more than this from a parish bookstore, and it bounds abuse. */
export const MAX_QUANTITY = 20;

/**
 * Validate a cart against the catalog and shape it for Square.
 *
 * Rejections are returned rather than thrown, and per line, so the caller can
 * tell a buyer *which* item is unavailable instead of failing the whole basket
 * with one message. An empty `lines` with a populated `rejected` is the normal
 * way this says no.
 */
export function buildSquareOrder(
  cart: readonly CartRequestLine[],
  catalog: ReadonlyMap<string, Product>,
): BuiltOrder {
  const lines: SquareOrderLine[] = [];
  const names: Record<string, string> = {};
  const rejected: BuiltOrder['rejected'] = [];
  const seen = new Set<string>();

  for (const entry of cart) {
    const slug = typeof entry?.slug === 'string' ? entry.slug.trim() : '';
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    /*
     * Integers only — not truncated to one.
     *
     * `Math.trunc` here quietly turned a request for 1.5 into a request for 1,
     * which is the wrong instinct: the shop only ever sends whole numbers, so a
     * fraction means the request was hand-built, and guessing what a hand-built
     * request meant is not this function's job. Refuse it and say why.
     */
    const quantity = Number(entry?.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      rejected.push({ slug, reason: 'bad-quantity' });
      continue;
    }

    const product = catalog.get(slug);
    if (!product) {
      rejected.push({ slug, reason: 'unknown' });
      continue;
    }
    // The published flag is the switch everywhere else on this site, and it has
    // to hold here too: a product hidden from the shop must not be buyable by
    // anyone who kept its slug.
    if (!product.published) {
      rejected.push({ slug, reason: 'unpublished' });
      continue;
    }
    if (product.stockCount === 0) {
      rejected.push({ slug, reason: 'sold-out' });
      continue;
    }
    // Without a variation id there is no way to have Square price this, and
    // sending an amount instead is exactly the thing this module refuses to do.
    if (!product.squareVariationId) {
      rejected.push({ slug, reason: 'not-in-square' });
      continue;
    }

    lines.push({ catalog_object_id: product.squareVariationId, quantity: String(quantity) });
    names[slug] = product.name;
  }

  return { lines, names, rejected };
}

/** True for something that could plausibly be delivered to. Deliberately loose. */
export function isUsableAddress(address: {
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}): boolean {
  return Boolean(
    address.line1?.trim() && address.city?.trim() && address.state?.trim() && address.postalCode?.trim(),
  );
}

/**
 * The shape of an email address, checked only enough to catch a typo.
 *
 * Deliberately not RFC 5322. The receipt is Square's to send, and an
 * over-strict pattern here rejects real addresses — which costs a sale to
 * prevent nothing, since an address that is well-formed and wrong is
 * indistinguishable anyway.
 */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
