"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShopProduct } from "./shopData";
import { CardPayment } from "./CardPayment";
import { DragRail } from "@/components/DragRail";
import { Icon } from "@/components/Icon";
import { Cover } from "./Cover";
import { PendingEditsProvider, SaveBar, usePendingEdits } from "./pendingEdits";
import { money } from "./money";
import { track, trackProduct, trackSearch, trackViewOnce } from "./track";
import { Suspense, lazy } from "react";
import { Dialog } from "./Sheet";
import { useBookstoreAdmin } from "./useBookstoreAdmin";
import { useLiveCatalog } from "./useLiveCatalog";
import { useCatalogDocs } from "./useCatalogDocs";
import {
  groupProducts,
  UNSORTED_LABEL,
  type BookstoreConfig,
  type BookstoreSection,
  type DocOf,
  type Product,
} from "@spsm/shared";

/*
 * The whole orders-and-metrics section, kept out of the shop's own chunk.
 *
 * A static import here put its markup into the JavaScript every parishioner
 * downloads to look at books — measured at 39KB in the export build, rendering
 * nothing for all of them. It is only ever mounted behind a claim check, so
 * there is no case where a visitor needs a byte of it.
 */
const BookstoreAdmin = lazy(() =>
  import("./BookstoreAdmin").then((m) => ({ default: m.BookstoreAdmin })),
);

/*
 * The controls that appear on the shop while editing it.
 *
 * One module for all three — the bar over the shelf, the controls beside a
 * section heading, and the ones on a book — so that pressing Edit fetches once
 * and every card is drawing from the same already-loaded chunk. Behind `lazy`
 * because it pulls `adminData` and the Square catalog writes with it, and it is
 * fetched only once somebody has actually pressed Edit rather than merely being
 * allowed to. A volunteer who opens /bookstore to buy a book downloads none of
 * it.
 */
const CategoryPills = lazy(() =>
  import("./EditControls").then((m) => ({ default: m.CategoryPills })),
);
const AddProductTile = lazy(() =>
  import("./EditControls").then((m) => ({ default: m.AddProductTile })),
);
const ProductSettings = lazy(() =>
  import("./EditControls").then((m) => ({ default: m.ProductSettings })),
);
const ShopInspector = lazy(() =>
  import("./EditControls").then((m) => ({ default: m.ShopInspector })),
);

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
  products: bakedProducts,
  square,
  settings,
}: {
  products: ShopProduct[];
  /** Public Web Payments values. Empty when checkout is not configured. */
  square: { applicationId: string; locationId: string; sandbox: boolean };
  /**
   * The shop's own settings, as the build baked them.
   *
   * Rendered straight into the static HTML, so a visitor sees the parish's
   * wording with no request and no SDK.
   */
  settings: BookstoreConfig;
}) {
  /*
   * Whether to offer the orders-and-metrics drawer at the foot of the shop.
   *
   * False for every visitor, and cheaply so — this does not import
   * `firebase/auth`, it reads the session store the masthead already maintains.
   * See `useBookstoreAdmin`.
   */
  const admin = useBookstoreAdmin();
  /*
   * Whether the shop is being arranged rather than shopped, and which book the
   * editing column is describing.
   *
   * ---------------------------------------------------------------------------
   * Still plain local state rather than the galleries' `EditModeProvider`, even
   * though there is a column again. That context carries a five-branch
   * `Selection` union for an arbitrarily deep tree of sections, media and
   * levels; the shop selects a book or it selects the shop. `string | null` is
   * the whole of it, and widening the shared union to hold a slug would put a
   * bookstore concern in the signature of every gallery component.
   *
   * `null` means the shop itself, which is what the column shows when nothing is
   * picked — never an empty column, and never one full of instructions.
   * ---------------------------------------------------------------------------
   */
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  /*
   * What makes an edit show up on the shelf.
   *
   * Bumped after every successful write, which re-runs the live read below.
   * That is the whole mechanism: there is no second copy of the catalog in this
   * component to patch, so a rename, a new book, a removed one and a section
   * moved all arrive by the same path a visitor's page uses.
   */
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /*
   * `body.is-editing` is what narrows the page to leave room for the column —
   * see `.is-editing` in globals.css. On `body` rather than the article because
   * the column is `position: fixed` and the shelf is measured against the
   * viewport.
   *
   * Removed on the way out *and* on unmount: navigating away from the shop with
   * the column open would otherwise leave every other page padded. Selection is
   * dropped at the same time, so re-entering edit mode starts at the shop rather
   * than on whichever book was last looked at.
   */
  useEffect(() => {
    if (!editing) {
      setSelected(null);
      return;
    }
    document.body.classList.add('is-editing');
    return () => document.body.classList.remove('is-editing');
  }, [editing]);
  /* Every editing refusal lands here, once, above the shelf. */
  const [editError, setEditError] = useState<string | null>(null);
  /* The documents behind the shelf, for the one control that needs Square's own
     image URLs rather than the build's optimised covers. Staff-only, and only
     once Edit is on. */
  const docs = useCatalogDocs(editing, nonce);

  /*
   * The catalog as it is now, replacing the baked copy once it arrives.
   *
   * The page is prerendered, so without this a product added in the admin — or
   * a section renamed — would be invisible until somebody redeployed the site.
   * That is the same problem the homepage bulletin has and the same fix it uses.
   *
   * `products` and `sections` are taken together or not at all. Taking fresh
   * sections while keeping baked products would file books into headings that do
   * not match them; `useLiveCatalog` only ever reports both.
   */
  const live = useLiveCatalog(bakedProducts, true, nonce);
  const products = live.products ?? bakedProducts;
  const sections = live.sections ?? settings.sections;
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
          // The ref is the one the handlers read, so it has to be seeded too —
          // otherwise the first click after a reload computes its delta against
          // an empty basket and records an add for books already in it.
          cartRef.current = parsed as Cart;
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

  /*
   * The basket, mirrored outside React state.
   *
   * ---------------------------------------------------------------------------
   * This ref exists to solve two problems that pull in opposite directions.
   *
   * **Batching.** React coalesces a fast run of clicks into one render, so a
   * handler that computes `(cart[slug] ?? 0) + 1` from the render's `cart` sees
   * the same stale count every time — five clicks on + produced a basket of
   * one. The usual fix is to do the arithmetic inside the `setCart` updater,
   * where the previous value is passed in.
   *
   * **Side effects.** But recording the change cannot happen inside that
   * updater. React invokes updaters more than once — twice under StrictMode in
   * development, and again whenever it replays a render — and an updater is
   * required to be pure for exactly that reason. Tracking from inside one
   * doubled every cart figure, which was caught by clicking Add three times and
   * finding six events in Firestore.
   *
   * So the running quantity lives here instead. The handler reads and updates
   * it synchronously — once per click, because an event handler is not replayed
   * — records the delta, and hands the result to `setCart`. The updater goes
   * back to being pure, and the count stays right under batching.
   * ---------------------------------------------------------------------------
   */
  const cartRef = useRef<Cart>({});

  /** Apply a change to the basket, record it, and re-render. One place. */
  const applyCart = useCallback((slug: string, next: (before: number) => number) => {
    const before = cartRef.current[slug] ?? 0;
    // Capped at 20: this is a parish bookstore, and an unbounded number field
    // is how someone orders 9,999 Bibles by leaning on a key.
    const bounded = Math.max(0, Math.min(20, Math.trunc(next(before))));
    if (bounded === before) return;

    const updated = { ...cartRef.current };
    if (bounded === 0) delete updated[slug];
    else updated[slug] = bounded;
    cartRef.current = updated;

    const delta = bounded - before;
    if (delta > 0) trackProduct('cartAdd', slug, delta);
    else trackProduct('cartRemove', slug, -delta);

    setCart(updated);
  }, []);

  /** Set an exact quantity. Only the basket's remove control uses this. */
  const setQuantity = useCallback(
    (slug: string, quantity: number) => applyCart(slug, () => quantity),
    [applyCart],
  );

  /** Add to, or take from, what is in the basket now. Everything else. */
  const bumpQuantity = useCallback(
    (slug: string, by: number) => applyCart(slug, (before) => before + by),
    [applyCart],
  );

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

  /*
   * The search is recorded when someone stops typing, not on every keystroke.
   *
   * Filtering happens per keystroke because eleven books need no debounce, but
   * recording per keystroke would file "b", "bi", "bib", "bibl", "bible" as
   * five separate searches — and the four prefixes would swamp the one thing
   * the person actually looked for. Nine hundred milliseconds of stillness is
   * the closest this can get to "they finished typing" without a submit button.
   */
  const searchState = useRef({ needle, empty: shown.length === 0 });
  searchState.current = { needle, empty: shown.length === 0 };

  useEffect(() => {
    if (!needle) return;
    const settle = setTimeout(() => {
      const state = searchState.current;
      if (state.needle === needle) trackSearch(needle, state.empty);
    }, 900);
    return () => clearTimeout(settle);
  }, [needle]);

  /*
   * The shop's divisions, as filters rather than as headings.
   *
   * ---------------------------------------------------------------------------
   * The shelf used to be cut into one `<ul>` per section, stacked down the page.
   * Tommy's instruction is that dividing the catalog must not hide any of it —
   * *"after separating into categories the store should still show all of the
   * options but there should be category pills under the search bar that the
   * user can use to filter"* — and he is right about what the headings cost: a
   * shopper who does not know which heading a title sits under has to scan every
   * one of them, and the shop got longer with every category the parish added.
   *
   * So one grid, always, and a row of pills that narrows it. Everything is on
   * screen until somebody chooses otherwise.
   *
   * `groupProducts` still does the work, unchanged, because its three rules are
   * exactly the ones a pill row needs: an empty category is dropped, a book
   * whose category was deleted falls into the catch-all rather than off the
   * shop, and no categories at all means no divisions. It is applied to the
   * *whole* catalog rather than to the search results, so the pills and their
   * counts stay put while somebody types instead of rearranging under the
   * cursor.
   * ---------------------------------------------------------------------------
   */
  const pills = useMemo(() => groupProducts(products, sections), [products, sections]);

  /*
   * The row as a shopper sees it: every category the parish has made, in order,
   * whether or not anything is filed under it yet.
   *
   * ---------------------------------------------------------------------------
   * This used to be `pills` itself, gated on there being more than one of them,
   * and the reasoning was that a lone pill beside "All" is a choice between the
   * whole shop and the whole shop. True, and beside the point: it meant a
   * category could be made, be visible in Edit, be offered in every book's
   * Category menu — and be invisible to visitors, with nothing on the page to
   * say why. `groupProducts` dropping empty categories compounded it, so filing
   * every book into one category hid the row again.
   *
   * Tommy's instruction is that the row is furniture, not a conditional:
   * *"always under the search bar"*. So it is drawn from `sections`, exactly as
   * the editing row is, and the two now agree. A category with nothing in it
   * shows a `0` and leads to the "Nothing in this category" line below, which is
   * a truthful answer rather than a missing control.
   *
   * The catch-all keeps its old rule — it exists only when something is actually
   * unfiled, because a "Everything else (0)" pill describes nothing.
   * ---------------------------------------------------------------------------
   */
  const rowPills = useMemo(() => {
    const countOf = new Map(pills.map((group) => [group.id, group.items.length]));
    const row = sections.map((section) => ({
      id: section.id as string | null,
      label: section.label,
      count: countOf.get(section.id) ?? 0,
    }));

    const unfiled = pills.find((group) => group.id === null);
    if (unfiled) {
      row.push({ id: null, label: UNSORTED_LABEL, count: unfiled.items.length });
    }
    return row;
  }, [pills, sections]);

  /** Which pill is chosen. `undefined` is "All", which is not a section id. */
  const [pill, setPill] = useState<string | null | undefined>(undefined);

  /*
   * A pill that stops existing — its category deleted, or its last product
   * removed or re-filed — must not leave the shop filtered to nothing with no
   * way back.
   *
   * Measured against `sections` rather than against `pills`, because while
   * editing the row shows *every* category including the empty ones. Checking
   * `pills` would have snapped the filter back to All the moment somebody
   * selected a category they had just emptied — which is exactly when they are
   * looking at it.
   */
  useEffect(() => {
    if (pill === undefined) return;
    const stillThere =
      pill === null
        ? pills.some((group) => group.id === null)
        : sections.some((section) => section.id === pill);
    if (!stillThere) setPill(undefined);
  }, [pills, sections, pill]);

  const shownHere = useMemo(() => {
    if (pill === undefined) return shown;
    const inPill = new Set(
      (pills.find((group) => group.id === pill)?.items ?? []).map((item) => item.slug),
    );
    return shown.filter((product) => inPill.has(product.slug));
  }, [shown, pills, pill]);

  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce(
    (sum, line) => sum + line.product.amount * line.quantity,
    0,
  );

  return (
    <PendingEditsProvider onSaved={refresh} onError={setEditError}>
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
        The orders queue and the metrics, for the people who run the shop.

        Placed here — above the shelf rather than under it — because a volunteer
        who opens it came for it, and putting it after eleven book covers would
        mean scrolling the whole catalog to reach the thing they wanted. It is a
        single quiet control until pressed, so a volunteer browsing as a
        parishioner still sees the shop first.

        `ready` as well as `canReview`: while the session is still restoring both
        are false, and rendering on `canReview` alone would flash the control in
        a moment later for somebody who has the claim.
      */}
      {/*
        The two staff controls, in one corner and side by side.

        They are genuinely two things: the drawer *reviews* what happened —
        orders taken, what sold — and Edit *changes* what the shop is.

        **Wrapped, because both pills were `position: fixed` at the same
        `right`/`bottom` and landed exactly on top of each other.** That is the
        overlapping-pills bug the events bar was rebuilt to remove, reintroduced
        the moment a second control joined the corner.

        Its own pill rather than the galleries' `EditToggle`, which renders
        nothing while editing because Done lives in that feature's side column.
        There is no column here, so the one pill has to say both things.
      */}
      {admin.ready && (admin.canReview || admin.canEdit) && (
        <div className="shop-tools">
          {/*
            Two permissions, not one, and the corner may hold either alone.

            The drawer *reviews* — orders and figures — and is `canReview`, which
            the finance grant also opens. Edit *changes what the shop is* and is
            `canEdit`, which it does not: a treasurer who could rewrite the
            catalog would be a treasurer whose every save the rules refuse. See
            the head of useBookstoreAdmin.
          */}
          {admin.canReview && (
            <Suspense fallback={null}>
              <BookstoreAdmin />
            </Suspense>
          )}
          {admin.canEdit && (
            <EditToggle
              editing={editing}
              onToggle={() => setEditing((was) => !was)}
              onBlocked={setEditError}
            />
          )}
        </div>
      )}

      {/*
        The categories, under the search bar.

        Always, as soon as the parish has made a category — see `rowPills`. The
        row used to appear only when two of them held books, which meant a new
        category was visible in Edit and invisible to everybody else.

        While editing, the *same row* is rendered by `CategoryPills` with the
        editing affordances on the pills themselves — drag to reorder, rename in
        place, remove. There is no separate panel: one was built and Tommy took
        it out, *"there no reason to add a whole panel"*, which is right. A strip
        of chips under the pills was a second copy of the same row, and the
        parish would have had to look at one to understand the other.
      */}
      {editing ? (
        /* Every category, including the empty ones — see `CategoryPills`. */
        <Suspense fallback={null}>
          <CategoryPills
            groups={pills}
            sections={sections}
            total={products.length}
            active={pill}
            onPick={setPill}
            onChanged={refresh}
            onError={setEditError}
          />
        </Suspense>
      ) : (
        rowPills.length > 0 && (
          <div className="shop-filters" role="group" aria-label="Filter by category">
            <button
              type="button"
              className={pill === undefined ? 'shop-filter is-on' : 'shop-filter'}
              aria-pressed={pill === undefined}
              onClick={() => setPill(undefined)}
            >
              All
              <span className="shop-filter__n">{products.length}</span>
            </button>

            {rowPills.map((group) => (
              <button
                key={group.id ?? '__unfiled'}
                type="button"
                className={pill === group.id ? 'shop-filter is-on' : 'shop-filter'}
                aria-pressed={pill === group.id}
                onClick={() => setPill(group.id)}
              >
                {group.label || UNSORTED_LABEL}
                <span className="shop-filter__n">{group.count}</span>
              </button>
            ))}
          </div>
        )
      )}

      {/*
        How this screen works, said once.

        It used to answer "why can I not change the title", which is no longer a
        question — the title is editable now. What a volunteer needs told instead
        is where the controls went: the cards carry none, and pressing one opens
        the column. That is not discoverable by looking at a shelf of covers.

        The price and description are still Square's, and still worth naming here
        rather than only inside the column, for the same reason the error notice
        lives here: it is the one place that is true of every book, so it does
        not need repeating on each of them.
      */}
      {editing && (
        <p className="shop-hint">
          Press a book to change it in the panel on the right. Title, price and
          description go straight to Square; stock, category and pictures are
          saved with the bar at the foot of the shop.
        </p>
      )}

      {/* One place for every refusal, so no control needs its own error slot. */}
      {editError && (
        <div className="notice notice--alarm" role="alert">
          <p>{editError}</p>
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={() => setEditError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {(needle || pill !== undefined) && (
        <p className="shop-count" aria-live="polite">
          {shownHere.length === 0
            ? needle
              ? `Nothing matches \u201C${query.trim()}\u201D.`
              : 'Nothing in this category.'
            : `${shownHere.length} of ${products.length} titles`}
        </p>
      )}

      {/*
        One shelf per section, in the order the parish chose.

        `groupProducts` decides what appears and what does not — an empty
        section is dropped, and a product whose section was deleted falls into
        an unfiled group rather than off the shop. All of that is pinned in
        tests/unit/shopSections.test.ts, because every one of those rules is a
        way to lose a book.

        While a search is running the divisions are suppressed: matches scattered
        under five headings, most of them empty, is a worse answer than a single
        list of what matched.
      */}
      {/*
        One grid, whatever the categories are. The pills above narrow it; nothing
        below is ever split into a second shelf.
      */}
      <ul className={editing ? 'shelf is-editing' : 'shelf'}>
        {shownHere.map((product) => (
          <Book
            key={product.id}
            product={product}
            inCart={cart[product.slug] ?? 0}
            editing={editing}
            selected={editing && selected === product.slug}
            onOpen={() => {
              /*
               * While editing, pressing a card selects it into the column
               * instead of opening the shopper's enlarged view. Pressing the
               * selected one again goes back to the shop's own settings, so the
               * card is a toggle rather than a one-way trip — the column's
               * "Back to the shop" says the same thing, but the card is where
               * the hand already is.
               */
              if (editing) {
                setSelected((was) => (was === product.slug ? null : product.slug));
                return;
              }
              trackProduct('detail', product.slug);
              setOpen(product);
            }}
            onAdd={() => bumpQuantity(product.slug, 1)}
          />
        ))}

      </ul>

      {/*
        How an order reaches someone, and what happens if it arrives wrong —
        together, at the foot of the page.

        Both were above the shelf, on the argument that these are the two
        questions a parish bookshop is asked before any other. Tommy has moved
        them here, and the reason the old placement was wrong is the same for
        both: they are three lines of small print between the shop's name and a
        single book, and a shop that opens with terms reads as one bracing for a
        complaint. Someone who wants either can always find them at the end, and
        the order lookup has its own page besides.
      */}
      <div className="shop-foot">
        <p className="shop-note">
          {settings.fulfilmentNote}{' '}
          <a href="/bookstore/orders">Check an order</a>.
        </p>

        {/*
        The returns policy.

        It used to sit above the shelf, on the argument that a policy belongs
        before the money rather than after it. Tommy has moved it here, and the
        reason it was wrong up there is worth keeping: it is the third paragraph
        of small print a shopper meets *before* seeing a single book, and a
        parish bookshop that opens with two disclaimers reads as a shop bracing
        for a complaint.

        What it says is unchanged, and both halves still go together. The parish
        does not take returns — a volunteer-run bookshop cannot run a returns
        desk — but a book that arrives damaged or is the wrong one is the
        parish's mistake to put right, and refusing that under cover of a blanket
        policy is not something a church should do.

        Still plain text and still not a link: the whole of it is two sentences,
        and a policy behind a click is a policy nobody has read.
      */}
        <p className="shop-terms">{settings.returnsNotice}</p>
      </div>

      {open && (
        <Detail
          /*
           * Re-resolved from the live list every render rather than shown as it
           * was when the card was clicked.
           *
           * `open` is a snapshot, and while editing the whole point is that the
           * thing on screen changes underneath it — a picture added, a count
           * nudged, a category filed. Without this the enlarged settings would
           * go on describing the book as it was when the dialog opened, and a
           * photograph you had just removed would still be sitting there. Falls
           * back to the snapshot for the moment between an archive landing and
           * the dialog closing.
           */
          product={products.find((p) => p.slug === open.slug) ?? open}
          inCart={cart[open.slug] ?? 0}
          others={products.filter((p) => p.slug !== open.slug)}
          editing={editing}
          doc={docs.get(open.slug)}
          sections={sections}
          onChanged={refresh}
          onError={setEditError}
          onPick={(product) => {
            trackProduct('detail', product.slug);
            setOpen(product);
          }}
          onClose={() => setOpen(null)}
          onAdd={(quantity) => {
            bumpQuantity(open.slug, quantity);
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
             * "will be in touch about collection or delivery", and a raw
             * 29-character Square order id under the word "Order". Every part
             * of that was either hedged or machine-facing: the reader had
             * already *chosen* collection or delivery two screens earlier, so
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
                  ? 'It will be delivered to you. Allow a few days — the church packs orders by hand.'
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
                  wrong, and then they need to be able to select it.

                  It is also the buyer's only credential: /bookstore/orders
                  takes this number and the address above and shows them where
                  the order has got to. There is no account to sign in to —
                  see OrderLookup.tsx — so saying where the number is used
                  belongs here, next to the number. */}
              <p className="done__ref">
                Reference <code>{receipt.orderId}</code>
              </p>
              <p className="done__track">
                Keep it: with the address above it shows you{' '}
                <a href="/bookstore/orders">where your order has got to</a>.
              </p>
            </div>
          ) : lines.length === 0 ? (
            <div className="basket__empty">
              <p className="basket__emptytitle">Your basket is empty</p>
              <p className="basket__emptynote">
                Books can be collected at the church or delivered to you.
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
                          onClick={() => bumpQuantity(product.slug, -1)}
                          aria-label={`One fewer ${product.name}`}
                        >
                          −
                        </button>
                        <span aria-live="polite">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => bumpQuantity(product.slug, 1)}
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
                  {count} {count === 1 ? 'book' : 'books'} · delivery, if you
                  choose it, is added at the next step
                </span>
              </div>

              <button
                type="button"
                className="basket__pay"
                onClick={() => {
                  // One per basket that reaches the card form. Paired with the
                  // orders for that day, this is the drop-off rate.
                  for (const line of lines) track({ kind: 'checkoutStart', slug: line.product.slug });
                  setStage('pay');
                }}
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
                  {/* Draggable and endless, but it does not walk along by
                      itself — see the note by `.alsoin__strip` in globals.css. */}
                  <DragRail className="rail--strip" drift={false}>
                    <ul className="addmore__strip">
                      {alsoBuy.map((product) => (
                        <li key={product.slug}>
                          {/* One tap adds it and it leaves this strip, because
                              `alsoBuy` excludes whatever is in the basket — so
                              the offer never repeats a book already taken. */}
                          <button
                            type="button"
                            className="addmore__book"
                            onClick={() => bumpQuantity(product.slug, 1)}
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
                  </DragRail>
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

                {/* "Subtotal", not "Total". The delivery charge is chosen a
                    step below this and named there; two figures both called the
                    total, one of them smaller, is how a checkout stops being
                    trusted. */}
                <p className="recap__total">
                  <span>Subtotal</span>
                  <strong>{money(total)}</strong>
                </p>
              </div>

              <CardPayment
                cart={lines.map((line) => ({
                  slug: line.product.slug,
                  quantity: line.quantity,
                }))}
                total={total}
                /*
                 * The live figure when there is one, the baked one otherwise.
                 *
                 * It has to be live. The checkout Function reads
                 * `config/bookstore` at the moment it charges, and this is what
                 * the payer is shown and — for Apple Pay and Google Pay — what
                 * they authorize with a thumbprint. A value baked at the last
                 * deploy is a number the parish may have changed since, and the
                 * two disagreeing is the parish charging more than it displayed.
                 */
                deliveryCents={live.deliveryCents ?? settings.deliveryCents}
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

      {/* Fixed to the window, so it never moves the shelf. Renders nothing
          until an edit is held — see pendingEdits.tsx. */}
      {/*
        The editing column, and the bar that sends what it holds.

        Both are fixed and portalled out of the article, so their order here is
        source order only. The column is `Suspense`-wrapped like every other
        editing chunk — a volunteer who opens /bookstore to buy a book downloads
        none of it.
      */}
      {editing && (
        <Suspense fallback={null}>
          <ShopInspector
            editing={editing}
            product={selected ? products.find((p) => p.slug === selected) : undefined}
            doc={selected ? docs.get(selected) : undefined}
            sections={sections}
            groups={pills.map((group) => ({
              id: group.id ?? '',
              label: group.label || UNSORTED_LABEL,
              count: group.items.length,
            }))}
            onDone={() => setEditing(false)}
            onSelect={setSelected}
            onChanged={refresh}
            onError={setEditError}
          >
            <AddProductTile
              variant="panel"
              sections={sections}
              onChanged={refresh}
              onError={setEditError}
            />
          </ShopInspector>
        </Suspense>
      )}

      {editing && <SaveBar />}
      </div>
    </PendingEditsProvider>
  );
}

/**
 * "Edit the shop" / "Done", and the one thing Done must not do.
 *
 * ---------------------------------------------------------------------------
 * Its own component because it has to read the held edits, and the provider
 * wraps what `Shop` *returns* — a `usePendingEdits()` in Shop's own body would
 * run above the provider and always see an empty set.
 *
 * Leaving edit mode with changes still held would throw them away silently, and
 * the person doing it would have no way of knowing: the cards would simply go
 * back to the saved numbers. So Done refuses while anything is waiting and says
 * why. It does not offer to save for you — Save and Discard are both already on
 * the bar, and quietly choosing one of them on somebody's behalf is how a stock
 * count nobody agreed to ends up in Square.
 * ---------------------------------------------------------------------------
 */
function EditToggle({
  editing,
  onToggle,
  onBlocked,
}: {
  editing: boolean;
  onToggle: () => void;
  onBlocked: (message: string) => void;
}) {
  const { count } = usePendingEdits();
  const held = editing && count > 0;

  return (
    <button
      type="button"
      className={editing ? 'shop-edit is-on' : 'shop-edit'}
      aria-pressed={editing}
      title={held ? 'Save or discard your changes first' : undefined}
      onClick={() => {
        if (held) {
          onBlocked(
            `${count} ${count === 1 ? 'book has' : 'books have'} changes that have not been ` +
              'saved. Save or discard them before leaving edit mode.',
          );
          return;
        }
        onToggle();
      }}
    >
      {editing ? 'Done' : 'Edit the shop'}
    </button>
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
  editing,
  selected,
  onOpen,
  onAdd,
}: {
  product: ShopProduct;
  inCart: number;
  /**
   * Staff are arranging the shop.
   *
   * The card carried its own settings until 2026-09-01 and now carries none —
   * pressing it selects the book into the editing column instead. See the note
   * on `ShopInspector` for why that reversed.
   */
  editing: boolean;
  /** This is the book the column is describing. */
  selected: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const soldOut = product.stockCount === 0;

  /*
   * "Was this card actually on screen?", answered by the browser.
   *
   * Counting a view when the card renders would count every book in the catalog
   * on every visit, which makes "most viewed" a list of eleven equal numbers.
   * An IntersectionObserver counts the ones a person actually scrolled to, once
   * each per page view — `trackViewOnce` holds the set.
   *
   * 50% for a quarter of a second, so a card that flies past under a fast
   * flick is not a view. Disconnected as soon as it fires: the card has been
   * seen, and nothing about seeing it again changes that.
   */
  const card = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const element = card.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          dwell ??= setTimeout(() => {
            trackViewOnce(product.slug);
            observer.disconnect();
          }, 250);
        } else if (dwell) {
          clearTimeout(dwell);
          dwell = null;
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(element);
    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [product.slug]);

  return (
    <li
      className={`book${editing ? ' is-editing' : ''}${selected ? ' is-selected' : ''}`}
      ref={card}
    >
      {/* `title` because the card's own heading is clamped to three lines —
          Square's longest runs to five. The whole of it is in the dialog this
          opens, and here on hover. */}
      {/*
        One button, two jobs, told apart by the mode.

        While editing it selects the book into the column; otherwise it opens the
        enlarged view a shopper sees. Not two buttons: the whole cover is the
        target either way, and a separate "edit this one" affordance on every
        card is the thing moving to a column was meant to remove.

        `aria-pressed` only while editing, because only then is it a toggle.
      */}
      <button
        type="button"
        className="book__open"
        onClick={onOpen}
        title={product.name}
        {...(editing ? { 'aria-pressed': selected } : {})}
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
            gone. It also stays while editing — it is what Square charges, and
            seeing it is how you notice it is wrong. */}
        <p className="book__price">{money(product.amount, product.currency)}</p>

        {soldOut ? (
          <span className="book__gone">Unavailable</span>
        ) : (
          !editing && (
            <button type="button" className="book__add" onClick={onAdd}>
              {inCart > 0 ? "Add another" : "Add to basket"}
            </button>
          )
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
  editing,
  doc,
  sections,
  onChanged,
  onError,
  onPick,
  onClose,
  onAdd,
}: {
  product: ShopProduct;
  inCart: number;
  /** The rest of the shelf, for the cross-sell below. */
  others: ShopProduct[];
  /** Staff are arranging the shop, so this screen holds the settings instead. */
  editing: boolean;
  /** The document behind it, for the picture manager. Absent until it lands. */
  doc: DocOf<Product> | undefined;
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
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

          {/*
            This screen used to become the enlarged settings while Edit was on.

            It cannot any more, and the branch that did it is gone rather than
            left unreachable: while editing, pressing a card selects the book
            into the column instead of opening this dialog, so there is no way
            in. The settings it held are the same `ProductSettings` the column
            renders — one editing surface, which is the point of the column.
          */}
          <div className="buybox">
            <p className="buybox__price">
              {money(product.amount, product.currency)}
            </p>

            <p
              className={
                soldOut ? "buybox__stock buybox__stock--out" : "buybox__stock"
              }
            >
              {soldOut ? "Out of stock" : "In stock at the church bookstore"}
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
                  Collect at the church, or have it delivered.
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
          <DragRail className="rail--strip" drift={false}>
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
          </DragRail>
        </div>
      )}
    </Dialog>
  );
}

