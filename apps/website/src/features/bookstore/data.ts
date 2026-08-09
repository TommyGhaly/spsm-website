import { collection, getDocs, query, where } from 'firebase/firestore';
import { COLLECTIONS, type DocOf, type Product } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf, safely } from '@/lib/firestore';

/**
 * Bookstore catalog.
 *
 * Read-only here by design. `orders` is writable only by Cloud Functions
 * reconciling verified Square webhooks — if the client could write to it, a
 * member could mark their own order paid.
 *
 * Two things are still undecided and both are in docs/decisions.md #5:
 * whether checkout is a Square Checkout Link or the Web Payments SDK, and
 * whether this catalog mirrors Square or Firestore is authoritative. `Product`
 * is shaped to work either way — `squareCatalogObjectId` present means mirrored
 * and read-only, both null means Firestore is the source.
 */
export async function getProducts(): Promise<DocOf<Product>[]> {
  return safely(
    'products',
    async () => {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.products), where('published', '==', true)),
      );
      return snapshot.docs
        .map(docOf<Product>)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [],
  );
}
