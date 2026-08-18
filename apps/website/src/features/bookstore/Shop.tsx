"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShopProduct } from "./shopData";
import { CardPayment } from "./CardPayment";

/**
 * Integer minor units to "$8.00".
 *
 * Cents always, including on whole dollars. This dropped them — "$15" rather
 * than "$15.00" — on the reasoning that a shop price reads cleaner short. It
 * does not: a column of prices where some carry cents and some do not stops
 * being a column, and "$15" reads as a label where "$15.00" reads as a price.
 * Every shop that takes money prints the cents.
 */
export function money(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

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
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null);
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

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce(
    (sum, line) => sum + line.product.amount * line.quantity,
    0,
  );

  return (
    <>
      <div className="shop-bar">
        <h2 className="shop-bar__title">Bookstore</h2>
        <button
          type="button"
          className="button button--quiet shop-bar__basket"
          onClick={() => setBasketOpen(true)}
          aria-haspopup="dialog"
        >
          Basket
          {/* Rendered only when there is something in it, so an empty shop does
              not show a zero that reads like a broken counter. */}
          {count > 0 && <span className="shop-bar__count">{count}</span>}
        </button>
      </div>

      <ul className="shelf">
        {products.map((product) => (
          <Row
            key={product.id}
            product={product}
            inCart={cart[product.slug] ?? 0}
            onOpen={() => setOpen(product)}
          />
        ))}
      </ul>

      {open && (
        <Detail
          product={open}
          inCart={cart[open.slug] ?? 0}
          onClose={() => setOpen(null)}
          onAdd={(quantity) => {
            setQuantity(open.slug, (cart[open.slug] ?? 0) + quantity);
            setOpen(null);
            setBasketOpen(true);
          }}
        />
      )}

      {basketOpen && (
        <Dialog title="Your basket" onClose={() => setBasketOpen(false)}>
          <h2 id="dialog-title" className="sheet__name">
            Your basket
          </h2>

          {paidOrderId ? (
            <div className="paid">
              <p className="paid__title">Thank you — your order is placed.</p>
              <p className="note">
                A receipt is on its way from Square. The parish will be in touch
                about collection or postage.
              </p>
              <p className="meta">Order {paidOrderId}</p>
            </div>
          ) : lines.length === 0 ? (
            <p className="note">Nothing in the basket yet.</p>
          ) : (
            <div className="cart">
              <ul className="cart__lines">
                {lines.map(({ product, quantity }) => (
                  <li key={product.slug} className="cart__line">
                    <Cover product={product} className="cart__cover" />

                    <div className="cart__text">
                      <p className="cart__name">{product.name}</p>
                      <p className="cart__stock">In stock</p>

                      <div className="cart__controls">
                        <div className="stepper stepper--sm">
                          <button
                            type="button"
                            onClick={() =>
                              setQuantity(product.slug, quantity - 1)
                            }
                            aria-label={`One fewer ${product.name}`}
                          >
                            −
                          </button>
                          <span aria-live="polite">{quantity}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setQuantity(product.slug, quantity + 1)
                            }
                            aria-label={`One more ${product.name}`}
                            disabled={quantity >= 20}
                          >
                            +
                          </button>
                        </div>

                        {/* Setting the quantity to zero is what removes it, so
                            there is one code path for "how many of this" rather
                            than a second one that deletes. */}
                        <button
                          type="button"
                          className="cart__remove"
                          onClick={() => setQuantity(product.slug, 0)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <p className="cart__sum">
                      {money(product.amount * quantity, product.currency)}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="summary">
                <p className="summary__line">
                  <span>
                    Subtotal ({count} {count === 1 ? "item" : "items"})
                  </span>
                  <strong>{money(total)}</strong>
                </p>
                <p className="summary__note">
                  Postage, if you choose it, is added at checkout.
                </p>
                <CardPayment
                  cart={lines.map((line) => ({
                    slug: line.product.slug,
                    quantity: line.quantity,
                  }))}
                  total={total}
                  applicationId={square.applicationId}
                  locationId={square.locationId}
                  sandbox={square.sandbox}
                  onPaid={(orderId) => {
                    // Cleared here rather than on the server's word alone: the
                    // order exists in Firestore by this point, so a basket that
                    // survived would let someone pay for the same books twice.
                    setCart({});
                    setPaidOrderId(orderId);
                  }}
                />
              </div>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}

function Cover({
  product,
  className,
}: {
  product: ShopProduct;
  className: string;
}) {
  if (!product.cover) {
    /*
     * No cover in Square. The title itself stands in — a plain binding, which
     * is an honest thing for a book to look like.
     *
     * This was the parish's cross, used as a generic "no image" mark. A cross
     * is not a decoration to scatter over missing data, and it said nothing
     * about which book was missing its picture.
     */
    return (
      <span className={`${className} cover--none`} aria-hidden="true">
        <span className="cover--none__title">{product.name}</span>
      </span>
    );
  }
  return (
    <img
      className={className}
      src={product.cover}
      {...(product.coverSrcSet
        ? {
            srcSet: product.coverSrcSet,
            sizes: "(max-width: 48rem) 46vw, 14rem",
          }
        : {})}
      alt={product.name}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * One book, as a row.
 *
 * ---------------------------------------------------------------------------
 * A list rather than a grid of covers, and the photographs are the reason.
 *
 * The parish's covers are phone snaps of books on a table — angled, lit
 * differently, with the desk visible behind several of them. Any layout that
 * makes them large makes those flaws the subject of the page, and a grid makes
 * them large by definition. At 40px they read as "which book is this", which is
 * all a reader needs from them and all these photographs can honestly carry.
 *
 * Eleven titles is also simply not a grid's worth of anything. A shop this size
 * is a list, the way a printed parish catalogue is a list.
 * ---------------------------------------------------------------------------
 *
 * The whole row is the button. `View` is a label on that affordance rather than
 * a control of its own — a second focusable thing inside the row would be a
 * second tab stop that goes exactly where the first one does.
 */
function Row({
  product,
  inCart,
  onOpen,
}: {
  product: ShopProduct;
  inCart: number;
  onOpen: () => void;
}) {
  const soldOut = product.stockCount === 0;

  return (
    <li className="shelf__item">
      <button type="button" className="shelf__row" onClick={onOpen}>
        <Cover product={product} className="shelf__thumb" />

        <span className="shelf__text">
          <span className="shelf__title">{product.name}</span>
          {/* The description where Square carries one — several titles have
              none, and an empty line reads better than an invented one. */}
          {product.description && (
            <span className="shelf__sub">{product.description}</span>
          )}
          {inCart > 0 && <span className="shelf__in">{inCart} in basket</span>}
        </span>

        <span className="shelf__price">
          {soldOut ? "Sold out" : money(product.amount, product.currency)}
        </span>

        <span className="shelf__view" aria-hidden="true">
          View
        </span>
      </button>
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
  onClose,
  onAdd,
}: {
  product: ShopProduct;
  inCart: number;
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
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      // Fires for Escape as well as `close()`, so both routes out land here.
      onClose={onClose}
      // Clicking the backdrop is a click on the dialog element itself; a click
      // on anything inside it stops at that child.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <button
        type="button"
        className="sheet__close"
        onClick={() => ref.current?.close()}
        aria-label="Close"
      >
        ×
      </button>
      {children}
    </dialog>
  );
}
