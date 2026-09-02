'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  blankRegistration,
  campBill,
  campGradeShort,
  campWeeksAttended,
  describeCampDays,
  registrationName,
  type CampRegistration,
  type CampRegistrationDraft,
  type CampServantRequest,
} from '@spsm/shared';
import { CampError, CampLoading, CampShell } from './CampShell';
import { RegistrationEditor, money, statusLabel } from './RegistrationEditor';
import {
  acceptServantRequest,
  deleteServantRequest,
  newRegistrationId,
  subscribeRegistrations,
  subscribeServantRequests,
  type WithId,
} from './data';
import { useCampAdmin } from './useCampAdmin';

/**
 * Everybody who has registered, at /admin/camp/registrations.
 *
 * ---------------------------------------------------------------------------
 * One list with three views of it, rather than three screens.
 *
 * Families and servants were one undifferentiated roster before, sorted
 * alphabetically, with the sign-up queue on a fourth screen somewhere else. But
 * the two halves of this camp are not the same transaction and are never read
 * at the same moment: a family row is read to answer "have they paid", and a
 * servant row to answer "which days can they do and is their paperwork done".
 * So they are separate views over the same query, with the columns each of them
 * needs, and the queue is the third — where the person who would act on it
 * already is.
 *
 * The editor opens **in place**, over the list, rather than at its own address.
 * That is the one thing kept from the old screen and it is right for the same
 * reason: closing it puts somebody back exactly where they were in a list of
 * two hundred, which a route change cannot do without restoring scroll.
 * ---------------------------------------------------------------------------
 */

type View = 'families' | 'servants' | 'queue';

interface Editing {
  id: string;
  draft: CampRegistrationDraft;
  isNew: boolean;
}

export function RegistrationsScreen() {
  const session = useCampAdmin();
  const { canEdit, config, uid } = session;
  const { programId, season } = config;

  const [rows, setRows] = useState<WithId<CampRegistration>[] | null>(null);
  const [queue, setQueue] = useState<WithId<CampServantRequest>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('families');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeRegistrations(programId, season, setRows, (cause) => setError(cause.message));
  }, [canEdit, programId, season]);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeServantRequests(programId, season, setQueue, (cause) =>
      setError(cause.message),
    );
  }, [canEdit, programId, season]);

  const families = useMemo(
    () => (rows ?? []).filter((row) => row.kind === 'family'),
    [rows],
  );
  const servants = useMemo(
    () => (rows ?? []).filter((row) => row.kind === 'servant'),
    [rows],
  );

  const shown = useMemo(() => {
    const list = view === 'servants' ? servants : families;
    const needle = search.trim().toLowerCase();
    if (!needle) return list;
    /*
     * Searched across the names on the registration, not only the contact's.
     *
     * A camp is asked for "Mariam", and Mariam is a child inside a document
     * filed under her mother's name. Matching only the title is the single most
     * common way this screen would fail to find somebody who is definitely in
     * it.
     */
    return list.filter((row) => {
      const hay = [
        row.contact.name,
        row.contact.email,
        row.contact.phone,
        ...row.children.map((child) => `${child.firstName} ${child.lastName}`),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [view, families, servants, search]);

  if (editing) {
    return (
      <CampShell session={session} tab="registrations" title="Summer camp">
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <RegistrationEditor
              id={editing.id}
              draft={editing.draft}
              config={config}
              uid={uid}
              isNew={editing.isNew}
              onDone={() => setEditing(null)}
            />
          </div>
        </section>
      </CampShell>
    );
  }

  const startFamily = () =>
    setEditing({
      id: newRegistrationId(),
      isNew: true,
      draft: blankRegistration({
        programId,
        season,
        kind: 'family',
        // The fee is copied onto the registration as it is created, so changing
        // the camp's fee later never re-bills anybody already registered.
        baseCents: config.baseCents,
        takenByUid: uid,
      }),
    });

  return (
    <CampShell
      session={session}
      tab="registrations"
      title="Summer camp"
      actions={
        config.familyRegistration ? (
          <button type="button" className="button" onClick={startFamily}>
            New family
          </button>
        ) : (
          <span className="camp-closed">Registrations are closed</span>
        )
      }
    >
      {error ? <CampError error={error} /> : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <div className="camp-views">
            <div className="camp-pills" role="tablist" aria-label="Who to show">
              <Pill on={view === 'families'} onClick={() => setView('families')}>
                Families <em>{families.length}</em>
              </Pill>
              <Pill on={view === 'servants'} onClick={() => setView('servants')}>
                Servants <em>{servants.length}</em>
              </Pill>
              <Pill on={view === 'queue'} onClick={() => setView('queue')}>
                Sign-ups waiting <em>{queue.length}</em>
              </Pill>
            </div>

            {view !== 'queue' ? (
              <input
                type="search"
                className="input camp-search"
                value={search}
                placeholder="Find a name…"
                aria-label="Find a registration"
                onChange={(event) => setSearch(event.target.value)}
              />
            ) : null}
          </div>

          {!config.familyRegistration && view === 'families' ? (
            <p className="note">
              The camp is not taking new family registrations. Everything already taken is still
              fully editable — open the settings on <a href="/admin/camp">the camp screen</a> to
              reopen the list.
            </p>
          ) : null}

          {rows === null ? (
            <CampLoading what="the registrations" />
          ) : view === 'queue' ? (
            <Queue
              queue={queue}
              waiverInForce={config.waiverText.trim().length > 0}
              uid={uid}
              onError={setError}
            />
          ) : shown.length === 0 ? (
            <p className="camp-empty">
              {search.trim()
                ? 'Nobody by that name.'
                : view === 'families'
                  ? 'No family has registered yet.'
                  : 'No servant has been taken on yet. Sign-ups arrive in the queue.'}
            </p>
          ) : (
            <ul className="camp-rows">
              {shown.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className="camp-row"
                    onClick={() => setEditing({ id: row.id, draft: row, isNew: false })}
                  >
                    {view === 'families' ? (
                      <FamilyRow row={row} weeks={config.weeks} />
                    ) : (
                      <ServantRow row={row} weeks={config.weeks} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </CampShell>
  );
}

/* ---------------------------------------------------------------------------
 * Rows
 * ------------------------------------------------------------------------ */

function FamilyRow({ row, weeks }: { row: WithId<CampRegistration>; weeks: number }) {
  const bill = campBill(row);
  const owing = bill.balanceCents > 0;

  return (
    <>
      <span className="camp-row__name">
        {registrationName(row)}
        <StatusChip status={row.status} />
      </span>
      <span className="camp-row__who">
        {row.children.length === 0
          ? 'No children yet'
          : row.children
              .map((child) => `${child.firstName || 'Child'} (${campGradeShort(child.grade)})`)
              .join(', ')}
      </span>
      <span className="camp-row__days">
        {/* One line for the whole family: the weeks any of them are coming. */}
        {row.children.some((child) => child.days.length > 0)
          ? describeCampDays(
              [...new Set(row.children.flatMap((child) => child.days))],
              weeks,
            )
          : 'No days chosen'}
      </span>
      <span className={`camp-row__money${owing ? ' is-owing' : ''}`}>
        {bill.dueCents === 0
          ? '—'
          : owing
            ? `${money(bill.balanceCents)} owed`
            : 'Paid'}
      </span>
    </>
  );
}

function ServantRow({ row, weeks }: { row: WithId<CampRegistration>; weeks: number }) {
  const servant = row.servant;
  return (
    <>
      <span className="camp-row__name">
        {registrationName(row)}
        <StatusChip status={row.status} />
      </span>
      <span className="camp-row__who">
        {servant && servant.sections.length > 0
          ? servant.sections.map((section) => (section === 'elementary' ? 'Elementary' : 'Middle school')).join(' & ')
          : 'No section chosen'}
      </span>
      <span className="camp-row__days">
        {servant ? describeCampDays(servant.days, weeks) : '—'}
      </span>
      <span className={`camp-row__money${servant?.cleared ? '' : ' is-owing'}`}>
        {servant?.cleared ? 'Cleared' : 'Not cleared'}
      </span>
    </>
  );
}

function StatusChip({ status }: { status: CampRegistration['status'] }) {
  if (status === 'registered') return null; // The ordinary case needs no badge.
  return <span className={`camp-status camp-status--${status}`}>{statusLabel(status)}</span>;
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className={`camp-pill${on ? ' is-on' : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * The queue
 * ------------------------------------------------------------------------ */

/**
 * Servants who signed themselves up, waiting to be accepted.
 *
 * Accepting is what *writes* the registration — from this browser, under this
 * administrator's uid and grant. Nothing a stranger sends reaches the roster,
 * the shirt count or the groups screen until somebody here has said so. A
 * sign-up that does not validate is accepted as a **draft** rather than
 * refused, because a teenager who left their emergency contact blank is a phone
 * call, not a rejection.
 */
function Queue({
  queue,
  waiverInForce,
  uid,
  onError,
}: {
  queue: readonly WithId<CampServantRequest>[];
  waiverInForce: boolean;
  uid: string | null;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (queue.length === 0) {
    return (
      <p className="camp-empty">
        Nobody is waiting. Sign-ups arrive here from <a href="/forms/summer-camp">the public
        form</a> while it is open.
      </p>
    );
  }

  return (
    <ul className="camp-queue">
      {queue.map((request) => {
        const servant = request.registration.servant;
        return (
          <li key={request.id} className="camp-queue__card">
            <div>
              <strong>{request.registration.contact.name || 'Unnamed'}</strong>
              <dl className="camp-queue__facts">
                <div>
                  <dt>Phone</dt>
                  <dd>{request.registration.contact.phone || '—'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{request.registration.contact.email || '—'}</dd>
                </div>
                <div>
                  <dt>Days</dt>
                  <dd>{servant ? describeCampDays(servant.days) : '—'}</dd>
                </div>
                <div>
                  <dt>Weeks</dt>
                  <dd>{servant ? campWeeksAttended(servant.days) : 0}</dd>
                </div>
                <div>
                  <dt>Would like to</dt>
                  <dd>{servant?.desiredRoles.join(', ') || '—'}</dd>
                </div>
              </dl>
              {servant?.availability ? (
                <p className="note">{servant.availability}</p>
              ) : null}
            </div>
            <div className="camp-queue__actions">
              <button
                type="button"
                className="button"
                disabled={busy === request.id}
                onClick={() => {
                  setBusy(request.id);
                  void acceptServantRequest(request.id, request, { uid, waiverInForce })
                    .catch((cause: Error) => onError(cause.message))
                    .finally(() => setBusy(null));
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="camp-danger"
                disabled={busy === request.id}
                onClick={() => {
                  if (!window.confirm('Dismiss this sign-up? It is deleted, not kept anywhere.')) {
                    return;
                  }
                  setBusy(request.id);
                  void deleteServantRequest(request.id)
                    .catch((cause: Error) => onError(cause.message))
                    .finally(() => setBusy(null));
                }}
              >
                Dismiss
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
