import { randomUUID } from 'node:crypto';
import { COLLECTIONS, formatSku, nextSkuNumber } from '@spsm/shared';
import type { SquareClient } from './square.js';

/**
 * Handing out `SPSM-####` numbers — see `payments/sku.ts` in @spsm/shared for
 * the scheme and why only Functions assign them.
 */

/** Document id of the counter, in the `config` collection. Functions-only by rule. */
export const CONFIG_DOC_SKU_COUNTER = 'skuCounter';

/**
 * Reserve `count` consecutive SKUs.
 *
 * In a transaction, so two products created at once get different numbers.
 * `existing` is every SKU already in the catalog, so a number typed at the
 * register is never handed out a second time — see `nextSkuNumber`.
 *
 * A reservation that is never written to Square leaves a gap. Gaps are
 * harmless; a duplicate on two shelves is not, and avoiding gaps would need the
 * Square write inside the transaction, which Firestore cannot do.
 */
export async function reserveSkus(
  db: FirebaseFirestore.Firestore,
  count: number,
  existing: Iterable<string | null | undefined>,
): Promise<string[]> {
  if (count <= 0) return [];
  const known = [...existing];
  const ref = db.collection(COLLECTIONS.config).doc(CONFIG_DOC_SKU_COUNTER);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const last = Number(snapshot.get('last')) || 0;
    const first = nextSkuNumber(known, last);
    tx.set(ref, { last: first + count - 1 }, { merge: true });
    return Array.from({ length: count }, (_, i) => formatSku(first + i));
  });
}

/**
 * Write SKUs onto existing Square variations, in one batch upsert.
 *
 * Each variation object is sent back whole with its current `version`, the way
 * the stock and details endpoints patch them: Square replaces a catalog object
 * with what it is sent, so a partial object would erase its price. Returns the
 * variation ids Square accepted; anything else is left for the next run.
 */
export async function writeSkusToSquare(
  square: SquareClient,
  assignments: { variation: Record<string, unknown>; sku: string }[],
): Promise<Set<string>> {
  const accepted = new Set<string>();
  if (assignments.length === 0) return accepted;

  const objects = assignments.map(({ variation, sku }) => ({
    ...variation,
    item_variation_data: {
      ...((variation['item_variation_data'] as Record<string, unknown> | undefined) ?? {}),
      sku,
    },
  }));

  const response = await fetch(`${square.host}/v2/catalog/batch-upsert`, {
    method: 'POST',
    headers: square.headers,
    body: JSON.stringify({
      idempotency_key: `sku-${randomUUID()}`.slice(0, 45),
      batches: [{ objects }],
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    objects?: { id?: string }[];
    errors?: { code?: string; detail?: string }[];
  };
  if (!response.ok) {
    const detail = body.errors?.[0];
    console.error(`[sku] Square refused the SKU upsert: ${response.status} ${detail?.code ?? ''} ${detail?.detail ?? ''}`);
    return accepted;
  }
  for (const object of body.objects ?? []) if (object.id) accepted.add(object.id);
  return accepted;
}
