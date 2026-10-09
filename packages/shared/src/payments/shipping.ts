/**
 * Live USPS postage for delivered orders — the parts that need no network.
 *
 * ---------------------------------------------------------------------------
 * How a delivery gets its price, end to end.
 *
 *   1. The browser sends the basket (slugs and quantities) and a ZIP code to
 *      `/api/shipping/quote`. Still no money in that direction.
 *   2. The quote Function weighs the basket from the Firestore mirror
 *      (`parcelFor`), asks USPS for each service, adds the parish's handling fee,
 *      and returns one option per service. Each option's id is a **signed
 *      quote** — service, cents, ZIP, basket and an expiry, under an HMAC only
 *      the Functions know.
 *   3. The buyer picks one and pays. `squareCheckout` verifies the signature and
 *      that the ZIP and basket are still the ones quoted, and charges the cents
 *      inside the token. A token that fails any check is ignored and the server
 *      quotes again itself.
 *
 * So the browser carries a price without being able to choose one: altering a
 * byte of the token breaks the signature, and an honest token for a one-book
 * basket does not verify against a ten-book one.
 *
 * Signing is passed in (`hmac`) rather than imported, because this package also
 * runs in the browser and Node's `crypto` does not. Only the Functions ever hold
 * the key, so only they ever call `signQuote` or `verifyQuote` for real.
 * ---------------------------------------------------------------------------
 */
import type { Product } from '../schema/commerce.js';
import type { BookstoreShipping, ShippingService } from '../schema/config.js';

/** What a shopper reads next to each option. */
export const SERVICE_LABELS: Record<ShippingService, string> = {
  USPS_GROUND_ADVANTAGE: 'USPS Ground Advantage',
  PRIORITY_MAIL: 'USPS Priority Mail',
  MEDIA_MAIL: 'USPS Media Mail',
};

/**
 * USPS's published delivery windows. The prices API does not return a date, and
 * a range USPS itself advertises is more honest than a date we would make up.
 */
export const SERVICE_DAYS: Record<ShippingService, string> = {
  USPS_GROUND_ADVANTAGE: '2–5 business days',
  PRIORITY_MAIL: '1–3 business days',
  MEDIA_MAIL: '2–8 business days',
};

/** The label written on a flat-rate order, so staff can tell the two apart. */
export const FLAT_SHIPPING_LABEL = 'Flat delivery';

/** USPS refuses domestic parcels over 70 lb. */
export const MAX_PARCEL_OZ = 70 * 16;
/** One copy of anything the parish sells weighs less than this. Guards a typo. */
export const MAX_ITEM_WEIGHT_OZ = MAX_PARCEL_OZ;

/** How long a quoted price may be paid. Long enough to find a card, no longer. */
export const QUOTE_TTL_MS = 30 * 60_000;

export interface ParcelLine {
  slug: string;
  quantity: number;
}

export interface Parcel {
  /** Contents plus the box. */
  weightOz: number;
  /** True only when every line may go by Media Mail. */
  mediaMail: boolean;
}

/**
 * The basket as one parcel, or null when it cannot be weighed.
 *
 * Null for a single unweighed line, not a parcel that quietly leaves it out: a
 * quote for two books when three are in the box is postage the parish pays the
 * difference on. Null sends the caller to the flat charge instead.
 */
export function parcelFor(
  lines: readonly ParcelLine[],
  catalog: ReadonlyMap<string, Pick<Product, 'weightOz' | 'mediaMail'>>,
  box: BookstoreShipping['box'],
): Parcel | null {
  if (lines.length === 0) return null;

  let weightOz = box.tareOz;
  let mediaMail = true;
  for (const line of lines) {
    const product = catalog.get(line.slug);
    const weight = product?.weightOz;
    if (!product || typeof weight !== 'number' || !(weight > 0)) return null;
    weightOz += weight * line.quantity;
    if (product.mediaMail !== true) mediaMail = false;
  }

  if (weightOz > MAX_PARCEL_OZ) return null;
  return { weightOz: Math.round(weightOz * 100) / 100, mediaMail };
}

/** Which services to ask USPS about, in the parish's order. */
export function servicesFor(settings: BookstoreShipping, parcel: Parcel): ShippingService[] {
  return settings.services.filter((service) => service !== 'MEDIA_MAIL' || parcel.mediaMail);
}

/**
 * USPS answers in dollars, as a float. Rounded to the cent once, here, and the
 * handling fee added in cents — never `(price + handling) * 100`, which is where
 * $6.85 becomes 684.9999 and a charge a cent short.
 */
export function quoteCents(uspsDollars: number, handlingCents: number): number | null {
  if (!Number.isFinite(uspsDollars) || uspsDollars <= 0) return null;
  return Math.round(uspsDollars * 100) + handlingCents;
}

/** Five digits from whatever was typed — `"01778-1234"` and `" 01778 "` both count. */
export function usableZip(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{5})(?:-?\d{4})?\s*$/.exec(value);
  return match ? match[1]! : null;
}

/**
 * The basket, in a form two requests agree on.
 *
 * Sorted, so a basket assembled in a different order is the same basket. Built
 * from what the shop sends rather than from a product lookup, so the quote and
 * checkout Functions compute it identically before either has read anything.
 */
export function basketKey(lines: readonly ParcelLine[]): string {
  return lines
    .map((line) => `${line.slug}:${line.quantity}`)
    .sort()
    .join(',');
}

export interface SignedQuote {
  service: ShippingService;
  cents: number;
  zip: string;
  basket: string;
  /** Epoch milliseconds. */
  expires: number;
}

export type Hmac = (message: string) => string;

/** `payload.signature`, both base64url. Opaque to the browser, which only echoes it. */
export function signQuote(quote: SignedQuote, hmac: Hmac): string {
  const payload = toBase64Url(JSON.stringify(quote));
  return `${payload}.${hmac(payload)}`;
}

/**
 * The quote inside a token, if it is genuine, unexpired, and for this basket
 * going to this ZIP. Null for anything else, with no reason given — every
 * failure has the same remedy, which is to quote again.
 */
export function verifyQuote(
  token: unknown,
  hmac: Hmac,
  expect: { zip: string; basket: string; now: number },
): SignedQuote | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!sameString(signature, hmac(payload))) return null;

  let quote: Partial<SignedQuote>;
  try {
    quote = JSON.parse(fromBase64Url(payload)) as Partial<SignedQuote>;
  } catch {
    return null;
  }

  if (
    typeof quote.service !== 'string' ||
    !(quote.service in SERVICE_LABELS) ||
    typeof quote.cents !== 'number' ||
    !Number.isInteger(quote.cents) ||
    quote.cents < 0 ||
    typeof quote.expires !== 'number' ||
    quote.expires < expect.now ||
    quote.zip !== expect.zip ||
    quote.basket !== expect.basket
  ) {
    return null;
  }
  return quote as SignedQuote;
}

/** Compares every character, so a near-miss signature costs as long as a far one. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/*
 * `btoa`/`atob` exist in browsers and in Node 16+, so these need no Buffer.
 * The payload is JSON of ASCII slugs and digits; `encodeURIComponent` keeps a
 * stray non-ASCII character from throwing all the same.
 */
function toBase64Url(text: string): string {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))));
}

/** One choice offered to the shopper. `id` is the signed quote. */
export interface ShippingOption {
  id: string;
  service: ShippingService;
  label: string;
  days: string;
  /** What is charged: postage plus handling. The signed figure. */
  cents: number;
  /** The handling part of `cents`, so the page can show the two separately. */
  handlingCents: number;
}

/** What `/api/shipping/quote` answers. `fallbackCents` alone means "flat delivery". */
export interface ShippingQuoteResponse {
  options: ShippingOption[];
  fallbackCents: number;
}

/**
 * A weight as staff type it, in **pounds** — returned in ounces, which is what
 * is stored and what the parcel arithmetic uses.
 *
 * `"2"`, `"2.5"` and `"2.5 lb"` are pounds; the field is labelled in pounds
 * because that is how the parish weighs things. Empty is `null` — not weighed —
 * and nonsense is `undefined`, so the form can tell "cleared" from "mistyped".
 */
export function parseWeight(text: string): number | null | undefined {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:lbs?|pounds?)?$/.exec(value);
  if (!match) return undefined;
  const ounces = Number(match[1]) * 16;
  if (!(ounces > 0) || ounces > MAX_ITEM_WEIGHT_OZ) return undefined;
  return Math.round(ounces * 100) / 100;
}

/** Stored ounces as the pounds the field shows: `40` → `"2.5"`. */
export function ouncesToPounds(ounces: number): string {
  return String(Math.round((ounces / 16) * 100) / 100);
}

/** `40` → `"2.5 lb"`. For hints, never for storage. */
export function formatWeight(ounces: number): string {
  return `${ouncesToPounds(ounces)} lb`;
}
