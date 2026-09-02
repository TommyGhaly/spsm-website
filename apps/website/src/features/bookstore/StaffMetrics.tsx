'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  conversionRate,
  toDate,
  topProducts,
  type BookstoreStats,
  type ProductStats,
} from '@spsm/shared';
import { money } from './money';

/**
 * What the bookstore did, over a period.
 *
 * ---------------------------------------------------------------------------
 * Every number here is one document read.
 *
 * Nothing on this screen aggregates anything. The shop writes one document per
 * view, cart change, and search — never a counter, because a counter tops out
 * near one write per second and fails first on the most popular book — and a
 * scheduled Function adds them up hourly into `bookstoreStats/{period}`. This
 * component reads that document and renders it.
 *
 * So the page is as fast on the busiest week of the year as on the quietest, and
 * nothing an admin does can slow the shop down. The cost is staleness, which is
 * why `computedAt` is on screen rather than assumed away, and why Refresh exists.
 * ---------------------------------------------------------------------------
 */

type Period = { id: string; label: string; kind: 'day' | 'month'; key: string };

/** Today in the parish's zone — the same key the events are stamped with. */
function parishDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - offsetDays * 86_400_000));
}

function parishMonth(offsetMonths = 0): string {
  const now = new Date();
  const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetMonths, 15));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).format(shifted);
}

function periods(): Period[] {
  return [
    { id: 'today', label: 'Today', kind: 'day', key: parishDay(0) },
    { id: 'yesterday', label: 'Yesterday', kind: 'day', key: parishDay(1) },
    { id: 'month', label: 'This month', kind: 'month', key: parishMonth(0) },
    { id: 'last', label: 'Last month', kind: 'month', key: parishMonth(1) },
  ];
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; stats: BookstoreStats | null; names: Map<string, string> }
  | { kind: 'failed'; message: string };

export function StaffMetrics() {
  const options = useMemo(periods, []);
  const [period, setPeriod] = useState<Period>(options[0]!);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (chosen: Period) => {
    setLoad({ kind: 'loading' });
    try {
      const { readStats, productNames } = await import('./adminData');
      const [stats, names] = await Promise.all([
        readStats(chosen.kind, chosen.key),
        productNames(),
      ]);
      setLoad({ kind: 'ready', stats, names });
    } catch (cause) {
      setLoad({
        kind: 'failed',
        message: cause instanceof Error ? cause.message : 'Could not read the statistics.',
      });
    }
  }, []);

  useEffect(() => {
    void read(period);
  }, [read, period]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const { refreshStats } = await import('./adminData');
      await refreshStats();
      await read(period);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not refresh.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bkstats">
      <div className="bkstats__bar">
        <div className="bkstats__periods" role="group" aria-label="Period">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={period.id === option.id ? 'bkqueue__filter is-on' : 'bkqueue__filter'}
              aria-pressed={period.id === option.id}
              onClick={() => setPeriod(option)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="button button--quiet"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? 'Recomputing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {load.kind === 'loading' && <p className="note">Reading…</p>}

      {load.kind === 'failed' && (
        <div className="notice notice--alarm" role="alert">
          <h2>Could not read the statistics</h2>
          <p>{load.message}</p>
        </div>
      )}

      {/*
        No document is the ordinary state for a quiet day, and for every period
        until the hourly rollup has run at least once. It is not an error and is
        not drawn as one.
      */}
      {load.kind === 'ready' && !load.stats && (
        <div className="notice" role="status">
          <h2>Nothing recorded for {period.label.toLowerCase()}</h2>
          <p>
            The figures are added up once an hour. If the shop has taken an order since
            the last run, press Refresh.
          </p>
        </div>
      )}

      {load.kind === 'ready' && load.stats && (
        <Report stats={load.stats} names={load.names} period={period} />
      )}
    </div>
  );
}

function Report({
  stats,
  names,
  period,
}: {
  stats: BookstoreStats;
  names: Map<string, string>;
  period: Period;
}) {
  const t = stats.totals;
  const computed = toDate(stats.computedAt);
  const nameOf = (slug: string) => names.get(slug) ?? slug;

  const bought = topProducts(stats, 'unitsSold', 8);
  const viewed = topProducts(stats, 'details', 8);
  const abandoned = useMemo(
    () =>
      Object.entries(stats.products)
        // Books put in a basket more often than they were bought. The gap is
        // the interesting number, not either side of it on its own.
        .map(([slug, p]) => ({ slug, gap: p.cartAdds - p.unitsSold, stats: p }))
        .filter((row) => row.gap > 0)
        .sort((a, b) => b.gap - a.gap || a.slug.localeCompare(b.slug))
        .slice(0, 6),
    [stats],
  );

  const zeroSearches = useMemo(
    () =>
      Object.entries(stats.zeroResultSearches)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10),
    [stats],
  );

  const allSearches = useMemo(
    () =>
      Object.entries(stats.searches)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 10),
    [stats],
  );

  return (
    <>
      <div className="bkstats__tiles">
        <Tile label="Sold" value={money(t.revenue)} note={`${t.orders} ${t.orders === 1 ? 'order' : 'orders'}, ${t.unitsSold} books`} />
        {/* Net is shown only when there is something to net off. A permanent
            "refunded $0.00" tile is furniture. */}
        {t.refunded > 0 && (
          <Tile
            label="Refunded"
            value={money(t.refunded)}
            note={`${t.refundedOrders} of them · net ${money(t.revenue - t.refunded)}`}
          />
        )}
        <Tile
          label="Collect / deliver"
          value={`${t.pickupOrders} / ${t.shippedOrders}`}
          note="picked up / delivered"
        />
        <Tile
          label="Visitors"
          value={String(t.visitors)}
          note={
            period.kind === 'month'
              ? 'busiest single day (daily figures cannot be added up)'
              : `${t.views} covers seen, ${t.details} opened`
          }
        />
        <Tile
          label="Started checkout"
          value={String(t.checkoutStarts)}
          note={`${t.orders} paid${t.checkoutStarts > 0 ? ` · ${Math.round((t.orders / t.checkoutStarts) * 100)}% of them` : ''}`}
        />
        {t.repeatBuyers > 0 && (
          <Tile
            label="Repeat buyers"
            value={String(t.repeatBuyers)}
            note="have bought before"
          />
        )}
      </div>

      <div className="bkstats__grid">
        <Table
          title="Most bought"
          empty="Nothing sold yet."
          rows={bought.map((row) => ({
            key: row.slug,
            name: nameOf(row.slug),
            value: `${row.value}`,
            note: row.stats.revenue > 0 ? money(row.stats.revenue) : '',
          }))}
        />

        <Table
          title="Most looked at"
          empty="No one has opened a book yet."
          rows={viewed.map((row) => ({
            key: row.slug,
            name: nameOf(row.slug),
            value: `${row.value}`,
            note: describeConversion(row.stats),
          }))}
        />

        <Table
          title="Added but not bought"
          empty="Nothing was left behind in a basket."
          hint="Books people put in a basket but did not buy."
          rows={abandoned.map((row) => ({
            key: row.slug,
            name: nameOf(row.slug),
            value: `${row.gap}`,
            note: `${row.stats.cartAdds} added, ${row.stats.unitsSold} sold`,
          }))}
        />

        <Table
          title="Searched for, not found"
          empty="Every search found something."
          hint="Worth thinking about stocking these."
          rows={zeroSearches.map(([term, count]) => ({
            key: term,
            name: term,
            value: String(count),
            note: '',
          }))}
        />

        <Table
          title="Searched for"
          empty="No one has used the search yet."
          rows={allSearches.map(([term, count]) => ({
            key: term,
            name: term,
            value: String(count),
            note: '',
          }))}
        />
      </div>

      <p className="bkstats__asof">
        {computed
          ? `Added up ${computed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`
          : 'Not yet added up.'}{' '}
        Sales come from the orders themselves; everything else is counted in the shop and
        misses anyone browsing with Do Not Track on.
      </p>
    </>
  );
}

/**
 * Views per purchase, phrased rather than tabulated.
 *
 * Null when nobody looked — "0%" and "nobody looked at it" are different facts,
 * and the first is a much harsher thing to print next to a book on no evidence.
 */
function describeConversion(stats: ProductStats): string {
  const rate = conversionRate(stats);
  if (rate === null) return '';
  return `${Math.round(rate)}% bought`;
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bktile">
      <p className="bktile__label">{label}</p>
      <p className="bktile__value">{value}</p>
      <p className="bktile__note">{note}</p>
    </div>
  );
}

function Table({
  title,
  hint,
  empty,
  rows,
}: {
  title: string;
  hint?: string;
  empty: string;
  rows: { key: string; name: string; value: string; note: string }[];
}) {
  return (
    <section className="bktable">
      <h3 className="bktable__title">{title}</h3>
      {hint && <p className="bktable__hint">{hint}</p>}

      {rows.length === 0 ? (
        <p className="bktable__empty">{empty}</p>
      ) : (
        <ol className="bktable__rows">
          {rows.map((row) => (
            <li key={row.key} className="bktable__row">
              <span className="bktable__name">{row.name}</span>
              {row.note && <span className="bktable__note">{row.note}</span>}
              <span className="bktable__value">{row.value}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
