import type { Metadata } from 'next';
import {
  getBookstoreConfig,
  getProducts,
  toShopProducts,
  Shop,
  squarePublicConfig,
} from '@/features/bookstore';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Bookstore',
  description: 'Books, icons, and church goods from the parish bookstore.',
};

/**
 * The shop.
 *
 * The catalog is mirrored from Square by `npm run catalog` — see
 * scripts/sync-catalog.mjs — and read here at build time, which is all a static
 * export can do. Everything interactive (the detail dialog, the basket) is in
 * `Shop`, a client component, because there is no server at request time to
 * hold a session.
 *
 * Checkout is not finished: taking a payment needs the Square access token,
 * which authorizes charges and therefore lives only in the Cloud Functions
 * runtime. `Shop` hands off to that Function and says so honestly when it is
 * not there.
 */
export default async function BookstorePage() {
  const [products, settings] = await Promise.all([getProducts(), getBookstoreConfig()]);

  return (
    <PageBody flush>
      <PageHeader title="Bookstore" />

      {products.length === 0 ? (
        <EmptyState what="products" collection="products" />
      ) : (
        <Shop
          products={toShopProducts(products)}
          square={squarePublicConfig()}
          settings={settings}
        />
      )}
    </PageBody>
  );
}
