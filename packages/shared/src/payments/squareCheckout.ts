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
 *   1. The request carries slugs, quantities and sizes. No money crosses the
 *      wire in that direction at all, so there is nothing to tamper with.
 *   2. Line items are sent to Square as `catalog_object_id`, not as an amount.
 *      Square looks the price up in its own catalog and returns the total, and
 *      that returned total is what gets charged. Even our Firestore mirror
 *      going stale or being edited cannot change what someone pays.
 *
 * The mirror is still consulted, but only to decide *whether a thing may be
 * sold* — published, in the shop, known to us — never for how much. The one
 * exception is a clothing size's add-on, which Square has no record of: it is
 * read from the parish's size list in Firestore, a staff-only field, and sent
 * as a modifier. Still never from the request.
 * ---------------------------------------------------------------------------
 */
import type { Product } from '../schema/commerce.js';
import { cleanSizes } from './clothing.js';

/**
 * What the browser is allowed to say. Quantities, slugs and — for clothing —
 * which size, nothing else.
 */
export interface CartRequestLine {
  slug: string;
  quantity: number;
  /** A label from `SIZE_PRESETS`, required for clothing and ignored otherwise. */
  size?: string;
}

export interface SquareOrderLine {
  /**
   * Ours, and echoed back on Square's priced line. It is what ties a priced line
   * to what was asked for: two sizes of one shirt are two lines with the same
   * catalog name, so names alone cannot.
   */
  uid: string;
  /** Square's variation id. Square prices this; we never send an amount. */
  catalog_object_id: string;
  quantity: string;
  /** `Size M`, so the size is on Square's receipt and the order in its dashboard. */
  note?: string;
  /**
   * A size's add-on, as an ad hoc modifier. The one amount this module ever
   * sends, and it comes from the parish's own size list in Firestore — never
   * from the request. Absent when the size costs nothing extra.
   */
  modifiers?: { uid: string; name: string; base_price_money: { amount: number; currency: 'USD' } }[];
}

/** One accepted line, as the order record will describe it. Parallel to `lines`. */
export interface BuiltItem {
  uid: string;
  slug: string;
  size: string | null;
  name: string;
  quantity: number;
}

export interface BuiltOrder {
  lines: SquareOrderLine[];
  items: BuiltItem[];
  /** Slug → name, so the order document can denormalize what was bought. */
  names: Record<string, string>;
  rejected: { slug: string; reason: RejectionReason; size?: string }[];
}

export type RejectionReason =
  | 'unknown'
  | 'unpublished'
  | 'not-in-square'
  | 'sold-out'
  | 'bad-quantity'
  /** Clothing asked for with no size, or one it does not come in. */
  | 'no-size'
  /** Fewer of that size left than were asked for. */
  | 'not-enough';

/** Nobody needs more than this from a parish bookstore, and it bounds abuse. */
export const MAX_QUANTITY = 20;

/**
 * Validate a cart against the catalog and shape it for Square.
 *
 * Rejections are returned rather than thrown, and per line, so the caller can
 * tell a buyer *which* item is unavailable instead of failing the whole basket
 * with one message. An empty `lines` with a populated `rejected` is the normal
 * way this says no.
 *
 * A line is a product, or a product in one size: two sizes of one shirt are two
 * lines, and a repeat of the same product-and-size is dropped.
 */
export function buildSquareOrder(
  cart: readonly CartRequestLine[],
  catalog: ReadonlyMap<string, Product>,
): BuiltOrder {
  const lines: SquareOrderLine[] = [];
  const items: BuiltItem[] = [];
  const names: Record<string, string> = {};
  const rejected: BuiltOrder['rejected'] = [];
  const seen = new Set<string>();

  for (const entry of cart) {
    const slug = typeof entry?.slug === 'string' ? entry.slug.trim() : '';
    const asked = typeof entry?.size === 'string' ? entry.size.trim() : '';
    const key = `${slug}\n${asked}`;
    if (!slug || seen.has(key)) continue;
    seen.add(key);

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

    /*
     * Clothing is counted per size on the website, so Square's count is not the
     * one that says whether it can be sold — see `Product.sizes`.
     */
    const sizes = cleanSizes(product.sizes);
    const size = sizes ? sizes.find((one) => one.label === asked) : undefined;
    if (sizes) {
      if (!size) {
        rejected.push({ slug, reason: 'no-size', ...(asked ? { size: asked } : {}) });
        continue;
      }
      if (size.count < quantity) {
        rejected.push({ slug, reason: size.count <= 0 ? 'sold-out' : 'not-enough', size: size.label });
        continue;
      }
    } else if (product.stockCount === 0) {
      rejected.push({ slug, reason: 'sold-out' });
      continue;
    }
    // Without a variation id there is no way to have Square price this, and
    // sending an amount instead is exactly the thing this module refuses to do.
    if (!product.squareVariationId) {
      rejected.push({ slug, reason: 'not-in-square' });
      continue;
    }

    const uid = `line-${lines.length}`;
    lines.push({
      uid,
      catalog_object_id: product.squareVariationId,
      quantity: String(quantity),
      ...(size ? { note: `Size ${size.label}` } : {}),
      ...(size && size.extraCents > 0
        ? {
            modifiers: [
              {
                uid: `${uid}-size`,
                name: `Size ${size.label}`,
                base_price_money: { amount: size.extraCents, currency: 'USD' as const },
              },
            ],
          }
        : {}),
    });
    items.push({ uid, slug, size: size?.label ?? null, name: product.name, quantity });
    names[slug] = product.name;
  }

  return { lines, items, names, rejected };
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

/** A name is long enough to be one and short enough to be a field. */
export const MAX_NAME = 60;

/**
 * Trim a supplied name to something storable, or return null.
 *
 * Deliberately permissive about *what* a name contains — Coptic, Arabic,
 * hyphens, apostrophes, and spaces are all ordinary in this parish, and a
 * pattern strict enough to exclude nonsense would exclude parishioners first.
 * It checks only that something was typed and bounds how much.
 */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
  return trimmed.length > 0 ? trimmed : null;
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
