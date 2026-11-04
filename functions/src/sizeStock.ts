import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { COLLECTIONS, cleanSizes, retakeSizes, returnSizes, shouldReturnSizes, sizeDemand } from '@spsm/shared';

/**
 * Putting an order's clothing sizes back on the shelf.
 *
 * Three places do it — a declined card in checkout, a failed or cancelled
 * payment or a restocked refund arriving by webhook, and the refund endpoint
 * when Square's refund completes before its own write lands — and all three
 * must agree on *what* goes back and that it goes back *once*. The `sizesCounted`
 * flag on the order is the once: whichever of them gets there first clears it in
 * the same transaction as the counts, and the rest find it clear.
 */

interface OrderLike {
  lineItems?: { productId?: string; size?: string | null; quantity?: number }[];
}

function demandOf(order: OrderLike) {
  return sizeDemand(
    (order.lineItems ?? []).map((line) => ({
      slug: String(line.productId ?? ''),
      size: line.size ?? null,
      quantity: Number(line.quantity) || 0,
    })),
  );
}

/**
 * True when an order moving to paid needs its sizes taken again: it has sizes,
 * and they were put back when it was thought failed.
 */
export function needsRetake(status: string, order: OrderLike & { sizesCounted?: boolean }): boolean {
  return status === 'paid' && order.sizesCounted !== true && demandOf(order).length > 0;
}

/**
 * The counterpart of `readSizeReturn`, for an order found paid after its sizes
 * were put back. Counts go no lower than zero — it is paid, so it cannot be
 * refused — and a shortfall is logged for somebody to ring the buyer about.
 */
export async function readSizeRetake(
  tx: Transaction,
  db: Firestore,
  orderRef: DocumentReference,
  order: OrderLike,
): Promise<() => void> {
  const demand = demandOf(order);
  const slugs = [...new Set(demand.map((entry) => entry.slug))].filter(Boolean);
  const refs = slugs.map((slug) => db.collection(COLLECTIONS.products).doc(slug));
  const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

  return () => {
    snaps.forEach((snap, index) => {
      const sizes = snap.exists ? cleanSizes(snap.get('sizes')) : null;
      if (!sizes) return;
      const { next, short } = retakeSizes(sizes, slugs[index]!, demand);
      if (short.length > 0) {
        console.error(`[sizes] OVERSOLD — order ${orderRef.id} paid late; ${slugs[index]} short ${JSON.stringify(short)}`);
      }
      tx.update(refs[index]!, { sizes: next, updatedAt: FieldValue.serverTimestamp() });
    });
    tx.update(orderRef, { sizesCounted: true });
  };
}

/**
 * Reads, inside `tx`, the products an order's sizes came from, and returns the
 * writes that put them back — to be called after every other read in the
 * transaction, since Firestore wants all reads first.
 */
export async function readSizeReturn(
  tx: Transaction,
  db: Firestore,
  orderRef: DocumentReference,
  order: OrderLike,
): Promise<() => void> {
  const demand = demandOf(order);
  const slugs = [...new Set(demand.map((entry) => entry.slug))].filter(Boolean);
  const refs = slugs.map((slug) => db.collection(COLLECTIONS.products).doc(slug));
  const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

  return () => {
    snaps.forEach((snap, index) => {
      const sizes = snap.exists ? cleanSizes(snap.get('sizes')) : null;
      if (!sizes) return;
      tx.update(refs[index]!, {
        sizes: returnSizes(sizes, slugs[index]!, demand),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    tx.update(orderRef, { sizesCounted: false });
  };
}

/**
 * Puts the sizes back if `status` calls for it and they are still out. Its own
 * transaction, for callers that are not already in one. Returns whether it did.
 *
 * `onlyIfAlready` makes it act only when the order's stored status already is
 * `status` — the refund endpoint's case, where the refund may still be pending
 * and the sizes must wait for Square to say it completed.
 */
export async function returnSizesIfDue(
  db: Firestore,
  orderRef: DocumentReference,
  status: string,
  { onlyIfAlready = false }: { onlyIfAlready?: boolean } = {},
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return false;
    if (onlyIfAlready && snap.get('status') !== status) return false;
    const order = snap.data() as OrderLike & Parameters<typeof shouldReturnSizes>[1];
    if (!shouldReturnSizes(status, order)) return false;
    const apply = await readSizeReturn(tx, db, orderRef, order);
    apply();
    return true;
  });
}
