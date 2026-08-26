'use client';

import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  MAX_SECTIONS,
  MAX_SECTION_LABEL,
  UNSORTED_LABEL,
  sectionId,
  type BookstoreSection,
  type DocOf,
  type Product,
} from '@spsm/shared';
import type { ShopProduct } from './shopData';

/** A category being dragged: which one, where it would land, and how far. */
interface Drag {
  id: string;
  from: number;
  to: number;
  dx: number;
  dy: number;
  /** False until the pointer passes the slack. A press that never moves filters. */
  moved: boolean;
  /** Where the press began, so the offset is measured from it. */
  x: number;
  y: number;
}

/**
 * Editing the shop, on the shop, in the space each thing already occupies.
 *
 * ---------------------------------------------------------------------------
 * The third arrangement, and the two it replaced are worth recording because
 * each was rejected for a different reason.
 *
 * **A "Catalog" tab in the orders drawer.** A list of titles with three controls
 * per row. Rejected because arranging a shop from a table of its names means the
 * shop itself is behind an overlay — *"i dont want it to be in the catelog I
 * want the orders and metrics section to make the products have editing
 * functionality in place."*
 *
 * **A properties column down the right, the galleries' arrangement.** Press
 * Edit, click a book, and its settings appear in a panel. Rejected as *"way too
 * confusing"*, with the fix stated: *"a lot of the settings can be done in the
 * space that the product already takes up rather than on the side view."*
 *
 * That is right for this page, and it is worth being precise about why it does
 * not contradict `editMode.tsx`'s warning that *"every new thing an
 * administrator could change added a button next to the thing it changed. That
 * does not converge."* The galleries' column exists because a photograph inside
 * a strip inside a section has no room of its own — its settings have nowhere to
 * live but a panel, and there are many kinds of thing at many depths. A shop is
 * flat: one kind of thing, one card each, four settings, and a card is a card's
 * worth of space. Nothing here has to be looked up in a panel to know which book
 * it belongs to, and there is no selection state at all — which is why `Shop`
 * uses a plain boolean rather than `EditModeProvider`.
 *
 * ## What Square owns is shown, not edited
 *
 * Name, price and description live in Square: the checkout prices orders from
 * Square's catalog, and the till and the card reader read the same record. An
 * edit made here would be overwritten by the next `npm run catalog`. The price
 * stays visible on the card while editing, because seeing it is how somebody
 * notices it is wrong.
 *
 * ## Every refusal goes to one place
 *
 * `onError` hands the message to a single notice above the shelf. Eleven cards
 * with eleven error slots is eleven things that are usually empty.
 * ---------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* Writing, shared by both sizes of the same controls                          */
/* -------------------------------------------------------------------------- */

/**
 * Run a write, and report on it.
 *
 * ---------------------------------------------------------------------------
 * Lifted out of `BookControls` when the enlarged settings arrived, because the
 * card and the dialog are the *same four settings at two sizes* — and the part
 * worth not writing twice is not the markup, it is this: the boolean a refusal
 * returns, the busy flag, and the timing of the acknowledgement. Two copies of
 * that would drift, and the way they would drift is that one of them quietly
 * stops putting a refused value back.
 *
 * The boolean is not decoration. Controls here show the new value immediately —
 * the stepper especially, which has to feel like a stepper — so a refusal has to
 * be able to put the old one back. Without it a failed save leaves a card
 * reading "8 in stock" when Square still holds four, which is worse than the
 * error message it sits next to.
 * ---------------------------------------------------------------------------
 */
function useWriter(onChanged: () => void, onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  /*
   * Whether this product has just saved something, and the timer that clears it.
   *
   * See `.bkedit__state` in globals.css for why it is worth the state: every
   * write here is either debounced (the stepper, by 700ms) or slow (a photograph
   * going to Square and back), so the gap between pressing a control and
   * anything happening is long enough for a volunteer to press it again.
   * "Saving…" while it is in flight and "Saved" for a moment afterwards is the
   * difference between a control that answers and one that appears to be dead.
   */
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  const write = async (run: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    try {
      await run();
      onChanged();
      /* Only a write that landed says so. A refusal has its own notice above the
         shelf, and a "Saved" flashing beside it would contradict it. */
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
      return true;
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That change was refused.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, saved, write };
}

/** "Saving…", then "Saved", then nothing. Absolutely positioned; costs no layout. */
function SaveState({ busy, saved }: { busy: boolean; saved: boolean }) {
  return (
    <span
      className={busy ? 'bkedit__state is-working' : saved ? 'bkedit__state is-saved' : 'bkedit__state'}
      aria-live="polite"
    >
      {busy ? 'Saving…' : saved ? 'Saved' : ''}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* One book                                                                    */
/* -------------------------------------------------------------------------- */

export function BookControls({
  product,
  doc,
  sections,
  onChanged,
  onError,
}: {
  /** What the shelf is rendering — the shopper's view, and what stock reads. */
  product: ShopProduct;
  /** The document behind it, when the staff read has landed. Pictures need it. */
  doc: DocOf<Product> | undefined;
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, saved, write } = useWriter(onChanged, onError);

  // Reset if this card becomes a different book — a half-opened confirmation
  // must not carry over to the next one.
  useEffect(() => setConfirming(false), [product.slug]);

  return (
    <div className={busy ? 'bkedit is-busy' : 'bkedit'}>
      {/*
        The one thing on this card that reports back. Absolutely positioned, so
        it costs no layout at all: this block was deliberately rewritten to half
        its old height, and buying feedback with a permanent empty row would give
        that back. `aria-live` so it is announced rather than only seen — a
        stepper that says nothing for 700ms is worse without sight, not better.
      */}
      <SaveState busy={busy} saved={saved} />

      <Field label="In stock">
        <StockStepper product={product} busy={busy} onWrite={write} />
      </Field>

      <Field label="Pictures">
        <Pictures product={product} doc={doc} busy={busy} onWrite={write} onError={onError} />
      </Field>

      {sections.length > 0 && (
        <Field label="Category">
          <select
            className="bkedit__select"
            value={product.section ?? ''}
            aria-label={`Category for ${product.name}`}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value || null;
              void write(async () => {
                const { setProductSection } = await import('./adminData');
                await setProductSection(product.slug, next);
              });
            }}
          >
            <option value="">— none —</option>
            {sections.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      <RemoveProduct
        product={product}
        busy={busy}
        confirming={confirming}
        onConfirming={setConfirming}
        onWrite={write}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The same four settings, enlarged                                            */
/* -------------------------------------------------------------------------- */

/**
 * A single product's settings, at the size a photograph needs.
 *
 * ---------------------------------------------------------------------------
 * Asked for directly: *"I also want to enlarge the settings by clicking on a
 * specific product and I should be able to remove pictures and add pictures as
 * necessary."*
 *
 * This is **not** the properties column that was rejected as *"way too
 * confusing"*, and the difference is worth being exact about, because from a
 * distance they look like the same idea.
 *
 *   - That column stood permanently down the side of the window and described
 *     whichever card you had last clicked. You had to look away from the shelf
 *     to see it, and away from it to see what it was describing.
 *   - This is the product's own screen — the same dialog a shopper opens, which
 *     already shows this book at full size and nothing else. It is opened
 *     deliberately, it holds one book, and closing it puts you back on the
 *     shelf. There is no selection to keep track of and nothing is displaced.
 *
 * The card keeps its compact controls, which remain the fast path: adjusting a
 * count on six books in a row should not mean opening and closing six dialogs.
 * This is the slow path, for the one job the card genuinely cannot do — looking
 * at a photograph while deciding whether to keep it.
 *
 * The buybox is what this replaces in the dialog, which is right: a quantity
 * stepper and Add to basket are the shopper's question, and nobody arranging the
 * shop is also buying from it.
 * ---------------------------------------------------------------------------
 */
export function ProductSettings({
  product,
  doc,
  sections,
  onChanged,
  onError,
  onRemoved,
}: {
  product: ShopProduct;
  doc: DocOf<Product> | undefined;
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
  /** Close the dialog: the book it was describing is no longer on the shop. */
  onRemoved: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, saved, write } = useWriter(onChanged, onError);

  useEffect(() => setConfirming(false), [product.slug]);

  return (
    <div className={busy ? 'bkpanel is-busy' : 'bkpanel'}>
      <div className="bkpanel__head">
        <h3 className="bkpanel__title">Shop settings</h3>
        <SaveState busy={busy} saved={saved} />
      </div>

      <p className="bkpanel__note">
        Square owns the title, the price and the description — this screen holds
        the four things the parish sets.
      </p>

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Pictures</h4>
        <Pictures
          product={product}
          doc={doc}
          busy={busy}
          variant="panel"
          onWrite={write}
          onError={onError}
        />
        {/*
          Said here and not on the card, because here it is actionable: the
          pictures are large enough to compare, so which one leads is a decision
          somebody can actually make. Ordering them is Square's, for now.
        */}
        {doc && doc.imagePaths.length > 1 && (
          <p className="bkpanel__aside">
            The first is the cover the shop shows. Reorder them in Square.
          </p>
        )}
        {!doc && (
          <p className="bkpanel__aside">Reading this product’s pictures…</p>
        )}
      </div>

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">In stock</h4>
        <StockStepper product={product} busy={busy} onWrite={write} />
      </div>

      {sections.length > 0 && (
        <div className="bkpanel__block">
          <h4 className="bkpanel__label">Category</h4>
          <select
            className="bkedit__select bkpanel__select"
            value={product.section ?? ''}
            aria-label={`Category for ${product.name}`}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value || null;
              void write(async () => {
                const { setProductSection } = await import('./adminData');
                await setProductSection(product.slug, next);
              });
            }}
          >
            <option value="">— none —</option>
            {sections.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bkpanel__block bkpanel__block--last">
        <RemoveProduct
          product={product}
          busy={busy}
          confirming={confirming}
          onConfirming={setConfirming}
          onWrite={write}
          /* Leaving the dialog open on an archived book would show a screen for
             something the shop no longer has, with controls that all fail. */
          onDone={onRemoved}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Taking a product off the shop                                               */
/* -------------------------------------------------------------------------- */

/**
 * Nothing destructive without a second step, and the second step says what
 * actually happens — "remove" reads as "delete" and this is an archive.
 *
 * The confirmation is held by the caller rather than here, so that opening the
 * enlarged settings for a different book closes a confirmation left open on the
 * last one. A half-pressed Remove must never carry across products.
 */
function RemoveProduct({
  product,
  busy,
  confirming,
  onConfirming,
  onWrite,
  onDone,
}: {
  product: ShopProduct;
  busy: boolean;
  confirming: boolean;
  onConfirming: (next: boolean) => void;
  onWrite: (run: () => Promise<void>) => Promise<boolean>;
  onDone?: () => void;
}) {
  if (!confirming) {
    return (
      <button
        type="button"
        className="bkedit__remove"
        disabled={busy}
        onClick={() => onConfirming(true)}
      >
        Remove this product
      </button>
    );
  }

  return (
    <div className="bkedit__confirm">
      <p>Off the website and out of the Square register. Past orders keep it.</p>
      <div className="bkedit__confirmrow">
        <button
          type="button"
          className="bkedit__keep"
          disabled={busy}
          onClick={() => onConfirming(false)}
        >
          Keep it
        </button>
        <button
          type="button"
          className="bkedit__gone"
          disabled={busy}
          onClick={() =>
            void (async () => {
              // Only on success: a refused archive leaves the book on the shop,
              // and closing the screen would say it had gone.
              if (
                await onWrite(async () => {
                  const { archiveProduct } = await import('./adminData');
                  await archiveProduct(product.slug);
                })
              ) {
                onDone?.();
              }
            })()
          }
        >
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

/**
 * One labelled row.
 *
 * The label sits *beside* the control rather than above it. Stacked, three
 * uppercase labels each took a line of their own and the block ran to half the
 * height of the cover above it — a lot of empty card for four settings.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bkedit__field">
      <span className="bkedit__label">{label}</span>
      <span className="bkedit__control">{children}</span>
    </div>
  );
}

/**
 * How many are on the shelf, as a stepper.
 *
 * ---------------------------------------------------------------------------
 * Three states, and collapsing them is the mistake to avoid: `null` is "nobody
 * counts these", a number is the count, and `0` is sold out — which greys the
 * card and makes the checkout refuse it. So the power button is its own control:
 * an emptied text box must never read as "stop counting", because a volunteer
 * clearing the field to mean *never mind* would take the book off the shop.
 *
 * **The writes are debounced, and that is not polish.** Every save is a call to
 * Square's inventory API through a Cloud Function, and a stepper invites four
 * quick presses. Firing one request per press would send four, out of order,
 * with the last one to arrive winning — so the count on the shelf would be
 * whichever request Square happened to answer last.
 *
 * So the number moves at once and the write follows once, ~700ms after the last
 * press. The draft is held in a ref as well as in state because the timer's
 * callback closes over the value from the render that created it — the same
 * batching trap `bookstoreEvents` hit, where a fast run of clicks collapsed into
 * one because the updater's side effect ran against a stale copy.
 * ---------------------------------------------------------------------------
 */
function StockStepper({
  product,
  busy,
  onWrite,
}: {
  product: ShopProduct;
  busy: boolean;
  onWrite: (run: () => Promise<void>) => Promise<boolean>;
}) {
  const stock = product.stockCount ?? null;
  const [draft, setDraft] = useState(stock ?? 0);
  const wanted = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* What the document holds, readable from inside the debounce callback — which
     closes over the render that scheduled it and would otherwise restore a
     count from several presses ago. */
  const held = useRef(stock);
  held.current = stock;

  /*
   * Re-seed from the document, but never while a press is still waiting to be
   * written — the refresh after an earlier save would otherwise snap the number
   * back to the count from before the press somebody just made.
   */
  useEffect(() => {
    if (wanted.current === null) setDraft(stock ?? 0);
  }, [product.slug, stock]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const save = (count: number | null) =>
    onWrite(async () => {
      const { setProductStock } = await import('./adminData');
      await setProductStock(product.slug, count);
    });

  const nudge = (by: number) => {
    setDraft((was) => {
      const next = Math.max(0, Math.min(99_999, was + by));
      wanted.current = next;
      return next;
    });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        const target = wanted.current;
        wanted.current = null;
        timer.current = null;
        if (target === null || target === held.current) return;
        // Refused: put back what Square still holds, so the card never shows a
        // count that was not accepted.
        if (!(await save(target))) setDraft(held.current ?? 0);
      })();
    }, 700);
  };

  if (stock === null) {
    return (
      <span className="bkedit__untracked">
        <span className="bkedit__value">not counted</span>
        <button
          type="button"
          className="bkedit__power"
          disabled={busy}
          title="Have Square start counting this product"
          aria-label="Start counting this product"
          onClick={() => void save(0)}
        >
          start counting
        </button>
      </span>
    );
  }

  return (
    <span className="bkstep">
      <button
        type="button"
        className="bkstep__btn"
        aria-label={`One fewer ${product.name}`}
        disabled={busy || draft === 0}
        onClick={() => nudge(-1)}
      >
        −
      </button>
      <output className={draft === 0 ? 'bkstep__n is-out' : 'bkstep__n'} aria-live="polite">
        {draft}
      </output>
      <button
        type="button"
        className="bkstep__btn"
        aria-label={`One more ${product.name}`}
        disabled={busy}
        onClick={() => nudge(1)}
      >
        +
      </button>
      <button
        type="button"
        className="bkedit__power"
        disabled={busy}
        title="Have Square stop counting this product"
        aria-label="Stop counting this product"
        onClick={() => void save(null)}
      >
        stop counting
      </button>
      {/* Zero is the one state worth a word — it takes the product off the shop.
          Beside the stepper rather than as a badge on its own line. */}
      {draft === 0 && <span className="bkstep__flag">sold out</span>}
    </span>
  );
}

/**
 * Add a photograph, or take one off. Square holds both.
 *
 * ---------------------------------------------------------------------------
 * Two sizes of one control, told apart by `variant`, and the reason they are one
 * component rather than two is that the *behaviour* is where all the difficulty
 * is: the drag counter, clearing the picker so a retry after a failure fires
 * `change` again, the downscale before upload, refusing a dropped PDF. None of
 * that differs between a card and a dialog, and two copies of it would be two
 * places to fix the next thing found wrong with it.
 *
 *   `row`   — on the card, in the space beside the "Pictures" label. Small
 *             thumbnails, the × revealed on hover.
 *   `panel` — in the enlarged settings, where there is room for the photograph
 *             to be looked at rather than merely counted, and where Remove is a
 *             word rather than a mark that has to be discovered.
 * ---------------------------------------------------------------------------
 */
function Pictures({
  product,
  doc,
  busy,
  variant = 'row',
  onWrite,
  onError,
}: {
  product: ShopProduct;
  doc: DocOf<Product> | undefined;
  busy: boolean;
  variant?: 'row' | 'panel';
  onWrite: (run: () => Promise<void>) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  /*
   * A file is being dragged over this card's picture row.
   *
   * Counted rather than held as a boolean: `dragleave` fires every time the
   * pointer crosses into a *child* of the drop zone — the thumbnails, the add
   * button — so a plain flag flickers off the moment the file passes over one of
   * them, and the zone stops looking like a target exactly while it is being
   * aimed at. Counting enters against leaves survives the child boundaries.
   */
  const [over, setOver] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const images = doc?.imagePaths ?? [];

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const shrunk = await downscale(file);
      await onWrite(async () => {
        const { uploadProductImage } = await import('./adminData');
        await uploadProductImage(product.slug, shrunk);
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That picture could not be read.');
    } finally {
      setUploading(false);
      // Cleared so choosing the same file twice fires `change` again — a retry
      // after a failure otherwise does nothing at all.
      if (picker.current) picker.current.value = '';
    }
  };

  /*
   * A photograph of a book is almost always already on the desktop, and the
   * gesture a volunteer reaches for is to drag it onto the card. The file picker
   * stays — dragging is an addition, never the only way in, because it has no
   * keyboard equivalent and no equivalent at all on a phone.
   *
   * `preventDefault` on dragover is not optional: without it the browser's
   * default handling wins, `drop` never fires, and the file opens as a page —
   * which navigates away from the shop mid-edit.
   */
  const accept = (event: ReactDragEvent) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return false;
    event.preventDefault();
    return true;
  };

  const remove = (url: string) =>
    void onWrite(async () => {
      const { removeProductImage } = await import('./adminData');
      await removeProductImage(product.slug, url);
    });

  const panel = variant === 'panel';
  const Box = panel ? 'div' : 'span';
  const Tile = panel ? 'div' : 'span';

  return (
    <Box
      className={`${panel ? 'bkpix bkpix--panel' : 'bkpix'}${over > 0 ? ' is-over' : ''}`}
      onDragEnter={(event) => {
        if (accept(event)) setOver((n) => n + 1);
      }}
      onDragOver={accept}
      onDragLeave={() => setOver((n) => Math.max(0, n - 1))}
      onDrop={(event) => {
        if (!accept(event)) return;
        setOver(0);
        if (uploading || busy) return;
        const file = Array.from(event.dataTransfer.files).find((one) =>
          one.type.startsWith('image/'),
        );
        // Said rather than ignored: a dropped PDF looks like it worked otherwise.
        if (!file) onError('That file is not a picture.');
        else void upload(file);
      }}
    >
      {images.map((url, index) => (
        <Tile className="bkpix__one" key={url}>
          {/* A plain `img`: these are Square CDN URLs the export build knows
              nothing about, and `next/image` would need every host in
              `remotePatterns` for a thumbnail this size. */}
          <img src={url} alt="" loading="lazy" />
          {/* The first is what the shop shows, and saying so is the difference
              between "why is that one the cover" and knowing. */}
          {index === 0 && <span className="bkpix__cover">cover</span>}
          {/*
            On the card this is a × that appears on approach, because a row of
            badges over every thumbnail is what made that block look busy. In the
            panel it is a word: there is room for one, the pictures are large
            enough that the mark would look like part of the photograph, and
            "discoverable on hover" is not a property a destructive control on a
            touchscreen can have.
          */}
          <button
            type="button"
            className={panel ? 'bkpix__off' : 'bkpix__del'}
            disabled={busy}
            aria-label={`Remove picture ${index + 1} of ${images.length} from ${product.name}`}
            title="Remove this picture"
            onClick={() => remove(url)}
          >
            {panel ? 'Remove' : '×'}
          </button>
        </Tile>
      ))}

      <button
        type="button"
        className="bkpix__add"
        disabled={uploading || busy}
        title="Add a picture — or drag one in"
        aria-label={`Add a picture to ${product.name}`}
        onClick={() => picker.current?.click()}
      >
        {panel ? (
          <>
            <span className="bkpix__addmark" aria-hidden="true">
              {uploading ? '…' : '+'}
            </span>
            <span className="bkpix__addword">
              {uploading ? 'Sending…' : over > 0 ? 'Drop it here' : 'Add a picture'}
            </span>
          </>
        ) : uploading ? (
          '…'
        ) : (
          '+'
        )}
      </button>

      {/*
        The empty state carries the instruction, and only the empty state.
        A book that already has its picture does not need to be told twice how to
        add another, and eleven copies of the sentence is what would make this
        block noisy. Hidden from assistive technology because the button beside
        it already says the same thing.

        The panel's add tile says all of this on its own face, so it gets none.
      */}
      {!panel && images.length === 0 && !uploading && (
        <span className="bkpix__hint" aria-hidden="true">
          {over > 0 ? 'Drop it here' : 'or drop one here'}
        </span>
      )}

      <input
        ref={picker}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </Box>
  );
}

/* -------------------------------------------------------------------------- */
/* The category pills, while editing                                           */
/* -------------------------------------------------------------------------- */

/**
 * The shopper's filter row, with the editing on the pills themselves.
 *
 * ---------------------------------------------------------------------------
 * There was a panel under this row — the same categories again as chips, each
 * with a rename box and three buttons. Tommy removed it: *"I want the drag adn
 * drop to be on the buttons themselves there no reason to add a whole panel."*
 *
 * He is right, and the reason I had it backwards is worth writing down. I split
 * them to keep the shopper's row "clean", but a shopper never sees this
 * component at all — it only renders while a volunteer is editing. So the split
 * bought nothing and cost the thing that matters: two rows showing the same
 * categories, where you arrange one and watch the other change. Arranging the
 * pills *is* the job, so the pills are what you drag.
 *
 * ## One pill does three things, told apart by how you press it
 *
 *  - a press and release without moving → filters, exactly as it does for a
 *    shopper, so the arrangement can be judged while it is made;
 *  - a press and a drag → reorders;
 *  - a double press → renames in place.
 *
 * The threshold is what keeps the first two apart, and it has to exist: without
 * it every reorder would also fire a filter on release, and the shelf would
 * change under the hand that was arranging it.
 *
 * `All` and the catch-all are not categories — nothing about them is stored —
 * so they filter and nothing else.
 * ---------------------------------------------------------------------------
 */
export function CategoryPills({
  groups,
  sections,
  total,
  active,
  onPick,
  onChanged,
  onError,
}: {
  /** What `groupProducts` made: the categories with something in them. */
  groups: readonly { id: string | null; label: string; items: readonly unknown[] }[];
  /** Every category, including the empty ones the row does not show. */
  sections: BookstoreSection[];
  total: number;
  active: string | null | undefined;
  onPick: (id: string | null | undefined) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /*
   * When the last drag ended, so the click it produces can be ignored.
   *
   * ---------------------------------------------------------------------------
   * Filtering is an `onClick` rather than something done on `pointerup`, because
   * a keyboard has no pointer: Space on a focused pill fires `click` and nothing
   * else, and handling the filter on `pointerup` left the row reorderable by
   * keyboard but not *usable* by one. So the click that trails a mouse drag has
   * to be told apart from a real one.
   *
   * **A timestamp, not a flag that waits to be consumed.** It was a boolean
   * cleared by the next click — and the trailing click does not always arrive:
   * the browser suppresses it when the pointer moved far enough, and after a
   * reorder the element under the cursor is a different pill anyway. The flag
   * then sat set until *some* later click ate it, which is how dragging a
   * category and then pressing × did nothing at all. A window that expires on
   * its own cannot go stale.
   * ---------------------------------------------------------------------------
   */
  const draggedAt = useRef(0);
  /** True only for a click arriving on the heels of a drag. */
  const swallowClick = () => Date.now() - draggedAt.current < 300;
  /* The live drag, for handlers created once at press time. See `begin`. */
  const dragRef = useRef<Drag | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (next: BookstoreSection[]) => {
    setBusy(true);
    try {
      const { writeSections } = await import('./adminData');
      await writeSections(next);
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'The categories could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * The order being edited is the one in `sections`, which is every category the
   * parish has. `groups` is the shopper's view and omits the empty ones.
   */
  const orderOf = (id: string) => sections.findIndex((row) => row.id === id);

  /**
   * How many products are in each category.
   *
   * ---------------------------------------------------------------------------
   * Built here so this row can be drawn from `sections` rather than from
   * `groups`, and that difference is the whole bug this fixed.
   *
   * `groupProducts` drops a category with nothing in it — correct for a shopper,
   * who would otherwise get a pill leading to an empty shelf. But it meant a
   * category that had just been *created* had no pill: it was written to
   * Firestore, it appeared in every product's Category menu, and the row showed
   * nothing. Adding a category looked like it did nothing at all, and an empty
   * one could never be renamed, reordered or removed, because there was nothing
   * on screen to press.
   *
   * So while editing, every category gets a pill and an honest count — a `0` is
   * information, and it is the state you are trying to get out of. The shopper's
   * row still hides them; that branch is in `Shop`.
   * ---------------------------------------------------------------------------
   */
  const countOf = new Map(groups.map((group) => [group.id, group.items.length]));
  const unfiled = groups.find((group) => group.id === null);

  /**
   * The row as it would be if you let go now.
   *
   * The pills physically move while you drag, rather than a highlight appearing
   * on the one you are over. It is the difference between being told where a
   * thing will land and watching it land — and with a row this small, a border
   * colour was not enough to read at a glance.
   */
  const preview =
    drag !== null && drag.moved
      ? (() => {
          const next = [...sections];
          const [lifted] = next.splice(drag.from, 1);
          if (lifted) next.splice(drag.to, 0, lifted);
          return next;
        })()
      : sections;

  /**
   * Pick a category up.
   *
   * ---------------------------------------------------------------------------
   * The window listeners are attached **here, synchronously**, rather than in an
   * effect keyed on the drag state — and that is the whole reason dragging did
   * not work with a real mouse.
   *
   * An effect runs after React has re-rendered. A mouse fires `pointermove`
   * within a millisecond or two of `pointerdown`, so the first moves of every
   * real drag landed before anything was listening; the pill sat still until the
   * pointer had travelled far enough for a later move to be caught, which on a
   * short drag across one pill is never. It passed the scripted test only
   * because dispatching the events from separate calls left a full render
   * between them — the one way the race cannot happen.
   *
   * Attaching on the press removes the race, and drops the teardown and
   * re-attach that otherwise ran on every single move.
   *
   * `dragRef` shadows the state because these handlers are created once, at
   * press time, and would otherwise read the drag as it was in that first
   * render forever. The state exists only so the row can draw the movement.
   * ---------------------------------------------------------------------------
   */
  const begin = (event: ReactPointerEvent, id: string) => {
    const from = orderOf(id);
    if (from < 0 || busy) return;

    // Otherwise the browser begins a text selection on the pill's own label, and
    // that drag competes with this one.
    event.preventDefault();

    const order = sections;
    const start: Drag = {
      id,
      from,
      to: from,
      dx: 0,
      dy: 0,
      moved: false,
      x: event.clientX,
      y: event.clientY,
    };
    dragRef.current = start;
    setDrag(start);

    const onMove = (move: PointerEvent) => {
      const held = dragRef.current;
      if (held === null) return;

      const dx = move.clientX - held.x;
      const dy = move.clientY - held.y;
      // Four pixels of slack, so a press that wobbles still reads as a press.
      if (!held.moved && Math.abs(dx) <= 4 && Math.abs(dy) <= 4) return;

      /*
       * Where it would be inserted, counted against the pills it is *not*.
       *
       * ---------------------------------------------------------------------------
       * This replaced "whichever centre is nearest", which was measured against
       * every pill including the one in hand — so the pill being dragged was
       * always its own nearest neighbour and the target barely moved. It is why
       * reordering felt like it was not responding.
       *
       * Counting instead: how many of the other pills has the pointer gone past?
       * That number *is* the index it belongs at, it needs no special case for
       * either end of the row, and it is stable while the row reflows underneath
       * — which it now does, because the preview reorders live.
       *
       * "Past" is two-dimensional because the row wraps: a pill on an earlier
       * line is behind you whatever the x, and only within the same line does x
       * decide.
       * ---------------------------------------------------------------------------
       */
      let to = 0;
      for (const pill of row.current?.querySelectorAll<HTMLElement>('[data-cat]') ?? []) {
        if (pill.getAttribute('data-cat') === held.id) continue;
        const box = pill.getBoundingClientRect();
        const passed =
          move.clientY > box.bottom ||
          (move.clientY >= box.top && move.clientX > box.left + box.width / 2);
        if (passed) to += 1;
      }

      const next: Drag = { ...held, moved: true, to, dx, dy };
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);

      const landed = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (landed === null) return;

      // A press that never moved is a filter, and the click that follows will do
      // it. Anything that moved is a reorder, and that click must be swallowed.
      if (landed.moved) draggedAt.current = Date.now();
      if (!landed.moved || landed.to === landed.from) return;

      const next = [...order];
      const [lifted] = next.splice(landed.from, 1);
      if (!lifted) return;
      next.splice(landed.to, 0, lifted);
      void save(next);
    };

    // On `window`: a drag that ends outside it would otherwise never see its
    // `pointerup`, leaving the row stuck mid-drag with no way out but a reload.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const shift = (id: string, by: number) => {
    const from = orderOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= sections.length) return;
    const next = [...sections];
    const [lifted] = next.splice(from, 1);
    if (!lifted) return;
    next.splice(to, 0, lifted);
    void save(next);
  };

  const rename = (id: string, label: string) => {
    const clean = label.trim().slice(0, MAX_SECTION_LABEL);
    setEditingId(null);
    // An empty name would leave a pill with nothing to press, so it is refused
    // rather than written.
    if (!clean) return;
    if (sections.some((row) => row.id === id && row.label === clean)) return;
    // The label changes; the id never does. That is what makes renaming a
    // category a one-field edit rather than a migration across every product
    // filed under it.
    void save(sections.map((row) => (row.id === id ? { ...row, label: clean } : row)));
  };

  const add = (label: string) => {
    const clean = label.trim().slice(0, MAX_SECTION_LABEL);
    setAdding(false);
    if (!clean || sections.length >= MAX_SECTIONS) return;

    const id = sectionId(clean);
    // A second category with the same id would swallow the first one's products,
    // so a repeated name is refused rather than merged.
    if (sections.some((row) => row.id === id)) {
      onError(`There is already a category called \u201C${clean}\u201D.`);
      return;
    }
    void save([...sections, { id, label: clean }]);
  };

  return (
    <div
      className={drag?.moved ? 'shop-filters is-editing is-dragging' : 'shop-filters is-editing'}
      ref={row}
      role="group"
      aria-label="Categories — drag a pill to reorder it"
    >
      <button
        type="button"
        className={active === undefined ? 'shop-filter is-on' : 'shop-filter'}
        aria-pressed={active === undefined}
        onClick={() => onPick(undefined)}
      >
        All
        <span className="shop-filter__n">{total}</span>
      </button>

      {preview.map((section) => (
        <CategoryPill
          key={section.id}
          id={section.id}
          label={section.label}
          count={countOf.get(section.id) ?? 0}
          on={active === section.id}
          busy={busy}
          editing={editingId === section.id}
          held={drag?.id === section.id && drag.moved}
          /* Nothing is "the target" any more — the row itself shows the answer. */
          target={false}
          onGrab={(event) => begin(event, section.id)}
          /*
           * True when the click now arriving is the one the browser fires at the
           * end of a mouse drag. Every control *inside* a pill has to ask —
           * dragging from the × would otherwise reorder the row and then open
           * the remove confirmation on the way out.
           */
          swallowClick={swallowClick}
          onFilter={() => onPick(section.id)}
          onShift={(by) => shift(section.id, by)}
          onRenameStart={() => setEditingId(section.id)}
          onRename={(next) => rename(section.id, next)}
          onRemove={() => void save(sections.filter((row) => row.id !== section.id))}
        />
      ))}

      {/* The catch-all, last. Not a category — there is nothing stored to drag,
          rename or remove — so it stays a plain filter, and it is absent when
          everything has been filed. */}
      {unfiled && (
        <button
          type="button"
          className={active === null ? 'shop-filter is-on' : 'shop-filter'}
          aria-pressed={active === null}
          onClick={() => onPick(null)}
        >
          {UNSORTED_LABEL}
          <span className="shop-filter__n">{unfiled.items.length}</span>
        </button>
      )}

      {/* Adding, at the end of the row — the same shape as the tile at the end
          of the shelf, and for the same reason. */}
      {sections.length < MAX_SECTIONS &&
        (adding ? (
          <NewCategory onDone={add} onCancel={() => setAdding(false)} />
        ) : (
          <button
            type="button"
            className="shop-filter shop-filter--add"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            + Category
          </button>
        ))}
    </div>
  );
}

/**
 * One category pill: a filter, a thing you can drag, and its own name field.
 *
 * Double-press to rename. Not a permanent input, because a row of text boxes is
 * no longer a row of pills — and the arrangement is the thing being judged, so
 * it has to keep looking like what a shopper will see.
 */
function CategoryPill({
  id,
  label,
  count,
  on,
  busy,
  editing,
  held,
  target,
  onGrab,
  swallowClick,
  onFilter,
  onShift,
  onRenameStart,
  onRename,
  onRemove,
}: {
  id: string;
  label: string;
  count: number;
  on: boolean;
  busy: boolean;
  editing: boolean;
  held: boolean;
  /** Unused since the row previews the result, and kept only as a class hook. */
  target: boolean;
  onGrab: (event: ReactPointerEvent) => void;
  swallowClick: () => boolean;
  onFilter: () => void;
  onShift: (by: number) => void;
  onRenameStart: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(label);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => setDraft(label), [label]);
  useEffect(() => setConfirming(false), [id]);

  if (editing) {
    return (
      <span className="shop-filter shop-filter--naming" data-cat={id}>
        <input
          type="text"
          value={draft}
          autoFocus
          maxLength={MAX_SECTION_LABEL}
          aria-label={`Rename the ${label} category`}
          size={Math.max(4, draft.length)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(key) => {
            if (key.key === 'Enter') {
              key.preventDefault();
              (key.target as HTMLInputElement).blur();
            }
            if (key.key === 'Escape') {
              setDraft(label);
              onRename(label);
            }
          }}
        />
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="shop-filter shop-filter--ask" data-cat={id}>
        {/* Said out loud, because removing a category looks like it might remove
            the products in it. It does not. */}
        Remove “{label}”? Its {count === 1 ? 'product stays' : 'products stay'} on the shop.
        <button type="button" className="shop-filter__go" disabled={busy} onClick={onRemove}>
          Remove
        </button>
        <button
          type="button"
          className="shop-filter__x"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <span
      className={`shop-filter shop-filter--edit${on ? ' is-on' : ''}${held ? ' is-held' : ''}${
        target ? ' is-target' : ''
      }`}
      data-cat={id}
      /*
       * The press that may become a drag is on the *whole pill*, not on the
       * label inside it.
       *
       * It was on the label, and the × beside it — a third of the pill's width —
       * did nothing at all when grabbed: no drag started, and nothing said why.
       * There is no reading of "drag the pill" in which part of the pill is not
       * the pill, and nothing marks where the dead strip begins.
       */
      onPointerDown={busy ? undefined : onGrab}
    >
      {/* Six dots, the one mark that says "this can be moved" without a word.
          Decorative: the pill's own label already carries the instructions. */}
      <span className="shop-filter__dots" aria-hidden="true">
        ⠿
      </span>

      <button
        type="button"
        className="shop-filter__grip"
        aria-pressed={on}
        aria-label={`${label}, ${count} ${count === 1 ? 'product' : 'products'}. Press to filter, drag or use the arrow keys to reorder, press twice to rename.`}
        disabled={busy}
        onClick={() => {
          if (swallowClick()) return;
          onFilter();
        }}
        onDoubleClick={onRenameStart}
        onKeyDown={(key) => {
          const by = key.key === 'ArrowLeft' ? -1 : key.key === 'ArrowRight' ? 1 : 0;
          if (by !== 0) {
            key.preventDefault();
            onShift(by);
            return;
          }
          /*
           * The keyboard has no double-press and no drag. Enter renames, which
           * leaves filtering to Space — and both are needed, because without
           * them a category could be reordered by keyboard but never renamed.
           */
          if (key.key === 'Enter') {
            key.preventDefault();
            onRenameStart();
          }
        }}
      >
        {label}
        <span className="shop-filter__n">{count}</span>
      </button>

      <button
        type="button"
        className="shop-filter__x"
        aria-label={`Remove the ${label} category`}
        disabled={busy}
        onClick={() => {
          if (swallowClick()) return;
          setConfirming(true);
        }}
      >
        ×
      </button>
    </span>
  );
}

/** The name of a category that does not exist yet. */
function NewCategory({
  onDone,
  onCancel,
}: {
  onDone: (label: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');

  return (
    <span className="shop-filter shop-filter--naming">
      <input
        type="text"
        value={label}
        autoFocus
        placeholder="Name it"
        aria-label="Name of a new category"
        maxLength={MAX_SECTION_LABEL}
        size={Math.max(6, label.length)}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => (label.trim() ? onDone(label) : onCancel())}
        onKeyDown={(key) => {
          if (key.key === 'Enter') {
            key.preventDefault();
            (key.target as HTMLInputElement).blur();
          }
          if (key.key === 'Escape') onCancel();
        }}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* The last tile on the shelf                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Adding a book, in the slot where the next book would go.
 *
 * At the end of the grid rather than in a bar at the top, at Tommy's direction —
 * *"I want the add product to be after the last product not at the top."* It is
 * the better place for the reason every "new" affordance ends up there: the tile
 * is the shape and size of the thing it makes, so pressing it reads as putting a
 * book on the shelf rather than as opening a form about one.
 *
 * The form takes over the tile rather than opening beside it, so the grid never
 * reflows — the shelf a volunteer is judging stays exactly as laid out.
 */
export function AddProductTile({
  sections,
  onChanged,
  onError,
}: {
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <li className="book book--add">
        <button type="button" className="bkadd" onClick={() => setOpen(true)}>
          <span className="bkadd__plus" aria-hidden="true">
            +
          </span>
          <span className="bkadd__word">Add a product</span>
        </button>
      </li>
    );
  }

  return (
    <li className="book book--add is-open">
      <NewProduct
        sections={sections}
        onClose={() => setOpen(false)}
        onAdded={() => {
          setOpen(false);
          onChanged();
        }}
        onError={onError}
      />
    </li>
  );
}

/**
 * Adding a product — the one thing here that is a form with a commit.
 *
 * Every other control on this page writes as you leave it, because there is
 * already a document to write to. A create genuinely is a commit: nothing exists
 * until you press the button.
 *
 * It creates the item in Square first, and that order is not arrangeable. The
 * checkout prices orders from Square's own catalog, so a row invented in
 * Firestore has no variation id and is a book on the shop that nobody can buy.
 */
function NewProduct({
  sections,
  onClose,
  onAdded,
  onError,
}: {
  sections: BookstoreSection[];
  onClose: () => void;
  onAdded: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [section, setSection] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   * Dollars as typed, cents when sent. `Math.round`, never `trunc`: `4.35 * 100`
   * is `434.99999999999994` in binary floating point, and truncating charges a
   * cent less than the parish set.
   */
  const cents = (() => {
    const trimmed = price.trim().replace(/^\$/, '');
    if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
    const value = Math.round(Number(trimmed) * 100);
    return value > 0 && value <= 100_000 ? value : null;
  })();

  const submit = async () => {
    if (!name.trim() || cents === null || busy) return;
    setBusy(true);
    try {
      const { createProduct } = await import('./adminData');
      await createProduct({
        name: name.trim(),
        description: description.trim(),
        priceCents: cents,
        section: section || null,
      });
      onAdded();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'The product could not be added.');
      setBusy(false);
    }
  };

  return (
    <div className="bknew">
      <input
        type="text"
        value={name}
        placeholder="Title"
        aria-label="Title"
        autoFocus
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        type="text"
        className="bknew__price"
        value={price}
        inputMode="decimal"
        placeholder="15.00"
        aria-label="Price in dollars"
        disabled={busy}
        onChange={(event) => setPrice(event.target.value)}
      />
      <input
        type="text"
        value={description}
        placeholder="A line about it (optional)"
        aria-label="Description"
        disabled={busy}
        onChange={(event) => setDescription(event.target.value)}
      />
      {sections.length > 0 && (
        <select
          value={section}
          aria-label="Category"
          disabled={busy}
          onChange={(event) => setSection(event.target.value)}
        >
          <option value="">— no category —</option>
          {sections.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="button button--small"
        disabled={busy || !name.trim() || cents === null}
        onClick={() => void submit()}
      >
        {busy ? 'Adding…' : 'Add to Square'}
      </button>
      <button
        type="button"
        className="button button--quiet button--small"
        disabled={busy}
        onClick={onClose}
      >
        Cancel
      </button>
      <p className="bknew__note">
        Created in Square, which is where the price lives and what the till uses. The
        picture goes on the card afterwards.
      </p>
    </div>
  );
}

/**
 * Shrink a photograph before it leaves the browser.
 *
 * ---------------------------------------------------------------------------
 * The parish's existing covers are 3105×3105 JPEGs — 37.75MB across nine of
 * them — because that is what a phone camera produces and nobody resizes before
 * uploading to Square. That size is the entire reason `sync-catalog.mjs` has a
 * local WebP pipeline.
 *
 * Sending the original would mean a multi-megabyte base64 body through a Cloud
 * Function on parish wifi, and a shop that then serves that original to every
 * visitor until the next `npm run catalog`. 1600px is larger than the 800px the
 * bundled covers use, so nothing is lost when the optimised copy is generated —
 * and it turns 4MB into roughly 200KB.
 *
 * Falls back to the original file if anything here fails. A large upload is a
 * slow success; a thrown error is a volunteer who cannot add a photo.
 * ---------------------------------------------------------------------------
 */
async function downscale(file: File, max = 1600): Promise<string> {
  const original = () =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return original();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return original();
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    // JPEG rather than WebP: Square re-encodes anyway, and JPEG is the format
    // its image endpoint is least likely to have an opinion about.
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return original();
  }
}
