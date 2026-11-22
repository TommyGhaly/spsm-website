'use client';

import { useEffect, useMemo, useState } from 'react';
import { cleanSizes, salesTaxCents, taxLabel, type DocOf, type Product } from '@spsm/shared';
import { money } from './money';

/**
 * Recording a sale paid in cash at the bookstore table.
 *
 * ---------------------------------------------------------------------------
 * The point is the counts, not the money.
 *
 * Square-tracked books come off Square's count only when Square sees a paid
 * order, and clothing sizes come off the site's counts only when an order is
 * recorded through a Function. A twenty handed over for a prayer book touched
 * neither, so the shop went on offering copies that had left the building. This
 * sends the sale to `squareCashOrder`, which makes it a real Square order paid
 * with Square's CASH source, and is refused — with the sentence to show — when
 * the counts cannot cover it.
 *
 * The total here is a preview, worked out the way the basket works it out;
 * Square prices the sale itself, and its figure is the one shown afterwards.
 * The app's `src/bookstore/admin/CashSale.tsx` is the same screen.
 * ---------------------------------------------------------------------------
 */

interface Line {
  product: DocOf<Product>;
  size: string | null;
  quantity: number;
}

function unitOf(product: Product, size: string | null): number {
  const extra = cleanSizes(product.sizes)?.find((one) => one.label === size)?.extraCents ?? 0;
  return (product.price?.amount ?? 0) + extra;
}

/** How many are on hand by the counts. Null: Square does not count it. */
function onHand(product: Product, size: string | null): number | null {
  const sizes = cleanSizes(product.sizes);
  if (sizes) return sizes.find((one) => one.label === size)?.count ?? 0;
  return typeof product.stockCount === 'number' ? product.stockCount : null;
}

/** `"12"`, `"12.5"`, `"$12.50"` → cents. Null for anything else. */
function centsOf(text: string): number | null {
  const trimmed = text.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export function CashSaleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [products, setProducts] = useState<DocOf<Product>[] | null>(null);
  const [rateBps, setRateBps] = useState(0);
  const [term, setTerm] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [tendered, setTendered] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ total: number; change: number } | null>(null);
  /* One key per dialog, so a retry after a lost answer records the sale once. */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { listProducts, readTaxRate } = await import('./adminData');
        const [all, rate] = await Promise.all([listProducts(), readTaxRate()]);
        if (!live) return;
        // Only what checkout would sell: published, and priced in Square.
        setProducts(all.filter((one) => one.published && one.squareVariationId));
        setRateBps(rate);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'Could not read the shop.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const found = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle || !products) return [];
    return products
      .filter(
        (one) => one.name.toLowerCase().includes(needle) || (one.sku ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [products, term]);

  const subtotal = lines.reduce((sum, line) => sum + unitOf(line.product, line.size) * line.quantity, 0);
  const tax = salesTaxCents(
    lines.map((line) => ({
      amountCents: unitOf(line.product, line.size) * line.quantity,
      taxable: line.product.taxable === true,
    })),
    rateBps,
  );
  const total = subtotal + tax;
  const tenderedCents = tendered.trim() === '' ? null : centsOf(tendered);
  const tenderedProblem =
    tendered.trim() === ''
      ? null
      : tenderedCents === null
        ? 'An amount like 20 or 20.00.'
        : tenderedCents < total
          ? `Less than the total, ${money(total)}.`
          : null;
  const over = lines.some((line) => {
    const left = onHand(line.product, line.size);
    return left !== null && line.quantity > left;
  });

  const add = (product: DocOf<Product>, size: string | null) => {
    setError(null);
    setLines((was) => {
      const at = was.findIndex((line) => line.product.id === product.id && line.size === size);
      if (at === -1) return [...was, { product, size, quantity: 1 }];
      return was.map((line, index) => (index === at ? { ...line, quantity: line.quantity + 1 } : line));
    });
    setTerm('');
  };

  const step = (index: number, by: number) => {
    setError(null);
    setLines((was) =>
      was
        .map((line, at) => (at === index ? { ...line, quantity: line.quantity + by } : line))
        .filter((line) => line.quantity > 0),
    );
  };

  const submit = async () => {
    if (sending || lines.length === 0 || over || tenderedProblem) return;
    setSending(true);
    setError(null);
    try {
      const { recordCashSale } = await import('./adminData');
      const answer = await recordCashSale({
        lines: lines.map((line) => ({ slug: line.product.slug, quantity: line.quantity, size: line.size })),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        tenderedCents,
        idempotencyKey,
      });
      setRecorded({ total: answer.total, change: answer.change });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The sale could not be recorded.');
    } finally {
      setSending(false);
    }
  };

  if (recorded) {
    return (
      <div className="bkmodal" role="dialog" aria-modal="true" aria-label="Cash sale recorded">
        <div className="bkmodal__panel">
          <h2 className="bkmodal__title">Recorded — {money(recorded.total)}</h2>
          <p className="bkmodal__note" role="status">
            {recorded.change > 0 ? `Give ${money(recorded.change)} change. ` : 'No change due. '}
            The stock has been taken off, and the sale is in Square as cash.
          </p>
          <div className="bkmodal__actions">
            <button type="button" className="button" onClick={onDone} autoFocus>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bkmodal" role="dialog" aria-modal="true" aria-label="Record a cash sale">
      <div className="bkmodal__panel bkcash">
        <h2 className="bkmodal__title">Cash sale</h2>
        <p className="bkmodal__note">
          For a sale paid in cash at the table. It is recorded in Square as cash and taken off
          the stock, so the shop does not sell the same copy online.
        </p>

        <label className="bkmodal__field">
          <span>Find an item</span>
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={products ? 'Title or SKU' : 'Reading the shop…'}
            disabled={!products || sending}
            autoFocus
          />
        </label>

        {found.length > 0 && (
          <ul className="bkcash__found">
            {found.map((product) => {
              const sizes = cleanSizes(product.sizes);
              const left = sizes ? null : onHand(product, null);
              return (
                <li key={product.id}>
                  <span className="bkcash__name">
                    {product.name}
                    <small>
                      {money(product.price?.amount ?? 0)}
                      {sizes ? '' : left === null ? ' · not counted' : left === 0 ? ' · sold out' : ` · ${left} on hand`}
                    </small>
                  </span>
                  {sizes ? (
                    <span className="bkcash__sizes">
                      {sizes.map((size) => (
                        <button
                          key={size.label}
                          type="button"
                          className="bkcash__chip"
                          disabled={size.count <= 0}
                          onClick={() => add(product, size.label)}
                          aria-label={`Add ${product.name} in size ${size.label}`}
                        >
                          {size.label} ({size.count})
                        </button>
                      ))}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="bkcash__chip"
                      disabled={left === 0}
                      onClick={() => add(product, null)}
                      aria-label={`Add ${product.name}`}
                    >
                      Add
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {term.trim() !== '' && products && found.length === 0 && (
          <p className="bkmodal__after">Nothing in the shop matches that.</p>
        )}

        {lines.length > 0 && (
          <div className="bkcash__sale">
            <ul>
              {lines.map((line, index) => {
                const left = onHand(line.product, line.size);
                const short = left !== null && line.quantity > left;
                return (
                  <li key={`${line.product.id}-${line.size ?? ''}`}>
                    <span className="bkcash__name">
                      {line.product.name}
                      {line.size && <strong> — size {line.size}</strong>}
                      <small className={short ? 'is-short' : undefined}>
                        {money(unitOf(line.product, line.size))} each
                        {left === null ? '' : short ? ` · only ${left} on hand` : ` · ${left} on hand`}
                      </small>
                    </span>
                    <span className="bkcash__qty">
                      <button
                        type="button"
                        className="bkcash__chip"
                        onClick={() => step(index, -1)}
                        aria-label={`One fewer ${line.product.name}`}
                      >
                        −
                      </button>
                      <span aria-live="polite">{line.quantity}</span>
                      <button
                        type="button"
                        className="bkcash__chip"
                        onClick={() => step(index, 1)}
                        disabled={left !== null && line.quantity >= left}
                        aria-label={`One more ${line.product.name}`}
                      >
                        +
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="bkorder__money">
              {tax > 0 && <span>Items {money(subtotal)}</span>}
              {tax > 0 && (
                <span>
                  {taxLabel(rateBps)} {money(tax)}
                </span>
              )}
              <span className="bkorder__money-total">Total {money(total)}</span>
            </p>
          </div>
        )}

        <label className="bkmodal__field">
          <span>Cash handed over (optional — empty means the exact amount)</span>
          <input
            value={tendered}
            onChange={(event) => setTendered(event.target.value)}
            inputMode="decimal"
            placeholder={total > 0 ? (total / 100).toFixed(2) : '20.00'}
            aria-invalid={Boolean(tenderedProblem)}
            disabled={sending}
          />
        </label>
        {tenderedProblem ? (
          <p className="bkmodal__error">{tenderedProblem}</p>
        ) : tenderedCents !== null && tenderedCents > total ? (
          <p className="bkmodal__after bkcash__change">Change: {money(tenderedCents - total)}</p>
        ) : null}

        <fieldset className="bkcash__buyer">
          <legend>Buyer (optional)</legend>
          <div className="bkcash__pair">
            <label className="bkmodal__field">
              <span>First name</span>
              <input value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={sending} />
            </label>
            <label className="bkmodal__field">
              <span>Last name</span>
              <input value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={sending} />
            </label>
          </div>
          <label className="bkmodal__field">
            <span>Email — given, it gets the usual confirmation</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={sending} />
          </label>
          <label className="bkmodal__field">
            <span>Phone</span>
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} disabled={sending} />
          </label>
        </fieldset>

        {error && (
          <p className="bkmodal__error" role="alert">
            {error}
          </p>
        )}

        <div className="bkmodal__actions">
          <button type="button" className="button button--quiet" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void submit()}
            disabled={sending || lines.length === 0 || over || Boolean(tenderedProblem)}
          >
            {sending ? 'Recording…' : total > 0 ? `Record ${money(total)}` : 'Record sale'}
          </button>
        </div>
      </div>
    </div>
  );
}
