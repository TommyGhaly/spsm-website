/**
 * Browser-side reads and writes for the bookstore admin.
 *
 * Separate from `data.ts` for the same reason `features/events/admin.ts` is:
 * that file is build-time only, runs unauthenticated during `next build`, and
 * filters on `published == true`. This one runs in a signed-in browser, reads
 * orders — which no unauthenticated client may read at all — and writes.
 *
 * **Not re-exported from `index.ts`, and every import of it is dynamic.** A
 * static import would pull this module's reads and writes into whatever chunk
 * the importer lands in, and /bookstore is a page parishioners open.
 *
 * Note that this does *not* keep `firebase/firestore` off the page — measured on
 * 2026-08-23, every exported page already carries about 604KB of it, contrary to
 * the comment in `lib/auth.ts`. What the dynamic imports do buy is that the
 * order queries, the refund call, and the stats reads are in chunks a visitor
 * never fetches. Worth keeping for that alone, and worth not over-claiming.
 *
 * Security is in `firestore.rules` and in the Functions, not here. Everything
 * below is convenience for somebody who already holds the claim: the fulfilment
 * write is permitted by the one narrow `allow update` on `orders`, and the
 * refund goes to a Function that re-checks the token server-side.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  CONFIG_DOC_BOOKSTORE,
  COLLECTIONS,
  parseSections,
  type BookstoreSection,
  type BookstoreShipping,
  type BookstoreStats,
  type DocOf,
  type FulfillmentStatus,
  type Order,
  type Product,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { auth } from '@/lib/auth';

/**
 * How many orders the screen holds at once.
 *
 * A cap rather than pagination. The parish sells a few books a week; two hundred
 * is more than a year of them, and a "load more" button on a list that will
 * never reach the bottom is machinery maintained for nobody. When it does start
 * filling up, the fix is a date filter, not a page button — staff look for
 * *this week's* orders, not for order 201.
 */
export const ORDER_PAGE = 200;

/** Every order, newest first. Staff and the bookstore group only. */
export async function listOrders(): Promise<DocOf<Order>[]> {
  const snapshot = await getDocs(
    query(collection(db(), COLLECTIONS.orders), orderBy('createdAt', 'desc'), limit(ORDER_PAGE)),
  );
  return snapshot.docs.map((entry) => ({ ...(entry.data() as Order), id: entry.id }));
}

/**
 * Move an order along: unfulfilled → ready → collected.
 *
 * The only field a client may change on an order. `firestore.rules` enforces
 * that with a `hasOnly` on the affected keys, so a write that tried to carry
 * `status` or `total` alongside would be refused entirely rather than partially
 * applied — see tests/rules/bookstore.test.ts.
 */
export async function setFulfillment(orderId: string, fulfillment: FulfillmentStatus): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Your session has expired. Sign in again.');

  await updateDoc(doc(db(), COLLECTIONS.orders, orderId), {
    fulfillment,
    updatedAt: serverTimestamp(),
    // The rule requires this to equal the caller's uid, so a write cannot be
    // attributed to somebody else.
    updatedBy: uid,
  });
}

/**
 * Refund an order in full.
 *
 * A POST to a Function rather than a Firestore write, because it moves money:
 * the Square access token authorizes charges and lives only in the Functions
 * runtime. The ID token goes in the header and is re-verified there — nothing
 * here is the check.
 */
export async function refundOrder(orderId: string, reason: string): Promise<void> {
  const user = auth().currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again.');

  const response = await fetch('/api/square/refund', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ orderId, reason }),
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? 'The refund could not be sent.');
  }
}

/**
 * One rolled-up period, or null when the rollup has not written it yet.
 *
 * Null is an ordinary answer and not an error: `bookstoreStats` is empty until
 * the scheduled Function first runs, and a day with no activity never gets a
 * document at all. The screen says "nothing recorded" rather than failing.
 */
export async function readStats(period: 'day' | 'month', key: string): Promise<BookstoreStats | null> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.bookstoreStats, `${period}-${key}`));
  return snapshot.exists() ? (snapshot.data() as BookstoreStats) : null;
}

/**
 * Recompute the recent periods now.
 *
 * The rollup runs hourly, which is fresh enough to read and too stale to trust
 * when somebody has just taken an order and wants to see it land. Same Function,
 * called on demand, same claim required.
 */
export async function refreshStats(): Promise<string[]> {
  const user = auth().currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again.');

  const response = await fetch('/api/square/stats-refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });

  const body = (await response.json().catch(() => ({}))) as { error?: string; days?: string[] };
  if (!response.ok) throw new Error(body.error ?? 'Could not refresh the statistics.');
  return body.days ?? [];
}

/**
 * Slug → product name, for the metrics tables.
 *
 * The stats documents are keyed by slug because that is what an event carries,
 * and `be-prepared-fr-daoud-lamei` is not a thing to put in front of a person.
 * Read separately rather than denormalized into the rollup: a book renamed in
 * Square should show its new name against its old sales, not the name it had on
 * the day somebody looked at it.
 *
 * Unpublished products are included — a title withdrawn from the shop still sold
 * copies last month, and leaving it as a bare slug in the report helps nobody.
 */
export async function productNames(): Promise<Map<string, string>> {
  const snapshot = await getDocs(collection(db(), COLLECTIONS.products));
  const names = new Map<string, string>();
  for (const entry of snapshot.docs) {
    const product = entry.data() as Product;
    if (product.slug) names.set(product.slug, product.name);
  }
  return names;
}


/* -------------------------------------------------------------------------- */
/* The catalog                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every product, published or not, for the admin list.
 *
 * Unlike `getProducts` in data.ts this does **not** filter on `published`. A
 * product the sync unpublished because Square no longer lists it is exactly the
 * row somebody opening this screen needs to see — it is off the shop and there
 * is nothing else that would say so.
 */
export async function listProducts(): Promise<DocOf<Product>[]> {
  const snapshot = await getDocs(collection(db(), COLLECTIONS.products));
  return snapshot.docs
    .map((entry) => ({ ...(entry.data() as Product), id: entry.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * File a product into a section, or clear it.
 *
 * A direct Firestore write, not a Function: nothing about it touches Square.
 * `firestore.rules` admits exactly `section`, `updatedAt`, and `updatedBy` from
 * the bookstore group, so a change here cannot carry a price with it.
 */
export async function setProductSection(slug: string, section: string | null): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Your session has expired. Sign in again.');

  await updateDoc(doc(db(), COLLECTIONS.products, slug), {
    section,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * A product's shipping weight and Media Mail eligibility.
 *
 * The parish's fields, like `section`, and written the same way. They price
 * only delivery, and only through the quote Function — so a wrong weight costs
 * a few cents of postage, never the price of a book.
 */
export async function setProductShipping(
  slug: string,
  shipping: { weightOz: number | null; mediaMail: boolean },
): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Your session has expired. Sign in again.');

  await updateDoc(doc(db(), COLLECTIONS.products, slug), {
    weightOz: shipping.weightOz,
    mediaMail: shipping.mediaMail,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** Save the live-postage settings. Same `merge` reasoning as `writeSections`. */
export async function writeShipping(shipping: BookstoreShipping): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Your session has expired. Sign in again.');

  await setDoc(
    doc(db(), COLLECTIONS.config, CONFIG_DOC_BOOKSTORE),
    { shipping, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true },
  );
}

/**
 * Save the shop's divisions.
 *
 * `setDoc(..., { merge: true })` because the document may not exist — nothing
 * seeds `config/bookstore`, and the first section anybody makes is what creates
 * it. The rules have a separate `create` branch for exactly that case.
 */
export async function writeSections(sections: BookstoreSection[]): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) throw new Error('Your session has expired. Sign in again.');

  await setDoc(
    doc(db(), COLLECTIONS.config, CONFIG_DOC_BOOKSTORE),
    { sections, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true },
  );
}

/** The sections as Firestore currently holds them. */
export async function readSections(): Promise<BookstoreSection[]> {
  const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_BOOKSTORE));
  return parseSections(snapshot.exists() ? snapshot.data()['sections'] : null);
}

/** POST to a catalog Function with the caller's ID token. */
async function callCatalog(path: string, body: unknown): Promise<Record<string, unknown>> {
  const user = auth().currentUser;
  if (!user) throw new Error('Your session has expired. Sign in again.');

  const response = await fetch(`/api/square/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify(body),
  });

  /*
   * Read the body as text first, then try JSON.
   *
   * `response.json().catch(() => ({}))` collapsed two very different failures
   * into one blank message. Every Function here answers with `{ error }`, so a
   * body that will not parse means the request never reached one — a missing
   * Hosting rewrite answering with the 404 page, or a dev proxy with nothing
   * behind it answering `500 Internal Server Error` as plain text. Both then
   * reported "That did not work." with the status thrown away, and both cost an
   * afternoon on 2026-09-01: once when the Functions emulator was down, and
   * again when this very endpoint was called before its rewrite was deployed.
   *
   * The status is the whole diagnosis, so it is in the sentence.
   */
  const answer = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(answer) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw new Error(
        `The server answered ${response.status} and not in the usual way, which ` +
          'normally means this page is newer than what is deployed. Try again, and ' +
          'tell whoever looks after the site if it keeps happening.',
      );
    }
  }

  if (!response.ok) throw new Error(String(json['error'] ?? `That did not work (${response.status}).`));
  return json;
}

export interface NewProduct {
  name: string;
  description: string;
  priceCents: number;
  section: string | null;
  weightOz: number | null;
  mediaMail: boolean;
}

/**
 * Add a product — to Square first, then here.
 *
 * Square has to be first: the checkout prices orders from Square's own catalog,
 * so a row that exists only in Firestore has no variation id and is a book on
 * the shop that nobody can buy. The Function enforces that order; this just
 * carries the form to it.
 */
export async function createProduct(product: NewProduct): Promise<string> {
  const json = await callCatalog('product', product);
  return String(json['slug']);
}

/**
 * Send a photograph to Square, attached to this product.
 *
 * As a data URL rather than a `FormData`, because the request needs an ID token
 * and the browser must never hold the Square access token. The Function
 * reassembles the multipart body Square's image endpoint requires.
 */
export async function uploadProductImage(slug: string, image: string): Promise<string> {
  const json = await callCatalog('product-image', { slug, image });
  return String(json['url']);
}

export async function removeProductImage(slug: string, url: string): Promise<void> {
  await callCatalog('product-image-remove', { slug, url });
}

/**
 * Set how many copies are on the shelf, or stop counting them.
 *
 * `null` is "not tracked" and is a different thing from `0`, which is sold out:
 * the shop hides a book at zero and shows one at null. The Function switches
 * Square's `track_inventory` accordingly, which is why this cannot be a
 * Firestore write — and why it would not survive one anyway, `stockCount` being
 * on the sync's field mask.
 */
export async function setProductStock(slug: string, count: number | null): Promise<void> {
  await callCatalog('product-stock', { slug, count });
}

/**
 * Take a product off the shop for good.
 *
 * Archives it in Square and unpublishes the mirror, in that order. Both are
 * needed: the unpublish is what the shop's live refresh notices within seconds,
 * and the archive is what stops the next `npm run catalog` publishing it again.
 */
export async function archiveProduct(slug: string): Promise<void> {
  await callCatalog('product-archive', { slug });
}

/**
 * Change what Square owns about a book: its title, its price, its description.
 *
 * All three are on the sync's field mask, so none of them can be a Firestore
 * write — a value typed into the document survives until the next sync and then
 * reverts. The Function edits the Square item and mirrors the result back, which
 * is what the shop's live refresh picks up seconds later.
 *
 * One call for all three, so editing a book is one round trip and one Square
 * catalog version rather than three. Only the keys present are touched; an
 * absent one is left alone rather than cleared.
 *
 * The slug, and so the product's URL, deliberately does not change with the
 * title: a new slug is a new document, and would cost the book its category, its
 * baked cover and its link from every past order.
 */
export interface ProductDetails {
  name?: string;
  description?: string;
  priceCents?: number;
}

export async function setProductDetails(
  slug: string,
  details: ProductDetails,
): Promise<void> {
  await callCatalog('product-details', { slug, ...details });
}
