'use client';

import { useEffect, useState } from 'react';
import {
  ORDINATION_RANKS,
  ORDINATION_RANK_INFO,
  isCalendarDay,
  longDay,
  ordinationRankLabel,
  type Ordination,
  type OrdinationRank,
  type OrdinationStatus,
} from '@spsm/shared';
import { getParishConfig } from '@/lib/config';
import {
  DEFAULT_CHURCH_NAME,
  createOrdination,
  watchApplicationCounts,
  watchOrdinations,
  type WithId,
} from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';
import { useOrdinationAdmin } from './useOrdinationAdmin';

/**
 * /admin/ordination — every ordination, and the form that opens a new one.
 *
 * An ordination is a rank and a date, and opening one is what puts the card on
 * /forms. Each is a card leading to its nominations, with the counts an admin
 * scans for: how many are waiting, how many are approved.
 */
export function OrdinationHome() {
  const session = useOrdinationAdmin();
  const [ordinations, setOrdinations] = useState<WithId<Ordination>[] | null>(null);
  const [counts, setCounts] = useState(new Map<string, Record<OrdinationStatus, number>>());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session.canEdit) return;
    const stopOrdinations = watchOrdinations(setOrdinations, (cause) => setError(cause.message));
    const stopCounts = watchApplicationCounts(setCounts, (cause) => setError(cause.message));
    return () => {
      stopOrdinations();
      stopCounts();
    };
  }, [session.canEdit]);

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (ordinations ?? []).filter((row) => row.date >= today || row.open);
  const past = (ordinations ?? []).filter((row) => !(row.date >= today || row.open)).reverse();

  return (
    <OrdinationShell session={session} tab="home" title="Ordinations">
      {error ? <OrdinationError error={error} /> : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <h3>Upcoming</h3>
          {ordinations === null ? (
            <p className="note">Loading…</p>
          ) : upcoming.length === 0 ? (
            <p className="note">Nothing yet. Open an ordination below to start taking nominations.</p>
          ) : (
            <OrdinationCards rows={upcoming} counts={counts} />
          )}

          <NewOrdination uid={session.uid} />

          {past.length > 0 ? (
            <>
              <h3 className="ordination-past">Past</h3>
              <OrdinationCards rows={past} counts={counts} />
            </>
          ) : null}
        </div>
      </section>
    </OrdinationShell>
  );
}

function OrdinationCards({
  rows,
  counts,
}: {
  rows: WithId<Ordination>[];
  counts: Map<string, Record<OrdinationStatus, number>>;
}) {
  return (
    <ul className="camp-cards">
      {rows.map((row) => {
        const tally = counts.get(row.id) ?? { pending: 0, approved: 0, rejected: 0 };
        return (
          <li key={row.id}>
            <a className="camp-card" href={`/admin/ordination/nominations?id=${encodeURIComponent(row.id)}`}>
              <span className="camp-card__eyebrow">
                {longDay(row.date)} · {row.open ? 'Taking nominations' : 'Closed'}
              </span>
              <span className="camp-card__title">{ordinationRankLabel(row.rank)}</span>
              <span className="camp-card__blurb">
                {tally.pending} waiting · {tally.approved} approved
                {tally.rejected ? ` · ${tally.rejected} not approved` : ''}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function NewOrdination({ uid }: { uid: string | null }) {
  const [rank, setRank] = useState<OrdinationRank>('reader');
  const [date, setDate] = useState('');
  const [churchName, setChurchName] = useState(DEFAULT_CHURCH_NAME);
  const [churchAddress, setChurchAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');

  // The cover page's "address, city, state", from the parish settings the
  // contact page reads. Editable here, and kept on the ordination afterwards.
  useEffect(() => {
    let live = true;
    void getParishConfig().then(({ address }) => {
      const street = [address.line1, address.line2].filter(Boolean).join(', ');
      const line = [street, address.city, [address.state, address.postalCode].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ');
      if (live && line) setChurchAddress((current) => current || line);
    });
    return () => {
      live = false;
    };
  }, []);

  async function open() {
    if (!uid) return;
    if (!isCalendarDay(date)) {
      setProblem('Choose the date of the ordination.');
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      const id = await createOrdination(
        { rank, date, churchName: churchName.trim(), churchAddress: churchAddress.trim() },
        uid,
      );
      window.location.href = `/admin/ordination/nominations?id=${encodeURIComponent(id)}`;
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  }

  return (
    <section className="camp-step ordination-new">
      <h3>Open an ordination</h3>
      <p className="note">
        Opening one puts a nomination form for it on the website&rsquo;s Forms page until you
        close it.
      </p>
      {problem ? <p className="ordination-problem">{problem}</p> : null}
      <div className="camp-grid">
        <label className="camp-field">
          <span className="camp-field__label">Rank</span>
          <select
            className="input"
            value={rank}
            onChange={(event) => setRank(event.target.value as OrdinationRank)}
          >
            {ORDINATION_RANKS.map((value) => (
              <option key={value} value={value}>
                {ordinationRankLabel(value)}
              </option>
            ))}
          </select>
          <span className="camp-field__hint">
            Completed {ORDINATION_RANK_INFO[rank].minimumAge} years of age, per the diocese.
          </span>
        </label>
        <label className="camp-field">
          <span className="camp-field__label">Date of ordination</span>
          <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      <div className="camp-grid">
        <label className="camp-field">
          <span className="camp-field__label">Church name</span>
          <input className="input" value={churchName} onChange={(event) => setChurchName(event.target.value)} />
        </label>
        <label className="camp-field">
          <span className="camp-field__label">Address, city, state</span>
          <input
            className="input"
            value={churchAddress}
            onChange={(event) => setChurchAddress(event.target.value)}
          />
        </label>
      </div>
      <p>
        <button type="button" className="button" disabled={saving || !uid} onClick={() => void open()}>
          {saving ? 'Opening…' : 'Open for nominations'}
        </button>
      </p>
    </section>
  );
}
