'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  campBill,
  campWeekRangeLabel,
  countPlacements,
  type CampRegistration,
} from '@spsm/shared';
import { CampError, CampShell } from './CampShell';
import { SettingsPanel } from './SettingsPanel';
import { subscribeRegistrations, subscribeServantRequests, type WithId } from './data';
import { archiveAllocation, readSeasons, subscribeAllocation, unarchiveAllocation, type AllocationSeason } from './allocationData';
import { downloadAllocationWorkbook } from './exportWorkbook';
import { useCampAdmin } from './useCampAdmin';

/**
 * The camp's front door, at /admin/camp.
 *
 * ---------------------------------------------------------------------------
 * Four things, in the order somebody needs them: where the camp stands, the
 * three screens, the settings, and the housekeeping that happens once a year.
 *
 * The old hub had the settings nowhere, the registrations on a different site
 * section, and its own year list above a card for the board and a card for the
 * register. What is different here is not the list of things — it is that all
 * of them are on one page, and that the numbers at the top are the ones a camp
 * director actually asks in June: how many children, how many servants, how
 * many still waiting to be grouped, and how much of the money is in.
 * ---------------------------------------------------------------------------
 */
export function CampHome() {
  const session = useCampAdmin();
  const { canEdit, config, uid } = session;
  const { programId, season } = config;

  const [registrations, setRegistrations] = useState<WithId<CampRegistration>[] | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [placed, setPlaced] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeRegistrations(programId, season, setRegistrations, (cause) =>
      setError(cause.message),
    );
  }, [canEdit, programId, season]);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeServantRequests(
      programId,
      season,
      (rows) => setWaiting(rows.length),
      // A queue that cannot be read is not worth a banner on this page: the
      // Registrations tab says so where the queue itself is.
      () => setWaiting(0),
    );
  }, [canEdit, programId, season]);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeAllocation(
      programId,
      season,
      (update) => setPlaced(countPlacements(update.draft)),
      () => setPlaced(null),
    );
  }, [canEdit, programId, season]);

  const totals = useMemo(() => summarise(registrations ?? []), [registrations]);

  return (
    <CampShell session={session} tab="home" title="Summer camp">
      {error ? <CampError error={error} /> : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <ul className="camp-figures">
            <Figure label="Children" value={totals.children} />
            <Figure label="Servants" value={totals.servants} />
            <Figure
              label="Not in a group"
              value={placed === null ? '—' : Math.max(0, totals.people - placed)}
              hint={placed === null ? undefined : 'across children and servants'}
            />
            <Figure
              label="Still owed"
              value={totals.owedCents > 0 ? money(totals.owedCents) : '—'}
              hint={totals.owedCents > 0 ? `of ${money(totals.billedCents)}` : 'nothing outstanding'}
            />
          </ul>

          <p className="camp-dates note">
            {config.weekStarts.some(Boolean)
              ? config.weekStarts.map((_start, index) => (
                  <span key={index} className="camp-dates__week">
                    <strong>Week {index + 1}</strong> {campWeekRangeLabel(config.weekStarts, index + 1)}
                  </span>
                ))
              : 'Camp has no dates yet — set them in the settings below.'}
          </p>
        </div>
      </section>

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <ul className="camp-cards">
            <Card
              href="/admin/camp/registrations"
              title="Registrations"
              eyebrow="Families · servants · sign-ups"
              blurb="Take a family's registration at the desk, record what they have paid, and accept the servants who have signed themselves up."
              badge={waiting > 0 ? `${waiting} waiting` : undefined}
            />
            <Card
              href="/admin/camp/groups"
              title="Groups"
              eyebrow="Grades · groups · stations"
              blurb="Put the grades into bands, cut each band into groups, and drag the children and servants into them. Exports the whole camp as a spreadsheet."
            />
            <Card
              href="/admin/camp/attendance"
              title="Attendance"
              eyebrow="Day by day · children only"
              blurb="Tick each child in when they arrive and out when they are collected. One list, two columns, by group or by grade."
            />
          </ul>
        </div>
      </section>

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <SettingsPanel config={config} uid={uid} />
        </div>
      </section>

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <Housekeeping
            programId={programId}
            season={season}
            uid={uid}
            registrations={registrations ?? []}
          />
        </div>
      </section>
    </CampShell>
  );
}

/* ---------------------------------------------------------------------------
 * The figures
 * ------------------------------------------------------------------------ */

interface Totals {
  children: number;
  servants: number;
  people: number;
  billedCents: number;
  paidCents: number;
  owedCents: number;
}

/**
 * The season in four numbers.
 *
 * Withdrawn registrations are out of the head count and *in* the money, which
 * looks inconsistent and is not: a family that pulled out in July after paying
 * is not a child at camp and is very much a figure the camp has to be able to
 * account for. `campBill` is the same arithmetic the registration screen shows
 * one family at a time, so the two cannot disagree.
 */
function summarise(registrations: readonly WithId<CampRegistration>[]): Totals {
  let children = 0;
  let servants = 0;
  let billedCents = 0;
  let paidCents = 0;

  for (const registration of registrations) {
    if (registration.status !== 'withdrawn') {
      children += registration.children.length;
      if (registration.servant) servants += 1;
    }
    const bill = campBill(registration);
    billedCents += bill.dueCents;
    paidCents += bill.paidCents;
  }

  return {
    children,
    servants,
    people: children + servants,
    billedCents,
    paidCents,
    owedCents: Math.max(0, billedCents - paidCents),
  };
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
}) {
  return (
    <li className="camp-figure">
      <span className="camp-figure__value">{value}</span>
      <span className="camp-figure__label">{label}</span>
      {hint ? <span className="camp-figure__hint">{hint}</span> : null}
    </li>
  );
}

function Card({
  href,
  title,
  eyebrow,
  blurb,
  badge,
}: {
  href: string;
  title: string;
  eyebrow: string;
  blurb: string;
  badge?: string | undefined;
}) {
  return (
    <li>
      <a className="camp-card" href={href}>
        <span className="camp-card__eyebrow">{eyebrow}</span>
        <span className="camp-card__title">
          {title}
          {badge ? <span className="camp-card__badge">{badge}</span> : null}
        </span>
        <span className="camp-card__blurb">{blurb}</span>
      </a>
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * Once a year
 * ------------------------------------------------------------------------ */

/**
 * The export, the archive, and the list of past seasons.
 *
 * Kept below the settings and visually quieter, because every control here is
 * pressed once or twice a year and two of them are hard to undo. Rolling the
 * camp over is deliberately *not* a button: it is changing the season field in
 * the settings above, which is the same action said in the place where its
 * effect is legible.
 */
function Housekeeping({
  programId,
  season,
  uid,
  registrations,
}: {
  programId: string;
  season: string;
  uid: string | null;
  registrations: readonly WithId<CampRegistration>[];
}) {
  const [seasons, setSeasons] = useState<AllocationSeason[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readSeasons(programId)
      .then((rows) => live && setSeasons(rows))
      .catch(() => live && setSeasons([]));
    return () => {
      live = false;
    };
  }, [programId, busy]);

  const thisSeason = seasons?.find((entry) => entry.season === season) ?? null;
  const archived = thisSeason?.archived ?? false;

  async function toggleArchive() {
    const question = archived
      ? `Reopen summer ${season} for editing?`
      : `Freeze summer ${season}? The groups become read-only. Nothing is deleted, and you can reopen it here.`;
    if (!window.confirm(question)) return;

    setBusy(true);
    setNote(null);
    try {
      if (archived) await unarchiveAllocation(programId, season, uid);
      else await archiveAllocation(programId, season, uid);
    } catch (cause) {
      setNote((cause as Error)?.message ?? 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="camp-keeping">
      <h2>Once a year</h2>

      <div className="camp-keeping__row">
        <div>
          <strong>The whole camp as a spreadsheet</strong>
          <p className="note">
            Every group, every servant, every station and everybody with nowhere to be, with
            the children&rsquo;s allergies and emergency contacts on the roster. Share it only
            with the people running the camp.
          </p>
        </div>
        <button
          type="button"
          className="button"
          onClick={() => {
            /*
             * Read straight from the live document rather than from anything
             * this page is holding: the export is the arrangement as it stands,
             * and the groups screen is where an unsaved one lives.
             */
            const stop = subscribeAllocation(
              programId,
              season,
              (update) => {
                stop();
                downloadAllocationWorkbook({
                  allocation: update.draft,
                  registrations,
                  generatedBy: uid ?? '',
                });
              },
              () => stop(),
            );
          }}
        >
          Download .xlsx
        </button>
      </div>

      <div className="camp-keeping__row">
        <div>
          <strong>{archived ? `Summer ${season} is frozen` : `Freeze summer ${season}`}</strong>
          <p className="note">
            {archived
              ? 'The groups are read-only. Reopen it to rearrange anybody.'
              : 'Makes the groups read-only once camp is over. Nothing is deleted — last summer stays exactly as it was left, and the question “who was Marina with last year” can still be answered.'}
          </p>
        </div>
        <button type="button" className="button button--quiet" disabled={busy} onClick={() => void toggleArchive()}>
          {archived ? 'Reopen' : 'Freeze'}
        </button>
      </div>

      {note ? <p className="camp-settings__error">{note}</p> : null}

      <h3>Past seasons</h3>
      {seasons === null ? (
        <p className="note">Looking…</p>
      ) : seasons.length === 0 ? (
        <p className="note">No season has been arranged yet.</p>
      ) : (
        <ul className="camp-seasons">
          {seasons.map((entry) => (
            <li key={entry.season}>
              <strong>{entry.season}</strong>
              <span className="note">
                {entry.placed} placed{entry.archived ? ' · frozen' : ''}
                {entry.season === season ? ' · this season' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        To start next year, change the season in the settings above. The groups screen opens
        empty on a fresh season and this year stays where it is.
      </p>
    </section>
  );
}
