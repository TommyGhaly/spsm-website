import type { Metadata } from 'next';
import { getProducts, ProductGrid } from '@/features/bookstore';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Bookstore',
  description: 'Books, icons, and church goods from the parish bookstore.',
};

/**
 * Catalog only. Checkout is not wired up: both open questions in
 * docs/decisions.md #5 are still open — Checkout Links vs. the Web Payments
 * SDK, and whether the catalog mirrors Square or Firestore is authoritative.
 *
 * Listing the catalog does not depend on either, so it ships now and checkout
 * slots in behind `PaymentProvider` when those are settled.
 */
export default async function BookstorePage() {
  const products = await getProducts();

  return (
    <>
      <PageHeader
        title="Bookstore"
        lede="Books, icons, and church goods. Purchases are made in person at the bookstore."
      />

      <PageBody>
        {products.length === 0 ? (
          <EmptyState what="products" collection="products" />
        ) : (
          <ProductGrid products={products} />
        )}
      </PageBody>
    </>
  );
}
