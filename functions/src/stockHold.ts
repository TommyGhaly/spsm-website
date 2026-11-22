import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { COLLECTIONS, parseInventoryCounts } from '@spsm/shared';
import { squareClient, type SquareClient } from './square.js';

/**
 * Square-tracked stock — everything that is not clothing.
 *
 * ---------------------------------------------------------------------------
 * Square owns these counts. It takes copies off its own count the moment a
 * payment on a catalog order completes (website, app, App Clip, the till, and a
 * cash order a volunteer records), and nothing here ever subtracts from Square
 * a second time.
 *
 * What lives here is the *mirror*: `stockCount` on the product document, which
 * the shop reads and checkout refuses against. Left to the fifteen-minute sync
 * it lagged every sale, so a second buyer could be sold a copy that had already
 * gone. So:
 *
 *   1. `readStockHold` lowers the mirror inside checkout's own transaction,
 *      before the card is touched, and refuses a basket the mirror cannot
 *      cover. Two buyers racing for the last copy are settled there.
 *   2. `refreshStock` then reads Square's real counts for those products once
 *      the payment has an outcome. Paid: Square has moved and the mirror agrees.
 *      Declined: Square never moved, and the refresh puts the copy back.
 *   3. `restockIfDue` puts a refund's copies back *in Square*, which a refund
 *      made through the API does not do, when staff chose to restock.
 * ---------------------------------------------------------------------------
 */

interface LineLike {
  productId?: string;
  slug?: string;
  size?: string | null;
  quantity?: number;
}

/** Slug → quantity, for the lines Square counts (no size). */
export function trackedDemand(lines: readonly LineLike[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of lines) {
    if (line.size) continue;
    const slug = String(line.slug ?? line.productId ?? '');
    const quantity = Number(line.quantity) || 0;
    if (!slug || quantity <= 0) continue;
    demand.set(slug, (demand.get(slug) ?? 0) + quantity);
  }
  return demand;
}

/**
 * Reads, inside `tx`, the tracked products an order takes from, and returns
 * what is short and the writes that lower the mirror — to be applied after
 * every other read in the transaction. Untracked products (`stockCount` null)
 * are left alone: nothing counts them.
 */
export async function readStockHold(
  tx: Transaction,
  db: Firestore,
  demand: ReadonlyMap<string, number>,
): Promise<{ short: { slug: string; left: number }[]; apply: () => void }> {
  const slugs = [...demand.keys()];
  const refs = slugs.map((slug) => db.collection(COLLECTIONS.products).doc(slug));
  const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

  const short: { slug: string; left: number }[] = [];
  const writes: (() => void)[] = [];
  snaps.forEach((snap, index) => {
    const count = snap.exists ? snap.get('stockCount') : null;
    if (typeof count !== 'number') return;
    const wanted = demand.get(slugs[index]!) ?? 0;
    if (count < wanted) {
      short.push({ slug: slugs[index]!, left: Math.max(0, count) });
      return;
    }
    writes.push(() =>
      tx.update(refs[index]!, { stockCount: count - wanted, updatedAt: FieldValue.serverTimestamp() }),
    );
  });

  return { short, apply: () => writes.forEach((write) => write()) };
}

/**
 * Bring the mirrored `stockCount` of these products into line with Square.
 *
 * Only products already tracked (a number, not null) are touched: switching
 * tracking on or off is the catalog sync's business. A tracked variation with
 * no IN_STOCK row in Square is at zero, the same reading the sync makes.
 *
 * Never throws. A failed read leaves the mirror as it was, which the next sync
 * corrects; a sale must never fail because a statistic could not be refreshed.
 */
export async function refreshStock(
  db: Firestore,
  slugs: readonly string[],
  square: SquareClient | null = squareClient(),
): Promise<void> {
  const unique = [...new Set(slugs.filter(Boolean))];
  if (!square || unique.length === 0) return;
  try {
    const refs = unique.map((slug) => db.collection(COLLECTIONS.products).doc(slug));
    await refreshSnapshots(db, await db.getAll(...refs), square);
  } catch (cause) {
    console.error('[stock] could not refresh from Square', cause);
  }
}

/**
 * The same, keyed by Square variation id — what an `inventory.count.updated`
 * webhook names. Picks up sales at the till within seconds instead of fifteen
 * minutes.
 */
export async function refreshStockByVariation(
  db: Firestore,
  variationIds: readonly string[],
  square: SquareClient | null = squareClient(),
): Promise<void> {
  const unique = [...new Set(variationIds.filter(Boolean))];
  if (!square || unique.length === 0) return;
  try {
    const snaps: DocumentSnapshot[] = [];
    // `in` takes thirty values at most.
    for (let index = 0; index < unique.length; index += 30) {
      const page = await db
        .collection(COLLECTIONS.products)
        .where('squareVariationId', 'in', unique.slice(index, index + 30))
        .get();
      snaps.push(...page.docs);
    }
    await refreshSnapshots(db, snaps, square);
  } catch (cause) {
    console.error('[stock] could not refresh from Square', cause);
  }
}

async function refreshSnapshots(
  db: Firestore,
  snaps: readonly DocumentSnapshot[],
  square: SquareClient,
): Promise<void> {
  const tracked = snaps.filter(
    (snap) =>
      snap.exists && typeof snap.get('stockCount') === 'number' && typeof snap.get('squareVariationId') === 'string',
  );
  if (tracked.length === 0) return;

  const variationIds = tracked.map((snap) => snap.get('squareVariationId') as string);
  const response = await fetch(`${square.host}/v2/inventory/counts/batch-retrieve`, {
    method: 'POST',
    headers: square.headers,
    // The same request the catalog sync makes, so the two never disagree.
    body: JSON.stringify({ catalog_object_ids: variationIds }),
  });
  const body = (await response.json().catch(() => ({}))) as { counts?: unknown[]; errors?: unknown };
  if (!response.ok) {
    console.warn(`[stock] Square would not give counts (HTTP ${response.status})`, JSON.stringify(body.errors));
    return;
  }
  const counts = parseInventoryCounts(body.counts ?? []);

  const batch = db.batch();
  for (const snap of tracked) {
    const next = counts.get(snap.get('squareVariationId') as string) ?? 0;
    if (next === snap.get('stockCount')) continue;
    batch.update(snap.ref, { stockCount: next, updatedAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
}

/**
 * Put a refunded order's tracked copies back on Square's shelf, once.
 *
 * Due when the order is `refunded`, staff ticked restock, and it has not been
 * done. The flag is claimed in a transaction before Square is called, and the
 * Square call carries a key derived from the order, so two webhook deliveries
 * racing each other restock once. Returns whether it did.
 */
export async function restockIfDue(db: Firestore, orderRef: DocumentReference): Promise<boolean> {
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return null;
    const refund = snap.get('refund') as { restock?: boolean } | null | undefined;
    if (snap.get('status') !== 'refunded' || refund?.restock !== true || snap.get('stockRestocked') === true) {
      return null;
    }
    const demand = trackedDemand((snap.get('lineItems') ?? []) as LineLike[]);
    if (demand.size === 0) return null;
    tx.update(orderRef, { stockRestocked: true });
    return demand;
  });
  if (!claimed) return false;

  const square = squareClient();
  if (!square) return false;
  const slugs = [...claimed.keys()];
  const products = await db.getAll(...slugs.map((slug) => db.collection(COLLECTIONS.products).doc(slug)));
  const now = new Date().toISOString();
  const changes = products.flatMap((snap) => {
    const variationId = snap.get('squareVariationId');
    // Untracked in Square: there is no count to put anything back on.
    if (typeof variationId !== 'string' || typeof snap.get('stockCount') !== 'number') return [];
    return [
      {
        type: 'ADJUSTMENT',
        adjustment: {
          catalog_object_id: variationId,
          from_state: 'SOLD',
          to_state: 'IN_STOCK',
          location_id: square.locationId,
          quantity: String(claimed.get(snap.id) ?? 0),
          occurred_at: now,
        },
      },
    ];
  });
  if (changes.length === 0) return false;

  const response = await fetch(`${square.host}/v2/inventory/changes/batch-create`, {
    method: 'POST',
    headers: square.headers,
    body: JSON.stringify({ idempotency_key: `restock-${orderRef.id}`.slice(0, 45), changes }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { errors?: unknown };
    console.error(`[stock] Square would not restock ${orderRef.id}`, JSON.stringify(body.errors));
    // Released, so the next delivery of the refund event can try again.
    await orderRef.update({ stockRestocked: false }).catch(() => undefined);
    return false;
  }
  await refreshStock(db, slugs, square);
  return true;
}
