import { createHmac } from 'node:crypto';
import { defineSecret, defineString } from 'firebase-functions/params';
import {
  COLLECTIONS,
  MAX_QUANTITY,
  QUOTE_TTL_MS,
  SERVICE_DAYS,
  SERVICE_LABELS,
  basketKey,
  parcelFor,
  quoteCents,
  servicesFor,
  signQuote,
  type BookstoreConfig,
  type Hmac,
  type ParcelLine,
  type Product,
  type ShippingOption,
  type ShippingService,
} from '@spsm/shared';

/*
 * USPS's own API, called directly — no aggregator, no per-label fee. The parish
 * still buys postage at the counter; this only prices it.
 *
 * Credentials come from a USPS business account's app at developers.usps.com.
 * Without them every quote falls back to the flat charge, which is a working
 * checkout rather than a broken one.
 *
 * The endpoint itself, `shippingQuote`, lives in checkout.ts beside
 * `squareCheckout`, so the two read the shop's settings through the one
 * function and cannot disagree about the flat charge.
 */
export const USPS_CLIENT_ID = defineSecret('USPS_CLIENT_ID');
export const USPS_CLIENT_SECRET = defineSecret('USPS_CLIENT_SECRET');
/** Signs quotes so checkout can trust a price the browser carried. Any long random string. */
export const SHIPPING_QUOTE_SECRET = defineSecret('SHIPPING_QUOTE_SECRET');
/** `production` for apis.usps.com; anything else is USPS's test environment. */
export const USPS_ENVIRONMENT = defineString('USPS_ENVIRONMENT', { default: 'production' });

/** Past this, the buyer is better served by the flat charge than by a spinner. */
const USPS_TIMEOUT_MS = 4_000;

function uspsHost(): string {
  return USPS_ENVIRONMENT.value() === 'production' ? 'https://apis.usps.com' : 'https://apis-tem.usps.com';
}

/** The signer, or null when the secret is missing — which means no live quotes. */
export function quoteHmac(): Hmac | null {
  const key = SHIPPING_QUOTE_SECRET.value().trim();
  if (!key) return null;
  return (message) => createHmac('sha256', key).update(message).digest('base64url');
}

/**
 * One OAuth token per instance, reused until a minute before it expires. USPS
 * issues them for eight hours, and asking for one per quote would double every
 * quote's latency and spend the parish's request allowance on handshakes.
 */
let cachedToken: { value: string; expires: number; host: string } | null = null;

async function uspsToken(signal: AbortSignal): Promise<string | null> {
  const host = uspsHost();
  if (cachedToken && cachedToken.host === host && cachedToken.expires > Date.now()) return cachedToken.value;

  // Trimmed: a value pasted into `secrets:set` keeps its trailing newline,
  // and USPS answers a key with a newline on the end with a bare 401.
  const clientId = USPS_CLIENT_ID.value().trim();
  const clientSecret = USPS_CLIENT_SECRET.value().trim();
  if (!clientId || !clientSecret) return null;

  const res = await fetch(`${host}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    signal,
  });
  if (!res.ok) {
    // USPS's own reason, which is what tells a wrong key from a missing API
    // product. It carries no credential — only the error code and message.
    console.error(`[shipping] USPS token request failed: ${res.status} ${await res.text().catch(() => '')}`);
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  const lifetime = Math.max(60, Number(json.expires_in) || 3600) * 1000;
  cachedToken = { value: json.access_token, expires: Date.now() + lifetime - 60_000, host };
  return json.access_token;
}

/** USPS's retail price for one service, in dollars, or null. */
async function uspsPrice(
  token: string,
  service: ShippingService,
  parcel: { weightOz: number },
  settings: BookstoreConfig['shipping'],
  zip: string,
  signal: AbortSignal,
): Promise<number | null> {
  const res = await fetch(`${uspsHost()}/prices/v3/base-rates/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      originZIPCode: settings.originZip,
      destinationZIPCode: zip,
      // Pounds, and USPS rounds up to the next ounce itself.
      weight: Math.ceil(parcel.weightOz) / 16,
      length: settings.box.lengthIn,
      width: settings.box.widthIn,
      height: settings.box.heightIn,
      mailClass: service,
      processingCategory: 'MACHINABLE',
      rateIndicator: 'SP',
      destinationEntryFacilityType: 'NONE',
      // What the counter charges, because the counter is where it is bought.
      priceType: 'RETAIL',
      mailingDate: new Date().toISOString().slice(0, 10),
    }),
    signal,
  });
  if (!res.ok) {
    console.error(`[shipping] USPS ${service} price failed: ${res.status} ${await res.text().catch(() => '')}`);
    return null;
  }
  const json = (await res.json()) as { totalBasePrice?: number };
  return typeof json.totalBasePrice === 'number' ? json.totalBasePrice : null;
}

/** The shop's request lines, cleaned the way `buildSquareOrder` cleans them. */
export function parcelLines(cart: unknown): ParcelLine[] {
  if (!Array.isArray(cart)) return [];
  const seen = new Set<string>();
  const lines: ParcelLine[] = [];
  for (const entry of cart.slice(0, 40) as { slug?: unknown; quantity?: unknown }[]) {
    const slug = typeof entry?.slug === 'string' ? entry.slug.trim() : '';
    const quantity = Number(entry?.quantity);
    if (!slug || seen.has(slug) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) continue;
    seen.add(slug);
    lines.push({ slug, quantity });
  }
  return lines;
}

/**
 * Every live option for this basket and ZIP, signed. Empty means "use the flat
 * charge" — for an unweighed item, the switch being off, a missing credential,
 * or USPS being slow or down. Shared by the quote endpoint and by checkout,
 * which re-quotes when the browser's token does not verify.
 */
export async function liveOptions(
  lines: readonly ParcelLine[],
  zip: string,
  catalog: ReadonlyMap<string, Pick<Product, 'weightOz' | 'mediaMail'>>,
  settings: BookstoreConfig['shipping'],
): Promise<ShippingOption[]> {
  if (settings.mode !== 'usps') return [];
  const hmac = quoteHmac();
  if (!hmac) return [];
  const parcel = parcelFor(lines, catalog, settings.box);
  if (!parcel) return [];
  const services = servicesFor(settings, parcel);
  if (services.length === 0) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USPS_TIMEOUT_MS);
  try {
    const token = await uspsToken(controller.signal);
    if (!token) return [];

    const prices = await Promise.all(
      services.map((service) =>
        uspsPrice(token, service, parcel, settings, zip, controller.signal).catch(() => null),
      ),
    );

    const basket = basketKey(lines);
    const expires = Date.now() + QUOTE_TTL_MS;
    const options: ShippingOption[] = [];
    services.forEach((service, i) => {
      const cents = quoteCents(prices[i] ?? NaN, settings.handlingCents);
      if (cents === null) return;
      options.push({
        id: signQuote({ service, cents, zip, basket, expires, handling: settings.handlingCents }, hmac),
        service,
        label: SERVICE_LABELS[service],
        days: SERVICE_DAYS[service],
        cents,
        handlingCents: settings.handlingCents,
      });
    });
    return options;
  } catch (error) {
    console.error('[shipping] USPS quote failed; using the flat charge', error);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Mirror rows for these slugs, keyed by slug. */
export async function productsFor(
  db: FirebaseFirestore.Firestore,
  slugs: readonly string[],
): Promise<Map<string, Product>> {
  const catalog = new Map<string, Product>();
  await Promise.all(
    slugs.map(async (slug) => {
      const doc = await db.collection(COLLECTIONS.products).doc(slug).get();
      if (doc.exists) catalog.set(slug, doc.data() as Product);
    }),
  );
  return catalog;
}
