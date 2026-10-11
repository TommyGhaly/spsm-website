'use client';

import Link from 'next/link';
import { clearanceOf, sizesSoldOut } from '@spsm/shared';
import { DragRail } from '@/components/DragRail';
import type { ShopProduct } from './shopData';
import { Cover } from './Cover';
import { PriceTag } from './PriceTag';
import { useLiveCatalog } from './useLiveCatalog';

/**
 * How many covers the strip carries before it is just the whole shop again.
 *
 * Twelve rather than eight, at Tommy's direction, and the reason is the turning
 * rather than the titles. The shelf goes round by repeating itself, and the
 * fewer books in one repeat the sooner a reader watching it sees the same cover
 * come past again — which reads as three books on a carousel rather than as a
 * shelf that continues. Twelve is about two laptop-widths, so a full turn is
 * long enough not to feel like a loop.
 *
 * Still a preview and not the shop: with a catalog larger than this the strip is
 * a sample of it, and the link underneath says how many there are in total.
 */
const SHOWN = 12;

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
 * link to `/bookstore`.
 *
 * A client component since clearance, for one reason: the homepage is baked at
 * deploy, and a sale marked on the shop that afternoon would not reach it until
 * the next one. `useLiveCatalog` is the shop's own read — one REST query, no
 * SDK — so the badges and crossed-out prices here are the ones the shop shows.
 *
 * A dozen, not the whole catalog. Enough to read as a shelf that continues past
 * the edge of the screen, which is the invitation; all of them would just be the
 * shop.
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
export function BookshelfPreview({ products: baked }: { products: ShopProduct[] }) {
  const live = useLiveCatalog(baked);
  const products = live.products ?? baked;

  // No catalog, no section. An empty shelf under a heading saying "From the
  // bookstore" is a claim the parish sells nothing.
  if (products.length === 0) return null;

  const saleOf = (product: ShopProduct) =>
    clearanceOf({ wasPriceCents: product.wasPriceCents, amountCents: product.amount });
  /* What is on clearance leads the strip, so the discount is what a reader
     meets first — the same items the shop's Clearance toggle shows. */
  const onSale = products.filter(
    (product) => saleOf(product) && !(product.sizes ? sizesSoldOut(product.sizes) : product.stockCount === 0),
  );
  const shown = [...onSale, ...products.filter((product) => !onSale.includes(product))].slice(0, SHOWN);
  const deepest = Math.max(0, ...onSale.map((product) => saleOf(product)?.percentOff ?? 0));

  return (
    <div className="bookshelf">
      {/*
        `DragRail` rather than a bare `overflow-x`: the shelf turns on its own,
        loops, and is pulled by hand, with no scrollbar. The same component
        carries the ministries on /events and the clergy below — a reader who has
        learnt that one strip on this site is draggable has learnt all of them.

        It renders the strip more than once to make the loop seamless, so
        nothing in here may carry an `id`, and the trailing gap that joins one
        copy to the next is `.bookshelf__strip`'s own `padding-right`.

        ---------------------------------------------------------------------
        `loop` and `speed`, both at Tommy's direction: the shelf is meant to
        turn the way the ministries on /events do, and it was not.

        **`loop` is the part that was actually broken.** A rail only moves when
        one copy of its row overruns the viewport, and twelve books at 11rem is
        about 2400px — so the shelf turned on a laptop and stood perfectly still
        on a large monitor, with no way to tell that from the animation having
        failed. `loop` repeats a short row until it does overrun, so the turning
        no longer depends on how wide the window is or how many titles the parish
        happens to stock. The ministries never needed it because five plates at
        889px overrun everything.

        **`speed` is the part that was a matter of degree, and it has been
        settled twice.** The site's default is 75px/s and the ministries pass
        their own 225; this was 150, the middle of those two, and it came down to
        90 at Tommy's direction — the shelf was turning too quickly.

        The reason 150 was wrong is a thing the ministries hide: a plate is 889px
        and a book is 176, so at one speed the small object crosses the screen
        five times as often. Reading a title takes about as long either way, so
        what feels like a gentle drift on the photographs feels like a conveyor
        on the covers. 90 is close to the site's default, which is what a strip of
        small things wants.

        This is still the number to change if it wants to be calmer or brisker —
        it is a prop for exactly that reason, and nothing else on the site moves
        with it.
        ---------------------------------------------------------------------
      */}
      <DragRail className="rail--shelf" speed={90} loop>
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
                  {saleOf(product) && (
                    <span className="book__sale bookshelf__sale">{saleOf(product)?.percentOff}% off</span>
                  )}
                </span>
                <span className="bookshelf__name">{product.name}</span>
                <span className="bookshelf__price">
                  <PriceTag product={product} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </DragRail>

      <p className="bookshelf__more">
        {onSale.length > 0 && (
          <>
            <Link className="bookshelf__deal" href="/bookstore?clearance">
              Clearance{deepest > 0 ? `: up to ${deepest}% off` : ''}
              <span aria-hidden="true"> →</span>
            </Link>{' '}
          </>
        )}
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
