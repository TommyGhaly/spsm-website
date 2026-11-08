'use client';

import { useEffect, useState } from 'react';
import {
  PARISH_TIME_ZONE,
  isCalendarDay,
  longDay,
  ordinationAccepting,
  todayIn,
  type Ordination,
  type OrdinationStatus,
} from '@spsm/shared';
import { getParishConfig } from '@/lib/config';
import {
  DEFAULT_CHURCH_NAME,
  createOrdination,
  readApplications,
  watchApplicationCounts,
  watchOrdinations,
  type WithId,
} from './data';
import { OrdinationError, OrdinationShell } from './OrdinationShell';
import { useOrdinationAdmin } from './useOrdinationAdmin';
import { approvalListHtml, openApprovalList } from './approvalList';

/**
 * /admin/ordination — every ordination, and the form that opens a new one.
 *
 * An ordination is a date, taking nominations for every rank, and opening one
 * is what puts the card on /forms. Each is a card leading to its nominations, with the counts an admin
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

/** The tab opens inside the click so it is not a blocked pop-up; the nominations are read after. */
async function printApprovalList(ordination: WithId<Ordination>) {
  const tab = window.open('', '_blank');
  tab?.document.write('<p style="font-family:system-ui;padding:2rem">Preparing the list…</p>');
  try {
    openApprovalList(tab, approvalListHtml(ordination, await readApplications(ordination.id)));
  } catch (cause) {
    tab?.close();
    window.alert(cause instanceof Error ? cause.message : String(cause));
  }
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
                {ordinationAccepting(row, todayIn(PARISH_TIME_ZONE))
                  ? row.closesOn
                    ? `Taking nominations through ${longDay(row.closesOn)}`
                    : 'Taking nominations'
                  : 'Closed'}
              </span>
              <span className="camp-card__title">{longDay(row.date)}</span>
              <span className="camp-card__blurb">
                {tally.pending} waiting · {tally.approved} approved
                {tally.rejected ? ` · ${tally.rejected} not approved` : ''}
              </span>
            </a>
            {tally.pending + tally.approved > 0 ? (
              <p className="ordination-actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void printApprovalList(row)}
                >
                  Print approval list
                </button>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function NewOrdination({ uid }: { uid: string | null }) {
  const [date, setDate] = useState('');
  const [closesOn, setClosesOn] = useState('');
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
    if (!isCalendarDay(closesOn)) {
      setProblem('Choose the last day to apply.');
      return;
    }
    if (closesOn > date) {
      setProblem('The last day to apply has to be on or before the ordination.');
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      const id = await createOrdination(
        { date, closesOn, churchName: churchName.trim(), churchAddress: churchAddress.trim() },
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
        Opening one puts a nomination form for it on the website&rsquo;s Forms page through
        the last day to apply, or until you close it sooner. Families choose the rank — cantor, reader or subdeacon — on the form, and
        each rank prints as its own application for the diocese.
      </p>
      {problem ? <p className="ordination-problem">{problem}</p> : null}
      <div className="camp-grid">
        <label className="camp-field">
          <span className="camp-field__label">Date of ordination</span>
          <input type="date" className="input" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="camp-field">
          <span className="camp-field__label">Last day to apply</span>
          <input
            type="date"
            className="input"
            value={closesOn}
            max={date || undefined}
            onChange={(event) => setClosesOn(event.target.value)}
          />
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
