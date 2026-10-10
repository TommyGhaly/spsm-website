import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineString } from 'firebase-functions/params';
import {
  CONFIG_DOC_BOOKSTORE,
  COLLECTIONS,
  mapSquareCatalog,
  mapSquareCategoryTree,
  orderSections,
  parseSections,
  mirrorDocumentId,
  parseInventoryCounts,
} from '@spsm/shared';
import { callerOf, mayManageOrders } from './httpAuth.js';
import { BUDGETS, CAPS, exclusive, throttled } from './rateLimit.js';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  squareClient,
  type SquareClient,
} from './square.js';
import { reserveSkus, writeSkusToSquare } from './sku.js';

/**
 * Mirroring the Square catalog into Firestore, on a schedule.
 *
 * ---------------------------------------------------------------------------
 * Why this exists.
 *
 * `scripts/sync-catalog.mjs` said it from the beginning: *"A script rather than
 * the scheduled Cloud Function it will eventually also be … The Function version
 * reads the token from Secret Manager and can come later without changing
 * anything here — the mapping is in `mapSquareCatalog`, which both call."* This
 * is that Function, and it calls exactly that mapping. There is deliberately no
 * second copy of the category rule, the slug rule, or the image rule here: a
 * divergent `slugify` in the Functions is a mistake this repo has already made
 * once.
 *
 * The gap it closes is the one Tommy named: *"the pictures in square should
 * automatically show up and when I decide to delete them they should delete."*
 * Before this, `imagePaths` only ever changed when somebody ran a script on a
 * laptop — so a photograph added in the Square app was invisible on the website
 * until a developer happened to sync, and one deleted in Square stayed on the
 * shop just as long. Neither is something a parish office should have to know
 * about.
 *
 * ## What it does *not* do, and this is the one real limitation
 *
 * The script downloads each photograph and writes an optimised 800px WebP pair
 * into `public/img/products`. Nothing here can do that: a Cloud Function has no
 * commit to write to, and the shop is a static export. So a picture that arrives
 * through this path is served from Square's own CDN at whatever size the parish
 * uploaded — fine for anything uploaded through the website, which is downscaled
 * to 1600px first, and heavy for a 3105px original attached in the Square
 * dashboard. `npm run catalog` followed by a deploy is still what re-bakes them.
 *
 * Correct-and-heavy beats absent, which is the same trade `useLiveCatalog`
 * settled on for the same reason.
 * ---------------------------------------------------------------------------
 */

const SQUARE_CATEGORY = defineString('SQUARE_CATALOG_CATEGORY', { default: 'Bookstore' });

/**
 * Exactly the fields Square owns, and the contract is the same one
 * `sync-catalog.mjs` states at its own mask: **anything on this document that
 * the parish owns rather than Square must be left off.**
 *
 * `section` is the live example — the shop's divisions are edited on the site
 * and would be erased on every run if they were written from here. `createdAt`
 * is written only when the document is new.
 */
interface MirrorFields {
  slug: string;
  name: string;
  description: string;
  price: { amount: number; currency: string };
  imagePaths: string[];
  squareCatalogObjectId: string;
  squareVariationId: string | null;
  stockCount?: number | null;
  category: string | null;
  /** Square's, like the rest — see `assignMissingSkus`. */
  sku: string | null;
  /** The Bookstore subcategories it is filed in, from Square. */
  categoryIds: string[];
  published: boolean;
  publishAt: null;
  syncedAt: Date;
  updatedAt: Date;
  updatedBy: null;
  createdAt?: Date;
}

export interface MirrorResult {
  scanned: number;
  written: number;
  unpublished: number;
  /** Null when Square could not be read at all — nothing was written. */
  failure: string | null;
}

/** Every catalog object, following Square's cursor to the end. */
async function readCatalog(square: SquareClient): Promise<unknown[] | null> {
  const objects: unknown[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`${square.host}/v2/catalog/list`);
    url.searchParams.set('types', 'ITEM,CATEGORY,IMAGE');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, { headers: square.headers });
    const body = (await response.json().catch(() => ({}))) as {
      objects?: unknown[];
      cursor?: string;
      errors?: { code?: string; detail?: string }[];
    };

    if (!response.ok) {
      const detail = body.errors?.[0];
      console.error(
        `[catalog-sync] Square returned HTTP ${response.status}: ${detail?.code ?? ''} ${detail?.detail ?? ''}`,
      );
      return null;
    }

    objects.push(...(body.objects ?? []));
    cursor = body.cursor;
  } while (cursor);

  return objects;
}

/**
 * How many of each variation Square says are on the shelf.
 *
 * `undefined` — never an empty map — when the counts cannot be read.
 * `mapSquareCatalog` reads an absent map as "inventory unknown, nothing is out
 * of stock" and an empty one as "every tracked item is at zero", so getting the
 * two confused would empty the shop on one failed request. The caller then
 * leaves `stockCount` off the write entirely rather than sending null.
 */
async function readInventory(
  square: SquareClient,
  variationIds: string[],
): Promise<Map<string, number> | undefined> {
  if (variationIds.length === 0) return undefined;

  const counts: unknown[] = [];
  // Square caps this endpoint at 1000 ids; the parish has eleven books, so the
  // chunking is insurance rather than something that runs today.
  for (let index = 0; index < variationIds.length; index += 500) {
    const response = await fetch(`${square.host}/v2/inventory/counts/batch-retrieve`, {
      method: 'POST',
      headers: square.headers,
      body: JSON.stringify({ catalog_object_ids: variationIds.slice(index, index + 500) }),
    });

    const body = (await response.json().catch(() => ({}))) as {
      counts?: unknown[];
      errors?: { code?: string; detail?: string }[];
    };

    if (!response.ok) {
      const detail = body.errors?.[0];
      console.warn(
        `[catalog-sync] could not read inventory (HTTP ${response.status} ${detail?.code ?? ''}); ` +
          'stock counts left untouched this run.',
      );
      return undefined;
    }

    counts.push(...(body.counts ?? []));
  }

  return parseInventoryCounts(counts);
}

/**
 * Square's Bookstore subcategories, written as the shop's categories.
 *
 * Square is where they are made, renamed and removed — from the register, or
 * from the site through `squareCategory`, which writes Square first — and this
 * brings the site into line within a sync. The *order* of the pills is the
 * parish's and stays in Firestore: `orderSections` keeps it for categories
 * that already have a place and adds new ones after.
 *
 * A failed tree read (no Bookstore category found) writes nothing, for the
 * same reason the product mirror refuses an empty catalog.
 */
async function mirrorCategories(
  db: FirebaseFirestore.Firestore,
  objects: readonly unknown[],
  categoryName: string,
): Promise<void> {
  const tree = mapSquareCategoryTree(objects, categoryName);
  if (!tree) return;
  const ref = db.collection(COLLECTIONS.config).doc(CONFIG_DOC_BOOKSTORE);
  const snapshot = await ref.get();
  const previous = parseSections(snapshot.get('sections'));
  const sections = orderSections(tree.categories, previous);
  if (JSON.stringify(sections) === JSON.stringify(previous)) return;
  await ref.set({ sections, updatedAt: new Date(), updatedBy: null }, { merge: true });
  console.log(`[catalog-sync] categories: ${sections.map((one) => one.label).join(', ')}`);
}

/**
 * Give every bookstore product without a SKU its `SPSM-####`, in Square.
 *
 * This is what numbers the books that predate SKUs, and anything a volunteer
 * adds at the register rather than on the website. Products made on the site
 * already have one — `squareCreateProduct` assigns it at creation.
 *
 * Written to Square first and copied into `products` only once Square accepts
 * it, so the mirror never shows a number the register does not. A refused
 * upsert leaves those products without one until the next run; the numbers it
 * reserved become a gap, which is harmless.
 *
 * Mutates `products` in place, so the mirror write below carries the new SKUs.
 */
async function assignMissingSkus(
  db: FirebaseFirestore.Firestore,
  square: SquareClient,
  objects: readonly unknown[],
  products: { squareVariationId: string | null; sku: string | null }[],
): Promise<void> {
  const missing = products.filter((product) => !product.sku && product.squareVariationId);
  if (missing.length === 0) return;

  // Every variation in the catalog, by id, as Square sent it — the whole object
  // goes back with only `sku` changed.
  const variations = new Map<string, Record<string, unknown>>();
  const everySku: string[] = [];
  for (const raw of objects) {
    const item = raw as { type?: string; item_data?: { variations?: Record<string, unknown>[] } };
    if (item?.type !== 'ITEM') continue;
    for (const variation of item.item_data?.variations ?? []) {
      if (typeof variation['id'] === 'string') variations.set(variation['id'], variation);
      const sku = (variation['item_variation_data'] as { sku?: unknown } | undefined)?.sku;
      if (typeof sku === 'string') everySku.push(sku);
    }
  }

  try {
    const skus = await reserveSkus(db, missing.length, everySku);
    const assignments = missing.flatMap((product, i) => {
      const variation = variations.get(product.squareVariationId as string);
      return variation ? [{ product, variation, sku: skus[i]! }] : [];
    });
    const accepted = await writeSkusToSquare(square, assignments);
    for (const { product, variation, sku } of assignments) {
      if (accepted.has(variation['id'] as string)) product.sku = sku;
    }
    console.log(`[catalog-sync] assigned ${accepted.size} SKU(s)`);
  } catch (error) {
    // A numbering failure must not stop the shop being mirrored.
    console.error('[catalog-sync] could not assign SKUs this run', error);
  }
}

/**
 * Read Square, write the mirror. Safe to run as often as you like.
 *
 * ---------------------------------------------------------------------------
 * Two refusals worth stating, because both are ways to empty a shop by accident.
 *
 * **A failed Square read writes nothing.** Not an empty catalog, not a prune —
 * nothing. The mirror keeps whatever it had, which is a working shop showing
 * last hour's books.
 *
 * **An empty result is treated as a failed read.** Zero products in the wanted
 * category is what a renamed category looks like, and the honest reading of
 * "Square returned no books" is "something is wrong", not "unpublish the
 * bookstore". `useLiveCatalog` refuses on exactly the same grounds.
 * ---------------------------------------------------------------------------
 */
export async function mirrorCatalog(): Promise<MirrorResult> {
  const empty: MirrorResult = { scanned: 0, written: 0, unpublished: 0, failure: null };

  const square = squareClient();
  if (!square) return { ...empty, failure: 'Square is not configured.' };

  const objects = await readCatalog(square);
  if (!objects) return { ...empty, failure: 'Square could not be read.' };

  const category = SQUARE_CATEGORY.value() || 'Bookstore';

  /*
   * Mapped twice, and the first pass is thrown away — the same shape the script
   * uses and for the same reason. The inventory endpoint is asked about
   * *variations*, and the only thing that knows which variations are in the
   * wanted category is the mapping itself. It is pure and network-free, so
   * running it twice costs nothing; the alternative is a second copy of the
   * category and variation logic, which is the duplication that put a wrong
   * `slugify` in the Functions once already.
   */
  const inventory = await readInventory(
    square,
    mapSquareCatalog(objects, category)
      .products.map((product) => product.squareVariationId)
      .filter((id): id is string => Boolean(id)),
  );

  const { products } = mapSquareCatalog(objects, category, inventory);

  if (products.length === 0) {
    return { ...empty, failure: `Square returned no products in the "${category}" category.` };
  }

  const db = getFirestore();
  await assignMissingSkus(db, square, objects, products);
  await mirrorCategories(db, objects, category);

  const collection = db.collection(COLLECTIONS.products);
  const existing = await collection.get();
  const present = new Set(existing.docs.map((doc) => doc.id));

  /*
   * Square's id → the document already mirroring it, so a book renamed from the
   * shop's edit panel updates in place instead of forking a second row under
   * its new slug. See `mirrorDocumentId`.
   */
  const byObjectId = new Map<string, string>();
  for (const doc of existing.docs) {
    const squareId = doc.get('squareCatalogObjectId') as string | undefined;
    if (squareId) byObjectId.set(squareId, doc.id);
  }

  const now = new Date();
  let written = 0;

  for (const product of products) {
    const id = mirrorDocumentId(product, byObjectId);
    const fields: MirrorFields = {
      // The document id, not `product.slug` — they differ after a rename, and
      // the two must not drift: `useLiveCatalog` and the checkout both look a
      // product up by this field and expect to find the document it names.
      slug: id,
      name: product.name,
      description: product.description,
      price: product.price,
      imagePaths: product.imagePaths,
      squareCatalogObjectId: product.squareCatalogObjectId,
      squareVariationId: product.squareVariationId,
      category: product.category,
      sku: product.sku,
      categoryIds: product.categoryIds,
      /*
       * Every mirrored row is published, which is the decision taken on
       * 2026-08-17: show the whole category and ignore Square's
       * `ecom_visibility`, which marks all but one book UNAVAILABLE. Change it
       * here and in scripts/sync-catalog.mjs together.
       */
      published: true,
      publishAt: null,
      syncedAt: now,
      updatedAt: now,
      // The sync is not a person. Null is the schema's value for that, and what
      // the rules already expect on rows nobody edited.
      updatedBy: null,
      ...(present.has(id) ? {} : { createdAt: now }),
    };

    /*
     * Omitted, not nulled, when the inventory read failed. `stockCount` would
     * otherwise be written as null over a real count, and one 403 on
     * INVENTORY_READ would quietly put every sold-out book back on the shop at
     * full stock. This is the Admin SDK's equivalent of leaving the field off
     * the REST mask, which is what the script does.
     */
    if (inventory !== undefined) fields.stockCount = product.stockCount;

    /*
     * `merge: true`, so fields absent here survive — `section` above all, which
     * is the parish's and is edited on the website. Every field Square owns is
     * present in `fields` on every run, so a value Square dropped is overwritten
     * rather than lingering: an emptied `imagePaths` really does empty here,
     * which is the "when I decide to delete them they should delete" half.
     */
    await collection.doc(id).set(fields, { merge: true });
    written += 1;
  }

  /*
   * Rows Square no longer offers.
   *
   * Unpublished, never deleted: an order references its products by slug, and a
   * deleted document turns a past order's line into a dangling id.
   *
   * Only rows that carry a `squareCatalogObjectId` are considered — a product
   * created some other way is not Square's to retire. Reached only after the
   * two refusals above, so this cannot run on a failed or empty read.
   */
  const live = new Set(products.map((product) => mirrorDocumentId(product, byObjectId)));
  let unpublished = 0;

  for (const doc of existing.docs) {
    if (live.has(doc.id)) continue;
    if (!doc.get('squareCatalogObjectId')) continue;
    if (doc.get('published') === false) continue;

    await doc.ref.update({
      published: false,
      syncedAt: now,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: null,
    });
    unpublished += 1;
  }

  return { scanned: products.length, written, unpublished, failure: null };
}

/**
 * The mirror, on a schedule.
 *
 * Fifteen minutes: short enough that a volunteer who photographs a book in the
 * Square app and then looks at the website does not conclude it is broken, long
 * enough that this is ~100 Square reads a day rather than a polling loop. Square
 * changes are rare and bursty, so most runs write the same eleven documents back
 * unchanged, which costs a handful of writes and nothing else.
 *
 * For seconds instead of minutes, add `catalog.version.updated` to the parish's
 * Square webhook subscription — `squareWebhook` already answers on it and calls
 * straight into `mirrorCatalog`. This stays as the safety net either way: a
 * webhook that is never configured, or one delivery Square drops, must not mean
 * the shop is permanently stale.
 */
export const syncSquareCatalog = onSchedule(
  {
    schedule: 'every 15 minutes',
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    timeoutSeconds: 300,
    maxInstances: CAPS.scheduled,
  },
  async () => {
    const result = await mirrorCatalog();
    if (result.failure) {
      // Warn rather than throw: a retry in fifteen minutes is the right response
      // to Square being briefly unreachable, and a failed scheduled run that
      // pages nobody is just noise in the log.
      console.warn(`[catalog-sync] nothing written — ${result.failure}`);
      return;
    }
    console.info(
      `[catalog-sync] ${result.written} product(s) mirrored, ${result.unpublished} unpublished.`,
    );
  },
);

/**
 * The same mirror, on demand, for somebody standing at the shop screen who has
 * just changed something in Square and does not want to wait.
 *
 * The same shape as `refreshBookstoreStats` next door, and gated on the same
 * claim as the rest of the catalog editing.
 */
export const refreshSquareCatalog = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false, maxInstances: CAPS.rebuild },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap gate, before a token is verified.
    if (throttled(req, res, { bucket: 'catalog:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    // Every call walks Square's whole catalog and rewrites the mirror. The
    // schedule does this anyway; the button is for not waiting for it.
    if (
      throttled(req, res, {
        bucket: 'catalogRebuild',
        max: BUDGETS.rebuild,
        identity: caller!.uid,
        message: 'The shop was just refreshed from Square. Please wait a minute.',
      })
    ) {
      return;
    }

    const release = exclusive('catalogMirror');
    if (!release) {
      // Two mirrors running at once write the same documents from two reads of
      // Square and the later write wins, which is how a photograph that was
      // just added comes back missing.
      res.status(409).json({ error: 'The shop is being refreshed right now.' });
      return;
    }

    try {
      const result = await mirrorCatalog();
      if (result.failure) {
        res.status(502).json({ error: result.failure });
        return;
      }

      res.status(200).json({ ok: true, ...result });
    } finally {
      release();
    }
  },
);
