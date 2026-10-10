/**
 * Give every rolled-up bookstore day and month its money split.
 *
 * ---------------------------------------------------------------------------
 * The stats documents gained `salesCents`, `taxCents`, `postageCents`,
 * `handlingCents`, `refundedTaxCents` and `shippingByService` — books, sales
 * tax and delivery shown apart. The hourly rollup only rewrites the last two
 * days, so everything older has the total and no split.
 *
 * Why not simply re-run the rollup for every day: `rollupDay` rebuilds the
 * *whole* document, views and visitors included, from `bookstoreEvents` — and
 * those expire after ninety days. Re-rolling August would wipe August's
 * browsing figures. So this recomputes **only the money fields**, from
 * `orders` (which never expire), with the same `rollupBookstore` the Function
 * uses, and writes them with a field mask so nothing else on the document is
 * touched. Months are then summed from their days the way `rollupMonth` sums
 * them, again writing only the money fields.
 *
 * Dry run by default; `--write` applies. Safe to run twice.
 *
 *   npm run build --workspace @spsm/shared && node scripts/backfill-bookstore-money.mjs
 * ---------------------------------------------------------------------------
 */
import { dayKey, rollupBookstore } from '@spsm/shared';
import { accessToken, documentUrl, fromFirestore, toValue } from './lib/firestore-rest.mjs';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'spsm-database';
const WRITE = process.argv.includes('--write');
const ZONE = 'America/New_York';
const MONEY = ['salesCents', 'taxCents', 'postageCents', 'handlingCents', 'refundedTaxCents'];

const token = await accessToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function* list(collection) {
  let pageToken = '';
  do {
    const url = new URL(documentUrl(PROJECT, collection));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Could not list ${collection}: ${response.status} ${await response.text()}`);
    const body = await response.json();
    for (const document of body.documents ?? []) yield document;
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
}

/** PATCH only the money fields, so views, visitors and the rest are untouched. */
async function writeMoney(id, totals, shippingByService) {
  const url = new URL(documentUrl(PROJECT, `bookstoreStats/${id}`));
  for (const field of MONEY) url.searchParams.append('updateMask.fieldPaths', `totals.${field}`);
  url.searchParams.append('updateMask.fieldPaths', 'shippingByService');
  // Only ever an existing rollup: a day with orders but no document is the
  // hourly job's to create, with its events, not this script's.
  url.searchParams.set('currentDocument.exists', 'true');
  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      fields: {
        totals: { mapValue: { fields: Object.fromEntries(MONEY.map((f) => [f, toValue(totals[f] ?? 0)])) } },
        shippingByService: toValue(shippingByService),
      },
    }),
  });
  if (!response.ok) throw new Error(`Could not write ${id}: ${response.status} ${await response.text()}`);
}

// ── Orders, by the parish day they were placed ─────────────────────────────
const byDay = new Map();
for await (const document of list('orders')) {
  const order = fromFirestore(document.fields ?? {});
  const placed = order.createdAt instanceof Date ? order.createdAt : null;
  if (!placed) continue;
  const day = dayKey(placed, ZONE);
  const row = {
    contactEmail: order.contactEmail ?? '',
    status: order.status,
    shipping: Boolean(order.shipping),
    total: order.total ?? { amount: 0 },
    lineItems: order.lineItems ?? [],
    day,
    subtotal: order.subtotal ?? null,
    tax: order.tax ?? null,
    shippingCents: order.shippingCents ?? null,
    handlingCents: order.handlingCents ?? null,
    shippingService: order.shippingService ?? null,
  };
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(row);
}

// ── The rollup documents that exist ────────────────────────────────────────
const existing = new Map();
for await (const document of list('bookstoreStats')) {
  existing.set(document.name.split('/').pop(), fromFirestore(document.fields ?? {}));
}

const money = (totals) => MONEY.map((f) => `${f.replace('Cents', '')} ${((totals[f] ?? 0) / 100).toFixed(2)}`).join(', ');
const months = new Map();

for (const [day, orders] of [...byDay].sort()) {
  const id = `day-${day}`;
  const rolled = rollupBookstore({ period: 'day', key: day, events: [], orders });
  const month = day.slice(0, 7);
  if (!months.has(month)) months.set(month, []);
  months.get(month).push(rolled);

  if (!existing.has(id)) {
    console.log(`  ${id}: no rollup document — skipped (the hourly job writes it)`);
    continue;
  }
  console.log(`  ${id}: ${orders.length} order(s) → ${money(rolled.totals)}`);
  if (WRITE) await writeMoney(id, rolled.totals, rolled.shippingByService);
}

for (const [month, days] of [...months].sort()) {
  const id = `month-${month}`;
  const totals = Object.fromEntries(MONEY.map((f) => [f, days.reduce((sum, d) => sum + d.totals[f], 0)]));
  const shippingByService = {};
  for (const d of days) {
    for (const [service, row] of Object.entries(d.shippingByService)) {
      const target = (shippingByService[service] ??= { orders: 0, cents: 0 });
      target.orders += row.orders;
      target.cents += row.cents;
    }
  }
  if (!existing.has(id)) {
    console.log(`  ${id}: no rollup document — skipped`);
    continue;
  }
  console.log(`  ${id}: ${money(totals)}`);
  if (WRITE) await writeMoney(id, totals, shippingByService);
}

console.log(WRITE ? 'Written.' : 'Dry run. Run again with --write to apply.');
