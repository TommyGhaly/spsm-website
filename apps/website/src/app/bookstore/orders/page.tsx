import type { Metadata } from 'next';
import { OrderLookup } from '@/features/bookstore/OrderLookup';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Your orders',
  description: 'Look up a bookstore order and see where it has got to.',
  // Nothing here is content. The page is a form, every result behind it is
  // somebody's purchase history, and neither is a thing to be indexed.
  robots: { index: false, follow: false },
};

/**
 * Where a buyer checks on an order.
 *
 * Static, like every page here — the lookup is a POST to a Cloud Function from
 * the client component, because a static export has no server at request time
 * and because the query has to happen somewhere the Firestore rules cannot
 * reach. `orders` is unreadable by an unauthenticated client on purpose; the
 * Function uses the Admin SDK after checking the receipt.
 */
export default function BookstoreOrdersPage() {
  return (
    <PageBody>
      <PageHeader title="Your orders" />
      <OrderLookup />
    </PageBody>
  );
}
