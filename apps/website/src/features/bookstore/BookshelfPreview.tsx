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
 *
 * ---------------------------------------------------------------------------
 * On the `__frame`/`__spine` pair, which is the difference between this reading
 * as a shelf and reading as a row of thumbnails.
 *
 * This was eight identical 9×12rem tiles floating on the band. Uniform boxes in
 * a line is the shape of a product grid, and the shop one click away already is
 * one — so the homepage was showing a duller version of a page it was meant to
 * be an invitation to. They are 11rem wide now, and about five fit a laptop
 * rather than eight: the covers are the argument, so they get the room.
 *
 * Three things changed, all of them borrowed from the shop's own card rather
 * than invented here:
 *
 *   - **The frame is a fixed-height slot and the book stands at the bottom of
 *     it.** The covers are no longer all the same height (see the `nth-child`
 *     rule in globals.css), so their tops are uneven and their bases line up —
 *     which is what a row of books on a shelf looks like. The slot is what
 *     keeps the captions below aligned regardless.
 *   - **`__spine` is the shop's `.book__spine`**: a darkening down the left
 *     edge that reads as the shadow in a book's gutter. It is what turns a
 *     rectangle of photograph into an object with a thickness.
 *   - **The shelf itself** is drawn in CSS across the whole strip, so it runs
 *     under every book and off the edge of the viewport with them.
 *
 * The spine is a `<span>` rather than a pseudo-element because the cover may be
 * an `<img>`, and an `<img>` cannot have one. `aria-hidden` because it is a
 * gradient describing a book's thickness, which is not information.
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
                <span className="bookshelf__frame">
                  <Cover
                    product={product}
                    className="bookshelf__cover"
                    sizes="11rem"
                  />
                  <span className="bookshelf__spine" aria-hidden="true" />
                </span>
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
