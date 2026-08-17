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
 *   - No item tracks inventory and none carries weight or dimensions.
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
 */
export function mapSquareCatalog(objects: readonly unknown[], categoryName: string): MappedCatalog {
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
      // Null means "not tracked", which is the truth: no item in this catalog
      // has inventory tracking switched on. Deliberately not 0, which would
      // mean sold out and hide everything.
      stockCount: null,
      category,
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
): { id: string | null; price: unknown } | null {
  const list = data?.['variations'];
  if (!Array.isArray(list) || list.length === 0) return null;

  const variation = asRecord(list[0]);
  const variationData = asRecord(variation?.['item_variation_data']);
  return { id: str(variation?.['id']), price: variationData?.['price_money'] };
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
