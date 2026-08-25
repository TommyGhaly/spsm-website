'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toDate, type DocOf, type FulfillmentStatus, type Order } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { money } from './money';

/**
 * The orders queue.
 *
 * ---------------------------------------------------------------------------
 * This screen is a packing list first and a ledger second.
 *
 * The question a volunteer opens it with is "what do I need to put aside before
 * Sunday", not "what did we sell". So it opens on the orders that still need
 * doing, sorted oldest first — the person who has been waiting longest is the
 * one to serve next — and everything else is behind a filter.
 *
 * Money is deliberately not the emphasis. Totals are here because an order has
 * one, but the two controls that matter are "put aside" and "handed over", and
 * both write a single field. Refunding is the exception and is styled as one:
 * it needs a reason, it asks twice, and it is the only thing here that cannot
 * be undone.
 * ---------------------------------------------------------------------------
 */

type List =
  | { kind: 'loading' }
  | { kind: 'ready'; orders: DocOf<Order>[] }
  | { kind: 'failed'; message: string };

type Filter = 'todo' | 'ready' | 'done' | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To put aside' },
  { id: 'ready', label: 'Waiting' },
  { id: 'done', label: 'Handed over' },
  { id: 'all', label: 'Everything' },
];

export function StaffOrders() {
  const [list, setList] = useState<List>({ kind: 'loading' });
  const [filter, setFilter] = useState<Filter>('todo');
  /** Order ids with a write in flight, so a row cannot be double-actioned. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<DocOf<Order> | null>(null);

  const load = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const { listOrders } = await import('./adminData');
      setList({ kind: 'ready', orders: await listOrders() });
    } catch (cause) {
      setList({
        kind: 'failed',
        message: cause instanceof Error ? cause.message : 'Could not read the orders.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orders = list.kind === 'ready' ? list.orders : [];

  const shown = useMemo(() => {
    /*
     * Filtered here rather than in the query, and that is a deliberate limit.
     *
     * A `where('fulfillment', …)` alongside `orderBy('createdAt')` needs a
     * composite index per combination, and the whole list is two hundred rows at
     * most — the parish sells a few books a week. Filtering in memory costs
     * nothing measurable and keeps `firestore.indexes.json` honest about what is
     * actually queried.
     */
    const paid = orders.filter((order) => order.status === 'paid' || order.status === 'refunded');

    if (filter === 'all') return orders;
    if (filter === 'todo') return paid.filter((o) => o.fulfillment === 'unfulfilled' && o.status === 'paid');
    if (filter === 'ready') return paid.filter((o) => o.fulfillment === 'ready' && o.status === 'paid');
    return paid.filter((o) => o.fulfillment === 'collected' || o.status === 'refunded');
  }, [orders, filter]);

  const ordered = useMemo(() => {
    /*
     * Oldest first while there is something to do, newest first once there is
     * not. A queue is served from the front; a record is read from the top.
     */
    const oldestFirst = filter === 'todo' || filter === 'ready';
    return [...shown].sort((a, b) => {
      const at = toDate(a.createdAt)?.getTime() ?? 0;
      const bt = toDate(b.createdAt)?.getTime() ?? 0;
      return oldestFirst ? at - bt : bt - at;
    });
  }, [shown, filter]);

  const counts = useMemo(
    () => ({
      todo: orders.filter((o) => o.status === 'paid' && o.fulfillment === 'unfulfilled').length,
      ready: orders.filter((o) => o.status === 'paid' && o.fulfillment === 'ready').length,
      done: orders.filter((o) => o.fulfillment === 'collected' || o.status === 'refunded').length,
      all: orders.length,
    }),
    [orders],
  );

  const advance = useCallback(
    async (order: DocOf<Order>, to: FulfillmentStatus) => {
      setError(null);
      setBusy((current) => new Set(current).add(order.id));
      try {
        const { setFulfillment } = await import('./adminData');
        await setFulfillment(order.id, to);
        /*
         * Patched locally rather than re-reading the collection.
         *
         * A full reload after every button press costs two hundred document
         * reads to change one field, and it makes the row somebody just clicked
         * jump position while their finger is still there. The write either
         * succeeded — in which case this is exactly what the server now holds —
         * or it threw, and nothing below runs.
         */
        setList((current) =>
          current.kind === 'ready'
            ? {
                kind: 'ready',
                orders: current.orders.map((row) =>
                  row.id === order.id ? { ...row, fulfillment: to } : row,
                ),
              }
            : current,
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That change was refused.');
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(order.id);
          return next;
        });
      }
    },
    [],
  );

  return (
    <div className="bkqueue">
      <div className="bkqueue__bar">
        <div className="bkqueue__filters" role="group" aria-label="Which orders to show">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? 'bkqueue__filter is-on' : 'bkqueue__filter'}
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
              <span className="bkqueue__badge">{counts[option.id]}</span>
            </button>
          ))}
        </div>

        <button type="button" className="button button--quiet" onClick={() => void load()}>
          Reload
        </button>
      </div>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {list.kind === 'loading' && <p className="note">Reading the orders…</p>}

      {list.kind === 'failed' && (
        <div className="notice notice--alarm" role="alert">
          <h2>Could not read the orders</h2>
          <p>{list.message}</p>
          <p>
            <button type="button" className="button button--quiet" onClick={() => void load()}>
              Try again
            </button>
          </p>
        </div>
      )}

      {list.kind === 'ready' && ordered.length === 0 && (
        <div className="notice" role="status">
          <h2>{filter === 'todo' ? 'Nothing to put aside' : 'Nothing here'}</h2>
          <p>
            {filter === 'todo'
              ? 'Every paid order has been dealt with.'
              : 'No orders match this filter yet.'}
          </p>
        </div>
      )}

      <ul className="bkqueue__list">
        {ordered.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            busy={busy.has(order.id)}
            onAdvance={(to) => void advance(order, to)}
            onRefund={() => setRefunding(order)}
          />
        ))}
      </ul>

      {refunding && (
        <RefundDialog
          order={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            setRefunding(null);
            // Re-read here, unlike the fulfilment writes: a refund's `status`
            // is set by Square's webhook rather than by us, so the local copy
            // genuinely does not know what the server now holds.
            void load();
          }}
        />
      )}
    </div>
  );
}

function OrderRow({
  order,
  busy,
  onAdvance,
  onRefund,
}: {
  order: DocOf<Order>;
  busy: boolean;
  onAdvance: (to: FulfillmentStatus) => void;
  onRefund: () => void;
}) {
  const placed = toDate(order.createdAt);
  const name = [order.buyerFirstName, order.buyerLastName].filter(Boolean).join(' ');
  const refunded = order.status === 'refunded';
  const units = (order.lineItems ?? []).reduce((sum, line) => sum + (line.quantity || 0), 0);

  /*
   * Whether there is anything to do to this order at all.
   *
   * Every control below is gated on `status === 'paid'`, so a pending, failed,
   * or refunded order has none — and the actions bar has a top border, which
   * without this renders as a stray rule under an order nobody can act on.
   */
  const actionable = order.status === 'paid';

  return (
    <li className={refunded ? 'bkorder is-refunded' : 'bkorder'}>
      <div className="bkorder__head">
        <div className="bkorder__who">
          {/* The name first, because that is what the order is filed under and
              what a volunteer is holding in their head. Orders taken before
              names were asked for fall back to the address. */}
          <p className="bkorder__name">{name || order.contactEmail}</p>
          <p className="bkorder__meta">
            {placed
              ? placed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : 'no date'}
            {' · '}
            {order.shipping ? 'Deliver' : 'Collect'}
            {' · '}
            {units} {units === 1 ? 'book' : 'books'}
            {' · '}
            {money(order.total?.amount ?? 0, order.total?.currency ?? 'USD')}
          </p>
        </div>

        <StateTag order={order} />
      </div>

      <ul className="bkorder__lines">
        {(order.lineItems ?? []).map((line, index) => (
          <li key={`${order.id}-${index}`}>
            <span className="bkorder__qty">{line.quantity}×</span> {line.name}
          </li>
        ))}
      </ul>

      {/* Only on a delivery, and only when there is one. It is the one piece of
          personal data on this screen, so it is not drawn where it is not used. */}
      {order.shipping && order.shippingAddress && (
        <address className="bkorder__addr">
          {[
            order.shippingAddress['line1'],
            order.shippingAddress['line2'],
            order.shippingAddress['city'],
            order.shippingAddress['state'],
            order.shippingAddress['postalCode'],
          ]
            .filter(Boolean)
            .join(', ')}
        </address>
      )}

      <p className="bkorder__contact">
        <a href={`mailto:${order.contactEmail}`}>{order.contactEmail}</a>
        <span className="bkorder__ref">{order.id}</span>
      </p>

      {actionable && (
      <div className="bkorder__actions">
        {order.fulfillment === 'unfulfilled' && (
          <button type="button" className="button" disabled={busy} onClick={() => onAdvance('ready')}>
            <Icon name="check" size={14} /> {order.shipping ? 'Packed' : 'Put aside'}
          </button>
        )}

        {order.fulfillment === 'ready' && (
          <>
            <button type="button" className="button" disabled={busy} onClick={() => onAdvance('collected')}>
              <Icon name="check" size={14} /> {order.shipping ? 'Posted' : 'Handed over'}
            </button>
            {/* Reversible, because "put aside" gets pressed on the wrong row. */}
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => onAdvance('unfulfilled')}
            >
              Undo
            </button>
          </>
        )}

        <button type="button" className="bkorder__refund" disabled={busy} onClick={onRefund}>
          Refund
        </button>
      </div>
      )}
    </li>
  );
}

/** The one-word state, said plainly. */
function StateTag({ order }: { order: DocOf<Order> }) {
  if (order.status === 'refunded') return <span className="bktag bktag--off">Refunded</span>;
  if (order.status === 'failed') return <span className="bktag bktag--off">Payment failed</span>;
  if (order.status === 'canceled') return <span className="bktag bktag--off">Cancelled</span>;
  if (order.status === 'pending') return <span className="bktag bktag--wait">Payment pending</span>;

  if (order.fulfillment === 'collected') {
    return <span className="bktag bktag--done">{order.shipping ? 'Posted' : 'Collected'}</span>;
  }
  if (order.fulfillment === 'ready') {
    return <span className="bktag bktag--ready">{order.shipping ? 'Packed' : 'Waiting'}</span>;
  }
  return <span className="bktag">To do</span>;
}

/**
 * Refunding, behind a reason and a second press.
 *
 * The reason is required by the Function too — an untraceable refund on a
 * parish's books is the first thing an audit asks about. Asking here as well
 * means the person is told before they commit rather than after.
 */
function RefundDialog({
  order,
  onClose,
  onDone,
}: {
  order: DocOf<Order>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reason.trim().length < 3 || sending) return;
    setSending(true);
    setError(null);
    try {
      const { refundOrder } = await import('./adminData');
      await refundOrder(order.id, reason.trim());
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The refund could not be sent.');
      setSending(false);
    }
  };

  return (
    <div className="bkmodal" role="dialog" aria-modal="true" aria-label="Refund this order">
      <div className="bkmodal__panel">
        <h2 className="bkmodal__title">Refund {money(order.total?.amount ?? 0)}?</h2>

        <p className="bkmodal__note">
          The whole order goes back to the card it was paid with, including delivery. The
          parish does not take returns, so this is an exception — say why, and your name
          is recorded against it.
        </p>

        <label className="bkmodal__field">
          <span>Reason</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Arrived damaged"
            autoFocus
          />
        </label>

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
            className="bkorder__refund"
            onClick={() => void submit()}
            disabled={sending || reason.trim().length < 3}
          >
            {sending ? 'Sending…' : 'Refund in full'}
          </button>
        </div>

        {/* Square reports most refunds as pending for a day or two, and the
            order's status only moves when the webhook says it completed. Saying
            so here stops somebody pressing it again. */}
        <p className="bkmodal__after">
          Square usually takes a few days. The order will show as refunded once it has
          gone through.
        </p>
      </div>
    </div>
  );
}
