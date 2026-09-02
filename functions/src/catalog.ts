import { randomUUID } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  slugify,
  trackInventoryPatch,
  tracksInventory,
} from '@spsm/shared';
import { callerOf, mayManageOrders } from './httpAuth.js';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
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
/**
 * Square's own ceiling, and the reason this one number survived.
 *
 * The site's other 8MB caps were removed on 2026-09-01 — a phone photograph
 * clears 8MB routinely and refusing a trusted volunteer's file protected
 * nothing. This one is not ours to remove: the image is forwarded to Square,
 * which rejects anything over 15MB with an error of its own. A larger bound
 * here would only move the failure to a worse place, where the message comes
 * back in Square's words after the whole upload has already been sent.
 */
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Adding to the catalog is limited to the bookstore group and church staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    /*
     * Ninety a minute, on the person, and the number is chosen around a batch
     * of photographs rather than around a single click.
     *
     * A book with eight pictures is eight calls in a few seconds, and somebody
     * adding a shelf of them in one sitting must not be stopped halfway through
     * — a batch that half-succeeds leaves a product in Square with some of its
     * photographs and no way to tell which. **Nothing here caps how large a
     * photograph may be; this counts calls, never bytes.**
     */
    if (
      throttled(req, res, {
        bucket: 'catalogCreate',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message: 'That is a lot of new products at once. Please wait a minute.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = cleanTitle(body['name']);
    const description =
      typeof body['description'] === 'string' ? body['description'].trim().slice(0, MAX_DESCRIPTION) : '';
    const priceCents = Number(body['priceCents']);
    const section = typeof body['section'] === 'string' ? body['section'].trim().slice(0, 40) : '';

    if (!name) {
      res.status(400).json({ error: 'A name is needed.' });
      return;
    }
    if (name.length > MAX_NAME) {
      res.status(400).json({ error: `A title of ${MAX_NAME} characters or fewer.` });
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
      const response = await fetch(`${square.host}/v2/catalog/object`, {
        method: 'POST',
        headers: square.headers,
        body: JSON.stringify({
          idempotency_key: squareIdempotencyKey('new'),
          object: {
            // `#name` is Square's convention for a client-supplied temporary id
            // on a create; it returns the real one in `id_mappings`.
            id: '#item',
            type: 'ITEM',
            item_data: {
              name,
              description,
              categories: [{ id: category }],
              /*
               * The same category again, as the reporting one.
               *
               * Square keeps two: `categories` is what the item belongs to and
               * is what `mapSquareCatalog` filters the shop on, while
               * `reporting_category` is what the Dashboard's sales and
               * inventory reports group by. Setting only the first put a new
               * book on the website and left it out of every report the parish
               * office actually reads — all ten books added through the Square
               * app carry both, so a book added here looked different for no
               * reason anyone chose.
               *
               * One category, so there is nothing to decide between them.
               */
              reporting_category: { id: category },
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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    // 512MiB because a photograph arrives here base64'd in the request body and
    // is held in memory to be re-sent to Square. The instance cap is what stops
    // a batch of them costing ten of these at once; it does not, and must not,
    // cap how large any one of them may be.
    memory: '512MiB',
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    /*
     * Ninety a minute, on the person, and the number is chosen around a batch
     * of photographs rather than around a single click.
     *
     * A book with eight pictures is eight calls in a few seconds, and somebody
     * adding a shelf of them in one sitting must not be stopped halfway through
     * — a batch that half-succeeds leaves a product in Square with some of its
     * photographs and no way to tell which. **Nothing here caps how large a
     * photograph may be; this counts calls, never bytes.**
     */
    if (
      throttled(req, res, {
        bucket: 'catalogImage',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message:
          'That is a lot of photographs at once. Please wait a minute, then carry ' +
          'on — nothing you have already added is lost.',
      })
    ) {
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
      res.status(413).json({
        error: 'That image is too large for Square. Keep it under 15MB.',
      });
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
          idempotency_key: squareIdempotencyKey('img'),
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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    // Ninety a minute, on the person rather than the address. Far above anybody
    // editing the shop by hand, and it counts calls, never bytes.
    if (
      throttled(req, res, {
        bucket: 'catalogImageRemove',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message: 'That is a lot of changes at once. Please wait a minute.',
      })
    ) {
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
          squareIdempotencyKey('detach'),
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

/**
 * A Square idempotency key: a short prefix and a UUID, never over 45 characters.
 *
 * ---------------------------------------------------------------------------
 * These were `${prefix}-${slug}-${Date.now()}` trimmed to Square's 45-character
 * limit, and the trim cut the timestamp off the **end** — the only part that
 * made the key unique.
 *
 * For `the-crucified-jesus-by-manasseh-youhanna-paperback` not one digit of it
 * survived, so every stock change after the first re-sent the first change's key
 * with a different quantity, and Square answered *"The idempotency key can only
 * be retried with the same request data."* Permanently, for that book. Shorter
 * names failed less obviously: `be-prepared-book-fr-daoud-lamei` kept seven
 * digits, so its key only changed every ~17 minutes, and
 * `the-bridegroom-pascha-sermons` kept nine, so two edits ten seconds apart
 * collided. Anything past a 25-character slug was affected to some degree, which
 * is why this looked intermittent rather than broken.
 *
 * A UUID is 36 characters, so every prefix here fits with room to spare and the
 * length no longer depends on what the book is called.
 *
 * NOT for refunds. `refunds.ts` derives its key from the order id on purpose, so
 * that a retried refund is the *same* request and Square collapses it instead of
 * paying twice. Uniqueness is right here and wrong there.
 */
function squareIdempotencyKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`.slice(0, 45);
}

/**
 * A book title, tidied, or null if there is not one.
 *
 * `cleanName` from @spsm/shared is deliberately *not* used: it caps at that
 * module's `MAX_NAME`, which is 60 and describes a **buyer's** name on an
 * order. Applied to a title it silently truncated, and the `name.length >
 * MAX_NAME` guard on the create path could therefore never fire — a 130
 * character title was cut to 60 and accepted rather than refused. Titles get
 * this module's own limit, and a title over it is rejected out loud.
 */
function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Text, safe to put in Square's `description_html`.
 *
 * The panel's description box is plain text, so every one of these is a literal
 * character rather than markup — a blurb reading "Fathers & Sons" must reach the
 * dashboard as those words and not as a broken entity. Five characters is the
 * whole of what HTML needs escaped in element content and attribute values.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Changing stock is limited to the bookstore group and church staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    // Ninety a minute, on the person rather than the address. Far above anybody
    // editing the shop by hand, and it counts calls, never bytes.
    if (
      throttled(req, res, {
        bucket: 'catalogStock',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message: 'That is a lot of stock changes at once. Please wait a minute.',
      })
    ) {
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
      /*
       * Read and written through the shared pair, because the parish's books
       * keep this flag in `location_overrides` rather than at the top level.
       * Comparing or setting only `data['track_inventory']` reads every real
       * book as untracked and leaves the override standing — see
       * `tracksInventory`.
       */
      if (tracksInventory(data) !== !untrack) {
        const failure = await upsertCatalogObject(
          square,
          { ...variation, item_variation_data: trackInventoryPatch(data, !untrack) },
          squareIdempotencyKey('track'),
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
            idempotency_key: squareIdempotencyKey('stock'),
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
 * Change what Square owns about a book: its title, its price, its description.
 *
 * ---------------------------------------------------------------------------
 * Square first, and the document keeps its id.
 *
 * All three are on the sync's field mask, so a value typed straight into
 * Firestore survives exactly until the next run and then reverts. That alone
 * makes this a Function. The better reason is that the parish sells these books
 * from the Square POS too: a price the website owned would disagree with the one
 * on the till receipt, which is the kind of difference somebody discovers at the
 * counter with a queue behind them.
 *
 * **The slug does not follow the title.** `mirrorDocumentId` is what makes that
 * hold across a sync; this endpoint is the other half. A recomputed slug would
 * be a different document, and renaming would quietly cost the book its
 * category, its baked cover, and the link from every completed order that names
 * it. So /bookstore keeps whatever URL the book was first given, which is also
 * the one anybody may have bookmarked.
 *
 * ## One endpoint for three fields, not three endpoints
 *
 * This began as `squareProductName`, which did the title alone. Price and
 * description arrived a day later and would have been two more near-identical
 * handlers — same gate, same lookup, same upsert, same mirror — differing only
 * in which key they set. Worse, editing all three would have been three round
 * trips and three catalog versions, and `catalog.version.updated` turns each of
 * those into a full mirror run.
 *
 * Every field is optional and only what is sent is touched, so the panel can
 * send one or all three and an absent key is never read as "clear it".
 *
 * ## Description is written three times, and that is Square's doing
 *
 * `description` is the field `mapSquareCatalog` reads and the one Square now
 * calls deprecated; `description_html` is what the Square dashboard and the
 * online store render; `description_plaintext` is what its search indexes. The
 * parish's own items carry all three, identical. Setting only one leaves the
 * other two stale, so the shop and the dashboard would show different words for
 * the same book. They are written together or not at all.
 *
 * The HTML copy is escaped rather than passed through: this is a plain-text box
 * in the panel, and a book blurb containing an ampersand must not become markup.
 * ---------------------------------------------------------------------------
 */
export const squareProductDetails = onRequest(
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Editing a book is limited to the bookstore group and church staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    // Ninety a minute, on the person rather than the address. Far above anybody
    // editing the shop by hand, and it counts calls, never bytes.
    if (
      throttled(req, res, {
        bucket: 'catalogDetails',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message: 'That is a lot of edits at once. Please wait a minute.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const slug = typeof body['slug'] === 'string' ? body['slug'].trim() : '';

    /*
     * `undefined` means "not sent, leave it alone" and is different from an
     * empty string, which means "clear the description". Only the description
     * can legitimately be emptied — a book with no title or no price is not
     * something this endpoint will produce.
     */
    const wantsName = 'name' in body;
    const wantsDescription = 'description' in body;
    const wantsPrice = 'priceCents' in body;

    const name = wantsName ? cleanTitle(body['name']) : undefined;
    const description = wantsDescription
      ? String(body['description'] ?? '').trim().slice(0, MAX_DESCRIPTION)
      : undefined;
    const priceCents = wantsPrice ? Number(body['priceCents']) : undefined;

    if (!slug) {
      res.status(400).json({ error: 'A product is needed.' });
      return;
    }
    if (!wantsName && !wantsDescription && !wantsPrice) {
      res.status(400).json({ error: 'Nothing to change.' });
      return;
    }
    if (wantsName && !name) {
      res.status(400).json({ error: 'A title is needed.' });
      return;
    }
    if (name && name.length > MAX_NAME) {
      res.status(400).json({ error: `A title of ${MAX_NAME} characters or fewer.` });
      return;
    }
    /*
     * The same rule as creating one, and for the same reason: Square will store
     * a $0.00 item quite happily, and the checkout refuses a zero total — so a
     * free book appears on the shop and fails at the card form with "could not
     * price the order", which is the least explicable failure available.
     */
    if (
      wantsPrice &&
      (!Number.isInteger(priceCents) || priceCents! <= 0 || priceCents! > MAX_PRICE_CENTS)
    ) {
      res.status(400).json({ error: 'A price between $0.01 and $1,000.00 is needed.' });
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

    if (!snapshot.exists) {
      res.status(404).json({ error: 'No such product.' });
      return;
    }

    const squareId = snapshot.get('squareCatalogObjectId') as string | undefined;
    if (!squareId) {
      res.status(409).json({
        error: 'This product is not in Square, so there is nothing to change. Re-run the catalog sync.',
      });
      return;
    }

    try {
      const item = await readCatalogObject(square, squareId);
      if (!item) {
        res.status(502).json({ error: 'Square no longer has this product.' });
        return;
      }

      const data = { ...((item['item_data'] ?? {}) as Record<string, unknown>) };
      const mirror: Record<string, unknown> = {};
      let changed = false;

      if (name !== undefined && data['name'] !== name) {
        data['name'] = name;
        mirror['name'] = name;
        changed = true;
      }

      if (description !== undefined && data['description'] !== description) {
        data['description'] = description;
        data['description_html'] = escapeHtml(description);
        data['description_plaintext'] = description;
        mirror['description'] = description;
        changed = true;
      }

      if (priceCents !== undefined) {
        /*
         * The price is on the *variation*, not the item, so the whole variation
         * list is rebuilt with the first one repriced. First rather than all,
         * because `mapSquareCatalog` prices a product from `variations[0]` and
         * every book in the parish's catalog has exactly one ("Regular"); a
         * multi-variation item would need a UI that can tell them apart, and
         * repricing all of them from one box would be a guess.
         */
        const variations = Array.isArray(data['variations']) ? [...data['variations']] : [];
        const first = variations[0] as Record<string, unknown> | undefined;
        const variationData = first?.['item_variation_data'] as
          | Record<string, unknown>
          | undefined;

        if (!first || !variationData) {
          res.status(409).json({
            error: 'This product has no price in Square to change. Re-run the catalog sync.',
          });
          return;
        }

        const current = (variationData['price_money'] ?? {}) as Record<string, unknown>;
        if (current['amount'] !== priceCents || current['currency'] !== 'USD') {
          variations[0] = {
            ...first,
            item_variation_data: {
              ...variationData,
              pricing_type: 'FIXED_PRICING',
              price_money: { amount: priceCents, currency: 'USD' },
            },
          };
          data['variations'] = variations;
          mirror['price'] = { amount: priceCents, currency: 'USD' };
          changed = true;
        }
      }

      /*
       * Square is written to only when something actually differs. Not an
       * optimisation: an upsert bumps the catalog version, which the
       * `catalog.version.updated` webhook turns into a full mirror run, so
       * saving an unchanged form would cost a sync for nothing.
       */
      if (changed) {
        const failure = await upsertCatalogObject(
          square,
          { ...item, item_data: data },
          squareIdempotencyKey('edit'),
        );
        if (failure) {
          res.status(502).json({ error: failure });
          return;
        }

        /*
         * Mirrored straight away, like the stock count and for the same reason:
         * /bookstore is a static export that reads through to Firestore and
         * swaps, so this write is what puts the new price on the shelf within
         * seconds instead of at the next sync.
         *
         * `slug` is pointedly not touched.
         */
        await ref.update({
          ...mirror,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: caller?.uid ?? null,
        });
      }

      res.status(200).json({ ok: true, slug, changed });
    } catch (error) {
      console.error('[catalog] unexpected failure editing a product', error);
      res.status(500).json({ error: 'That change could not be saved.' });
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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    cors: false,
    maxInstances: CAPS.bookstoreEdit,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified — see rateLimit.ts. Loose,
    // because the parish's staff share a building and therefore an address.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Removing a product is limited to the bookstore group and church staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }

    // Ninety a minute, on the person rather than the address. Far above anybody
    // editing the shop by hand, and it counts calls, never bytes.
    if (
      throttled(req, res, {
        bucket: 'catalogArchive',
        max: BUDGETS.bookstoreEdit,
        identity: caller!.uid,
        message: 'That is a lot of removals at once. Please wait a minute.',
      })
    ) {
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
            squareIdempotencyKey('archive'),
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
