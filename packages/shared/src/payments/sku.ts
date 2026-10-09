/**
 * Bookstore SKUs: `SPSM-0001`, `SPSM-0002`, …
 *
 * ---------------------------------------------------------------------------
 * Where they live, and who may make one.
 *
 * The number is written into Square, on the first variation's own `sku`, so the
 * register and the website show the same thing. The Firestore mirror copies it
 * like any other Square-owned field.
 *
 * Only Cloud Functions assign them — `squareCreateProduct` for a product made on
 * the site, and the catalog sync for anything made at the register or before
 * SKUs existed. Both reserve numbers from one counter document
 * (`config/skuCounter`) inside a transaction, so two products created in the
 * same second cannot both become `SPSM-0012`. `scripts/sync-catalog.mjs` copies
 * SKUs and never assigns them; two assigners is two numbering schemes.
 *
 * A SKU never changes once given. It is not derived from the name or the
 * section, so renaming a book or moving it between sections leaves it alone —
 * which is the whole point of a stock number.
 * ---------------------------------------------------------------------------
 */

export const SKU_PREFIX = 'SPSM-';

/** Four digits until there are more than 9999 products, then as many as needed. */
export function formatSku(n: number): string {
  return `${SKU_PREFIX}${String(Math.max(1, Math.floor(n))).padStart(4, '0')}`;
}

/** `"SPSM-0042"` → 42. Anything else — a hand-typed ISBN, say — is null. */
export function parseSku(sku: string | null | undefined): number | null {
  if (typeof sku !== 'string') return null;
  const match = /^SPSM-(\d+)$/i.exec(sku.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The first number free to hand out.
 *
 * Takes the higher of the counter and the largest SKU already in the catalog,
 * because either can be ahead: the counter after a create whose Square write
 * failed, the catalog after someone typed `SPSM-0050` at the register. Starting
 * from the counter alone would eventually hand out a number already on a shelf.
 */
export function nextSkuNumber(existing: Iterable<string | null | undefined>, counter: number): number {
  let highest = Number.isSafeInteger(counter) && counter > 0 ? counter : 0;
  for (const sku of existing) {
    const n = parseSku(sku);
    if (n !== null && n > highest) highest = n;
  }
  return highest + 1;
}
