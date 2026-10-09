/**
 * Mirror the Square bookstore catalog into the Firestore `products` collection.
 *
 * Square is the source of truth (decision #5b), so this runs one way and every
 * document it writes carries `squareCatalogObjectId` — the marker that staff
 * tooling must treat the row as read-only.
 *
 * A script rather than the scheduled Cloud Function it will eventually also be,
 * for the same reason the other seeders are scripts: the website is a static
 * export rebuilt on deploy, so a sync that runs immediately before the build is
 * worth having on day one, and it needs no Blaze plan or deployed Function to
 * be useful. The Function version reads the token from Secret Manager and can
 * come later without changing anything here — the mapping is in
 * `mapSquareCatalog`, which both call.
 *
 * Writing to `products` needs the `staff` claim, which nobody has yet, so this
 * goes in over the REST API with your own gcloud credentials — the same route
 * seed-config.mjs and seed-content.mjs take. Prerequisite: `gcloud auth login`.
 *
 * Dry by default, like every other seeder here. Nothing is written without
 * `--write`, because this talks to the parish's live project.
 *
 * Usage:
 *   npm run catalog                  # show what Square has and what would change
 *   npm run catalog -- --write       # create/update the product documents
 *   npm run catalog -- --write --prune   # also unpublish rows Square no longer has
 *   npm run catalog -- --write --emulator  # target the local emulator instead
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  mapSquareCatalog,
  mirrorDocumentId,
  parseInventoryCounts,
} from '../packages/shared/dist/index.js';
import { accessToken, documentUrl, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const prune = process.argv.includes('--prune');
const skipImages = process.argv.includes('--skip-images');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

/**
 * Write to the local Firestore emulator instead of the parish's project.
 *
 * `npm run dev:local` runs the site against the emulators, which is the only
 * way to work on anything gated behind an allocation. A catalog synced only to
 * production is therefore invisible in exactly the setup most local development
 * uses — the page renders its empty state and looks broken while production is
 * fine.
 */
const emulator = process.argv.includes('--emulator');
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

if (emulator && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(EMULATOR_HOST)) {
  console.error(`Refusing to run: --emulator but FIRESTORE_EMULATOR_HOST ${EMULATOR_HOST} is not localhost.`);
  process.exit(1);
}

/** Document URL for whichever store is being targeted. */
const docUrl = (path) =>
  emulator
    ? `http://${EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${path}`
    : documentUrl(project, path);

/**
 * The emulator takes a literal `owner` bearer token and bypasses rules with it;
 * production needs a real gcloud credential. Resolved lazily so a dry run needs
 * no `gcloud auth login` at all.
 */
const authorization = () => (emulator ? 'Bearer owner' : `Bearer ${accessToken()}`);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the optimised covers go, following `optimize-assets.mjs`'s rule that
 * anything referenced from markup by URL lives in `public/` and is versioned
 * with the code.
 *
 * ---------------------------------------------------------------------------
 * Why the covers are downloaded rather than hotlinked from Square
 *
 * They were hotlinked, on the same reasoning the bulletin uses for the
 * announcements app: one copy, no sync to keep in step. Then the real catalog
 * was measured. Square serves the originals the parish photographed — mostly
 * 3105×3105 JPEGs — and the nine covers come to **37.75 MB**, one of them 7 MB
 * on its own. That is not a shop page on a phone; that is a download.
 *
 * There is no resize parameter to reach for: the URLs are plain S3 objects.
 * And `images.unoptimized` is on because this is a static export, so nothing
 * resizes them at request time either. The bytes committed here are the exact
 * bytes a parishioner downloads, which is the principle `optimize-assets.mjs`
 * is built on — so the covers join everything else that principle governs.
 * ---------------------------------------------------------------------------
 */
const COVER_DIR = join(ROOT, 'apps/website/public/img/products');

/** Displayed about 210px wide; 400/800 gives a 2× panel headroom. */
const COVER_WIDTH = 400;

/**
 * Which Square category becomes the online shop.
 *
 * Named here rather than inferred, because the parish's catalog is mostly the
 * Egyptian Coptic Festival food menu — 57 of its 68 items. Getting this wrong
 * puts Lamb Dinner in the bookstore, so `mapSquareCatalog` deliberately returns
 * nothing at all for a category name it cannot find.
 */
const CATEGORY = 'Bookstore';

const squareEnv =
  process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
const squareHost =
  squareEnv === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
const squareToken =
  squareEnv === 'production'
    ? process.env.SQUARE_ACCESS_TOKEN
    : (process.env.SQUARE_SANDBOX_ACCESS_TOKEN ?? process.env.SQUARE_ACCESS_TOKEN);

if (!project) {
  console.error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set. See .env.example.');
  process.exit(1);
}
if (!squareToken) {
  console.error(`No Square access token for the ${squareEnv} environment. See .env.example.`);
  process.exit(1);
}

/** Every catalog object, following Square's cursor to the end. */
async function readSquareCatalog() {
  const objects = [];
  let cursor;
  do {
    const url = new URL(`${squareHost}/v2/catalog/list`);
    url.searchParams.set('types', 'ITEM,CATEGORY,IMAGE');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Square-Version': '2025-01-23',
      },
    });
    const body = await response.json();

    if (!response.ok) {
      const detail = body?.errors?.[0];
      console.error(`Square returned HTTP ${response.status}: ${detail?.code ?? ''} ${detail?.detail ?? ''}`);
      if (response.status === 401) {
        console.error(
          'A 401 here is almost always a sandbox token with SQUARE_ENVIRONMENT=production, or the reverse.',
        );
      }
      process.exit(1);
    }

    objects.push(...(body.objects ?? []));
    cursor = body.cursor;
  } while (cursor);

  return objects;
}

/** The slugs currently in Firestore, so we can report adds vs updates. */
async function existingSlugs(auth) {
  const url = `${docUrl('products')}?pageSize=300`;
  const response = await fetch(url, { headers: { Authorization: auth } });
  if (response.status === 404) return { present: new Set(), byObjectId: new Map() };
  if (!response.ok) {
    console.error(`Could not list products: HTTP ${response.status}`);
    process.exit(1);
  }
  const body = await response.json();

  const present = new Set();
  /*
   * Square's id → the document already mirroring it. Without this a book
   * renamed from the shop's edit panel would be written to a *new* document
   * under its new slug, and the old one pruned — see `mirrorDocumentId`.
   */
  const byObjectId = new Map();

  for (const document of body.documents ?? []) {
    const id = document.name.split('/').pop();
    present.add(id);
    const squareId = document.fields?.squareCatalogObjectId?.stringValue;
    if (squareId) byObjectId.set(squareId, id);
  }

  return { present, byObjectId };
}

/**
 * How many of each variation Square says are on the shelf.
 *
 * Returns `undefined` — never an empty map — when the counts cannot be read.
 * `mapSquareCatalog` treats an absent map as "inventory unknown, nothing is out
 * of stock", and an empty one as "every tracked item is at zero". Getting that
 * backwards would mean one failed request emptying the whole shop on the next
 * deploy, so the distinction is kept all the way out to here.
 */
async function readInventory(variationIds) {
  if (variationIds.length === 0) return undefined;

  const counts = [];
  // Square caps this endpoint at 1000 ids. The parish has eleven books, so the
  // chunking is insurance rather than something that runs today.
  for (let index = 0; index < variationIds.length; index += 500) {
    const response = await fetch(`${squareHost}/v2/inventory/counts/batch-retrieve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Square-Version': '2025-01-23',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ catalog_object_ids: variationIds.slice(index, index + 500) }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = body?.errors?.[0];
      console.warn(
        `\n  Could not read inventory: HTTP ${response.status} ${detail?.code ?? ''} ${detail?.detail ?? ''}`,
      );
      if (detail?.code === 'FORBIDDEN' || response.status === 403) {
        console.warn('  The token needs INVENTORY_READ. Run npm run verify:scopes.');
      }
      console.warn('  Stock counts are left untouched this run; nothing is marked sold out.\n');
      return undefined;
    }

    counts.push(...(body.counts ?? []));
  }

  return parseInventoryCounts(counts);
}

const objects = await readSquareCatalog();

/*
 * Mapped twice, and the first pass is thrown away.
 *
 * The inventory endpoint is asked about *variations*, and the only thing that
 * knows which variations are in the Bookstore category is the mapping itself.
 * So: map to learn the ids, fetch the counts, map again with them. It is pure
 * and network-free, which is what makes running it twice a non-event — and the
 * alternative is a second copy of the category and variation logic here, which
 * is exactly the duplication that put a wrong `slugify` in the Functions.
 */
const inventory = await readInventory(
  mapSquareCatalog(objects, CATEGORY)
    .products.map((product) => product.squareVariationId)
    .filter(Boolean),
);
const { products, skipped } = mapSquareCatalog(objects, CATEGORY, inventory);

console.log(`Square (${squareEnv}): ${objects.length} catalog objects`);
console.log(`Target: ${emulator ? `emulator ${EMULATOR_HOST}` : `project ${project}`}`);
console.log(`Category "${CATEGORY}": ${products.length} product(s), ${skipped.length} skipped`);

const tracked = products.filter((product) => product.stockCount !== null);
console.log(
  inventory
    ? `Inventory: ${tracked.length} tracked, ${tracked.filter((p) => p.stockCount === 0).length} sold out\n`
    : 'Inventory: not read — stockCount left off this run\'s field mask\n',
);

if (products.length === 0) {
  console.error(
    `Nothing to sync. Either the "${CATEGORY}" category does not exist in this Square\n` +
      `account, or it has no sellable items. This script refuses to fall back to\n` +
      `"publish everything" — the catalog is mostly festival food.`,
  );
  process.exit(1);
}

for (const item of skipped) {
  console.log(`  skipped  ${item.name || item.id} (${item.reason})`);
}
if (skipped.length > 0) console.log('');

const auth = authorization();
const { present, byObjectId } = await existingSlugs(auth);

/** The document each product is written to — its existing one after a rename. */
const docIdOf = (product) => mirrorDocumentId(product, byObjectId);

for (const product of products) {
  const id = docIdOf(product);
  const verb = present.has(id) ? 'update' : 'create';
  const price = `$${(product.price.amount / 100).toFixed(2)}`;
  const renamed = id === product.slug ? '' : `  (renamed; stays at ${id})`;
  console.log(`  ${verb.padEnd(6)} ${price.padStart(8)}  ${product.slug}${renamed}`);
}

const live = new Set(products.map(docIdOf));
const stale = [...present].filter((slug) => !live.has(slug));
if (stale.length > 0) {
  console.log(
    `\n  ${stale.length} document(s) in Firestore are not in Square: ${stale.join(', ')}`,
  );
  console.log(prune ? '  --prune given: these will be unpublished.' : '  Pass --prune to unpublish them.');
}

if (!write) {
  console.log('\nDry run. Nothing written. Re-run with --write to apply.');
  process.exit(0);
}

if (!skipImages) {
  mkdirSync(COVER_DIR, { recursive: true });
  let bytesIn = 0;
  let bytesOut = 0;
  let written = 0;

  for (const product of products) {
    /*
     * Every image on the item, not just the first.
     *
     * The detail view has a gallery — a main image with a thumbnail strip — so
     * a book with three photographs needs three files here. Today no book in
     * the parish's catalog has more than one, so this loop runs once per book;
     * it exists so that adding a second photograph in Square is the whole of
     * the work, with no code change on this side.
     *
     * The first keeps the bare `<slug>.webp` name that `bundledCover` and every
     * previously written document already point at. The rest are suffixed.
     */
    for (const [index, source] of product.imagePaths.entries()) {
      const stem = index === 0 ? product.slug : `${product.slug}-${index + 1}`;

      try {
        const response = await fetch(source);
        if (!response.ok) {
          console.warn(`  cover  ${stem}: HTTP ${response.status}, skipped`);
          continue;
        }
        const original = Buffer.from(await response.arrayBuffer());
        bytesIn += original.length;

        // `inside` with `withoutEnlargement`, not `cover`: every cover in this
        // catalog is square today, but a book photographed in portrait must not
        // be cropped to fit — losing the top of a title is worse than a
        // letterbox. The 160x160 one stays 160x160 rather than being blown up.
        for (const [suffix, width] of [['', COVER_WIDTH], ['@2x', COVER_WIDTH * 2]]) {
          const out = await sharp(original, { failOn: 'error' })
            .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: suffix ? 80 : 78, effort: 6 })
            .toBuffer();
          writeFileSync(join(COVER_DIR, `${stem}${suffix}.webp`), out);
          bytesOut += out.length;
        }
        written++;
      } catch (error) {
        console.warn(`  cover  ${stem}: ${error.message}, skipped`);
      }
    }
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(
    `\nCovers: ${written} optimised — ${mb(bytesIn)} MB from Square becomes ` +
      `${mb(bytesOut)} MB committed (1× and 2× WebP).`,
  );
}

/*
 * Exactly the fields Square owns on a product document.
 *
 * `section`, `weightOz` and `mediaMail` are deliberately absent — see the note
 * at the PATCH below, and their notes in packages/shared/src/schema/commerce.ts.
 *
 * `sku` is present: it is Square's, read off the variation. This script copies
 * SKUs and never assigns them — the catalog-sync Function does that, so there is
 * one numbering and not two (see packages/shared/src/payments/sku.ts).
 */
const MIRRORED_FIELDS = [
  'slug',
  'name',
  'description',
  'price',
  'imagePaths',
  'squareCatalogObjectId',
  'squareVariationId',
  'stockCount',
  'category',
  'sku',
  'published',
  'publishAt',
  'syncedAt',
  'createdAt',
  'updatedAt',
  'updatedBy',
];

/*
 * The mask this run actually uses.
 *
 * A masked field with no value is a *delete*, not a skip — that is the whole
 * point of the mask and it cuts both ways here. When the inventory read fails
 * every product carries `stockCount: null`, and leaving the field on the mask
 * would write that null over a real count: one 403 on INVENTORY_READ and every
 * sold-out book is quietly back on the shop at full stock.
 *
 * So a run that could not read inventory does not claim to know it.
 */
const fields = inventory
  ? MIRRORED_FIELDS
  : MIRRORED_FIELDS.filter((field) => field !== 'stockCount');

const now = new Date();
let created = 0;
let updated = 0;

for (const product of products) {
  const id = docIdOf(product);
  const existed = present.has(id);
  const body = {
    ...product,
    // The document id, not the freshly slugified name — they differ after a
    // rename, and the field must keep naming the document it lives in.
    slug: id,
    /*
     * Every mirrored row is published, which is the decision taken on
     * 2026-08-17: show the whole Bookstore category and ignore Square's
     * `ecom_visibility`, which currently marks all but one book UNAVAILABLE.
     * Revisit here if that flag ever starts being maintained.
     */
    published: true,
    publishAt: null,
    syncedAt: now,
    updatedAt: now,
    // The sync is not a user. Null is the schema's value for "not a person",
    // and is what `orders` and the rules already expect elsewhere.
    updatedBy: null,
    ...(existed ? {} : { createdAt: now }),
  };

  if (existed) {
    body.createdAt = now;
  }

  /*
   * A field mask, and the reason it replaced a whole-document PATCH.
   *
   * This used to send no `updateMask`, which replaces the document outright —
   * described here as "what a mirror wants: a field removed in Square must
   * disappear rather than linger". That was true while every field came from
   * Square. It stopped being true when `section` arrived: the shop's divisions
   * are the parish's, stored on this document and edited on the site, and a
   * whole-document PATCH silently erased every one of them on the next sync.
   * Nothing would have failed; the shop would just have gone flat again.
   *
   * The mask keeps the original property where it matters. Every mirrored field
   * is listed, so one absent from `body` because Square dropped it is deleted
   * here too — a masked field with no value is a delete, not a skip. Fields
   * *not* on the list are left alone, which is now exactly what is wanted.
   *
   * **Anything added to this document that the parish owns rather than Square
   * must be left off this list.** That is the whole contract.
   */
  const url = new URL(docUrl(`products/${id}`));
  for (const field of fields) {
    url.searchParams.append('updateMask.fieldPaths', field);
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(body) }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(`\nFailed to write ${id}: HTTP ${response.status}\n${detail.slice(0, 400)}`);
    process.exit(1);
  }

  existed ? updated++ : created++;
}

let pruned = 0;
if (prune) {
  for (const slug of stale) {
    // Unpublished rather than deleted. An order may reference this product, and
    // a deleted document turns a past order's line item into a dangling id.
    const response = await fetch(
      `${docUrl(`products/${slug}`)}?updateMask.fieldPaths=published`,
      {
        method: 'PATCH',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: toFieldMap({ published: false }) }),
      },
    );
    if (response.ok) pruned++;
  }
}

console.log(`\nWrote ${created} new, ${updated} updated${prune ? `, ${pruned} unpublished` : ''}.`);
console.log(
  emulator
    ? 'Written to the emulator. Reload the dev server page to see them.'
    : 'The site reads this at build time — redeploy for it to appear.',
);
