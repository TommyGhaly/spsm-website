import type { AuditFields, Publishable, Timestamped } from './common.js';

/**
 * Bookstore.
 *
 * Money is always integer minor units (cents) plus an explicit currency. Never
 * a float, never a formatted string — Square's API works this way too, so the
 * boundary stays lossless.
 */
export interface Money {
  amount: number;
  currency: 'USD';
}

/**
 * Product catalog.
 *
 * Open Decision #5b (unresolved): is Square the source of truth for the catalog
 * (mirrored here by a sync Function) or is Firestore authoritative with Square
 * used for payment only?
 *
 * This shape works either way, which is the point of settling it later:
 *   - `squareCatalogObjectId` present + `syncedAt` set ⇒ mirrored from Square,
 *     and this doc must be treated as read-only by staff tooling.
 *   - both null ⇒ Firestore-authoritative, edit freely.
 */
export interface Product extends AuditFields, Publishable {
  slug: string;
  name: string;
  description: string;
  price: Money;
  imagePaths: string[];

  /** Set when this row mirrors a Square catalog object. */
  squareCatalogObjectId: string | null;
  squareVariationId: string | null;
  /** Last successful mirror from Square. Null ⇒ Firestore-authoritative. */
  syncedAt: Timestamped | null;

  /**
   * Null means "not tracked" — deliberately distinct from 0, which means sold
   * out. When mirroring from Square, Square's count wins.
   */
  stockCount: number | null;

  /**
   * The Square category this came from. Always `"Bookstore"` today.
   *
   * It is the *gate*, not a division: `sync-catalog.mjs` filters the parish's
   * 68 Square items down to the 11 in this one category, and the other 57 are
   * the Coptic Festival food menu. So every product's value is the same string
   * and it groups nothing. `section` below is what divides the shop.
   */
  category: string | null;

  /**
   * Which part of the shop this belongs in — `"books"`, `"icons"`, and so on.
   *
   * ---------------------------------------------------------------------------
   * Owned by the parish here, not mirrored from Square. That is deliberate and
   * it is the one field on this document Square must never overwrite.
   *
   * Square keeps a single `Bookstore` category as the gate (see `category`), and
   * the divisions the shop actually shows are maintained on this site — Tommy's
   * call: *"group in the firestore it should all be under bookstore in the
   * square categories."* It avoids reorganising a catalog the festival and the
   * POS also depend on.
   *
   * The consequence, and it is a sharp one: `sync-catalog.mjs` used to `PATCH`
   * these documents with no field mask, which replaces the whole document. That
   * would erase every section assignment on each run. It now sends an explicit
   * `updateMask` of the mirrored fields only. Anything added here in future that
   * the parish owns rather than Square must be left out of that mask too.
   *
   * Null means unsorted; the shop shows those together at the end rather than
   * hiding them.
   * ---------------------------------------------------------------------------
   */
  section?: string | null;

  /**
   * Square subcategories of the Bookstore this product is filed in, by Square
   * category id — mirrored by the sync, and changed from the site through
   * `squareProductCategories`, which writes Square first. Supersedes `section`,
   * which was the parish's own single field and is no longer read.
   */
  categoryIds?: string[];

  /**
   * `SPSM-0001`. Mirrored from the first Square variation's own `sku`, so it is
   * the same number the register shows. Assigned by Functions only — see
   * `payments/sku.ts`. Optional because rows written before SKUs existed have
   * none until the next sync gives them one.
   */
  sku?: string | null;

  /**
   * Shipping weight of one copy, in ounces, packaging excluded (the box's own
   * weight is a shop setting). Owned by the parish like `section`, and for the
   * same reason kept out of the sync's field mask: Square holds no weights.
   *
   * Null or absent means "not weighed", and a basket containing one cannot be
   * quoted — checkout falls back to the flat delivery charge rather than guess.
   */
  weightOz?: number | null;

  /**
   * Whether USPS Media Mail may carry this — books and recorded media only.
   * Media Mail is offered for a basket only when every line says yes, because
   * USPS can inspect and surcharge a parcel that is not entirely media.
   */
  mediaMail?: boolean;

  /**
   * Whether Massachusetts sales tax applies. The parish's field, like `section`,
   * and kept off the sync's field mask for the same reason. Absent is false:
   * nothing is taxed until somebody says so. Books used in worship are exempt;
   * gifts and goods generally are not — see `payments/salesTax.ts`.
   */
  taxable?: boolean;

  /**
   * What it cost before it went on clearance, in cents. The parish's field,
   * like `taxable`, and off the sync's field mask: Square holds only the price
   * charged now, which is the clearance price. Shown crossed out beside it, and
   * only while it is the higher of the two — so a price raised in Square past it
   * simply stops reading as a sale. Null or absent means not on clearance.
   * See `payments/clothing.ts` for `clearanceOf`.
   */
  wasPriceCents?: number | null;

  /**
   * Clothing: the sizes it comes in, how many of each are on hand, and what a
   * size adds to the price. Null or absent means it is not clothing and sells
   * the ordinary way.
   *
   * Counted here, not in Square — the parish's choice, so the counts are the
   * website's alone and an in-person sale on the register does not lower them.
   * The checkout Function lowers a size's count when it sells online and refuses
   * a size at zero; `stockCount` is not consulted for these. A size's add-on is
   * charged as a modifier on the Square line — see `buildSquareOrder`.
   */
  sizes?: ProductSize[] | null;
}

/** One size of a piece of clothing. */
export interface ProductSize {
  /** `M`, `Youth S` — one of `SIZE_PRESETS`. */
  label: string;
  /** On hand. 0 shows the size as sold out. */
  count: number;
  /** Added to the item's price for this size, in cents. 0 for most sizes. */
  extraCents: number;
}

/**
 * Orders, keyed to the Square order id.
 *
 * Written only by Cloud Functions — never by the client. The client's job ends
 * at "start a checkout"; everything after that is reconciled from Square's
 * webhook, so a closed laptop mid-payment can't lose an order.
 */
export interface Order extends AuditFields {
  /** Square's order id. Also used as the Firestore doc id. */
  squareOrderId: string;
  squarePaymentId: string | null;

  /** Purchaser. Null for a guest checkout, which is nearly all of them. */
  memberUid: string | null;
  contactEmail: string;

  /**
   * Who the order is for.
   *
   * Kept as two fields rather than one string. The bookstore files collection
   * orders by surname, and splitting a full name on a space gets Coptic and
   * hyphenated names wrong in exactly the cases a parish sees most.
   *
   * Not the cardholder name. Square captures one of those and it is frequently
   * somebody else — a spouse, a parent, a business — so it cannot be the name a
   * volunteer calls out across the bookstore table.
   *
   * Optional because orders taken before this was asked for do not have one.
   */
  buyerFirstName?: string;
  buyerLastName?: string;
  /**
   * `contactEmail` lowercased, because that is the only form a query can match.
   *
   * Firestore `==` is byte-exact, so an order placed as `Anba@…` is invisible
   * to a lookup typed as `anba@…` — and the buyer, who typed both, would be
   * told they have no orders. Written at checkout; older orders predate it and
   * the lookup Function queries both fields for exactly that reason.
   */
  contactEmailLower?: string;

  lineItems: OrderLineItem[];
  /**
   * The total's parts: `subtotal` is the goods before tax, `tax` is what
   * Square charged as sales tax. With `shippingCents` they add up to `total`.
   *
   * Optional because orders taken before they were recorded have only the
   * total — `splitOrderTotal` in the analytics rollup reconstructs the split
   * for those. `total` remains the number that is always true.
   */
  subtotal?: Money | null;
  tax?: Money | null;
  total: Money;

  status: OrderStatus;
  fulfillment: FulfillmentStatus;

  /** True when this is being posted rather than collected after Liturgy. */
  shipping: boolean;
  /** Only set on a shipped order. Null for collection, always. */
  shippingAddress: Record<string, string> | null;
  /**
   * What the buyer paid for postage, as the service they chose — "USPS Ground
   * Advantage", or "Flat delivery" when no live quote was used. Tells whoever
   * takes the parcel to the post office which service to buy. Absent on
   * collections and on orders from before live rates.
   */
  shippingService?: string;
  /** Everything charged for delivery, handling included. 0 on a collection. */
  shippingCents?: number;
  /** The handling part of `shippingCents`. */
  handlingCents?: number;

  /**
   * Idempotency key we sent to Square. Kept so a retry after a network failure
   * cannot create a second order for the same cart.
   */
  idempotencyKey: string;

  /**
   * Set once checkout has lowered the clothing size counts for this order, so a
   * retried request cannot lower them twice. Absent on orders with no sizes.
   */
  sizesCounted?: boolean;

  /** Raw webhook event ids we've already applied, newest last. */
  appliedEventIds: string[];

  /**
   * Set when staff refunded this order. Null on every order that was not.
   *
   * The parish publishes a no-returns policy, so this is the record of an
   * exception being made — which is precisely the thing worth keeping a name
   * and a reason against. `status` moving to `refunded` is Square's webhook
   * doing its job; this is the parish's own note about why.
   *
   * Optional, and absent on an order that was not refunded — the checkout
   * Function does not write it as null, because that write merges and could
   * erase a real refund on a retry. See the note there.
   */
  refund?: OrderRefund | null;
}

export interface OrderRefund {
  squareRefundId: string;
  amount: Money;
  /** Free text from the staff member. Shown to nobody but staff. */
  reason: string;
  /** uid of the staff member who pressed the button. Never null. */
  refundedBy: string;
  refundedByEmail: string;
  refundedAt: Timestamped;
}

export interface OrderLineItem {
  productId: string;
  /** Denormalized so a later price change doesn't rewrite history. */
  name: string;
  /**
   * What Square charged for one of these, at the time.
   *
   * Read back from Square's priced order rather than from our catalog mirror —
   * the mirror can be stale by exactly the amount that would make a sales
   * report disagree with the bank. Optional because orders taken before this
   * was recorded have no value to supply, and inventing one would be worse than
   * leaving per-product revenue at zero for them.
   */
  unitPrice?: Money | null;
  quantity: number;
  /** The product's SKU when the order was taken. Absent on older orders. */
  sku?: string | null;
  /** The size bought, for clothing. Absent for everything else. */
  size?: string | null;
}

/** Mirrors the subset of Square payment states we care about. */
export const ORDER_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'canceled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILLMENT_STATUSES = ['unfulfilled', 'ready', 'collected'] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: money.currency,
  }).format(money.amount / 100);
}

export function sumMoney(items: OrderLineItem[]): Money {
  return {
    amount: items.reduce((total, item) => total + (item.unitPrice?.amount ?? 0) * item.quantity, 0),
    currency: 'USD',
  };
}
