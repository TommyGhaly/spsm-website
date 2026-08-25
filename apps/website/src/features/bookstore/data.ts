import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  CONFIG_DOC_BOOKSTORE,
  COLLECTIONS,
  DEFAULT_BOOKSTORE_CONFIG,
  parseBookstoreConfig,
  type BookstoreConfig,
  type DocOf,
  type Product,
} from '@spsm/shared';
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

/**
 * The shop's settings, read at build time.
 *
 * Unauthenticated, like everything else in this file — `config/bookstore` is
 * world-readable because the page prints it. Falls back to the committed
 * defaults, which are the exact strings that used to be hard-coded in `Shop`,
 * so a parish that has never opened the editor sees no change at all.
 */
export async function getBookstoreConfig(): Promise<BookstoreConfig> {
  return safely(
    'config/bookstore',
    async () => {
      const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_BOOKSTORE));
      return parseBookstoreConfig(snapshot.exists() ? snapshot.data() : null);
    },
    DEFAULT_BOOKSTORE_CONFIG,
  );
}
