import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, cleanName, slugify } from '@spsm/shared';
import { callerOf, mayManageOrders } from './httpAuth.js';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  squareClient,
} from './square.js';

/**
 * Adding a book to the shop, and putting a photograph on it.
 *
 * ---------------------------------------------------------------------------
 * Square first, always. The Firestore row is a consequence, never the record.
 *
 * Square is the source of truth for the catalog (decision #5b) and — much more
 * importantly — it is what *prices the order at checkout*. `buildSquareOrder`
 * sends catalog ids and lets Square decide the amount, precisely so a tampered
 * or stale mirror cannot change what somebody pays. A product created only in
 * Firestore would therefore be a product that cannot be bought: it has no
 * variation id, and the checkout rejects it as `not-in-square`.
 *
 * So this creates the item in Square, and only then writes the mirror row. If
 * Square fails, nothing is written anywhere and the volunteer is told. If the
 * Firestore write fails after Square succeeded, the item exists in Square and
 * the next `npm run catalog` picks it up — an inconsistency that heals, rather
 * than a book on the website that nobody can buy.
 * ---------------------------------------------------------------------------
 */

/**
 * The Square category every online product belongs to.
 *
 * The gate, not a division: the parish's Square catalog holds 68 items, 57 of
 * which are the Coptic Festival food menu, and this one category is what keeps
 * Lamb Dinner off the bookstore page. The shop's own divisions are a Firestore
 * field — see `Product.section`.
 *
 * Must match `CATEGORY` in scripts/sync-catalog.mjs. A product created under
 * any other name is invisible to the sync and vanishes from the site the next
 * time it runs.
 */
const SQUARE_CATEGORY = defineString('SQUARE_CATALOG_CATEGORY', { default: 'Bookstore' });

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;
/** $1,000. A parish bookstore has no honest reason to exceed it. */
const MAX_PRICE_CENTS = 100_000;
/** Square's own ceiling is 15MB; this is well under and still generous. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** A parish bookstore counting more than this has mistyped, not restocked. */
const MAX_STOCK = 10_000;

interface SquareErrorBody {
  errors?: { detail?: string; code?: string }[];
}

/** The category's Square id, or null when the parish has not made one. */
async function categoryId(
  host: string,
  headers: Record<string, string>,
  wanted: string,
): Promise<string | null> {
  const response = await fetch(`${host}/v2/catalog/list?types=CATEGORY`, { headers });
  if (!response.ok) return null;

  const body = (await response.json()) as { objects?: Record<string, unknown>[] };
  const target = wanted.trim().toLowerCase();

  for (const object of body.objects ?? []) {
    const data = object['category_data'] as { name?: string } | undefined;
    if (typeof data?.name === 'string' && data.name.trim().toLowerCase() === target) {
      return String(object['id']);
    }
  }
  return null;
}

/**
 * Create a product in Square, then mirror it.
 *
 * The variation carries the price, because that is where Square keeps it: an
 * ITEM is a name and a description, and an ITEM_VARIATION is a thing with an
 * amount. A single default variation is what the parish's existing eleven books
 * all have, and matching them is what lets `mapSquareCatalog` read this back
 * without a special case.
 */
export const squareCreateProduct = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Adding to the catalog is limited to the bookstore group and parish staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanName(body['name']);
    const description =
      typeof body['description'] === 'string' ? body['description'].trim().slice(0, MAX_DESCRIPTION) : '';
    const priceCents = Number(body['priceCents']);
    const section = typeof body['section'] === 'string' ? body['section'].trim().slice(0, 40) : '';

    if (!name || name.length > MAX_NAME) {
      res.status(400).json({ error: 'A name is needed.' });
      return;
    }
    /*
     * A price is required and must be positive. Square will happily create a
     * $0.00 item, and the checkout refuses to charge a zero total — so a free
     * book would appear on the shop and fail at the card form with "could not
     * price the order", which is the least explicable failure available.
     */
    if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > MAX_PRICE_CENTS) {
      res.status(400).json({ error: 'A price between $0.01 and $1,000.00 is needed.' });
      return;
    }

    const square = squareClient();
    if (!square) {
      res.status(503).json({ error: 'Square is not configured.' });
      return;
    }

    const wanted = SQUARE_CATEGORY.value();
    const category = await categoryId(square.host, square.headers, wanted);
    if (!category) {
      /*
       * Refused rather than created uncategorised. An item with no category is
       * invisible to `mapSquareCatalog`, so it would be created successfully in
       * Square, never appear on the site, and give nobody a reason why.
       */
      res.status(409).json({
        error:
          `Square has no "${wanted}" category, which is what puts a product in the online ` +
          'shop. Create it in the Square Dashboard first.',
      });
      return;
    }

    try {
      const idempotencyKey = `new-${caller?.uid ?? 'staff'}-${Date.now()}`.slice(0, 45);
      const response = await fetch(`${square.host}/v2/catalog/object`, {
        method: 'POST',
        headers: square.headers,
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          object: {
            // `#name` is Square's convention for a client-supplied temporary id
            // on a create; it returns the real one in `id_mappings`.
            id: '#item',
            type: 'ITEM',
            item_data: {
              name,
              description,
              categories: [{ id: category }],
              variations: [
                {
                  id: '#variation',
                  type: 'ITEM_VARIATION',
                  item_variation_data: {
                    name: 'Regular',
                    pricing_type: 'FIXED_PRICING',
                    price_money: { amount: priceCents, currency: 'USD' },
                  },
                },
              ],
            },
          },
        }),
      });

      const json = (await response.json()) as SquareErrorBody & {
        catalog_object?: { id?: string; item_data?: { variations?: { id?: string }[] } };
      };

      if (!response.ok || !json.catalog_object?.id) {
        const detail = json.errors?.[0];
        console.error('[catalog] Square refused the item', JSON.stringify(json.errors));
        /*
         * The scope error is called out by name. `ITEMS_WRITE` is not needed by
         * anything else this site does, so the first time anyone adds a product
         * is the first time a token without it fails — and "FORBIDDEN" alone
         * sends somebody looking at Firestore rules.
         */
        if (detail?.code === 'FORBIDDEN' || response.status === 403) {
          res.status(502).json({
            error:
              'Square refused: this access token cannot write to the catalog. It needs the ' +
              'ITEMS_WRITE permission.',
          });
          return;
        }
        res.status(502).json({ error: detail?.detail ?? 'Square would not create the product.' });
        return;
      }

      const squareId = json.catalog_object.id;
      const variationId = json.catalog_object.item_data?.variations?.[0]?.id ?? null;

      /*
       * The mirror row, keyed by `slugify` from @spsm/shared — the *same*
       * function `mapSquareCatalog` uses, not a copy of it.
       *
       * This started as a local reimplementation and was wrong within eight
       * lines: the real one normalises to NFKD, strips diacritics, and removes
       * apostrophes, so "St. Mary's Prayers" is `st-marys-prayers` there and
       * would have been `st-mary-s-prayers` here. The next `npm run catalog`
       * would then have created a *second* document for the same book and the
       * shop would have listed it twice.
       *
       * There is no version of this worth duplicating. The document id is the
       * join between Square and Firestore, and a join computed two ways is a
       * join that eventually disagrees.
       */
      const slug = slugify(name);
      const db = getFirestore();
      await db
        .collection(COLLECTIONS.products)
        .doc(slug)
        .set(
          {
            slug,
            name,
            description,
            price: { amount: priceCents, currency: 'USD' },
            imagePaths: [],
            squareCatalogObjectId: squareId,
            squareVariationId: variationId,
            stockCount: null,
            category: wanted,
            // The parish's own field, and the reason the sync now uses a field
            // mask — see scripts/sync-catalog.mjs.
            ...(section ? { section } : {}),
            published: true,
            publishAt: null,
            syncedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: caller?.uid ?? null,
          },
          { merge: true },
        );

      res.status(200).json({ ok: true, slug, squareId, variationId });
    } catch (error) {
      console.error('[catalog] unexpected failure creating a product', error);
      res.status(500).json({ error: 'The product could not be created.' });
    }
  },
);

/**
 * Attach a photograph to a product, in Square.
 *
 * ---------------------------------------------------------------------------
 * Square's image endpoint is multipart, and that is the whole awkwardness here.
 *
 * `POST /v2/catalog/images` wants a `multipart/form-data` body whose first part
 * is a JSON request and whose second is the file. The browser sends this
 * Function plain JSON with a base64 payload instead — because the request has to
 * carry an ID token, and because a browser `FormData` posted straight at Square
 * would need the access token in the page, which is the one thing it must never
 * have.
 *
 * So the boundary is assembled here. Node's `FormData`/`Blob` are global in
 * Node 22 and `fetch` sets the boundary header itself, which is why the headers
 * below deliberately omit `Content-Type` — setting it by hand produces a body
 * Square cannot parse, with a completely unhelpful error.
 * ---------------------------------------------------------------------------
 *
 * The site shows the new photograph immediately: `covers.ts` prefers a bundled
 * WebP but falls back to Square's own CDN URL, which this writes into
 * `imagePaths`. The optimised copy arrives at the next `npm run catalog`.
 */
export const squareProductImage = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';
    const dataUrl = typeof body['image'] === 'string' ? body['image'] : '';

    if (!slug || !dataUrl.startsWith('data:image/')) {
      res.status(400).json({ error: 'A product and an image are both needed.' });
      return;
    }

    const comma = dataUrl.indexOf(',');
    const mime = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64');

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'That image is too large. Keep it under 8MB.' });
      return;
    }

    const square = squareClient();
    if (!square) {
      res.status(503).json({ error: 'Square is not configured.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.products).doc(slug);
    const snapshot = await ref.get();
    const squareId = snapshot.get('squareCatalogObjectId') as string | undefined;

    if (!snapshot.exists || !squareId) {
      res.status(404).json({ error: 'No such product in Square.' });
      return;
    }

    try {
      const form = new FormData();
      form.append(
        'request',
        JSON.stringify({
          idempotency_key: `img-${slug}-${Date.now()}`.slice(0, 45),
          object_id: squareId,
          image: {
            type: 'IMAGE',
            /*
             * Required, and its absence is not obvious: Square answers
             * `VALUE_EMPTY` on `image.id`, which reads like the *file* was
             * missing rather than a field nobody thought to send.
             *
             * `#image` is the same client-supplied temporary id convention the
             * item create above uses for `#item` and `#variation` — a new object
             * has no real id yet, so one is invented for the request and Square
             * returns the id it actually assigned.
             */
            id: '#image',
            image_data: { caption: snapshot.get('name') ?? slug },
          },
        }),
      );
      /*
       * A filename with a real extension. Square infers the image type from it,
       * and the part is rejected outright without one.
       */
      const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      form.append(
        'image_file',
        new Blob([new Uint8Array(bytes)], { type: mime }),
        `${slug}.${extension}`,
      );

      const response = await fetch(`${square.host}/v2/catalog/images`, {
        method: 'POST',
        headers: {
          // No Content-Type: `fetch` derives it from the FormData, including the
          // boundary. Setting it by hand yields a body Square cannot parse.
          Authorization: square.headers['Authorization'] as string,
          'Square-Version': square.headers['Square-Version'] as string,
        },
        body: form,
      });

      const json = (await response.json()) as SquareErrorBody & {
        image?: { image_data?: { url?: string } };
      };

      const url = json.image?.image_data?.url;
      if (!response.ok || !url) {
        console.error('[catalog] Square refused the image', JSON.stringify(json.errors));
        if (json.errors?.[0]?.code === 'FORBIDDEN' || response.status === 403) {
          res.status(502).json({
            error: 'Square refused: this access token needs the ITEMS_WRITE permission.',
          });
          return;
        }
        res.status(502).json({ error: json.errors?.[0]?.detail ?? 'Square would not take that image.' });
        return;
      }

      /*
       * Appended, not replaced. Square keeps a list per item and the detail
       * gallery already renders every entry — a second photograph of a book is
       * a second photograph, not a correction of the first.
       */
      await ref.update({
        imagePaths: FieldValue.arrayUnion(url),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller?.uid ?? null,
      });

      res.status(200).json({ ok: true, url });
    } catch (error) {
      console.error('[catalog] unexpected failure uploading an image', error);
      res.status(500).json({ error: 'The image could not be uploaded.' });
    }
  },
);

/**
 * Remove a photograph from a product.
 *
 * Detached here and deleted in Square, in that order: the site stops showing it
 * either way, and an orphaned Square image is tidier than a product whose page
 * points at a deleted URL.
 */
export const squareRemoveProductImage = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';
    const url = typeof body['url'] === 'string' ? body['url'] : '';
    if (!slug || !url) {
      res.status(400).json({ error: 'A product and an image are both needed.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.products).doc(slug);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      res.status(404).json({ error: 'No such product.' });
      return;
    }

    /*
     * Square first, and the whole point of this Function is that it happens at
     * all.
     *
     * This used to be the `arrayRemove` below and nothing else, under a comment
     * claiming the image was "deleted in Square" — which it never was. The
     * effect was a Remove button that worked until the next `npm run catalog`
     * and then silently undid itself, because the sync mirrors `image_ids` off
     * the Square item and the picture was still attached to it. A control that
     * reverses itself hours later is worse than one that refuses.
     *
     * Detaching means upserting the ITEM without that image id. Square's upsert
     * is optimistic-concurrency controlled, so it has to be a read-modify-write
     * against the live object at its current version — see `readCatalogObject`.
     */
    const squareId = snapshot.get('squareCatalogObjectId') as string | undefined;
    const square = squareClient();

    if (squareId && square) {
      const found = await findAttachedImage(square, squareId, url);

      if (found) {
        const { item, imageId } = found;
        const data = (item['item_data'] ?? {}) as Record<string, unknown>;
        const ids = Array.isArray(data['image_ids']) ? (data['image_ids'] as string[]) : [];

        const failure = await upsertCatalogObject(
          square,
          { ...item, item_data: { ...data, image_ids: ids.filter((id) => id !== imageId) } },
          `detach-${slug}-${imageId}`,
        );
        if (failure) {
          // Nothing written to Firestore: a product whose document says the
          // picture is gone while Square still carries it is the state the next
          // sync silently reverses, which is the bug this branch exists to end.
          res.status(502).json({ error: failure });
          return;
        }

        /*
         * Then delete the image object itself. Best effort, and deliberately
         * not fatal: it is already detached, so the shop and the next sync both
         * agree it is gone. An orphaned image in the Square library is untidy;
         * failing the whole removal over it would leave the parish unable to
         * take a wrong photograph off a book.
         */
        const dropped = await fetch(
          `${square.host}/v2/catalog/object/${encodeURIComponent(imageId)}`,
          { method: 'DELETE', headers: square.headers },
        );
        if (!dropped.ok) {
          console.warn(`[catalog] detached ${imageId} but could not delete it: ${dropped.status}`);
        }
      }
      /*
       * Not found is not an error. `imagePaths` can hold a URL Square no longer
       * knows about — an image deleted in the Square dashboard, or a row from
       * before a re-sync — and that is precisely the case where the document
       * needs cleaning up rather than the request refusing.
       */
    }

    await ref.update({
      imagePaths: FieldValue.arrayRemove(url),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: caller?.uid ?? null,
    });

    res.status(200).json({ ok: true });
  },
);

/**
 * The item, and the id of the image on it that serves this URL.
 *
 * Matched by URL because that is all the browser has: the shop renders
 * `imagePaths`, which are Square's CDN URLs, and nothing on the page ever sees a
 * catalog object id. `include_related_objects` brings the IMAGE objects back
 * with the item, so this is one request rather than one per picture.
 *
 * Null when Square has no such attachment — see the caller for why that is an
 * ordinary answer and not a failure.
 */
async function findAttachedImage(
  square: { host: string; headers: Record<string, string> },
  itemId: string,
  url: string,
): Promise<{ item: Record<string, unknown>; imageId: string } | null> {
  const response = await fetch(
    `${square.host}/v2/catalog/object/${encodeURIComponent(itemId)}?include_related_objects=true`,
    { headers: square.headers },
  );
  if (!response.ok) return null;

  const body = (await response.json()) as {
    object?: Record<string, unknown>;
    related_objects?: Record<string, unknown>[];
  };

  const item = body.object;
  if (!item) return null;

  const data = (item['item_data'] ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(data['image_ids']) ? (data['image_ids'] as string[]) : [];
  if (ids.length === 0) return null;

  for (const related of body.related_objects ?? []) {
    if (related['type'] !== 'IMAGE') continue;
    const id = String(related['id'] ?? '');
    const imageData = (related['image_data'] ?? {}) as Record<string, unknown>;
    if (ids.includes(id) && imageData['url'] === url) return { item, imageId: id };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Stock, and retiring a product                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fetch one catalog object, with its version.
 *
 * Square's upsert is optimistic-concurrency controlled: an object sent without
 * the version it was read at is rejected, and one sent with a *stale* version
 * is rejected too. So every edit below is read-modify-write against the live
 * object rather than a hand-built payload — which also means a field this code
 * has never heard of survives the round trip instead of being erased.
 */
async function readCatalogObject(
  square: { host: string; headers: Record<string, string> },
  id: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${square.host}/v2/catalog/object/${encodeURIComponent(id)}`, {
    headers: square.headers,
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { object?: Record<string, unknown> };
  return body.object ?? null;
}

/** Upsert an object Square just gave us, modified. Returns an error sentence or null. */
async function upsertCatalogObject(
  square: { host: string; headers: Record<string, string> },
  object: Record<string, unknown>,
  key: string,
): Promise<string | null> {
  const response = await fetch(`${square.host}/v2/catalog/object`, {
    method: 'POST',
    headers: square.headers,
    body: JSON.stringify({ idempotency_key: key.slice(0, 45), object }),
  });

  if (response.ok) return null;

  const json = (await response.json().catch(() => ({}))) as SquareErrorBody;
  const detail = json.errors?.[0];
  console.error('[catalog] Square refused an upsert', JSON.stringify(json.errors));

  if (detail?.code === 'FORBIDDEN' || response.status === 403) {
    return 'Square refused: this access token needs the ITEMS_WRITE permission.';
  }
  return detail?.detail ?? 'Square would not accept that change.';
}

/**
 * Set — or stop tracking — how many copies are on the shelf.
 *
 * ---------------------------------------------------------------------------
 * The count lives in Square, and this is the whole reason this Function exists
 * rather than a Firestore write.
 *
 * `stockCount` is on `MIRRORED_FIELDS` in scripts/sync-catalog.mjs, so a number
 * typed straight into the product document survives exactly until the next
 * `npm run catalog` and then silently becomes null again. That alone would
 * force the count into Square.
 *
 * The better reason is that Square is where copies actually leave the shelf.
 * The parish sells these books at a table with the Square POS, and at the
 * festival; a count the website owned would be right until the first sale
 * nobody typed in. Writing to Square's inventory means the till and the shop
 * decrement the same number.
 *
 * Two calls, in order, because they answer different questions:
 *   1. the *variation* carries `track_inventory` — whether Square counts this
 *      item at all. An inventory change against an untracked variation is
 *      accepted and then ignored.
 *   2. `PHYSICAL_COUNT` sets the quantity to what staff just counted, as
 *      opposed to `ADJUSTMENT`, which moves it by a delta. Somebody looking at
 *      a shelf knows there are four, not that there are two fewer than before.
 *
 * `count: null` switches tracking off, which is different from zero: zero is
 * sold out and hides the book, null is "we do not count these" and shows it.
 * ---------------------------------------------------------------------------
 */
export const squareProductStock = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Changing stock is limited to the bookstore group and parish staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';
    const raw = body['count'];

    /*
     * Null and only null means "stop counting". `undefined`, `''`, and a
     * non-number are refused rather than folded into it — a request that lost
     * its count in transit must not read as an instruction to stop tracking.
     */
    const untrack = raw === null;
    const count = untrack ? null : Number(raw);

    if (!slug) {
      res.status(400).json({ error: 'A product is needed.' });
      return;
    }
    if (!untrack && (!Number.isInteger(count) || count! < 0 || count! > MAX_STOCK)) {
      res.status(400).json({ error: `A whole number between 0 and ${MAX_STOCK}, or none at all.` });
      return;
    }

    const square = squareClient();
    if (!square) {
      res.status(503).json({ error: 'Square is not configured.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.products).doc(slug);
    const snapshot = await ref.get();
    const variationId = snapshot.get('squareVariationId') as string | undefined;

    if (!snapshot.exists) {
      res.status(404).json({ error: 'No such product.' });
      return;
    }
    if (!variationId) {
      /*
       * A product with no variation has no price in Square and cannot be bought
       * either — the checkout rejects it as `not-in-square`. Saying so here is
       * more use than a 502 from an endpoint that was asked about nothing.
       */
      res.status(409).json({
        error: 'This product has no Square price, so there is nothing to count. Re-run the catalog sync.',
      });
      return;
    }

    try {
      const variation = await readCatalogObject(square, variationId);
      if (!variation) {
        res.status(502).json({ error: 'Square no longer has a price for this product.' });
        return;
      }

      const data = (variation['item_variation_data'] ?? {}) as Record<string, unknown>;
      // Coerced, because Square omits the field entirely on an untracked
      // variation rather than sending `false` — a strict compare would upsert
      // on every "stop counting" of something already untracked.
      if (Boolean(data['track_inventory']) !== !untrack) {
        const failure = await upsertCatalogObject(
          square,
          { ...variation, item_variation_data: { ...data, track_inventory: !untrack } },
          `track-${slug}-${Date.now()}`,
        );
        if (failure) {
          res.status(502).json({ error: failure });
          return;
        }
      }

      if (!untrack) {
        const change = await fetch(`${square.host}/v2/inventory/changes/batch-create`, {
          method: 'POST',
          headers: square.headers,
          body: JSON.stringify({
            idempotency_key: `stock-${slug}-${Date.now()}`.slice(0, 45),
            changes: [
              {
                type: 'PHYSICAL_COUNT',
                physical_count: {
                  catalog_object_id: variationId,
                  state: 'IN_STOCK',
                  location_id: square.locationId,
                  quantity: String(count),
                  occurred_at: new Date().toISOString(),
                },
              },
            ],
          }),
        });

        if (!change.ok) {
          const json = (await change.json().catch(() => ({}))) as SquareErrorBody;
          const detail = json.errors?.[0];
          console.error('[catalog] Square refused the count', JSON.stringify(json.errors));
          /*
           * Named, for the same reason ITEMS_WRITE is named on create: nothing
           * else on this site touches inventory, so the first person to set a
           * stock number is the first person to find out the token cannot.
           */
          if (detail?.code === 'FORBIDDEN' || change.status === 403) {
            res.status(502).json({
              error:
                'Square refused: this access token cannot change inventory. It needs the ' +
                'INVENTORY_WRITE permission.',
            });
            return;
          }
          res.status(502).json({ error: detail?.detail ?? 'Square would not record that count.' });
          return;
        }
      }

      /*
       * Mirrored immediately rather than left for the next sync. /bookstore is a
       * static export that reads through to Firestore and swaps — so this write
       * is what puts "Sold out" on the shop within seconds, which is the point
       * of setting the number in the first place.
       */
      await ref.update({
        stockCount: count,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller?.uid ?? null,
      });

      res.status(200).json({ ok: true, stockCount: count });
    } catch (error) {
      console.error('[catalog] unexpected failure setting stock', error);
      res.status(500).json({ error: 'The stock count could not be saved.' });
    }
  },
);

/**
 * Take a product off the shop, by archiving it in Square.
 *
 * ---------------------------------------------------------------------------
 * Archived in Square, not deleted anywhere.
 *
 * Three things had to be true at once, and archiving is the only option that
 * manages all three:
 *
 *   - **The sync must not undo it.** `sync-catalog.mjs` writes `published: true`
 *     over every mirrored row on every run, so a product merely unpublished in
 *     Firestore comes back at the next `npm run catalog`. `mapSquareCatalog`
 *     skips archived items, so an archived one is never in that set — the
 *     unpublish below is left standing.
 *   - **Past orders must keep working.** Deleting the document would turn a
 *     line item on a completed order into a dangling slug, which is the reason
 *     the sync's own prune unpublishes rather than deletes.
 *   - **It must be reversible.** Un-archiving in the Square Dashboard and
 *     re-running the sync puts the book back, photographs and all. A deleted
 *     catalog object is gone.
 *
 * The Firestore write comes second and is what the shop notices: the live
 * refresh queries `published == true`, so the book leaves the page within
 * seconds without a deploy.
 * ---------------------------------------------------------------------------
 */
export const squareArchiveProduct = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    const caller = await callerOf(req);
    if (!mayManageOrders(caller)) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Removing a product is limited to the bookstore group and parish staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';
    if (!slug) {
      res.status(400).json({ error: 'A product is needed.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.products).doc(slug);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      res.status(404).json({ error: 'No such product.' });
      return;
    }

    const squareId = snapshot.get('squareCatalogObjectId') as string | undefined;

    try {
      if (squareId) {
        const square = squareClient();
        if (!square) {
          res.status(503).json({ error: 'Square is not configured.' });
          return;
        }

        const item = await readCatalogObject(square, squareId);
        if (item) {
          const data = (item['item_data'] ?? {}) as Record<string, unknown>;
          const failure = await upsertCatalogObject(
            square,
            { ...item, item_data: { ...data, is_archived: true } },
            `archive-${slug}-${Date.now()}`,
          );
          if (failure) {
            res.status(502).json({ error: failure });
            return;
          }
        }
        /*
         * A product Square has already lost — deleted in the Dashboard, say —
         * falls through to the unpublish below rather than failing. The row is
         * exactly what somebody is trying to get rid of, and refusing because
         * the remote copy is already gone would leave it on the shop forever.
         */
      }

      await ref.update({
        published: false,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller?.uid ?? null,
      });

      res.status(200).json({ ok: true, archivedInSquare: Boolean(squareId) });
    } catch (error) {
      console.error('[catalog] unexpected failure archiving a product', error);
      res.status(500).json({ error: 'The product could not be removed.' });
    }
  },
);
