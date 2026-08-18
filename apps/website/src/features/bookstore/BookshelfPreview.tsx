import Link from 'next/link';
import type { ShopProduct } from './shopData';
import { Cover } from './Cover';
import { money } from './money';

/** How many covers the strip carries before it is just the whole shop again. */
const SHOWN = 8;

/**
 * A shelf of covers on the homepage, between the livestream and the week ahead.
 *
 * ---------------------------------------------------------------------------
 * A preview rather than a second shop, and the distinction is what keeps it
 * honest. The bookstore page had a horizontal strip of covers above its own
 * list once, and it was removed for showing the same eleven books twice on one
 * page. Here there is nothing to duplicate: this is the only place the books
 * appear, for a reader who came to check a service time and did not know the
 * parish sells anything.
 *
 * Covers and prices, no descriptions and no Add button. Buying needs a basket,
 * a dialog and Square's SDK — all of it client-side, none of it worth loading
 * on the homepage for the few who will click through. Every cover is a plain
 * link to `/bookstore`, so this stays a server component and costs the page
 * nothing but images.
 *
 * Eight, not eleven. Enough to read as a shelf that continues past the edge of
 * the screen, which is the invitation; all of them would just be the shop.
 * ---------------------------------------------------------------------------
 */
export function BookshelfPreview({ products }: { products: ShopProduct[] }) {
  // No catalog, no section. An empty shelf under a heading saying "From the
  // bookstore" is a claim the parish sells nothing.
  if (products.length === 0) return null;

  const shown = products.slice(0, SHOWN);

  return (
    <div className="bookshelf">
      {/*
        A viewport wrapping a track, rather than one element being both the
        scroller and the flex row — the same split the shop's strips use. As a
        single element the row's content escapes to the document and the whole
        page can be dragged sideways.
      */}
      <div className="bookshelf__viewport scroller">
        <ul className="bookshelf__strip">
          {shown.map((product) => (
            <li key={product.slug}>
              <Link className="bookshelf__book" href="/bookstore">
                <Cover
                  product={product}
                  className="bookshelf__cover"
                  sizes="9rem"
                />
                <span className="bookshelf__name">{product.name}</span>
                <span className="bookshelf__price">
                  {money(product.amount, product.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <p className="bookshelf__more">
        <Link href="/bookstore">
          {products.length > SHOWN
            ? `Browse all ${products.length} titles`
            : 'Visit the bookstore'}
          <span aria-hidden="true"> →</span>
        </Link>
      </p>
    </div>
  );
}
