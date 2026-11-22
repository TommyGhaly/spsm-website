'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  NFC_ACTION_LABELS,
  NFC_FUNNELS,
  NFC_PATHS,
  NFC_PATH_LABELS,
  NFC_PLATFORMS,
  NFC_PLATFORM_LABELS,
  NFC_SLUGS,
  NFC_SLUG_LABELS,
  nfcPercent,
  summarizeNfcStats,
  type NfcPath,
  type NfcSlug,
  type NfcSlugRevenue,
} from '@spsm/shared';
import { PageBody } from '@/components/PageBody';
import { PageHeader } from '@/components/PageHeader';
import { getServerSnapshot, getSnapshot, signIn, subscribe } from '@/lib/authStore';
import { useScreenGrants } from '@/lib/screenGrants';
import { money } from '@/features/bookstore/money';
import { NFC_RANGES, type NfcReading } from './data';

/**
 * /admin/nfc — how the church's NFC tags are used.
 *
 * ---------------------------------------------------------------------------
 * The website's copy of the NFC page in the app, and the two read the same
 * documents through the same shared arithmetic (`sumNfcStats`,
 * `summarizeNfcStats`), so they cannot disagree about a number.
 *
 * ## Who sees what
 *
 * The `nfc` grant opens the counts. The money those taps led to is drawn only
 * for somebody who also holds Finance, because that is what `firestore.rules`
 * serves — and, as on the finance screen, the page does not mention a section
 * the reader was not given. A volunteer looking after the tags sees taps and
 * steps and nothing that says there is a revenue band they are missing.
 *
 * ## What the numbers are
 *
 * Taps, not people: a visit is minted per tap and kept nowhere (see
 * packages/shared/src/analytics/nfc.ts). The steps under each tag are visits
 * that reached them, so a percentage is "of the people who tapped, how many
 * went on to…". Money is what Square charged, before any refund.
 * ---------------------------------------------------------------------------
 */
export function NfcScreen() {
  const auth = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { ready, canAdmin } = useScreenGrants();

  if (auth.kind === 'restoring' || auth.kind === 'signing-in' || !ready) {
    return (
      <Shell>
        <p className="note">Loading…</p>
      </Shell>
    );
  }

  if (auth.kind !== 'signed-in') {
    return (
      <Shell>
        <div className="notice">
          <h2>Sign in first</h2>
          <p>These are the church&rsquo;s figures about its NFC tags.</p>
          <p>
            <button type="button" className="button" onClick={() => void signIn()}>
              Sign in with Microsoft
            </button>
          </p>
        </div>
      </Shell>
    );
  }

  if (!canAdmin('nfc')) {
    return (
      <Shell>
        <div className="notice">
          <h2>This one is not yours</h2>
          <p>
            The NFC tag statistics are shown to whoever looks after the tags. If that should be
            you, ask an administrator to give you the NFC tag statistics area.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <NfcBody withRevenue={canAdmin('finance')} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="NFC tags" />
      <PageBody>
        <section className="band">
          <div className="wrap">
            <h1 className="fin__title">NFC tags</h1>
            {children}
          </div>
        </section>
      </PageBody>
    </>
  );
}

type Load = { kind: 'loading' } | { kind: 'ready'; reading: NfcReading } | { kind: 'failed'; message: string };

function NfcBody({ withRevenue }: { withRevenue: boolean }) {
  const [days, setDays] = useState<number>(30);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  const read = useCallback(async () => {
    setLoad({ kind: 'loading' });
    try {
      const { readNfcPeriod } = await import('./data');
      setLoad({ kind: 'ready', reading: await readNfcPeriod(days, withRevenue) });
    } catch (error) {
      console.error('[nfc] could not read the statistics', error);
      setLoad({ kind: 'failed', message: 'The figures could not be read. Check your connection and try again.' });
    }
  }, [days, withRevenue]);

  useEffect(() => {
    void read();
  }, [read]);

  const rangeLabel = NFC_RANGES.find((range) => range.days === days)?.label ?? '';

  return (
    <div className="fin">
      <div className="fin__bar">
        <label className="fin__monthPick">
          <span>Period</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            {NFC_RANGES.map((range) => (
              <option key={range.days} value={range.days}>
                {range.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fin__refresh" onClick={() => void read()} disabled={load.kind === 'loading'}>
          {load.kind === 'loading' ? 'Reading…' : 'Refresh'}
        </button>
      </div>

      {load.kind === 'loading' && <p className="fin__empty">Reading the figures…</p>}
      {load.kind === 'failed' && (
        <p className="fin__error" role="alert">
          {load.message}
        </p>
      )}
      {load.kind === 'ready' && <Report reading={load.reading} rangeLabel={rangeLabel} />}
    </div>
  );
}

function Report({ reading, rangeLabel }: { reading: NfcReading; rangeLabel: string }) {
  const summary = summarizeNfcStats(reading.bySlug);

  if (summary.scans === 0) {
    return (
      <p className="fin__empty">
        Nobody has tapped a tag in this period yet — or the tags have not been tapped since the
        counting began. Taps are counted from the App Clip, the SPSM Connect app and the website alike.
      </p>
    );
  }

  const busiest = Math.max(1, ...reading.series.map((point) => point.scans));
  const top = summary.ranked[0];

  return (
    <>
      <section className="fin__section">
        <h2 className="fin__h2">Taps — {rangeLabel.toLowerCase()}</h2>
        <p className="fin__lede">
          Every tap on a church tag, by how the phone opened it.
          {top && ` ${NFC_SLUG_LABELS[top.slug]} is the most tapped.`}
        </p>
        <div className="fin__tiles">
          <Count label="All taps" value={summary.scans} strong />
          {NFC_PATHS.map((path) => (
            <Count
              key={path}
              label={NFC_PATH_LABELS[path]}
              value={summary.path[path]}
              note={share(summary.path[path], summary.scans)}
            />
          ))}
        </div>
        <div className="fin__tiles nfc__platforms">
          {NFC_PLATFORMS.map((platform) => (
            <Count
              key={platform}
              label={NFC_PLATFORM_LABELS[platform]}
              value={summary.platform[platform]}
              note={share(summary.platform[platform], summary.scans)}
            />
          ))}
        </div>

        <div className="nfc__series" role="img" aria-label={`Taps over ${rangeLabel.toLowerCase()}`}>
          {reading.series.map((point) => (
            <span
              key={point.id}
              className="nfc__seriesBar"
              style={{ height: `${Math.max(point.scans > 0 ? 4 : 1, (point.scans / busiest) * 100)}%` }}
              title={`${seriesLabel(point.id)}: ${point.scans} ${point.scans === 1 ? 'tap' : 'taps'}`}
            />
          ))}
        </div>
        <p className="fin__foot">
          {reading.series[0]?.id.startsWith('month-') ? 'One bar a month.' : 'One bar a day.'}{' '}
          Hover a bar for its count.
        </p>
      </section>

      <section className="fin__section">
        <h2 className="fin__h2">Most tapped</h2>
        <p className="fin__lede">Busiest first. The bar is each tag’s share of every tap.</p>
        <div className="nfc__scroll">
          <table className="fin__table">
            <thead>
              <tr>
                <th scope="col">Tag</th>
                <th scope="col">Taps</th>
                {NFC_PATHS.map((path) => (
                  <th key={path} scope="col">
                    {NFC_PATH_LABELS[path]}
                  </th>
                ))}
                {NFC_PLATFORMS.map((platform) => (
                  <th key={platform} scope="col">
                    {NFC_PLATFORM_LABELS[platform]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summary.ranked.map(({ slug, counts }) => (
                <tr key={slug}>
                  <th scope="row">
                    {NFC_SLUG_LABELS[slug]}
                    <span className="nfc__share" aria-hidden="true">
                      <span style={{ width: `${(counts.scans / summary.scans) * 100}%` }} />
                    </span>
                  </th>
                  <td className="fin__num">{counts.scans}</td>
                  {NFC_PATHS.map((path) => (
                    <td key={path} className="fin__num">
                      {counts.path[path]}
                    </td>
                  ))}
                  {NFC_PLATFORMS.map((platform) => (
                    <td key={platform} className="fin__num">
                      {counts.platform[platform]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summary.ranked.length < NFC_SLUGS.length && (
          <p className="fin__foot">
            Not tapped in this period:{' '}
            {NFC_SLUGS.filter((slug) => reading.bySlug[slug].scans === 0)
              .map((slug) => NFC_SLUG_LABELS[slug])
              .join(', ')}
            .
          </p>
        )}
      </section>

      <section className="fin__section">
        <h2 className="fin__h2">What people did next</h2>
        <p className="fin__lede">
          Of the people who tapped each tag, how many went on to each step — counted once per tap,
          however many times they did it.
        </p>
        <ul className="fin__seasons">
          {summary.ranked.map(({ slug, counts }) => (
            <li key={slug} className="fin__season">
              <div className="fin__seasonHead">
                <h3>{NFC_SLUG_LABELS[slug]}</h3>
                <p>
                  {counts.scans} {counts.scans === 1 ? 'tap' : 'taps'}
                </p>
              </div>
              <dl className="fin__ledger">
                {NFC_FUNNELS[slug].map((action) => (
                  <div key={action} className="fin__line">
                    <dt>{NFC_ACTION_LABELS[action]}</dt>
                    <dd>
                      {counts.actions[action]}
                      <span className="fin__sub"> {share(counts.actions[action], counts.scans) ?? ''}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
        <p className="fin__foot">
          Sending a form and paying are recorded by the church’s server when they happen, not
          reported by the phone. Gifts are made on Tithe.ly, so the giving tag can only show that
          Tithe.ly was opened.
        </p>
      </section>

      {reading.revenue && <Revenue revenue={reading.revenue} rangeLabel={rangeLabel} />}
    </>
  );
}

function Revenue({ revenue, rangeLabel }: { revenue: Record<NfcSlug, NfcSlugRevenue>; rangeLabel: string }) {
  const rows = NFC_SLUGS.map((slug) => ({ slug, money: revenue[slug] }))
    .filter((row) => row.money.cents > 0)
    .sort((a, b) => b.money.cents - a.money.cents);
  const total = rows.reduce((sum, row) => sum + row.money.cents, 0);
  const byPath = NFC_PATHS.reduce(
    (into, path) => ({ ...into, [path]: rows.reduce((sum, row) => sum + row.money.path[path], 0) }),
    {} as Record<NfcPath, number>,
  );

  return (
    <section className="fin__section">
      <h2 className="fin__h2">Money from taps — {rangeLabel.toLowerCase()}</h2>
      <p className="fin__lede">
        Bookstore orders and paid forms that began with a tap, credited to the tag that was tapped —
        including a purchase made later in the same visit under a different tag.
      </p>
      {total === 0 ? (
        <p className="fin__empty">Nothing bought after a tap in this period.</p>
      ) : (
        <>
          <div className="fin__tiles">
            <div className="fin__tile fin__tile--strong">
              <span className="fin__tileLabel">From taps</span>
              <span className="fin__tileValue">{money(total)}</span>
            </div>
            {NFC_PATHS.map((path) => (
              <div key={path} className="fin__tile">
                <span className="fin__tileLabel">{NFC_PATH_LABELS[path]}</span>
                <span className="fin__tileValue">{money(byPath[path])}</span>
              </div>
            ))}
          </div>
          <div className="nfc__scroll">
            <table className="fin__table">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Purchases</th>
                  <th scope="col">Bookstore</th>
                  <th scope="col">Forms</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ slug, money: row }) => (
                  <tr key={slug}>
                    <th scope="row">{NFC_SLUG_LABELS[slug]}</th>
                    <td className="fin__num">{row.count}</td>
                    <td className="fin__num">{money(row.source.bookstore.cents)}</td>
                    <td className="fin__num">{money(row.source.forms.cents)}</td>
                    <td className="fin__num">{money(row.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="fin__foot">
        What Square charged, sales tax and postage included, before any refund — refunds are netted
        on the Finance page. Tithe.ly gifts are not visible to this site.
      </p>
    </section>
  );
}

function Count({ label, value, note, strong }: { label: string; value: number; note?: string | null | undefined; strong?: boolean }) {
  return (
    <div className={strong ? 'fin__tile fin__tile--strong' : 'fin__tile'}>
      <span className="fin__tileLabel">{label}</span>
      <span className="fin__tileValue">{value.toLocaleString('en-US')}</span>
      {note && <span className="fin__sub">{note}</span>}
    </div>
  );
}

function share(part: number, whole: number): string | null {
  const percent = nfcPercent(part, whole);
  return percent === null ? null : `${percent}%`;
}

function seriesLabel(id: string): string {
  const [kind, key] = [id.slice(0, id.indexOf('-')), id.slice(id.indexOf('-') + 1)];
  const [y, m, d] = key.split('-').map(Number) as [number, number, number?];
  const date = new Date(Date.UTC(y, m - 1, d ?? 1));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    ...(kind === 'day' ? { day: 'numeric' } : { year: 'numeric' }),
  }).format(date);
}
