'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  campWeekRangeLabel,
  countPlacements,
  type CampAllocationDraft,
  type CampConfig,
  type CampRegistration,
} from '@spsm/shared';
import { CampError, CampShell } from './CampShell';
import { SettingsPanel } from './SettingsPanel';
import { subscribeRegistrations, subscribeServantRequests, type WithId } from './data';
import { archiveAllocation, readSeasons, subscribeAllocation, unarchiveAllocation, type AllocationSeason } from './allocationData';
import { downloadAllocationWorkbook } from './exportWorkbook';
import { ExportSheet } from './ExportSheet';
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
  const { canEdit, canSeeMoney, config, uid } = session;
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

      <section className="band camp-band camp-band--home">
        <div className="wrap camp-wrap">
          <ul className="camp-figures">
            <Figure label="Children" value={totals.children} tone="accent" />
            <Figure label="Servants" value={totals.servants} tone="azure" />
            <Figure
              label="Not in a group"
              value={placed === null ? '—' : Math.max(0, totals.people - placed)}
              hint={placed === null ? undefined : 'across children and servants'}
              tone="gold"
            />
          </ul>

          {/*
            The money is on Finance, and only there.
            -------------------------------------------------------------------
            There was a fourth tile here — "Still owed", summed in this browser
            from every registration on the screen. It is gone at Tommy's
            direction: the camp's screens are for running the camp, and a
            balance across the season is a treasurer's figure that belongs with
            the church's other three.

            Nothing is lost by removing it. /admin/finance already carries the
            same season, computed by `functions/src/finance.ts` from the records
            on a server rather than from whatever this page happens to have
            loaded, and it carries the billed, the discounted, the received and
            the refunded beside it. The two could disagree, in fact, and the
            rollup is the one that would be right.

            The line below is the whole of what stays: a door, shown to the
            person who holds `finance` narrowed to `camp`, because pointing
            somebody at a screen they will be refused is worse than saying
            nothing. Per-family balances are untouched — a registrar recording
            a check at the desk still needs the bill in front of them, and that
            is a family's figure, not the season's.
            -------------------------------------------------------------------
          */}
          {canSeeMoney && (
            <p className="camp-money-note note">
              Fees, payments and what is still owed for the season are on{' '}
              <a href="/admin/finance">Finance</a>.
            </p>
          )}

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

      <section className="band camp-band camp-band--home">
        <div className="wrap camp-wrap">
          <ul className="camp-cards">
            <Card
              href="/admin/camp/registrations"
              title="Registrations"
              tone="accent"
              eyebrow="Families · servants · sign-ups"
              blurb={
                canSeeMoney
                  ? "Take a family's registration at the desk, record what they have paid, and accept the servants who have signed themselves up."
                  : "Take a family's registration at the desk, record a payment as it arrives, and accept the servants who have signed themselves up."
              }
              badge={waiting > 0 ? `${waiting} waiting` : undefined}
            />
            <Card
              href="/admin/camp/groups"
              title="Groups"
              tone="azure"
              eyebrow="Grades · groups · stations"
              blurb="Put the grades into bands, cut each band into groups, and drag the children and servants into them. Exports the servants and their groups as a spreadsheet."
            />
            <Card
              href="/admin/camp/attendance"
              title="Attendance"
              tone="gold"
              eyebrow="Day by day · children only"
              blurb="Tick each child in when they arrive and out when they are collected. One list, two columns, by group or by grade."
            />
          </ul>
        </div>
      </section>

      <section className="band camp-band camp-band--home">
        <div className="wrap camp-wrap">
          <SettingsPanel config={config} uid={uid} />
        </div>
      </section>

      <section className="band camp-band camp-band--home">
        <div className="wrap camp-wrap">
          <Housekeeping
            config={config}
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
}

/**
 * The season in three numbers.
 *
 * Money used to be the fourth, and its absence is why the withdrawn are simply
 * out of this: a family that pulled out in July is not a child at camp, and the
 * one reason the old version counted them anyway — that a payment they made is
 * still a figure somebody has to account for — is now a question the finance
 * rollup answers, on the screen where the accounting happens.
 */
function summarise(registrations: readonly WithId<CampRegistration>[]): Totals {
  let children = 0;
  let servants = 0;

  for (const registration of registrations) {
    if (registration.status === 'withdrawn') continue;
    children += registration.children.length;
    if (registration.servant) servants += 1;
  }

  return { children, servants, people: children + servants };
}

/**
 * `tone` is a colour, not a meaning the code reads: `.camp-figure[data-tone]`
 * puts an edge along the top of the cell and takes the numeral with it. Three
 * numbers in one panel, all in the same ink, were read as one long figure —
 * "37 14 43" — often enough at the top of this page to be worth three colours.
 */
type Tone = 'accent' | 'azure' | 'gold';

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string | undefined;
  tone: Tone;
}) {
  return (
    <li className="camp-figure" data-tone={tone}>
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
  tone,
}: {
  href: string;
  title: string;
  eyebrow: string;
  blurb: string;
  badge?: string | undefined;
  /* Matched to the figure above it — registrations to children, groups to
     servants, attendance to the ungrouped — so the eye going from a number to
     the door that changes it is following one colour. */
  tone: Tone;
}) {
  return (
    <li>
      <a className="camp-card" data-tone={tone} href={href}>
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
  config,
  programId,
  season,
  uid,
  registrations,
}: {
  config: CampConfig;
  programId: string;
  season: string;
  uid: string | null;
  registrations: readonly WithId<CampRegistration>[];
}) {
  const [seasons, setSeasons] = useState<AllocationSeason[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** The live board, once the export dialog has read it. See the button below. */
  const [exporting, setExporting] = useState<CampAllocationDraft | null>(null);

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
          <strong>The servants as a spreadsheet</strong>
          <p className="note">
            Every servant, the group they are with, and the grades that group covers &mdash; one
            sheet for each week and half of the camp. No children are on it, so it is a file
            that can be printed and handed round.
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
             *
             * Read *before* the dialog opens, not after it is answered, so that
             * pressing Download in the dialog saves a file rather than waiting
             * on a listener — and so a board that cannot be read fails here,
             * with the button still under the cursor.
             */
            const stop = subscribeAllocation(
              programId,
              season,
              (update) => {
                stop();
                setExporting(update.draft);
              },
              () => stop(),
            );
          }}
        >
          Download .xlsx
        </button>

        {exporting ? (
          <ExportSheet
            config={config}
            season={season}
            onClose={() => setExporting(null)}
            onPick={(weeks, sections) => {
              const allocation = exporting;
              setExporting(null);
              downloadAllocationWorkbook({
                allocation,
                registrations,
                generatedBy: uid ?? '',
                weeks,
                sections,
              });
            }}
          />
        ) : null}
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
