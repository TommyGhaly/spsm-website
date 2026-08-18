"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShopProduct } from "./shopData";
import { CardPayment } from "./CardPayment";
import { Icon } from "@/components/Icon";
import { Cover } from "./Cover";
import { money } from "./money";

export { money };

/** slug → quantity. Kept flat so it survives `JSON.stringify` unchanged. */
type Cart = Record<string, number>;

const CART_KEY = "spsm.bookstore.cart";

/**
 * The bookstore: a grid, a detail dialog, and a basket.
 *
 * A client component because all three are interactive, and because this is a
 * static export — there is no server at request time to hold a session, so the
 * basket lives in `localStorage` and the page it is on is the same HTML file
 * everyone gets.
 *
 * The dialog is the reason the grid is not just links. These books have no page
 * of their own: there is one paragraph of description and a price behind each,
 * which is not a page's worth of content, and a route per product would be
 * eleven more HTML files that each say four lines. A dialog shows the same
 * thing without the navigation.
 */
export function Shop({
  products,
  square,
}: {
  products: ShopProduct[];
  /** Public Web Payments values. Empty when checkout is not configured. */
  square: { applicationId: string; locationId: string; sandbox: boolean };
}) {
  const [cart, setCart] = useState<Cart>({});
  const [open, setOpen] = useState<ShopProduct | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [query, setQuery] = useState('');
  /*
   * What was bought, captured at the moment it was paid for.
   *
   * Not derivable afterwards: paying clears the basket, and the fulfilment
   * choice and email live inside `CardPayment` and go with it. Holding only the
   * order id is what made the confirmation screen a Square reference and two
   * sentences of hedging.
   */
  const [receipt, setReceipt] = useState<{
    orderId: string;
    email: string;
    shipping: boolean;
    lines: { name: string; quantity: number; amount: number }[];
    total: number;
  } | null>(null);
  /*
   * The basket is two screens, not one.
   *
   * Everything used to be on one: the lines on the left and the whole
   * payment form squeezed into a 19rem summary column beside them. No form
   * looks right in 19rem — the fields were narrower than the words above
   * them — and no amount of restyling fixes a column that narrow. Paying
   * now gets the whole dialog.
   */
  const [stage, setStage] = useState<'cart' | 'pay'>('cart');
  // Until this flips, the cart shown is empty even if storage has one. See the
  // note in the effect below.
  const [ready, setReady] = useState(false);

  /*
   * Read storage after mount, never during render.
   *
   * The page is prerendered at build time, so the server's HTML has an empty
   * cart in it. Reading `localStorage` during the first client render would
   * produce different markup and React would discard the whole tree as a
   * hydration mismatch. One frame with an empty badge is the price of that.
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CART_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCart(parsed as Cart);
        }
      }
    } catch {
      // A corrupt or unavailable store (private browsing, quota) must not take
      // the shop down — an empty basket is a recoverable state.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      /* Nothing to do: the basket still works for this visit. */
    }
  }, [cart, ready]);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    setCart((current) => {
      const next = { ...current };
      // Capped at 20: this is a parish bookstore, and an unbounded number field
      // is how someone orders 9,999 Bibles by leaning on a key.
      const bounded = Math.max(0, Math.min(20, Math.trunc(quantity)));
      if (bounded === 0) delete next[slug];
      else next[slug] = bounded;
      return next;
    });
  }, []);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([slug, quantity]) => {
          const product = products.find((p) => p.slug === slug);
          return product ? { product, quantity } : null;
        })
        .filter(
          (line): line is { product: ShopProduct; quantity: number } =>
            line !== null,
        ),
    [cart, products],
  );

  /*
   * What to offer next, in the basket.
   *
   * The basket was a dead end that only counted: it told you what you had
   * chosen and pointed at Checkout. But the moment someone has decided to buy
   * one book from a parish shop is the moment they are most likely to take a
   * second, and nothing was putting one in front of them.
   *
   * No recommendation data exists here and none is invented. This is the rest
   * of the shelf, minus what is already in the basket and minus anything sold
   * out — which on a catalog of eleven is the honest version of "you might also
   * like". Capped at six so it stays a shelf rather than a second catalogue.
   */
  const alsoBuy = useMemo(
    () =>
      products
        .filter((product) => !cart[product.slug] && product.stockCount !== 0)
        .slice(0, 6),
    [cart, products],
  );

  /*
   * Matched on the title and the description, both lowercased, on every
   * keystroke. Eleven books need no index, no debounce and no request — the
   * whole catalog is already in memory, and a search that waits 300ms to filter
   * a list this size only feels broken.
   */
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? products.filter(
        (product) =>
          product.name.toLowerCase().includes(needle) ||
          product.description.toLowerCase().includes(needle),
      )
    : products;

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce(
    (sum, line) => sum + line.product.amount * line.quantity,
    0,
  );

  return (
    <div className="shop-page">
      {/*
        One row: the name of the shop, the search, and the basket.
        
        It was a block — a heading, a sentence beneath it, and a full-width
        search bar under that — which is three stacked things where a shop needs
        a bar. Everything here is a control or a label for one, so they belong on
        a line together, and the whole band comes down to about half the height.
      */}
      <div className="shop-head">
        <h2 className="shop-head__title">Bookstore</h2>

        <div className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${products.length} titles`}
            aria-label="Search the bookstore"
          />
          {query && (
            <button type="button" className="search__clear" onClick={() => setQuery('')}>
              Clear
            </button>
          )}
        </div>

        <button
          type="button"
          className="shop-head__basket"
          onClick={() => setBasketOpen(true)}
          aria-haspopup="dialog"
        >
          <Icon name="gift" size={16} />
          <span className="shop-head__basketword">Basket</span>
          {/* Only when there is something in it: an empty shop showing a zero
              reads like a broken counter. */}
          {count > 0 && <span className="shop-head__count">{count}</span>}
        </button>
      </div>

      {/*
        How a book actually reaches someone, said once, above the books.

        These are the two questions a parish bookshop is asked before any other
        — can I pick it up on Sunday, and will you post it — and the answers
        were buried three screens down inside a basket nobody had opened yet.
      */}
      <p className="shop-note">
        Collect your order at the church, or have it posted to you.
      </p>

      {needle && (
        <p className="shop-count" aria-live="polite">
          {shown.length === 0
            ? `Nothing matches \u201C${query.trim()}\u201D.`
            : `${shown.length} of ${products.length} titles`}
        </p>
      )}

      <ul className="shelf">
        {shown.map((product) => (
          <Book
            key={product.id}
            product={product}
            inCart={cart[product.slug] ?? 0}
            onOpen={() => setOpen(product)}
            onAdd={() => setQuantity(product.slug, (cart[product.slug] ?? 0) + 1)}
          />
        ))}
      </ul>

      {open && (
        <Detail
          product={open}
          inCart={cart[open.slug] ?? 0}
          others={products.filter((p) => p.slug !== open.slug)}
          onPick={setOpen}
          onClose={() => setOpen(null)}
          onAdd={(quantity) => {
            setQuantity(open.slug, (cart[open.slug] ?? 0) + quantity);
            setOpen(null);
            setBasketOpen(true);
          }}
        />
      )}

      {basketOpen && (
        <Dialog
          title={stage === 'pay' ? 'Checkout' : 'Your basket'}
          /*
           * Two different shapes, and the modifier is what says which.
           *
           * The basket is one narrow column — a ledger. The checkout is a
           * recap beside a payment form, which needs the width. Sizing the
           * sheet for the wider of the two and letting the basket rattle
           * around inside it is what made the basket look broken: a title at
           * one edge, its price at the other, and a void between them.
           */
          className={stage === 'pay' ? 'sheet--pay' : 'sheet--basket'}
          heading={stage === 'pay' ? 'Checkout' : 'Your basket'}
          screen={receipt ? 'paid' : stage}
          {...(stage === 'pay'
            ? { back: { label: 'Back to basket', onBack: () => setStage('cart') } }
            : {})}
          onClose={() => {
            setBasketOpen(false);
            setStage('cart');
          }}
        >
          {receipt ? (
            /*
             * What happened, what was bought, and what to do now.
             *
             * This screen used to be a thank-you, a sentence saying the parish
             * "will be in touch about collection or postage", and a raw
             * 29-character Square order id under the word "Order". Every part
             * of that was either hedged or machine-facing: the reader had
             * already *chosen* collection or postage two screens earlier, so
             * being told the parish would be in touch about which one read as
             * though the choice had not registered.
             *
             * It answers the four things somebody actually wants at this point
             * — did it go through, what did I buy, where does it come from, and
             * what do I do next — and keeps the reference at the bottom in
             * small type, because it matters only if something goes wrong.
             */
            <div className="done">
              <p className="done__mark" aria-hidden="true">
                ✓
              </p>

              <h3 className="done__title">Your order is placed</h3>

              {/* The fulfilment they chose, stated back to them. */}
              <p className="done__lede">
                {receipt.shipping
                  ? 'It will be posted to you. Allow a few days — the parish packs orders by hand.'
                  : 'It will be waiting for you at the bookstore. Collect it after any Liturgy.'}
              </p>

              <ul className="done__lines">
                {receipt.lines.map((line) => (
                  <li key={line.name}>
                    <span className="done__qty">{line.quantity}×</span>
                    <span className="done__name">{line.name}</span>
                    <span className="done__sum">{money(line.amount)}</span>
                  </li>
                ))}
              </ul>

              <p className="done__total">
                <span>Paid</span>
                <strong>{money(receipt.total)}</strong>
              </p>

              <p className="done__receipt">
                A receipt is on its way to <strong>{receipt.email}</strong>.
              </p>

              <button
                type="button"
                className="basket__pay"
                onClick={() => {
                  setBasketOpen(false);
                  setStage('cart');
                  setReceipt(null);
                }}
              >
                Back to the bookstore
              </button>

              {/* Last, and small. Nobody needs this unless something goes
                  wrong, and then they need to be able to select it. */}
              <p className="done__ref">
                Reference <code>{receipt.orderId}</code>
              </p>
            </div>
          ) : lines.length === 0 ? (
            <div className="basket__empty">
              <p className="basket__emptytitle">Your basket is empty</p>
              <p className="basket__emptynote">
                Books can be collected at the church or posted to you.
              </p>
              <button
                type="button"
                className="basket__pay"
                onClick={() => setBasketOpen(false)}
              >
                Browse the bookstore
              </button>
            </div>
          ) : stage === 'cart' ? (
            /*
             * One column, top to bottom: what you have, what it comes to, how
             * to pay, and then — after the decision is made, not across it —
             * the offer of one more book.
             *
             * This replaced a two-column basket with the lines on the left and
             * a sticky summary on the right. That shape is for a cart of forty
             * items where the total has to follow you down the page. A parish
             * basket holds one to three books, so the second column bought
             * nothing and cost everything: it squeezed the lines until every
             * title sat a hand's width from its own price, and left a column of
             * dead paper beside them.
             */
            <div className="basket">
              <ul className="basket__lines">
                {lines.map(({ product, quantity }) => (
                  <li key={product.slug} className="basket__line">
                    <Cover product={product} className="basket__cover" />

                    <p className="basket__name">{product.name}</p>

                    {/* The unit price, not "In stock". Every line said in
                        stock, which is true of everything in the shop and so
                        tells the reader nothing; what they want to check
                        against the line total is what one of them costs. */}
                    <p className="basket__each">
                      {money(product.amount, product.currency)} each
                    </p>

                    {/* The controls and the line total share a row, so the
                        money lands at the foot of the line rather than opposite
                        the title with a gap between. Every line is the height
                        of its cover, so the totals still form a column. */}
                    <div className="basket__foot">
                      <div className="stepper stepper--sm">
                        <button
                          type="button"
                          onClick={() => setQuantity(product.slug, quantity - 1)}
                          aria-label={`One fewer ${product.name}`}
                        >
                          −
                        </button>
                        <span aria-live="polite">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => setQuantity(product.slug, quantity + 1)}
                          aria-label={`One more ${product.name}`}
                          disabled={quantity >= 20}
                        >
                          +
                        </button>
                      </div>

                      {/* Setting the quantity to zero removes it, so there is
                          one code path for "how many of this" rather than a
                          second one that deletes. */}
                      <button
                        type="button"
                        className="basket__remove"
                        onClick={() => setQuantity(product.slug, 0)}
                      >
                        Remove
                      </button>

                      <p className="basket__sum">
                        {money(product.amount * quantity, product.currency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="basket__total">
                <span className="basket__totallabel">Subtotal</span>
                <strong className="basket__totalsum">{money(total)}</strong>
                <span className="basket__totalnote">
                  {count} {count === 1 ? 'book' : 'books'} · postage, if you
                  choose it, is added at the next step
                </span>
              </div>

              <button
                type="button"
                className="basket__pay"
                onClick={() => setStage('pay')}
              >
                Checkout
              </button>

              {/* The way back. Without it the only exit from a basket is the
                  close cross, which reads as abandoning the order rather than
                  going to find another book. */}
              <button
                type="button"
                className="basket__keep"
                onClick={() => setBasketOpen(false)}
              >
                Keep browsing
              </button>

              {/*
                Below the button, not above it.

                The offer of a second book belongs after the decision to buy the
                first, never across it — anything between the lines and the
                total interrupts someone adding up. The dialog is short enough
                that this is still on screen when they get there.
              */}
              {alsoBuy.length > 0 && (
                <div className="addmore">
                  <h3 className="addmore__title">Add another book</h3>
                  <div className="addmore__viewport scroller">
                    <ul className="addmore__strip">
                      {alsoBuy.map((product) => (
                        <li key={product.slug}>
                          {/* One tap adds it and it leaves this strip, because
                              `alsoBuy` excludes whatever is in the basket — so
                              the offer never repeats a book already taken. */}
                          <button
                            type="button"
                            className="addmore__book"
                            onClick={() =>
                              setQuantity(product.slug, (cart[product.slug] ?? 0) + 1)
                            }
                          >
                            <Cover product={product} className="addmore__cover" />
                            <span className="addmore__name">{product.name}</span>
                            <span className="addmore__price">
                              {money(product.amount, product.currency)}
                            </span>
                            <span className="addmore__add" aria-hidden="true">
                              Add
                            </span>
                            <span className="visually-hidden">
                              Add {product.name} to your basket
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="paying">
              {/* A recap rather than the editable list: quantities are settled
                  by this point, and a stepper beside a card form invites
                  changing the total mid-payment. */}
              <div className="recap">
                <ul className="recap__lines">
                  {lines.map(({ product, quantity }) => (
                    <li key={product.slug}>
                      <span className="recap__qty">{quantity}×</span>
                      <span className="recap__name">{product.name}</span>
                      <span className="recap__sum">
                        {money(product.amount * quantity, product.currency)}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="recap__total">
                  <span>Total</span>
                  <strong>{money(total)}</strong>
                </p>
              </div>

              <CardPayment
                cart={lines.map((line) => ({
                  slug: line.product.slug,
                  quantity: line.quantity,
                }))}
                total={total}
                applicationId={square.applicationId}
                locationId={square.locationId}
                sandbox={square.sandbox}
                onPaid={(orderId, detail) => {
                  // Read `lines` and `total` before clearing: they are derived
                  // from the cart, so after `setCart({})` there is nothing left
                  // to tell anyone what they just bought.
                  setReceipt({
                    orderId,
                    email: detail.email,
                    shipping: detail.shipping,
                    lines: lines.map(({ product, quantity }) => ({
                      name: product.name,
                      quantity,
                      amount: product.amount * quantity,
                    })),
                    total,
                  });
                  // Cleared here rather than on the server's word alone: the
                  // order exists in Firestore by this point, so a basket that
                  // survived would let someone pay for the same books twice.
                  setCart({});
                }}
              />
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

/**
 * One book, as a card on the shelf.
 *
 * ---------------------------------------------------------------------------
 * **A card, reversing the row this replaced — and the reasoning it reverses
 * was not wrong, it was answering a different question.**
 *
 * The row existed because the parish's covers are phone snaps of books on a
 * table, and any layout that shows them large makes those flaws the subject of
 * the page. True. What eleven rows then produced, though, was a 40px thumbnail,
 * a title, and a price at the far end of an empty gutter — a stock report.
 * Nothing on it made anyone want a book, and wanting a book is the whole job of
 * a shop.
 *
 * The photographs survive being shown large, because the fix for a crooked
 * snapshot is not to shrink it: it is to frame it. Every cover sits in a tile
 * of the same shape, cropped to fill, with a spine down its left edge and a
 * shadow under it. Framed identically eleven times, the differences in how they
 * were taken stop reading as eleven mistakes and start reading as eleven books.
 *
 * The horizontal strip that used to sit above the rows is gone with them: it
 * held the same eleven covers in the same order as the list beneath it, and one
 * catalogue shown twice cannot justify the second showing.
 * ---------------------------------------------------------------------------
 *
 * The cover and title open the book; `Add` is its own control in the footer,
 * which is why the card is a `div` of two buttons rather than one big button —
 * a button cannot contain another one.
 */
function Book({
  product,
  inCart,
  onOpen,
  onAdd,
}: {
  product: ShopProduct;
  inCart: number;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const soldOut = product.stockCount === 0;

  return (
    <li className="book">
      {/* `title` because the card's own heading is clamped to three lines —
          Square's longest runs to five. The whole of it is in the dialog this
          opens, and here on hover. */}
      <button
        type="button"
        className="book__open"
        onClick={onOpen}
        title={product.name}
      >
        <span className="book__frame">
          <Cover product={product} className="book__cover" />
          {/* The shadow in the gutter of a book standing upright — the one
              piece of pure ornament here, and what gives a flat rectangle of
              photograph a thickness. */}
          <span className="book__spine" aria-hidden="true" />

          {/* Only ever rendered when there is something to say. A badge that is
              usually blank is furniture. */}
          {soldOut ? (
            <span className="book__flag book__flag--out">Sold out</span>
          ) : (
            inCart > 0 && <span className="book__flag">{inCart} in basket</span>
          )}
        </span>

        <span className="book__title">{product.name}</span>
        {/* Where Square carries one — nine of the eleven have none, and an
            empty line reads better than an invented one. */}
        {product.description && (
          <span className="book__blurb">{product.description}</span>
        )}
      </button>

      <div className="book__foot">
        {/* The price stays even when the book does not: a sold-out title still
            costs what it costs, and the flag on the cover is what says it is
            gone. */}
        <p className="book__price">{money(product.amount, product.currency)}</p>

        {soldOut ? (
          <span className="book__gone">Unavailable</span>
        ) : (
          <button type="button" className="book__add" onClick={onAdd}>
            {inCart > 0 ? "Add another" : "Add to basket"}
          </button>
        )}
      </div>
    </li>
  );
}

/** How far the cover magnifies under the pointer. */
const ZOOM = 2.6;

/**
 * The gallery: one image, magnified in place.
 *
 * ---------------------------------------------------------------------------
 * The lens used to be wrong, and the reason is worth keeping.
 *
 * It was positioned as a percentage of the *plate*, while the panel read a
 * percentage of the *image* — and the image sat inside the plate's padding,
 * letterboxed by `contain`, so the two were never the same rectangle. The lens
 * pointed at one part of the cover and the panel showed another.
 *
 * The plate now has no padding and the covers are square, so the frame and the
 * picture are the same box and one percentage means one thing to both. That is
 * the whole fix: not better arithmetic, but removing the second rectangle.
 *
 * Three columns, left to right: the cover, the magnified view, then the text.
 * The magnifier has a column of its own, so it never covers the description —
 * and it sits immediately beside the cover, so the eye travels from the lens to
 * the enlargement without crossing the page.
 *
 * Idle, that column shows the cover at rest rather than standing empty. It is
 * the same picture larger, which is worth the space on a page whose entire
 * subject is one book, and it means the frame is already there when the pointer
 * arrives instead of appearing from nowhere.
 * ---------------------------------------------------------------------------
 */
function Gallery({ product }: { product: ShopProduct }) {
  const [index, setIndex] = useState(0);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const images = product.gallery;
  if (images.length === 0) {
    return (
      <div className="item__media">
        <Cover product={product} className="item__cover" />
      </div>
    );
  }

  const current = images[
    Math.min(index, images.length - 1)
  ] as ShopProduct["gallery"][number];
  const many = images.length > 1;
  const step = (by: number) =>
    setIndex((i) => (i + by + images.length) % images.length);

  return (
    <div className="item__media">
      <div className="item__gallery">
        <div
          className="item__plate"
          onMouseLeave={() => setPoint(null)}
          onMouseMove={(event) => {
            // The plate has no padding and the covers are square, so this box and
            // the picture inside it are the same rectangle — which is what makes
            // the lens and the panel agree.
            const box = event.currentTarget.getBoundingClientRect();
            const x = Math.min(
              100,
              Math.max(0, ((event.clientX - box.left) / box.width) * 100),
            );
            const y = Math.min(
              100,
              Math.max(0, ((event.clientY - box.top) / box.height) * 100),
            );
            setPoint({ x, y });
          }}
        >
          <img
            className="item__cover"
            src={current.src}
            alt={product.name}
            decoding="async"
          />

          {point && (
            <span
              className="item__lens"
              aria-hidden="true"
              style={{
                width: `${100 / ZOOM}%`,
                height: `${100 / ZOOM}%`,
                // Placed by its centre so it sits under the pointer, and clamped
                // to the frame so it cannot hang off the edge showing a region
                // the panel is not able to display.
                left: `clamp(0%, calc(${point.x}% - ${50 / ZOOM}%), ${100 - 100 / ZOOM}%)`,
                top: `clamp(0%, calc(${point.y}% - ${50 / ZOOM}%), ${100 - 100 / ZOOM}%)`,
              }}
            />
          )}

          {many && (
            <>
              <button
                type="button"
                className="item__step item__step--prev"
                onClick={() => step(-1)}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className="item__step item__step--next"
                onClick={() => step(1)}
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}
        </div>

        {/*
        Always shown, including for a book with a single photograph: the strip
        is what says "this is the gallery", and it should exist before a second
        image is added rather than appear from nowhere afterwards. The arrows
        above are the part held back, because an arrow that cannot move is a
        broken control where a lone thumbnail is a short list.
      */}
        <ul className="thumbs">
          {images.map((image, at) => (
            <li key={image.src}>
              <button
                type="button"
                className={
                  at === index ? "thumbs__pick is-current" : "thumbs__pick"
                }
                onClick={() => setIndex(at)}
                aria-label={`Image ${at + 1} of ${images.length}`}
                aria-current={at === index}
              >
                <img src={image.src} alt="" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/*
        The magnified view, rendered here and lifted into the middle column by
        the grid. Idle it shows the cover whole; under a pointer it shows the
        region the lens is over, at the same percentages against the same
        rectangle — which is what makes the two agree.
      */}
      <div
        className="item__zoompanel"
        aria-hidden="true"
        style={{
          backgroundImage: `url(${current.large})`,
          backgroundSize: point ? `${ZOOM * 100}%` : "contain",
          backgroundPosition: point ? `${point.x}% ${point.y}%` : "center",
        }}
      />
    </div>
  );
}

/**
 * One book, in full.
 *
 * Laid out the way a product page is: the cover large on the left, and a buy
 * box on the right carrying the price, the availability, the quantity and the
 * action, boxed off from the description. That arrangement is worth copying
 * because it answers, in one glance and in a fixed order, the four questions
 * someone has at this point — what is it, what does it cost, can I have it,
 * how do I get it.
 *
 * The cover earns its size here in a way it does not in the list. There is one
 * of them, it is the thing being considered, and nothing else on screen is
 * competing with it.
 */
function Detail({
  product,
  inCart,
  others,
  onPick,
  onClose,
  onAdd,
}: {
  product: ShopProduct;
  inCart: number;
  /** The rest of the shelf, for the cross-sell below. */
  others: ShopProduct[];
  onPick: (product: ShopProduct) => void;
  onClose: () => void;
  onAdd: (quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const soldOut = product.stockCount === 0;

  return (
    <Dialog title={product.name} onClose={onClose}>
      <div className="item">
        <Gallery product={product} />

        <div className="item__main">
          <h2 id="dialog-title" className="item__title">
            {product.name}
          </h2>

          <p className="item__price">
            {money(product.amount, product.currency)}
          </p>

          {product.description ? (
            <p className="item__blurb">{product.description}</p>
          ) : (
            <p className="item__blurb item__blurb--none">
              No description has been added for this title.
            </p>
          )}

          <div className="buybox">
            <p className="buybox__price">
              {money(product.amount, product.currency)}
            </p>

            <p
              className={
                soldOut ? "buybox__stock buybox__stock--out" : "buybox__stock"
              }
            >
              {soldOut ? "Out of stock" : "In stock at the parish bookstore"}
            </p>

            {!soldOut && (
              <>
                <div className="buybox__qty">
                  <span>Quantity</span>
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      aria-label="One fewer"
                      disabled={quantity <= 1}
                    >
                      −
                    </button>
                    {/* Text, not an input: the only reachable values are the ones
                        these two buttons produce, so there is nothing to
                        validate and no keyboard route to 9,999. */}
                    <span aria-live="polite">{quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                      aria-label="One more"
                      disabled={quantity >= 20}
                    >
                      +
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  className="buybox__add"
                  onClick={() => onAdd(quantity)}
                >
                  Add to basket
                </button>

                <p className="buybox__note">
                  Collect at the church, or have it posted.
                </p>
              </>
            )}

            {inCart > 0 && (
              <p className="buybox__in">{inCart} already in your basket</p>
            )}
          </div>
        </div>
      </div>

      {/*
        Somewhere to go next.

        Opening a book used to be a dead end: read it, add it or close. On a
        shelf of eleven, the reader who came for one title is the reader most
        likely to take a second, and nothing was offering them one. There is no
        recommendation data here and none is invented — this is simply the rest
        of the shelf, which on a catalog this size is the honest version of
        "you might also like".
      */}
      {others.length > 0 && (
        <div className="alsoin">
          <h3 className="alsoin__title">More from the bookstore</h3>
          <div className="alsoin__viewport scroller">
            <ul className="alsoin__strip">
              {others.map((other) => (
                <li key={other.slug}>
                  <button type="button" className="alsoin__book" onClick={() => onPick(other)}>
                    <Cover product={other} className="alsoin__cover" />
                    <span className="alsoin__name">{other.name}</span>
                    <span className="alsoin__price">{money(other.amount, other.currency)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/**
 * A modal, hand-rolled on `<dialog>`.
 *
 * `showModal()` rather than the `open` attribute: only the modal form gets the
 * top layer, the backdrop, focus trapping, and Escape-to-close from the
 * browser. Setting `open` renders a dialog that looks right and traps nothing.
 */
function Dialog({
  title,
  heading,
  back,
  screen,
  className,
  onClose,
  children,
}: {
  title: string;
  /**
   * The visible title in the bar, where the screen has one to show.
   *
   * Separate from `title`, which is only the accessible name. The product
   * dialog sets its own heading in the reading column, at display size, and
   * repeating it in the bar two lines above would be the same words twice —
   * so it passes nothing and gets a bar holding only the close.
   */
  heading?: string;
  /**
   * The way back to the previous screen, pinned in the bar beside the title.
   *
   * It used to sit at the top of the checkout's recap panel, which scrolls —
   * and on a phone, where that panel stacks above the payment form rather than
   * beside it, scrolls away completely. A way out of a payment screen should
   * not be something you have to scroll back up to find.
   */
  back?: { label: string; onBack: () => void };
  /**
   * Changes when the dialog swaps one screen for another, so the scroll can go
   * back to the top.
   *
   * The sheet scrolls, and the two screens it holds are different heights. Left
   * alone, Checkout pressed at the foot of a long basket landed you part-way
   * down the payment form, and Back landed you in the middle of the basket —
   * both of which read as the dialog having lost its place.
   */
  screen?: string;
  /** A width modifier, or empty. The basket and the product page want
      different ones. */
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [screen]);

  return (
    <dialog
      ref={ref}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-label={title}
      // Fires for Escape as well as `close()`, so both routes out land here.
      onClose={onClose}
      // Clicking the backdrop is a click on the dialog element itself; a click
      // on anything inside it stops at that child.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      {/*
        The bar is pinned and the close lives in it.

        Both of those were bugs. The close was absolutely positioned against the
        sheet, so it scrolled away with the content — and the heading, which was
        sticky, then slid over the top of it and hid it on the way past. The
        heading was not properly pinned either: its `top` was a negative offset,
        so it moved a couple of centimetres before it stuck, which reads as the
        header sliding around while you scroll.

        One sticky bar at `top: 0` holding both fixes both. It only works
        because the sheet's own padding moved to `.sheet__body`: a sticky child
        of a padded scroller sticks to the *padding* box, which leaves a strip
        above it for content to scroll through.
      */}
      <div className="sheet__bar">
        {back && (
          <button type="button" className="sheet__back" onClick={back.onBack}>
            <span aria-hidden="true">←</span> {back.label}
          </button>
        )}
        {heading && <h2 className="sheet__name">{heading}</h2>}
        <button
          type="button"
          className="sheet__close"
          onClick={() => ref.current?.close()}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="sheet__body">{children}</div>
    </dialog>
  );
}
