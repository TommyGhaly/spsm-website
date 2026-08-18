'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShopProduct } from './shopData';

/** Integer minor units to "$8" / "$8.50". Whole dollars lose the ".00". */
export function money(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}

/** slug → quantity. Kept flat so it survives `JSON.stringify` unchanged. */
type Cart = Record<string, number>;

const CART_KEY = 'spsm.bookstore.cart';

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
export function Shop({ products }: { products: ShopProduct[] }) {
  const [cart, setCart] = useState<Cart>({});
  const [open, setOpen] = useState<ShopProduct | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
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
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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

  const add = useCallback(
    (product: ShopProduct) => setQuantity(product.slug, (cart[product.slug] ?? 0) + 1),
    [cart, setQuantity],
  );

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([slug, quantity]) => {
          const product = products.find((p) => p.slug === slug);
          return product ? { product, quantity } : null;
        })
        .filter((line): line is { product: ShopProduct; quantity: number } => line !== null),
    [cart, products],
  );

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.product.amount * line.quantity, 0);

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

      <ul className="shop">
        {products.map((product) => (
          <Card
            key={product.id}
            product={product}
            inCart={cart[product.slug] ?? 0}
            onOpen={() => setOpen(product)}
            onAdd={() => add(product)}
          />
        ))}
      </ul>

      {open && (
        <Dialog title={open.name} onClose={() => setOpen(null)}>
          <div className="sheet__body">
            <Cover product={open} className="sheet__cover" />
            <div className="sheet__detail">
              <h2 id="dialog-title" className="sheet__name">
                {open.name}
              </h2>
              <p className="sheet__price">{money(open.amount, open.currency)}</p>
              {open.description ? (
                <p className="sheet__blurb">{open.description}</p>
              ) : (
                <p className="sheet__blurb sheet__blurb--none">
                  No description has been added for this title.
                </p>
              )}
              {open.stockCount === 0 ? (
                <p className="note">Out of stock.</p>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    add(open);
                    setOpen(null);
                    setBasketOpen(true);
                  }}
                >
                  Add to basket
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {basketOpen && (
        <Dialog title="Your basket" onClose={() => setBasketOpen(false)}>
          <h2 id="dialog-title" className="sheet__name">
            Your basket
          </h2>

          {lines.length === 0 ? (
            <p className="note">Nothing in the basket yet.</p>
          ) : (
            <>
              <ul className="basket">
                {lines.map(({ product, quantity }) => (
                  <li key={product.slug} className="basket__line">
                    <Cover product={product} className="basket__cover" />
                    <div className="basket__text">
                      <p className="basket__name">{product.name}</p>
                      <p className="basket__each">{money(product.amount, product.currency)} each</p>
                    </div>
                    <label className="basket__qty">
                      <span className="visually-hidden">Quantity of {product.name}</span>
                      <input
                        type="number"
                        min={0}
                        max={20}
                        value={quantity}
                        onChange={(event) =>
                          setQuantity(product.slug, Number(event.target.value))
                        }
                      />
                    </label>
                    <p className="basket__sum">{money(product.amount * quantity, product.currency)}</p>
                  </li>
                ))}
              </ul>

              <p className="basket__total">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </p>

              <Checkout total={total} />
            </>
          )}
        </Dialog>
      )}
    </>
  );
}

function Cover({ product, className }: { product: ShopProduct; className: string }) {
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
        ? { srcSet: product.coverSrcSet, sizes: '(max-width: 48rem) 46vw, 14rem' }
        : {})}
      alt={product.name}
      loading="lazy"
      decoding="async"
    />
  );
}

function Card({
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
    <li className={soldOut ? 'shop-item shop-item--sold' : 'shop-item'}>
      {/*
        The frame is the button, so the whole picture is the hit target rather
        than a few words of title. The name below repeats inside it for the
        accessible name, which is why the visible copy is `aria-hidden`.
      */}
      <button type="button" className="shop-item__frame" onClick={onOpen}>
        <span className="visually-hidden">{product.name} — see details</span>
        <Cover product={product} className="shop-item__cover" />
        {soldOut && <span className="shop-item__flag">Sold out</span>}
      </button>

      <div className="shop-item__body">
        <h3 className="shop-item__name">{product.name}</h3>
        <p className="shop-item__price">{money(product.amount, product.currency)}</p>
        {!soldOut && (
          <button type="button" className="button button--quiet shop-item__add" onClick={onAdd}>
            {inCart > 0 ? `In basket (${inCart})` : 'Add to basket'}
          </button>
        )}
      </div>
    </li>
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

/**
 * Checkout.
 *
 * Card details are never handled here, and cannot be: taking a payment needs
 * the Square access token, which authorizes charges and so exists only in the
 * Cloud Functions runtime. This button hands off to that Function.
 *
 * Until it is deployed the request fails, and this says so plainly rather than
 * spinning — a shop that appears to take an order and silently drops it is
 * worse than one that admits it is not finished.
 */
function Checkout({ total }: { total: number }) {
  const [state, setState] = useState<'idle' | 'working' | 'unavailable'>('idle');

  return (
    <div className="checkout">
      <button
        type="button"
        className="button button--full"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          try {
            const response = await fetch('/api/square/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ total }),
            });
            if (!response.ok) throw new Error(String(response.status));
            const body: { url?: string } = await response.json();
            if (body.url) window.location.assign(body.url);
            else setState('unavailable');
          } catch {
            setState('unavailable');
          }
        }}
      >
        {state === 'working' ? 'Starting checkout…' : `Check out — ${money(total)}`}
      </button>

      {state === 'unavailable' && (
        <p className="note checkout__note">
          Online payment isn&apos;t switched on yet. The books are all available in the
          bookstore after Liturgy, and the office can hold any of them for you.
        </p>
      )}
    </div>
  );
}
