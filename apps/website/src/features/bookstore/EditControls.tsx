'use client';

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { EditColumn } from '@/components/EditColumn';
import { downscaleToDataUrl } from '@/lib/downscale';
import {
  MAX_SECTIONS,
  MAX_SECTION_LABEL,
  UNSORTED_LABEL,
  MAX_TAX_RATE_BPS,
  MAX_SIZE_COUNT,
  MAX_SIZE_EXTRA_CENTS,
  SIZE_PRESETS,
  clearanceOf,
  formatWeight,
  ouncesToPounds,
  taxPercentage,
  parseWeight,
  childSections,
  MAX_HANDLING_CENTS,
  SERVICE_DAYS,
  SERVICE_LABELS,
  SHIPPING_SERVICES,
  type BookstoreSection,
  type BookstoreShipping,
  type ShippingService,
  type DocOf,
  type Product,
  type ProductSize,
} from '@spsm/shared';
import type { ShopProduct } from './shopData';
import { usePendingEdit, usePendingEdits } from './pendingEdits';
import { money } from './money';

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


/**
 * "Saving…", then "Saved", then nothing — and "Edited" while a change is held.
 *
 * Absolutely positioned; costs no layout. The `dirty` state is the card's half
 * of the save bar: the bar says *how many* books are waiting, and this says
 * *which*. Without it the only feedback for pressing `+` would be the number
 * changing, which is indistinguishable from a control that has not been wired up.
 *
 * `busy` still wins, because the writes it reports — a photograph, a removal —
 * are the ones that do go out immediately.
 */
function SaveState({
  busy,
  saved,
  dirty = false,
}: {
  busy: boolean;
  saved: boolean;
  dirty?: boolean;
}) {
  const state = busy ? 'is-working' : saved ? 'is-saved' : dirty ? 'is-held' : '';
  return (
    <span className={state ? `bkedit__state ${state}` : 'bkedit__state'} aria-live="polite">
      {busy ? 'Saving…' : saved ? 'Saved' : dirty ? 'Edited' : ''}
    </span>
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
  /**
   * Inside the editing column, which supplies its own heading and saved state.
   *
   * Repeating them here would put the book's name twice within about 60px of
   * itself, and two "Saved" indicators that could disagree — the column's is
   * driven by the save bar, this one by the immediate writes.
   */
  bare = false,
}: {
  product: ShopProduct;
  doc: DocOf<Product> | undefined;
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
  /** Close the dialog, or clear the selection: the book is no longer on the shop. */
  onRemoved: () => void;
  bare?: boolean | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const { busy, saved, write } = useWriter(onChanged, onError);
  const pending = usePendingEdit(product.slug, {
    stockCount: product.stockCount ?? null,
    categoryIds: product.categoryIds,
    weightOz: product.weightOz,
    mediaMail: product.mediaMail,
    taxable: product.taxable,
    sizes: product.sizes,
  });

  useEffect(() => setConfirming(false), [product.slug]);

  return (
    <div className={busy ? 'bkpanel is-busy' : 'bkpanel'}>
      {!bare && (
        <div className="bkpanel__head">
          <h3 className="bkpanel__title">Book settings</h3>
          <SaveState busy={busy} saved={saved} dirty={pending.dirty} />
        </div>
      )}

      <p className="bkpanel__note">
        Stock, category, shipping and pictures are saved with the bar at the
        foot of the shop. The title, price and description go straight to
        Square.
      </p>

      {/* No block heading: every field inside carries its own label, and a
          "Details" heading above three labelled boxes is a word doing nothing. */}
      <div className="bkpanel__block">
        <ProductDetailsForm product={product} busy={busy} onWrite={write} />
      </div>

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Clearance</h4>
        <ClearanceField key={product.slug} product={product} busy={busy} onWrite={write} />
      </div>

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Pictures</h4>
        <Pictures
          product={product}
          doc={doc}
          busy={busy}
          variant="panel"
          onError={onError}
        />
        {/*
          Said here and not on the card, because here it is actionable: the
          pictures are large enough to compare, so which one leads is a decision
          somebody can actually make. Ordering them is Square's, for now.
        */}
        {doc && doc.imagePaths.length > 1 && (
          <p className="bkpanel__aside">
            The first picture is the one shown on the shelf. Reorder them in
            Square.
          </p>
        )}
        {!doc && (
          <p className="bkpanel__aside">Loading pictures…</p>
        )}
      </div>

      {/* Clothing is counted per size, below, so the single count would be a
          second number for the same shelf. */}
      {pending.sizes === null && (
        <div className="bkpanel__block">
          <h4 className="bkpanel__label">In stock</h4>
          <StockStepper product={product} busy={busy} />
        </div>
      )}

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Clothing</h4>
        <ClothingField
          key={product.slug}
          name={product.name}
          priceCents={product.amount}
          sizes={pending.sizes}
          busy={busy}
          onChange={pending.setSizes}
        />
      </div>

      {sections.length > 0 && (
        <div className="bkpanel__block">
          <h4 className="bkpanel__label">Categories</h4>
          <CategoryChecklist
            name={product.name}
            sections={sections}
            chosen={pending.categoryIds}
            busy={busy}
            onChange={pending.setCategories}
          />
        </div>
      )}

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Shipping</h4>
        <ShippingFields
          key={product.slug}
          name={product.name}
          weightOz={pending.weightOz}
          mediaMail={pending.mediaMail}
          busy={busy}
          onChange={pending.setShipping}
        />
        {product.sku && <p className="bkpanel__aside">SKU {product.sku}</p>}
      </div>

      <div className="bkpanel__block">
        <h4 className="bkpanel__label">Sales tax</h4>
        <TaxableField
          taxable={pending.taxable}
          busy={busy}
          onChange={pending.setTaxable}
        />
      </div>

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
/* Clearance                                                                  */
/* -------------------------------------------------------------------------- */

/** Dollars as typed, cents when valid. `Math.round`, for the reason in `ProductDetailsForm`. */
function parseDollars(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/**
 * Put an item on clearance, change its clearance price, or end it.
 *
 * The clearance price is the real price — it goes to Square, so the till charges
 * it too — and the price before is kept on the parish's side to show crossed
 * out. Its own button, like the title and price above it, because it changes
 * what the item costs everywhere.
 */
function ClearanceField({
  product,
  busy,
  onWrite,
}: {
  product: ShopProduct;
  busy: boolean;
  onWrite: (run: () => Promise<void>) => Promise<boolean>;
}) {
  const sale = clearanceOf({ wasPriceCents: product.wasPriceCents, amountCents: product.amount });
  const was = sale?.wasCents ?? product.amount;
  const [text, setText] = useState(sale ? (sale.nowCents / 100).toFixed(2) : '');
  useEffect(() => {
    setText(sale ? (sale.nowCents / 100).toFixed(2) : '');
    // Re-seeded when the saved price comes back changed, as the details form is.
  }, [product.amount, product.wasPriceCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = parseDollars(text);
  const valid = cents !== null && cents > 0 && cents < was;
  const wrong = text.trim() !== '' && !valid;
  const percent = valid ? Math.round(((was - cents) / was) * 100) : null;
  const changed = valid && cents !== sale?.nowCents;

  const go = (run: () => Promise<void>) => void onWrite(run);

  return (
    <div className="bkdetails">
      {sale && (
        <p className="bksale">
          On clearance: <s>{money(sale.wasCents)}</s> <strong>{money(sale.nowCents)}</strong>{' '}
          <span className="bksale__off">{sale.percentOff}% off</span>
        </p>
      )}

      <label className="bkdetails__row">
        <span className="bkdetails__label">Sale price</span>
        <span className="bkdetails__money">
          <span aria-hidden="true">$</span>
          <input
            type="text"
            className={wrong ? 'bkrename__input is-wrong' : 'bkrename__input'}
            value={text}
            inputMode="decimal"
            placeholder={`Less than ${money(was)}`}
            aria-label={`Sale price of ${product.name} in dollars`}
            aria-invalid={wrong}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        </span>
      </label>

      <p className={wrong ? 'bkpanel__aside bkpanel__aside--wrong' : 'bkpanel__aside'}>
        {wrong
          ? `A price below ${money(was)}, like 5 or 4.50.`
          : percent !== null
            ? `${money(was)} → ${money(cents as number)}, ${percent}% off. Shown in the Clearance section at the top of the shop.`
            : sale
              ? 'Change the price above to adjust the discount.'
              : `Type the sale price. ${money(was)} is kept and shown crossed out beside it.`}
      </p>

      <div className="bkdetails__go">
        <button
          type="button"
          className="button button--small"
          disabled={busy || !changed}
          onClick={() =>
            go(async () => {
              const { setClearance } = await import('./adminData');
              await setClearance(product.slug, was, cents as number);
            })
          }
        >
          {sale ? 'Update clearance price' : 'Put on clearance'}
        </button>
        {sale && (
          <button
            type="button"
            className="button button--quiet button--small"
            disabled={busy}
            onClick={() =>
              go(async () => {
                const { endClearance } = await import('./adminData');
                await endClearance(product.slug, sale.wasCents);
              })
            }
          >
            End clearance — back to {money(sale.wasCents)}
          </button>
        )}
      </div>

      <p className="bkpanel__aside">Goes to Square, so the till charges the clearance price too.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Clothing sizes                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Whether this is clothing, and if so which sizes, how many of each, and what
 * a size adds to the price.
 *
 * Held for the Save bar like the stock count it stands in for. The boxes keep
 * their own text, as the weight box does, so `1.` on the way to `1.50` is not
 * rewritten under somebody's fingers; only text that reads as a number is
 * passed up.
 */
function ClothingField({
  name,
  priceCents,
  sizes,
  busy,
  onChange,
}: {
  name: string;
  priceCents: number;
  sizes: readonly ProductSize[] | null;
  busy: boolean;
  onChange: (next: readonly ProductSize[] | null) => void;
}) {
  const [texts, setTexts] = useState<Record<string, { count: string; extra: string }>>(() =>
    Object.fromEntries(
      (sizes ?? []).map((size) => [
        size.label,
        { count: String(size.count), extra: size.extraCents ? (size.extraCents / 100).toFixed(2) : '' },
      ]),
    ),
  );

  const byLabel = new Map((sizes ?? []).map((size) => [size.label, size]));
  /** The list with one size replaced, added or removed, kept in preset order. */
  const put = (label: string, next: ProductSize | null) => {
    const merged = new Map(byLabel);
    if (next) merged.set(label, next);
    else merged.delete(label);
    onChange(SIZE_PRESETS.flatMap((one) => merged.get(one) ?? []));
  };

  const textOf = (label: string) => texts[label] ?? { count: '0', extra: '' };
  const setText = (label: string, patch: Partial<{ count: string; extra: string }>) =>
    setTexts((was) => ({ ...was, [label]: { ...(was[label] ?? { count: '0', extra: '' }), ...patch } }));

  /*
   * A box whose text reads as a number other than the held value has been
   * overtaken — Discard on the bar, or a save coming back — so it takes the
   * value. Text that does not read as a number yet is somebody mid-typing and
   * is left alone.
   */
  useEffect(() => {
    setTexts((was) => {
      let next = was;
      for (const size of sizes ?? []) {
        const text = was[size.label];
        if (!text) continue;
        const count = /^\d+$/.test(text.count.trim()) ? Number(text.count) : null;
        const extra = text.extra.trim() === '' ? 0 : parseDollars(text.extra);
        if ((count !== null && count !== size.count) || (extra !== null && extra !== size.extraCents)) {
          next = {
            ...next,
            [size.label]: {
              count: String(size.count),
              extra: size.extraCents ? (size.extraCents / 100).toFixed(2) : '',
            },
          };
        }
      }
      return next;
    });
  }, [sizes]);

  const onHand = (sizes ?? []).reduce((sum, size) => sum + size.count, 0);

  return (
    <div className="bkclothes">
      <label className="bkship__media">
        <input
          type="checkbox"
          checked={sizes !== null}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked ? [] : null)}
        />
        This is clothing — sold by size
      </label>

      {sizes !== null && (
        <>
          <table className="bksizes">
            <caption className="visually-hidden">Sizes of {name}</caption>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">On hand</th>
                <th scope="col">Adds</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {SIZE_PRESETS.map((label) => {
                const size = byLabel.get(label);
                const text = textOf(label);
                const countWrong = size !== undefined && !/^\d+$/.test(text.count.trim());
                const extra = text.extra.trim() === '' ? 0 : parseDollars(text.extra);
                const extraWrong = size !== undefined && (extra === null || extra > MAX_SIZE_EXTRA_CENTS);
                return (
                  <tr key={label} className={size ? 'is-on' : undefined}>
                    <th scope="row">
                      <label className="bkship__media">
                        <input
                          type="checkbox"
                          checked={size !== undefined}
                          disabled={busy}
                          onChange={(event) =>
                            put(
                              label,
                              event.target.checked
                                ? {
                                    label,
                                    count: /^\d+$/.test(text.count.trim()) ? Math.min(MAX_SIZE_COUNT, Number(text.count)) : 0,
                                    extraCents: extra !== null && extra <= MAX_SIZE_EXTRA_CENTS ? extra : 0,
                                  }
                                : null,
                            )
                          }
                        />
                        {label}
                      </label>
                    </th>
                    <td>
                      <input
                        type="text"
                        inputMode="numeric"
                        className={countWrong ? 'bkrename__input is-wrong' : 'bkrename__input'}
                        aria-label={`How many ${label} on hand`}
                        value={size ? text.count : ''}
                        placeholder="—"
                        disabled={busy || !size}
                        onChange={(event) => {
                          setText(label, { count: event.target.value });
                          const value = event.target.value.trim();
                          if (size && /^\d+$/.test(value)) {
                            put(label, { ...size, count: Math.min(MAX_SIZE_COUNT, Number(value)) });
                          }
                        }}
                      />
                    </td>
                    <td>
                      <span className="bkdetails__money">
                        <span aria-hidden="true">+$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className={extraWrong ? 'bkrename__input is-wrong' : 'bkrename__input'}
                          aria-label={`What ${label} adds to the price, in dollars`}
                          value={size ? text.extra : ''}
                          placeholder="0"
                          disabled={busy || !size}
                          onChange={(event) => {
                            setText(label, { extra: event.target.value });
                            const value = event.target.value.trim() === '' ? 0 : parseDollars(event.target.value);
                            if (size && value !== null && value <= MAX_SIZE_EXTRA_CENTS) {
                              put(label, { ...size, extraCents: value });
                            }
                          }}
                        />
                      </span>
                    </td>
                    <td className="bksizes__price">
                      {size ? money(priceCents + size.extraCents) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="bkpanel__aside">
            {sizes.length === 0
              ? 'Tick the sizes it comes in. Until one is ticked it cannot be bought.'
              : `${onHand} on hand across ${sizes.length} ${sizes.length === 1 ? 'size' : 'sizes'}. ` +
                'Counted on the website only — an online sale lowers the count, a sale on the register does not. ' +
                'A size at 0 shows as sold out.'}
          </p>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Categories — Square's subcategories of the Bookstore                       */
/* -------------------------------------------------------------------------- */

/**
 * Which categories an item is filed in, as a checklist of the whole tree.
 *
 * Checkboxes rather than the dropdown this replaced, because an item can be in
 * several — Square allows it and the parish asked for it. Indented by depth so
 * "Arabic books" reads as part of "Books". Ticking a subcategory does not tick
 * its parent: the shop already shows a subcategory's items under the parent.
 */
function CategoryChecklist({
  name,
  sections,
  chosen,
  busy,
  onChange,
}: {
  name: string;
  sections: readonly BookstoreSection[];
  chosen: readonly string[];
  busy: boolean;
  onChange: (next: readonly string[]) => void;
}) {
  // Tree order: each category followed by its own children, at any depth.
  const rows: { section: BookstoreSection; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const section of childSections(sections, parentId)) {
      rows.push({ section, depth });
      if (depth < 8) walk(section.id, depth + 1);
    }
  };
  walk(null, 0);

  return (
    <fieldset className="bkcatlist" disabled={busy}>
      <legend className="visually-hidden">Categories for {name}</legend>
      {rows.map(({ section, depth }) => (
        <label key={section.id} className="bkship__media" style={{ paddingInlineStart: `${depth * 1.1}rem` }}>
          <input
            type="checkbox"
            checked={chosen.includes(section.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...chosen, section.id]
                  : chosen.filter((id) => id !== section.id),
              )
            }
          />
          {section.label}
        </label>
      ))}
      <p className="bkpanel__aside">
        {chosen.length === 0
          ? 'In no category — it shows under \u201CEverything else\u201D.'
          : 'Saved to Square too, so the register files it the same way.'}
      </p>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------- */
/* Sales tax                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether Massachusetts sales tax applies to this item.
 *
 * Off unless somebody turns it on. Books used in worship are exempt; gifts and
 * goods generally are not — the hint says so in a line, because the person
 * ticking it is a volunteer, not an accountant. The rate is the shop's, set
 * once in the shop panel.
 */
function TaxableField({
  taxable,
  busy,
  onChange,
}: {
  taxable: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="bkship">
      <label className="bkship__media">
        <input
          type="checkbox"
          checked={taxable}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked)}
        />
        Charge sales tax on this item
      </label>
      <p className="bkpanel__aside">
        {taxable
          ? 'Tax is added at checkout and shown as its own line.'
          : 'Not taxed. Leave off for books used in worship; tick for gifts and goods.'}
      </p>
    </div>
  );
}

/**
 * The shop's sales-tax rate, saved with its own button like the shipping
 * settings — one decision about money, made once.
 */
function TaxSettings({
  taxRateBps,
  taxed,
  onChanged,
  onError,
}: {
  taxRateBps: number;
  /** How many products are marked taxable, so the rate is not set in a vacuum. */
  taxed: number;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { busy, saved, write } = useWriter(onChanged, onError);
  const [text, setText] = useState(taxPercentage(taxRateBps));
  useEffect(() => setText(taxPercentage(taxRateBps)), [taxRateBps]);

  const trimmed = text.trim().replace(/%$/, '').trim();
  const value = /^\d{1,2}(\.\d{1,2})?$/.test(trimmed) ? Math.round(Number(trimmed) * 100) : null;
  const valid = value !== null && value <= MAX_TAX_RATE_BPS;
  const changed = valid && value !== taxRateBps;

  return (
    <div className="bkshipcfg">
      <label className="bkshipcfg__field">
        <span className="bkshipcfg__label">Tax rate</span>
        <span className="bkunit">
          <input
            className={valid ? 'bkrename__input' : 'bkrename__input is-wrong'}
            inputMode="decimal"
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="bkunit__post">%</span>
        </span>
        <span className="bkshipcfg__hint">
          Massachusetts is 6.25%. Applied only to items marked taxable
          {taxed > 0 ? ` — ${taxed} ${taxed === 1 ? 'item is' : 'items are'} now.` : ' — none are yet.'}{' '}
          Delivery is never taxed.
        </span>
      </label>
      <div className="bkshipcfg__go">
        <button
          type="button"
          className="button button--small"
          disabled={busy || !changed}
          onClick={() => {
            const save = async () => {
              const { writeTaxRate } = await import('./adminData');
              await writeTaxRate(value as number);
            };
            void write(save);
          }}
        >
          Save tax rate
        </button>
        <SaveState busy={busy} saved={saved} dirty={changed} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shipping: weight and Media Mail                                            */
/* -------------------------------------------------------------------------- */

/**
 * The two facts live postage needs about a book, for the settings panel and the
 * add form alike.
 *
 * Weighed in pounds, stored in ounces. The box keeps its own text, because what
 * somebody is halfway through typing — `1.` on the way to `1.5` — is not yet a
 * weight, and pushing
 * every keystroke through the parser would rewrite the box under their fingers.
 * Only text that reads as a weight, or an emptied box, is passed up.
 */
export function ShippingFields({
  name,
  weightOz,
  mediaMail,
  busy,
  onChange,
}: {
  name: string;
  weightOz: number | null;
  mediaMail: boolean;
  busy: boolean;
  onChange: (next: { weightOz: number | null; mediaMail: boolean }) => void;
}) {
  const [text, setText] = useState(weightOz === null ? '' : ouncesToPounds(weightOz));
  const parsed = parseWeight(text);
  const wrong = parsed === undefined;

  return (
    <div className="bkship">
      <label className="bkship__weight">
        <span className="visually-hidden">Shipping weight of {name}, in pounds</span>
        <input
          type="text"
          className={wrong ? 'bkrename__input is-wrong' : 'bkrename__input'}
          inputMode="decimal"
          placeholder="Weight, lb"
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            const next = parseWeight(event.target.value);
            if (next !== undefined) onChange({ weightOz: next, mediaMail });
          }}
        />
      </label>
      <label className="bkship__media">
        <input
          type="checkbox"
          checked={mediaMail}
          disabled={busy}
          onChange={(event) => onChange({ weightOz, mediaMail: event.target.checked })}
        />
        Book or media (Media Mail)
      </label>
      <p className={wrong ? 'bkpanel__aside bkpanel__aside--wrong' : 'bkpanel__aside'}>
        {wrong
          ? 'Type pounds, like 2 or 1.5.'
          : parsed === null
            ? 'Not weighed — a delivery with this in it is charged the flat rate.'
            : `${formatWeight(parsed)} a copy, before the box.`}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The book's own details: title, price, description                          */
/* -------------------------------------------------------------------------- */

/**
 * The three things Square owns, edited together and saved on demand.
 *
 * ---------------------------------------------------------------------------
 * Not held for the save bar, and not saved on blur either.
 *
 * The bar exists for the stepper, the category and the pictures — edits that are
 * cheap, reversible, and made across several books in a row. These are none of
 * those: they are one book at a time, they go to Square, and they change what
 * the book is called and what it costs on the till as well as on the shop. An
 * explicit button is the honest control for that.
 *
 * Saving on blur was the first attempt at the title and is worse than either:
 * tabbing past a field you only meant to read renames a book in Square, and
 * there is nothing to press to undo it.
 *
 * ## One button for the three
 *
 * They were going to be three controls with three buttons, which is three round
 * trips and — because `catalog.version.updated` triggers a mirror — three full
 * catalog syncs to change one book. `setProductDetails` sends only what
 * actually differs, so pressing Save once after editing all three is one write.
 *
 * The fields re-seed when the panel moves to a different book *or* when a saved
 * value comes back changed. `product` is the live document, so without the
 * second half a successful save would leave the boxes showing what you typed and
 * the button still lit as though nothing had happened.
 * ---------------------------------------------------------------------------
 */
function ProductDetailsForm({
  product,
  busy,
  onWrite,
}: {
  product: ShopProduct;
  busy: boolean;
  onWrite: (run: () => Promise<void>) => Promise<boolean>;
}) {
  /*
   * Dollars as typed, cents when sent. `Math.round`, never `trunc`: `4.35 * 100`
   * is `434.99999999999994` in binary floating point, and truncating charges a
   * cent less than the parish set. Same arithmetic as the add form.
   */
  const asDollars = (cents: number) => (cents / 100).toFixed(2);

  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(asDollars(product.amount));
  const [description, setDescription] = useState(product.description);

  useEffect(() => {
    setName(product.name);
    setPrice(asDollars(product.amount));
    setDescription(product.description);
  }, [product.slug, product.name, product.amount, product.description]);

  const title = name.trim().replace(/\s+/g, ' ');
  const blurb = description.trim();

  const cents = (() => {
    const trimmed = price.trim().replace(/^\$/, '');
    if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
    const value = Math.round(Number(trimmed) * 100);
    return value > 0 && value <= 100_000 ? value : null;
  })();

  const titleChanged = title.length > 0 && title !== product.name;
  const priceChanged = cents !== null && cents !== product.amount;
  const blurbChanged = blurb !== product.description;
  /* A price box that cannot be parsed blocks Save rather than being ignored —
     silently keeping the old price after somebody typed a new one is worse. */
  const priceBroken = price.trim() !== '' && cents === null;
  const changed = (titleChanged || priceChanged || blurbChanged) && !priceBroken && title.length > 0;

  const save = async () => {
    if (!changed || busy) return;
    await onWrite(async () => {
      const { setProductDetails } = await import('./adminData');
      await setProductDetails(product.slug, {
        ...(titleChanged ? { name: title } : {}),
        ...(priceChanged ? { priceCents: cents } : {}),
        ...(blurbChanged ? { description: blurb } : {}),
      });
    });
  };

  /* Enter saves from either single-line box, Escape abandons the lot. The
     description is a textarea, where Enter is a newline and must stay one. */
  const keys = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      setName(product.name);
      setPrice(asDollars(product.amount));
      setDescription(product.description);
    }
  };

  return (
    <div className="bkdetails">
      <label className="bkdetails__row">
        <span className="bkdetails__label">Title</span>
        <input
          type="text"
          className="bkrename__input"
          value={name}
          disabled={busy}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={keys}
        />
      </label>

      <label className="bkdetails__row">
        <span className="bkdetails__label">Price</span>
        <span className="bkdetails__money">
          <span aria-hidden="true">$</span>
          <input
            type="text"
            className={priceBroken ? 'bkrename__input is-wrong' : 'bkrename__input'}
            value={price}
            inputMode="decimal"
            aria-label={`Price of ${product.name} in dollars`}
            aria-invalid={priceBroken}
            disabled={busy}
            onChange={(event) => setPrice(event.target.value)}
            onKeyDown={keys}
          />
        </span>
      </label>

      <label className="bkdetails__row">
        <span className="bkdetails__label">Description</span>
        <textarea
          className="bkdetails__text"
          value={description}
          rows={3}
          maxLength={2000}
          placeholder="A line about it — shown under the title on the shelf."
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') keys(event);
          }}
        />
      </label>

      {priceBroken && (
        <p className="bkpanel__aside bkpanel__aside--wrong">
          A price like 8 or 8.50, up to $1,000.00.
        </p>
      )}

      <div className="bkdetails__go">
        <button
          type="button"
          className="button button--small"
          disabled={busy || !changed}
          onClick={() => void save()}
        >
          Save to Square
        </button>
      </div>

      <p className="bkpanel__aside">
        Goes to Square, so the till shows it too. The web address stays as it is,
        so nobody’s bookmark or past receipt breaks.
      </p>
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
      <p>
        This takes the book off the website and out of the Square register.
        Past orders keep it.
      </p>
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
 * **This no longer writes anything.** It used to debounce a call to Square's
 * inventory API ~700ms after the last press, which meant the card decided when
 * your edit was sent and a run of presses across several books was a run of
 * round trips. The number now changes here and waits on the bar at the foot of
 * the shop. See `pendingEdits.tsx` for what is held and what still acts at once.
 *
 * That also removes the whole class of bug the debounce needed guarding against
 * — stale closures, out-of-order responses, re-seeding from a document mid-press
 * — because there is no longer anything in flight to be out of order with.
 * ---------------------------------------------------------------------------
 */
function StockStepper({
  product,
  busy,
}: {
  product: ShopProduct;
  busy: boolean;
}) {
  const { stockCount, setStock, nudge } = usePendingEdit(product.slug, {
    stockCount: product.stockCount ?? null,
    categoryIds: product.categoryIds,
  });

  if (stockCount === null) {
    return (
      <span className="bkedit__untracked">
        <span className="bkedit__value">not counted</span>
        <button
          type="button"
          className="bkedit__power"
          disabled={busy}
          title="Start tracking stock for this book"
          aria-label="Start tracking stock"
          onClick={() => setStock(0)}
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
        disabled={busy || stockCount === 0}
        onClick={() => nudge(-1)}
      >
        −
      </button>
      <output className={stockCount === 0 ? 'bkstep__n is-out' : 'bkstep__n'} aria-live="polite">
        {stockCount}
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
        title="Stop tracking stock for this book"
        aria-label="Stop tracking stock"
        onClick={() => setStock(null)}
      >
        stop counting
      </button>
      {/* Zero is the one state worth a word — it takes the product off the shop.
          Beside the stepper rather than as a badge on its own line. */}
      {stockCount === 0 && <span className="bkstep__flag">sold out</span>}
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
  onError,
}: {
  product: ShopProduct;
  doc: DocOf<Product> | undefined;
  busy: boolean;
  variant?: 'row' | 'panel';
  onError: (message: string) => void;
}) {
  /* Reading the file and shrinking it, not sending it — nothing goes to Square
     until Save. Still worth a state: `downscale` decodes a phone photograph,
     which is long enough to look like nothing happened. */
  const [reading, setReading] = useState(false);
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

  const {
    addedImages,
    removedImages,
    holdImage,
    unholdImage,
    markImageRemoved,
    unmarkImageRemoved,
  } = usePendingEdit(product.slug, {
    stockCount: product.stockCount ?? null,
    categoryIds: product.categoryIds,
  });

  const saved = doc?.imagePaths ?? [];

  /*
   * What to show: every saved photograph, then every one chosen here.
   *
   * A photograph marked for removal is *not* dropped from this list — it stays,
   * dimmed, with a way to put it back. That is the point of holding the edit at
   * all: a removal you cannot see is a removal you cannot change your mind
   * about, and before this change the only undo was re-uploading the file.
   *
   * The order is exactly what `save` performs — removals, then additions
   * appended — so the tiles are a true preview of the result, cover included.
   */
  const tiles = [
    ...saved.map((url) => ({
      key: url,
      src: url,
      removed: removedImages.includes(url),
      undo: () => unmarkImageRemoved(url),
      off: () => markImageRemoved(url),
    })),
    ...addedImages.map((image) => ({
      key: image.id,
      src: image.dataUrl,
      removed: false,
      undo: undefined,
      off: () => unholdImage(image.id),
    })),
  ];

  /* Which tile the shop will use as the cover: the first one still standing. */
  const coverKey = tiles.find((tile) => !tile.removed)?.key;

  const take = async (files: readonly File[]) => {
    const pictures = files.filter((one) => one.type.startsWith('image/'));
    // Said rather than ignored: a dropped PDF looks like it worked otherwise.
    if (pictures.length === 0) {
      onError('That file is not a picture.');
      return;
    }

    setReading(true);
    try {
      /* Sequentially, so several large photographs do not decode at once and
         lock the tab up on the machine in the church office. */
      for (const file of pictures) holdImage(await downscale(file));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That picture could not be read.');
    } finally {
      setReading(false);
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
        if (reading || busy) return;
        void take(Array.from(event.dataTransfer.files));
      }}
    >
      {tiles.map((tile, index) => (
        <Tile
          className={tile.removed ? 'bkpix__one is-removed' : 'bkpix__one'}
          key={tile.key}
        >
          {/* A plain `img`: saved ones are Square CDN URLs the export build
              knows nothing about, and `next/image` would need every host in
              `remotePatterns` for a thumbnail this size. A held one is a
              `data:` URL, which it could not take at all. */}
          <img src={tile.src} alt="" loading="lazy" />

          {/* The first is what the shop shows, and saying so is the difference
              between "why is that one the cover" and knowing. */}
          {tile.key === coverKey && <span className="bkpix__cover">cover</span>}
          {tile.removed && <span className="bkpix__gone">removing</span>}

          {/*
            On the card this is a × that appears on approach, because a row of
            badges over every thumbnail is what made that block look busy. In the
            panel it is a word: there is room for one, the pictures are large
            enough that the mark would look like part of the photograph, and
            "discoverable on hover" is not a property a destructive control on a
            touchscreen can have.
          */}
          {tile.removed ? (
            <button
              type="button"
              className={panel ? 'bkpix__off' : 'bkpix__del'}
              disabled={busy}
              aria-label={`Keep picture ${index + 1} on ${product.name}`}
              title="Put this picture back"
              onClick={tile.undo}
            >
              {panel ? 'Put back' : '↺'}
            </button>
          ) : (
            <button
              type="button"
              className={panel ? 'bkpix__off' : 'bkpix__del'}
              disabled={busy}
              aria-label={`Remove picture ${index + 1} of ${tiles.length} from ${product.name}`}
              title="Remove this picture"
              onClick={tile.off}
            >
              {panel ? 'Remove' : '×'}
            </button>
          )}
        </Tile>
      ))}

      <button
        type="button"
        className="bkpix__add"
        disabled={reading || busy}
        title="Add a picture, or drag one in"
        aria-label={`Add a picture to ${product.name}`}
        onClick={() => picker.current?.click()}
      >
        {panel ? (
          <>
            <span className="bkpix__addmark" aria-hidden="true">
              {reading ? '…' : '+'}
            </span>
            <span className="bkpix__addword">
              {reading ? 'Reading…' : over > 0 ? 'Drop it here' : 'Add a picture'}
            </span>
          </>
        ) : reading ? (
          '…'
        ) : (
          '+'
        )}
      </button>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) void take(files);
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
  parentId = null,
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
  /**
   * Which level of the tree this row edits: null for the top-level categories,
   * or a category's id for the subcategories inside it. Shop draws a second row
   * for the chosen category's children.
   */
  parentId?: string | null;
}) {
  const row = useRef<HTMLDivElement>(null);
  /** The categories on this row, in the parish's order. */
  const level = childSections(sections, parentId);
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

  /** One change, with the row held busy and the shop refreshed after. */
  const run = async (task: (data: typeof import('./adminData')) => Promise<unknown>) => {
    setBusy(true);
    try {
      await task(await import('./adminData'));
      onChanged();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'The categories could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  /*
   * A new order for this row, written into the whole list.
   *
   * The order is the parish's and is kept on the site — Square has none for
   * categories — so this is the one change here that is a Firestore write. The
   * row's categories take the slots they already held in the full list, in
   * their new order, so the other levels do not move.
   */
  const save = (nextLevel: BookstoreSection[]) =>
    run(async ({ writeSections }) => {
      const ids = new Set(nextLevel.map((one) => one.id));
      const queue = [...nextLevel];
      await writeSections(sections.map((one) => (ids.has(one.id) ? queue.shift()! : one)));
    });

  /*
   * The order being edited is the one in `sections`, which is every category the
   * parish has. `groups` is the shopper's view and omits the empty ones.
   */
  const orderOf = (id: string) => level.findIndex((row) => row.id === id);

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
          const next = [...level];
          const [lifted] = next.splice(drag.from, 1);
          if (lifted) next.splice(drag.to, 0, lifted);
          return next;
        })()
      : level;

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

    const order = level;
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
    if (from < 0 || to < 0 || to >= level.length) return;
    const next = [...level];
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
    // Renamed in Square — so on the register and in its reports too. The id
    // never changes, so every item filed under it stays filed.
    void run(({ renameCategory }) => renameCategory(id, clean));
  };

  const add = (label: string) => {
    const clean = label.trim().slice(0, MAX_SECTION_LABEL);
    setAdding(false);
    if (!clean || sections.length >= MAX_SECTIONS) return;

    // A repeated name on the same level is refused rather than made twice.
    if (level.some((row) => row.label.toLowerCase() === clean.toLowerCase())) {
      onError(`There is already a category called \u201C${clean}\u201D here.`);
      return;
    }
    // Made in Square, under the Bookstore or under this row's parent.
    void run(({ createCategory }) => createCategory(clean, parentId));
  };

  return (
    <div
      className={drag?.moved ? 'shop-filters is-editing is-dragging' : 'shop-filters is-editing'}
      ref={row}
      role="group"
      aria-label={parentId === null ? 'Categories — drag to reorder' : 'Subcategories — drag to reorder'}
    >
      {/* On a subcategory row, "All" is everything in the parent category. */}
      <button
        type="button"
        className={active === (parentId ?? undefined) ? 'shop-filter is-on' : 'shop-filter'}
        aria-pressed={active === (parentId ?? undefined)}
        onClick={() => onPick(parentId ?? undefined)}
      >
        All
        <span className="shop-filter__n">{parentId === null ? total : (countOf.get(parentId) ?? 0)}</span>
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
          // Deleted in Square. Refused there while anything is still in it.
          onRemove={() => void run(({ removeCategory }) => removeCategory(section.id))}
        />
      ))}

      {/* The catch-all, last. Not a category — there is nothing stored to drag,
          rename or remove — so it stays a plain filter, and it is absent when
          everything has been filed. */}
      {parentId === null && unfiled && (
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
            {parentId === null ? '+ Category' : '+ Subcategory'}
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
  /**
   * `tile` is the last cell of the shelf grid, which is what this was.
   * `panel` is the editing column, which has no grid and cannot hold an `<li>`.
   *
   * Two shells around one `NewProduct`, the same arrangement `Pictures` uses for
   * the same reason: all the difficulty is in the form — the price parsing, the
   * held photographs, the create-then-upload order — and none of it differs
   * between the two places it can appear.
   */
  variant = 'tile',
}: {
  sections: BookstoreSection[];
  onChanged: () => void;
  onError: (message: string) => void;
  variant?: 'tile' | 'panel' | undefined;
}) {
  const [open, setOpen] = useState(false);
  const Shell = variant === 'panel' ? 'div' : 'li';
  const shell = variant === 'panel' ? 'bkadd-panel' : 'book book--add';

  if (!open) {
    return (
      <Shell className={shell}>
        <button type="button" className="bkadd" onClick={() => setOpen(true)}>
          <span className="bkadd__plus" aria-hidden="true">
            +
          </span>
          <span className="bkadd__word">Add a product</span>
        </button>
      </Shell>
    );
  }

  return (
    <Shell className={`${shell} is-open`}>
      <NewProduct
        sections={sections}
        onClose={() => setOpen(false)}
        onAdded={() => {
          setOpen(false);
          onChanged();
        }}
        onError={onError}
      />
    </Shell>
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
  const [categoryIds, setCategoryIds] = useState<readonly string[]>([]);
  const [shipping, setShipping] = useState<{ weightOz: number | null; mediaMail: boolean }>({
    weightOz: null,
    // Most of what the shop sells is books, so the box starts ticked.
    mediaMail: true,
  });
  // Off, like every product: nothing is taxed until somebody says so.
  const [taxable, setTaxable] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * Pictures chosen for a book that does not exist yet.
   *
   * Local state rather than `pendingEdits`, because everything there is keyed by
   * slug and this product has no slug until Square has given it one. Same
   * `downscale` and the same `data:` URLs, so the tiles preview identically to
   * the ones on a saved card.
   */
  const [pictures, setPictures] = useState<{ id: string; dataUrl: string }[]>([]);
  const [reading, setReading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const takePictures = async (files: readonly File[]) => {
    const chosen = files.filter((one) => one.type.startsWith('image/'));
    if (chosen.length === 0) {
      onError('That file is not a picture.');
      return;
    }
    setReading(true);
    try {
      for (const file of chosen) {
        const dataUrl = await downscale(file);
        setPictures((was) => [
          ...was,
          { id: globalThis.crypto?.randomUUID?.() ?? `p-${was.length}-${Date.now()}`, dataUrl },
        ]);
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : 'That picture could not be read.');
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = '';
    }
  };

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
    if (!name.trim() || cents === null || busy || reading) return;
    setBusy(true);
    try {
      const { createProduct, uploadProductImage } = await import('./adminData');
      const slug = await createProduct({
        name: name.trim(),
        description: description.trim(),
        priceCents: cents,
        categoryIds: [...categoryIds],
        weightOz: shipping.weightOz,
        mediaMail: shipping.mediaMail,
        taxable,
      });

      /*
       * The book first, then its photographs, and the order is forced: an image
       * is attached to a catalog object, so there is nothing to attach one to
       * until Square has minted the item and told us its slug.
       *
       * A picture that fails therefore fails *after* the book exists. Saying so
       * and leaving the book is the honest outcome — the alternative is deleting
       * a product the parish just created because one photograph did not upload,
       * and the pictures can be added again from the card in a second.
       */
      for (const picture of pictures) {
        try {
          await uploadProductImage(slug, picture.dataUrl);
        } catch (cause) {
          onError(
            `"${name.trim()}" was added, but a picture did not upload` +
              `${cause instanceof Error ? `: ${cause.message}` : '.'} ` +
              'Add it from the book’s own settings.',
          );
          break;
        }
      }

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
        <CategoryChecklist
          name={name.trim() || 'this item'}
          sections={sections}
          chosen={categoryIds}
          busy={busy}
          onChange={setCategoryIds}
        />
      )}
      <ShippingFields
        name={name.trim() || 'this book'}
        weightOz={shipping.weightOz}
        mediaMail={shipping.mediaMail}
        busy={busy}
        onChange={setShipping}
      />
      <TaxableField taxable={taxable} busy={busy} onChange={setTaxable} />
      {/*
        The pictures, on the add form.
        Same tiles as a saved card so the two read as one control, and the same
        drag target — a volunteer adding a book has the cover on the desktop in
        front of them, and making them add the book first and photograph it
        second was an extra step for no reason.
      */}
      <span className="bknew__pix">
        {pictures.map((picture, index) => (
          <span className="bkpix__one" key={picture.id}>
            <img src={picture.dataUrl} alt="" />
            {index === 0 && <span className="bkpix__cover">cover</span>}
            <button
              type="button"
              className="bkpix__del"
              disabled={busy}
              aria-label={`Remove picture ${index + 1}`}
              title="Remove this picture"
              onClick={() => setPictures((was) => was.filter((one) => one.id !== picture.id))}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="bkpix__add"
          disabled={reading || busy}
          title="Add a picture"
          aria-label="Add a picture to this new book"
          onClick={() => picker.current?.click()}
        >
          {reading ? '…' : '+'}
        </button>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length > 0) void takePictures(files);
          }}
        />
      </span>

      <button
        type="button"
        className="button button--small"
        disabled={busy || reading || !name.trim() || cents === null}
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
  /*
   * The canvas work moved to `@/lib/downscale`, which the gallery upload path
   * also uses. One implementation rather than two, and the shared one fixed a
   * fault this copy had: `createImageBitmap(file)` without
   * `{ imageOrientation: 'from-image' }` ignores the EXIF rotation tag in some
   * engines, so a photograph taken sideways was baked in sideways while the
   * original still looked upright when you went to check.
   *
   * Still a data URL and still JPEG, because Square's image endpoint takes a
   * base64 body and re-encodes whatever it is given.
   */
  return downscaleToDataUrl(file, max);
}

/* -------------------------------------------------------------------------- */
/* The editing column                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Everything about the selected book, down the right, with the shelf narrowed
 * to fit beside it.
 *
 * ---------------------------------------------------------------------------
 * **This is a reversal, and the note it replaces argued the other way.** The
 * settings used to sit on each card, and the comment there said a column had
 * been tried and judged *"way too confusing"* — that a book on a shelf "has a
 * whole card" and needs no panel, unlike a photograph buried in a strip inside a
 * section. Tommy has asked for the column back: *"I want the editing products to
 * function similar to editing the pictures in events where it all shows up on
 * the side when selecting a specific product."*
 *
 * Worth doing again rather than arguing, because what made it fail was a bug
 * rather than the shape — the same bug that sank the galleries' first column.
 * `.rail--bleed` is `width: 100vw`, so a full-bleed rail measured itself against
 * the *window* and ran on underneath the panel; "the column took a third of the
 * horizontal space" was that, not a judgement about columns. `--edit-gutter`
 * fixed it, and the events column has been the good one ever since.
 *
 * The other half of the case is the one `editMode.tsx` makes and time has
 * proved: **every new thing an administrator can change adds a control next to
 * the thing it changes, and that does not converge.** The card carried a
 * stepper, a picture row and a category select; this week it would also have
 * carried a title field. Four controls on a 12rem tile, on a grid of ten.
 *
 * ## Never empty, never instructions
 *
 * With no book selected it shows the shop's own settings — the categories and
 * Add a book. That is the rule the galleries' column learned the hard way: the
 * arrangement before it died of being permanently present and mostly full of
 * help text, so a column that is always there has to earn its space in every
 * state.
 *
 * Deliberately *not* here: the delivery charge, the fulfilment line and the
 * returns notice. An in-place editor for exactly those was built on this page
 * once and rejected — *"I don't want it to be for editing."* They live in
 * `config/bookstore` and are edited in the Firebase console.
 * ---------------------------------------------------------------------------
 */
/**
 * How delivered orders are priced, edited for the whole shop.
 *
 * ---------------------------------------------------------------------------
 * Saved with its own button, not the bar. The bar holds per-book edits made in
 * a run across the shelf; this is one decision about money, made once, and an
 * explicit Save is the honest control for it — the same reasoning as a book's
 * title and price.
 *
 * Laid out as a choice first — flat rate or USPS — and only the USPS details
 * when USPS is chosen, each with its unit beside the box and a line saying
 * what it does. Weights are per book, in each book's own Shipping block.
 * ---------------------------------------------------------------------------
 */
function ShippingSettings({
  shipping,
  flatCents,
  onChanged,
  onError,
}: {
  shipping: BookstoreShipping;
  /** The flat delivery charge, shown for reference; set by the office. */
  flatCents: number;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { busy, saved, write } = useWriter(onChanged, onError);
  const seedText = (from: BookstoreShipping) => ({
    handling: (from.handlingCents / 100).toFixed(2),
    lengthIn: String(from.box.lengthIn),
    widthIn: String(from.box.widthIn),
    heightIn: String(from.box.heightIn),
    tare: ouncesToPounds(from.box.tareOz),
  });
  const [draft, setDraft] = useState(shipping);
  // What is typed, kept as text so a half-typed "1." is not rewritten.
  const [text, setText] = useState(() => seedText(shipping));
  // Re-seed when a save comes back, so the button goes quiet once it has landed.
  useEffect(() => {
    setDraft(shipping);
    setText(seedText(shipping));
  }, [shipping]);

  const money = (value: string): number | null => {
    const trimmed = value.trim().replace(/^\$/, '');
    if (!/^\d*(\.\d{0,2})?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
    const cents = Math.round(Number(trimmed) * 100);
    return cents <= MAX_HANDLING_CENTS ? cents : null;
  };
  const number = (value: string, min: number, max: number): number | null => {
    const n = Number(value.trim());
    return value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max ? n : null;
  };

  const handlingCents = money(text.handling);
  const lengthIn = number(text.lengthIn, 1, 36);
  const widthIn = number(text.widthIn, 1, 36);
  const heightIn = number(text.heightIn, 1, 36);
  const tareLb = number(text.tare, 0, 5);
  const zipOk = /^\d{5}$/.test(draft.originZip);
  const live = draft.mode === 'usps';

  const valid =
    !live ||
    (zipOk &&
      handlingCents !== null &&
      lengthIn !== null &&
      widthIn !== null &&
      heightIn !== null &&
      tareLb !== null &&
      draft.services.length > 0);
  const next: BookstoreShipping = {
    ...draft,
    handlingCents: handlingCents ?? draft.handlingCents,
    box: {
      lengthIn: lengthIn ?? draft.box.lengthIn,
      widthIn: widthIn ?? draft.box.widthIn,
      heightIn: heightIn ?? draft.box.heightIn,
      // Untouched text keeps the stored ounces: 6 oz shows as 0.38 lb, and
      // converting that back would read as an edit nobody made.
      tareOz:
        tareLb === null || text.tare === ouncesToPounds(draft.box.tareOz)
          ? draft.box.tareOz
          : Math.round(tareLb * 1600) / 100,
    },
  };
  const changed = JSON.stringify(next) !== JSON.stringify(shipping);

  const type = (key: keyof ReturnType<typeof seedText>) => (event: { target: { value: string } }) =>
    setText((was) => ({ ...was, [key]: event.target.value }));
  const toggleService = (service: ShippingService, on: boolean) =>
    setDraft((was) => ({
      ...was,
      // Kept in the canonical order, which is the order the shopper sees.
      services: SHIPPING_SERVICES.filter((one) => (one === service ? on : was.services.includes(one))),
    }));

  return (
    <div className="bkshipcfg">
      <fieldset className="bkshipcfg__mode" disabled={busy}>
        <legend className="bkshipcfg__q">How is delivery priced?</legend>
        <label className={!live ? 'bkshipcfg__opt is-on' : 'bkshipcfg__opt'}>
          <input
            type="radio"
            name="shipping-mode"
            checked={!live}
            onChange={() => setDraft((was) => ({ ...was, mode: 'flat' }))}
          />
          <span className="bkshipcfg__opt-name">Flat rate</span>
          <span className="bkshipcfg__opt-note">{formatCents(flatCents)} on every delivery</span>
        </label>
        <label className={live ? 'bkshipcfg__opt is-on' : 'bkshipcfg__opt'}>
          <input
            type="radio"
            name="shipping-mode"
            checked={live}
            onChange={() => setDraft((was) => ({ ...was, mode: 'usps' }))}
          />
          <span className="bkshipcfg__opt-name">USPS rates</span>
          <span className="bkshipcfg__opt-note">Priced by weight and the buyer&rsquo;s ZIP code</span>
        </label>
      </fieldset>

      {live && (
        <fieldset className="bkshipcfg__details" disabled={busy}>
          <label className="bkshipcfg__field">
            <span className="bkshipcfg__label">Ship from ZIP code</span>
            <input
              className={zipOk ? 'bkrename__input' : 'bkrename__input is-wrong'}
              inputMode="numeric"
              maxLength={5}
              value={draft.originZip}
              onChange={(event) => setDraft((was) => ({ ...was, originZip: event.target.value.trim() }))}
            />
            <span className="bkshipcfg__hint">Where parcels are posted from.</span>
          </label>

          <label className="bkshipcfg__field">
            <span className="bkshipcfg__label">Handling fee</span>
            <span className="bkunit">
              <span className="bkunit__pre">$</span>
              <input
                className={handlingCents === null ? 'bkrename__input is-wrong' : 'bkrename__input'}
                inputMode="decimal"
                value={text.handling}
                onChange={type('handling')}
              />
            </span>
            <span className="bkshipcfg__hint">Added once per order, on top of postage. 0 for none.</span>
          </label>

          <div className="bkshipcfg__field">
            <span className="bkshipcfg__label">Box size</span>
            <span className="bkshipcfg__box">
              {(
                [
                  ['lengthIn', 'Length', lengthIn],
                  ['widthIn', 'Width', widthIn],
                  ['heightIn', 'Height', heightIn],
                ] as const
              ).map(([key, label, parsed]) => (
                <label key={key} className="bkunit">
                  <span className="visually-hidden">{label} in inches</span>
                  <input
                    className={parsed === null ? 'bkrename__input is-wrong' : 'bkrename__input'}
                    inputMode="decimal"
                    value={text[key]}
                    placeholder={label[0]}
                    onChange={type(key)}
                  />
                  <span className="bkunit__post">in</span>
                </label>
              ))}
            </span>
            <span className="bkshipcfg__hint">Length × width × height of the box you usually use.</span>
          </div>

          <label className="bkshipcfg__field">
            <span className="bkshipcfg__label">Empty box weight</span>
            <span className="bkunit">
              <input
                className={tareLb === null ? 'bkrename__input is-wrong' : 'bkrename__input'}
                inputMode="decimal"
                value={text.tare}
                onChange={type('tare')}
              />
              <span className="bkunit__post">lb</span>
            </span>
            <span className="bkshipcfg__hint">Added to the books&rsquo; weight, with the packing.</span>
          </label>

          <div className="bkshipcfg__field">
            <span className="bkshipcfg__label">Services buyers can choose</span>
            {SHIPPING_SERVICES.map((service) => (
              <label key={service} className="bkshipcfg__svc">
                <input
                  type="checkbox"
                  checked={draft.services.includes(service)}
                  onChange={(event) => toggleService(service, event.target.checked)}
                />
                <span>
                  {SERVICE_LABELS[service]}
                  <span className="bkshipcfg__hint">
                    {SERVICE_DAYS[service]}
                    {service === 'MEDIA_MAIL' && ' · only when every item is a book or media'}
                  </span>
                </span>
              </label>
            ))}
            {draft.services.length === 0 && (
              <span className="bkpanel__aside bkpanel__aside--wrong">Choose at least one.</span>
            )}
          </div>

          <p className="bkshipcfg__hint">
            Each item&rsquo;s weight is set on the item itself. An order with an item that has no weight
            pays the flat rate.
          </p>
        </fieldset>
      )}

      <div className="bkshipcfg__go">
        <button
          type="button"
          className="button button--small"
          disabled={busy || !changed || !valid}
          onClick={() => {
            const save = async () => {
              const { writeShipping } = await import('./adminData');
              await writeShipping(next);
            };
            void write(save);
          }}
        >
          Save shipping
        </button>
        <SaveState busy={busy} saved={saved} dirty={changed} />
      </div>
    </div>
  );
}

/** `700` → `"$7.00"`. */
function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ShopInspector({
  editing,
  product,
  doc,
  sections,
  groups,
  shipping,
  flatCents,
  taxRateBps,
  taxedCount,
  onDone,
  onSelect,
  onChanged,
  onError,
  children,
}: {
  editing: boolean;
  /** The selected book, or undefined for the shop itself. */
  product: ShopProduct | undefined;
  doc: DocOf<Product> | undefined;
  sections: BookstoreSection[];
  /** How many books sit under each category, for the shop-wide view. */
  groups: { id: string; label: string; count: number }[];
  /** The live-postage settings, as `config/bookstore` holds them. */
  shipping: BookstoreShipping;
  /** The flat delivery charge, for the shipping panel to show. */
  flatCents: number;
  /** The sales-tax rate, in basis points. */
  taxRateBps: number;
  /** How many products are marked taxable, for the tax panel's hint. */
  taxedCount: number;
  onDone: () => void;
  onSelect: (slug: string | null) => void;
  onChanged: () => void;
  onError: (message: string) => void;
  /** The Add-a-book form, passed in so the column does not own its state. */
  children?: ReactNode;
}) {
  const { count, saving } = usePendingEdits();

  return (
    <EditColumn
      on={editing}
      kind={product ? 'Book' : 'Shop'}
      title={product ? product.name : 'The bookstore'}
      /*
       * The column's indicator reads from the save bar rather than from the last
       * write, because on this page edits are *held*. "Saved" beside three
       * unsaved changes would be a lie, and it is the one question the header
       * exists to answer.
       */
      saving={saving}
      onBack={product ? () => onSelect(null) : undefined}
      backLabel="Back to the shop"
      onDone={onDone}
    >
      {product ? (
        <ProductSettings
          bare
          product={product}
          doc={doc}
          sections={sections}
          onChanged={onChanged}
          onError={onError}
          /* The book was archived, so there is nothing left to describe. Back to
             the shop rather than an empty panel about a book that is gone. */
          onRemoved={() => onSelect(null)}
        />
      ) : (
        <div className="bkpanel">
          <p className="bkpanel__note">
            {count > 0
              ? 'Pick a book to change it. Your held changes are on the bar at the foot of the shop.'
              : 'Pick a book to change its title, price, description, pictures, stock or category.'}
          </p>

          <div className="bkpanel__block">
            <h4 className="bkpanel__label">Categories</h4>
            {groups.length > 0 ? (
              <ul className="bkcats">
                {groups.map((group) => (
                  <li key={group.id}>
                    <span className="bkcats__name">{group.label}</span>
                    {/* The count is the useful half: an empty category is the
                        thing somebody is most likely looking for here, and it is
                        invisible on the shelf because nothing renders under it. */}
                    <span className="bkcats__n">
                      {group.count} {group.count === 1 ? 'book' : 'books'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="bkpanel__aside">
                No categories yet. Add one from the row above the shelf.
              </p>
            )}
            <p className="bkpanel__aside">
              Rename, reorder and add categories on the pills above the shelf.
            </p>
          </div>

          <div className="bkpanel__block">
            <h4 className="bkpanel__label">Shipping</h4>
            <ShippingSettings
              shipping={shipping}
              flatCents={flatCents}
              onChanged={onChanged}
              onError={onError}
            />
          </div>

          <div className="bkpanel__block">
            <h4 className="bkpanel__label">Sales tax</h4>
            <TaxSettings
              taxRateBps={taxRateBps}
              taxed={taxedCount}
              onChanged={onChanged}
              onError={onError}
            />
          </div>

          {children && (
            <div className="bkpanel__block bkpanel__block--last">
              <h4 className="bkpanel__label">Add a book</h4>
              {children}
            </div>
          )}
        </div>
      )}
    </EditColumn>
  );
}
