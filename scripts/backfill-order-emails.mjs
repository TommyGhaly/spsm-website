/**
 * Give every existing order a `contactEmailLower`.
 *
 * ---------------------------------------------------------------------------
 * Why the order lookup needs this, and what happens without it.
 *
 * A buyer finds their orders by proving one receipt — an order number plus the
 * email it went to — and the Function then queries for everything under that
 * address. Firestore `==` is byte-exact, so the query runs against a lowercased
 * copy of the address; an order written before that field existed has no copy
 * and is invisible to it.
 *
 * The Function has a fallback that matches the address as stored on the order
 * the buyer proved, which catches most legacy rows because the same person's
 * orders were typed the same way. "Most" is the problem: a buyer who used
 * `Mina@example.com` in March and `mina@example.com` in June sees half their
 * history, with nothing to indicate the other half exists. That is worse than
 * an error, because it looks like an answer.
 *
 * This makes the fallback unnecessary. Run it once, and every order is reachable
 * by the exact query.
 * ---------------------------------------------------------------------------
 *
 * Goes in over the REST API with your own gcloud credentials, like the other
 * scripts here — those bypass security rules the same way the Admin SDK does,
 * and `orders` is `allow write: if false` to every client.
 *
 * Prerequisite: `gcloud auth login`.
 *
 * Usage:
 *   node scripts/backfill-order-emails.mjs            # report only
 *   node scripts/backfill-order-emails.mjs --write    # apply
 */
import { accessToken, documentUrl, fromFirestore, toValue } from './lib/firestore-rest.mjs';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'spsm-database';
const WRITE = process.argv.includes('--write');

const token = await accessToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

/** Every order, a page at a time. */
async function* orders() {
  let pageToken = '';
  do {
    const url = new URL(documentUrl(PROJECT, 'orders'));
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Could not list orders: ${response.status} ${await response.text()}`);
    }
    const body = await response.json();
    for (const document of body.documents ?? []) yield document;
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
}

let seen = 0;
let already = 0;
const needed = [];

for await (const document of orders()) {
  seen += 1;
  const data = fromFirestore(document.fields ?? {});
  const email = typeof data.contactEmail === 'string' ? data.contactEmail.trim() : '';
  if (!email) continue;

  const lower = email.toLowerCase();
  if (data.contactEmailLower === lower) {
    already += 1;
    continue;
  }
  needed.push({ name: document.name, id: document.name.split('/').pop(), email, lower });
}

console.log(`${seen} orders, ${already} already correct, ${needed.length} to update.`);

if (needed.length === 0) {
  console.log('Nothing to do.');
  process.exit(0);
}

for (const order of needed) {
  console.log(`  ${order.id}  ${order.email} -> ${order.lower}`);
}

if (!WRITE) {
  console.log('\nDry run. Re-run with --write to apply.');
  process.exit(0);
}

for (const order of needed) {
  /*
   * A field-masked PATCH, writing exactly one field.
   *
   * Without `updateMask.fieldPaths` a PATCH replaces the whole document with
   * the body — which here is one field — and every order it touched would lose
   * its line items, its total, and its payment id. The mask is the difference
   * between a backfill and a data loss.
   */
  const url = new URL(`https://firestore.googleapis.com/v1/${order.name}`);
  url.searchParams.set('updateMask.fieldPaths', 'contactEmailLower');

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: { contactEmailLower: toValue(order.lower) } }),
  });

  if (!response.ok) {
    console.error(`  FAILED ${order.id}: ${response.status} ${await response.text()}`);
    continue;
  }
  console.log(`  updated ${order.id}`);
}

console.log('\nDone. Every order is now reachable by the exact query.');
