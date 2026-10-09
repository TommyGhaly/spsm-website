/**
 * Turning Square's catalog into this site's `Product` rows.
 *
 * Square is the source of truth for the bookstore (decision #5b), so this is a
 * one-way mapping: Square → Firestore. Nothing here writes back, and every row
 * it produces carries `squareCatalogObjectId`, which is the marker that staff
 * tooling must treat the document as read-only.
 *
 * Pure and network-free on purpose. The fetching lives in the sync Function,
 * which needs the access token; the *shape* work lives here, where it can be
 * tested against real catalog payloads without a credential.
 *
 * ---------------------------------------------------------------------------
 * What the parish's real catalog actually looks like, checked 2026-08-17
 *
 * These are not hypothetical edge cases — every one of them is in the live
 * data, and each drove a decision below:
 *
 *   - 68 items, of which only 11 are books. The other 57 are the Egyptian
 *     Coptic Festival food menu: Lamb Dinner, Cotton Candy, Sugar Cane Juice.
 *     Hence the category filter, without which the parish bookstore page would
 *     list falafel.
 *   - Duplicate names, including "The Bridegroom: Pascha Sermons" twice. Slugs
 *     therefore cannot be assumed unique — see `slugify` and the suffixing.
 *   - Trailing spaces on several names ("The Angelic Life ").
 *   - No item tracks inventory and none carries weight or dimensions. Staff can
 *     now switch tracking on per product from /bookstore, so this is the
 *     starting state rather than a permanent one — see `stockCount` below.
 * ---------------------------------------------------------------------------
 */
import type { Money } from '../schema/commerce.js';

/** The fields a mirrored product gets from Square. The writer adds the rest. */
export interface MappedProduct {
  /** Firestore document id. Stable across syncs — see `slugify`. */
  slug: string;
  name: string;
  description: string;
  price: Money;
  imagePaths: string[];
  squareCatalogObjectId: string;
  squareVariationId: string | null;
  stockCount: number | null;
  category: string | null;
  /**
   * The first variation's SKU, as Square holds it. Null until one is assigned —
   * see `sku.ts` for who assigns them and why only one place does.
   */
  sku: string | null;
}

/** Why an item in the requested category did not become a product. */
export interface SkippedItem {
  id: string;
  name: string;
  reason: 'archived' | 'no-price' | 'no-name';
}

export interface MappedCatalog {
  products: MappedProduct[];
  skipped: SkippedItem[];
}

/**
 * Map the objects of a `GET /v2/catalog/list` response into products.
 *
 * `categoryName` is matched case-insensitively against CATEGORY objects. An
 * unmatched name yields no products rather than everything — silently
 * publishing 68 festival items because someone renamed a category in Square is
 * the worst failure this function could have.
 *
 * `counts` is the parsed body of `POST /v2/inventory/counts/batch-retrieve`,
 * keyed by variation id — see `parseInventoryCounts`. **Omitting it is not the
 * same as passing an empty map**, and the distinction is load-bearing:
 *
 *   - omitted ⇒ inventory was never asked for, and every product gets
 *     `stockCount: null`, which is "not tracked" and puts nothing out of stock.
 *   - supplied ⇒ the counts are authoritative, so a variation with tracking
 *     switched on and no count row is 0, i.e. genuinely sold out.
 *
 * A caller that cannot reach the inventory endpoint must therefore pass nothing
 * rather than an empty map. The alternative — one failed request emptying the
 * whole shop — is the worst outcome available here, and it is a single
 * `undefined` away.
 */
export function mapSquareCatalog(
  objects: readonly unknown[],
  categoryName: string,
  counts?: ReadonlyMap<string, number>,
): MappedCatalog {
  const wanted = categoryName.trim().toLowerCase();

  const categories = new Map<string, string>();
  const images = new Map<string, string>();
  const items: Record<string, unknown>[] = [];

  for (const raw of objects) {
    const object = asRecord(raw);
    if (!object) continue;
    const id = str(object['id']);
    if (!id) continue;

    switch (object['type']) {
      case 'CATEGORY': {
        const name = str(asRecord(object['category_data'])?.['name']);
        if (name) categories.set(id, name);
        break;
      }
      case 'IMAGE': {
        const url = str(asRecord(object['image_data'])?.['url']);
        if (url) images.set(id, url);
        break;
      }
      case 'ITEM':
        items.push(object);
        break;
    }
  }

  const products: MappedProduct[] = [];
  const skipped: SkippedItem[] = [];
  // Slugs come from names, and the live catalog has duplicate names. Counting
  // them lets the second occurrence become `…-2` rather than overwriting the
  // first — which would silently drop a product on every sync.
  const slugCounts = new Map<string, number>();

  for (const item of items) {
    const id = str(item['id']) ?? '';
    const data = asRecord(item['item_data']);
    const name = str(data?.['name']);

    if (!name) {
      skipped.push({ id, name: '', reason: 'no-name' });
      continue;
    }

    const categoryId = itemCategoryId(data);
    const category = categoryId ? categories.get(categoryId) : undefined;
    if (!category || category.trim().toLowerCase() !== wanted) continue;

    // Archived means staff have retired it in Square. Publishing it anyway
    // would make the archive button do nothing, which is worse than the item
    // being absent.
    if (data?.['is_archived'] === true) {
      skipped.push({ id, name, reason: 'archived' });
      continue;
    }

    const variation = firstVariation(data);
    const price = moneyOf(variation?.price);
    if (!price) {
      // A book with no price cannot be added to a cart, and rendering "$0.00"
      // would invite someone to try.
      skipped.push({ id, name, reason: 'no-price' });
      continue;
    }

    const base = slugify(name);
    const seen = (slugCounts.get(base) ?? 0) + 1;
    slugCounts.set(base, seen);

    products.push({
      slug: seen === 1 ? base : `${base}-${seen}`,
      name,
      description: str(data?.['description']) ?? '',
      price,
      imagePaths: imageUrls(data, images),
      squareCatalogObjectId: id,
      squareVariationId: variation?.id ?? null,
      /*
       * Tracking is read off the variation, not inferred from the presence of a
       * count. Square returns no count row for a variation that has never had
       * one recorded, so "no row" is ambiguous on its own — it means zero for a
       * tracked item and "not tracked" for an untracked one, and only
       * `track_inventory` tells the two apart.
       */
      stockCount: stockOf(variation, counts),
      category,
      sku: variation?.sku ?? null,
    });
  }

  // Alphabetical, so a sync that returns objects in a different order does not
  // produce a spurious diff.
  products.sort((a, b) => a.name.localeCompare(b.name));
  return { products, skipped };
}

/**
 * `"The Holy Pascha "` → `"the-holy-pascha"`.
 *
 * Used as the Firestore document id, so it must be stable: the same book must
 * produce the same slug on every sync or each run would create a duplicate
 * document and orphan the old one. That rules out anything involving a counter
 * or a timestamp, and means the name is the only input.
 *
 * Not derived from `squareCatalogObjectId`, which *is* stable and unique, for
 * one reason: these ids are opaque strings like `LFXK2QZ...`, and they end up
 * in the product URL. A readable slug is worth the duplicate handling above.
 */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      // Strip combining marks, so an accented title does not become a run of
      // hyphens. `\p{Diacritic}` needs the `u` flag.
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // A name of nothing but punctuation would otherwise produce '' and
      // collide with every other such name at the document-id level.
      .slice(0, 80) || 'item'
  );
}

/**
 * The item's category id, across both shapes Square uses.
 *
 * `category_id` is the older single-category field; `categories[]` is the
 * current one. The parish's catalog returns the newer shape, but both are live
 * in the API depending on `Square-Version`, and reading only one of them is a
 * silent "no products" the day that changes.
 */
function itemCategoryId(data: Record<string, unknown> | null): string | null {
  const list = data?.['categories'];
  if (Array.isArray(list)) {
    const first = str(asRecord(list[0])?.['id']);
    if (first) return first;
  }
  return str(data?.['category_id']);
}

function firstVariation(
  data: Record<string, unknown> | null,
): { id: string | null; price: unknown; tracked: boolean; sku: string | null } | null {
  const list = data?.['variations'];
  if (!Array.isArray(list) || list.length === 0) return null;

  const variation = asRecord(list[0]);
  const variationData = asRecord(variation?.['item_variation_data']);
  return {
    id: str(variation?.['id']),
    price: variationData?.['price_money'],
    tracked: tracksInventory(variationData),
    sku: str(variationData?.['sku']),
  };
}

/**
 * Whether Square is counting copies of this variation.
 *
 * ---------------------------------------------------------------------------
 * Square states this in two places and the parish's real catalog uses the one
 * this function was originally missing.
 *
 * `track_inventory` on `item_variation_data` is the variation-wide default.
 * `location_overrides[].track_inventory` is the per-location answer, and it is
 * what the Square dashboard writes when you switch tracking on for a location
 * — which is the only way a single-location merchant ever does it. Every book
 * in the parish's production catalog carries the override and *no* top-level
 * flag, so reading only the top-level one reported "not tracked" for all ten
 * while Square held real counts of one to three copies each.
 *
 * That is not a cosmetic miss. `stockOf` maps "not tracked" to `stockCount:
 * null`, `squareCheckout` only refuses a line at `stockCount === 0`, and so a
 * book with the last copy already sold stayed on the shop and stayed buyable.
 *
 * Any location tracking it counts as tracked. The parish has one location, and
 * `parseInventoryCounts` likewise keys on the variation alone — a merchant with
 * two shops would need a location id threaded through both, which is a change
 * to make when there is a second shop and not before.
 *
 * Exported because `squareProductStock` has to *write* this flag, and a writer
 * that puts it somewhere this function does not look is a switch that appears
 * to work and does nothing. `trackInventoryPatch` below is the matching setter;
 * the two belong together and neither should be reimplemented at a call site.
 * ---------------------------------------------------------------------------
 */
export function tracksInventory(variationData: Record<string, unknown> | null): boolean {
  if (variationData?.['track_inventory'] === true) return true;

  const overrides = variationData?.['location_overrides'];
  if (!Array.isArray(overrides)) return false;
  return overrides.some((raw) => asRecord(raw)?.['track_inventory'] === true);
}

/**
 * An `item_variation_data` that tracks inventory, or does not, as asked.
 *
 * ---------------------------------------------------------------------------
 * The counterpart to `tracksInventory`, and the reason it is a function rather
 * than one line at the call site: **the flag has to be written everywhere that
 * function reads it.**
 *
 * Setting only the top-level `track_inventory` looks right and is a no-op on
 * every book the parish actually has. Those all carry
 * `location_overrides[{ track_inventory: true }]` and no top-level flag, and an
 * override wins for its location — so "stop counting" would write `false` at
 * the top, leave the override saying `true`, and the next sync would read the
 * book back as tracked with its old count. The staff button would appear to do
 * nothing, twice: once in Square and once on the shop.
 *
 * So both are set. Overrides are rewritten in place rather than dropped —
 * they carry other per-location settings (`price_money`, `sellable`) that are
 * none of this function's business.
 * ---------------------------------------------------------------------------
 */
export function trackInventoryPatch(
  variationData: Record<string, unknown> | null,
  tracked: boolean,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(variationData ?? {}), track_inventory: tracked };

  const overrides = variationData?.['location_overrides'];
  if (Array.isArray(overrides) && overrides.length > 0) {
    data['location_overrides'] = overrides.map((raw) => {
      const override = asRecord(raw);
      return override ? { ...override, track_inventory: tracked } : raw;
    });
  }

  return data;
}

/** What this variation's stock is, given what we know about inventory. */
function stockOf(
  variation: { id: string | null; tracked: boolean } | null,
  counts: ReadonlyMap<string, number> | undefined,
): number | null {
  if (!counts || !variation?.tracked) return null;
  return variation.id ? (counts.get(variation.id) ?? 0) : null;
}

/**
 * `POST /v2/inventory/counts/batch-retrieve` → variation id → quantity.
 *
 * Square reports quantities as *strings* (`"3"`), and one row per catalog
 * object per state: an item can hold IN_STOCK, SOLD, and WASTE rows at once.
 * Only IN_STOCK is what a shopper can buy, so the others are dropped — summing
 * them would have counted every copy already sold as still on the shelf.
 *
 * A negative quantity is possible in Square (an oversell recorded at the till)
 * and is clamped to 0. The shop reads `stockCount === 0` as sold out and would
 * treat -1 as plenty in stock.
 */
export function parseInventoryCounts(rows: readonly unknown[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const raw of rows) {
    const row = asRecord(raw);
    if (!row || row['state'] !== 'IN_STOCK') continue;

    const id = str(row['catalog_object_id']);
    if (!id) continue;

    const quantity = Number(row['quantity']);
    if (!Number.isFinite(quantity)) continue;

    counts.set(id, Math.max(0, Math.floor(quantity)));
  }

  return counts;
}

/** Square money → `Money`, or null if it isn't usable. */
function moneyOf(raw: unknown): Money | null {
  const record = asRecord(raw);
  const amount = record?.['amount'];
  // A free item is legitimate; a missing or negative amount is not.
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
  // Only USD is modelled, and the merchant is US-based. Refusing anything else
  // beats silently relabelling another currency as dollars.
  if (record?.['currency'] !== 'USD') return null;
  return { amount: Math.round(amount), currency: 'USD' };
}

/**
 * Image URLs, hotlinked from Square's CDN.
 *
 * The same trade the bulletin makes with the announcements app: copying them
 * into our own Storage means a second copy to keep in step and a sync that can
 * fail halfway. The cost is that a photo the parish deletes in Square breaks
 * here, which is the correct direction — Square is the source of truth.
 */
function imageUrls(
  data: Record<string, unknown> | null,
  images: Map<string, string>,
): string[] {
  const ids = data?.['image_ids'];
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => (typeof id === 'string' ? images.get(id) : undefined))
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Trims; returns null for anything that isn't a non-empty string. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Which Firestore document a mirrored product belongs in.
 *
 * ---------------------------------------------------------------------------
 * The document id is a slug of the name, and it has to keep being that for
 * every product the mirror has never seen — a readable `/bookstore` URL is the
 * reason `slugify` exists rather than keying on Square's opaque ids.
 *
 * But a name can now be changed from the shop's own edit panel, and a slug
 * recomputed from the new name is a *different document*. Left alone, one
 * rename would: create a second row, prune the first as "no longer in Square",
 * and take the parish's `section` and the build's baked cover down with it —
 * while any completed order still pointing at the old slug turned into a
 * dangling line item.
 *
 * So Square's own id is the join wherever one already exists, and the slug is
 * only ever how a *new* document gets named. A renamed book keeps the document,
 * the URL, the category and the cover it had, and only its `name` changes,
 * which is the whole of what was asked for.
 *
 * @param existingByObjectId `squareCatalogObjectId` → the document id already
 *   holding it. Products created outside Square have no id and are absent, so
 *   they fall through to the slug exactly as before.
 * ---------------------------------------------------------------------------
 */
export function mirrorDocumentId(
  product: { slug: string; squareCatalogObjectId: string },
  existingByObjectId: ReadonlyMap<string, string>,
): string {
  return existingByObjectId.get(product.squareCatalogObjectId) ?? product.slug;
}
