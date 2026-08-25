'use client';

import { Suspense, lazy, useState } from 'react';
import { Dialog } from './Sheet';

/*
 * Both panels are `lazy`, and the measurement is why.
 *
 * They were plain imports, and the production build put all of both — the queue,
 * the refund dialog, the metrics tables — into the chunk /bookstore loads
 * eagerly. 39KB of back-office markup delivered to every parishioner opening the
 * shop, to render nothing. `adminData` was already dynamic and was correctly
 * split; the components around it were not, which is the half that is easy to
 * miss because the expensive-looking import is the Firestore one.
 *
 * Split from each other as well as from the page: opening Orders should not
 * fetch the metrics tables, and most sessions here only ever want one of them.
 */
const StaffOrders = lazy(() =>
  import('./StaffOrders').then((m) => ({ default: m.StaffOrders })),
);
const StaffMetrics = lazy(() =>
  import('./StaffMetrics').then((m) => ({ default: m.StaffMetrics })),
);

/**
 * Orders and metrics, in a drawer down the right of the shop.
 *
 * ---------------------------------------------------------------------------
 * A drawer, not a panel in the flow, and this is the third arrangement.
 *
 * It was a separate route at `/staff/bookstore`; then a section that expanded
 * inline above the shelf, which is what Tommy saw and rejected — *"I hate how it
 * opens above and pushes everything down I'd rather a side drawer that opens
 * when toggled."* He is right, and the reason is worth writing down rather than
 * just complying: an inline panel is laid out **in** the page, so opening it
 * moves the catalog. Every book jumps down by the height of the queue, and the
 * thing you were looking at before you pressed the button is somewhere else
 * when you close it again. A volunteer switching between "what sold" and "what
 * does that book cost" pays that cost on every toggle.
 *
 * An overlay pays it never. The shop stays exactly where it was, and closing the
 * drawer puts you back on an unmoved page.
 *
 * ## Built on the bookstore's own sheet, deliberately
 *
 * `Dialog` is the same native `<dialog>` the basket, the product detail, and the
 * payment form already use, with `sheet--drawer` pinning it to the right edge
 * instead of centring it. That inherits the top layer, the inert page behind,
 * focus containment, Escape-to-close, and the backdrop click — none of which I
 * would have got right by hand, and all of which a hand-rolled drawer would have
 * had to reimplement and then keep in step with the other three.
 *
 * Under 60rem the same stylesheet makes it full width, because a 30rem drawer
 * beside a 24rem phone is two unusable halves.
 *
 * ## This is a review surface. Nothing here edits the shop.
 *
 * An in-place editor for the delivery charge and the returns notice was built
 * here and rejected. The two writes that remain are both *about an order* rather
 * than about the shop — advancing it through the queue, and refunding it — and
 * both live on the order they act on. Settings are in `config/bookstore`, edited
 * in the console.
 *
 * **A third tab broke that rule and has been taken out again.** "Catalog" put
 * adding, removing, stock and pictures in here as a list of titles — which meant
 * arranging the shop while the shop itself was behind an overlay. Tommy's
 * words: *"i dont want it to be in the catelog I want the orders and metrics
 * section to make the products have editing functionality in place."* That work
 * now lives on the shelf, in `ShopEditing`, behind the Edit pill next to this
 * one. The rule above is the reason it never belonged here.
 *
 * Nothing at all is rendered for a visitor, and nothing downloaded either: this
 * module is behind a `lazy` in `Shop` and the two panels behind another one
 * here. Verified against the export build, not assumed.
 * ---------------------------------------------------------------------------
 */
export function BookstoreAdmin() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'orders' | 'metrics'>('orders');

  return (
    <>
      {/*
        A fixed pill in the corner, taking no layout space at all.

        Which is the point: a control in the flow would itself shift the catalog
        by its own height the moment it appeared for a signed-in volunteer, which
        is a smaller version of the thing being fixed here. Fixed, it costs the
        page nothing and is reachable without scrolling back up.

        Its own class rather than `.edit-toggle`. It looks identical on purpose —
        same pill, same corner, same language as the galleries' control — but
        this one opens a read-only drawer, and borrowing a class named for
        editing would tie a review surface to whatever that pill becomes next.
      */}
      <button type="button" className="bkadmin__toggle" onClick={() => setOpen(true)}>
        Orders &amp; metrics
      </button>

      {/*
        Mounted only while open, so closing genuinely unmounts the queue and its
        polling-free-but-still-live state rather than leaving it hidden. The
        `key` on the view is what makes switching tabs a fresh panel instead of
        one reconciled against the other's leftovers.
      */}
      {open && (
        <Dialog
          title="Bookstore orders and metrics"
          className="sheet--drawer"
          screen={view}
          onClose={() => setOpen(false)}
        >
          <div className="bkadmin">
            {/*
              Tabs rather than two stacked sections. They answer different
              questions on different days — "what do I pack" and "what sold" —
              and nobody wants both at once.
            */}
            <div className="bktabs" role="tablist" aria-label="Bookstore">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'orders'}
                className={view === 'orders' ? 'bktabs__tab is-on' : 'bktabs__tab'}
                onClick={() => setView('orders')}
              >
                Orders
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'metrics'}
                className={view === 'metrics' ? 'bktabs__tab is-on' : 'bktabs__tab'}
                onClick={() => setView('metrics')}
              >
                Metrics
              </button>
            </div>

            {/* A plain line rather than a skeleton: this is a fetch over parish
                wifi, not a render, and a shimmer for something that arrives in
                200ms is noise. */}
            <Suspense fallback={<p className="note">Loading…</p>}>
              {view === 'orders' && <StaffOrders key="orders" />}
              {view === 'metrics' && <StaffMetrics key="metrics" />}
            </Suspense>
          </div>
        </Dialog>
      )}
    </>
  );
}
