'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  blankRegistration,
  campBill,
  campAge,
  campGradeShort,
  campSectionLabel,
  campWeekRoleKey,
  campWeekdayLabel,
  campWeeksAttended,
  parseCampDayKey,
  shirtSizeLabel,
  CAMP_SECTIONS,
  describeCampDays,
  describeCampDesiredRoles,
  registrationName,
  type CampConfig,
  type CampRegistration,
  type CampRegistrationDraft,
  type CampServantRequest,
} from '@spsm/shared';
import { CampError, CampLoading, CampShell } from './CampShell';
import { RegistrationEditor, money, statusLabel } from './RegistrationEditor';
import {
  acceptServantRequest,
  deleteRegistration,
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
  const { canEdit, canSeeMoney, config, uid } = session;
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
            {/*
              A servant's registration is read, never edited.
              ----------------------------------------------------------------
              *"I can go to the servants section and edit the servant's
              registration — I shouldn't be able to do that."* It is a form
              somebody filled in about themselves, and an administrator quietly
              rewriting what a volunteer said they can do is how a camp ends up
              with a roster nobody has agreed to. Families are different and
              stay fully editable: that registration is taken *by* the camp, at
              a desk, on somebody's behalf.
            */}
            {editing.draft.kind === 'servant' ? (
              <ServantSheet
                id={editing.id}
                registration={editing.draft}
                config={config}
                onDone={() => setEditing(null)}
                onError={setError}
              />
            ) : (
              <RegistrationEditor
                id={editing.id}
                draft={editing.draft}
                config={config}
                uid={uid}
                canSeeMoney={canSeeMoney}
                isNew={editing.isNew}
                onDone={() => setEditing(null)}
              />
            )}
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
              weeks={config.weeks}
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
                    /* Three columns rather than four when the money column is
                       withheld — see `FamilyRow`. The servants' view keeps four
                       either way: its last column is whether they are cleared
                       to be with children, which is not money. */
                    className={
                      view === 'families' && !canSeeMoney ? 'camp-row camp-row--nomoney' : 'camp-row'
                    }
                    onClick={() => setEditing({ id: row.id, draft: row, isNew: false })}
                  >
                    {view === 'families' ? (
                      <FamilyRow row={row} weeks={config.weeks} showMoney={canSeeMoney} />
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

/**
 * A family, and whether the last column says what they owe.
 *
 * `showMoney` is `finance` narrowed to `camp`, and the column is dropped rather
 * than dashed: a dash in this column already means "no fee due", so withholding
 * a balance as a dash would read as a family who owes nothing. A registrar sees
 * three columns and the row is otherwise the same row.
 */
function FamilyRow({
  row,
  weeks,
  showMoney,
}: {
  row: WithId<CampRegistration>;
  weeks: number;
  showMoney: boolean;
}) {
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
      {showMoney && (
        <span className={`camp-row__money${owing ? ' is-owing' : ''}`}>
          {bill.dueCents === 0
            ? '—'
            : owing
              ? `${money(bill.balanceCents)} owed`
              : 'Paid'}
        </span>
      )}
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
      {/*
        What they asked to do, not whether their paperwork is done.
        --------------------------------------------------------------------
        This column used to read "Cleared / Not cleared". That field is gone
        with the rest of the camp's own notes about a servant — see
        `CampServantDetails` — and what belongs in the last column of this row
        is the thing the row is scanned for: what did this person volunteer
        for.
      */}
      <span className="camp-row__money">
        {servant ? describeCampDesiredRoles(servant) || 'No preference' : '—'}
      </span>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * A servant's registration, read
 * ------------------------------------------------------------------------ */

/**
 * What a servant said about themselves, laid out and not editable.
 *
 * ---------------------------------------------------------------------------
 * The administrators' screen used to open a servant in the same editor a family
 * gets, and it had two things wrong with it. Every answer on the sign-up form
 * was a field an administrator could quietly rewrite — a volunteer who said
 * "mornings only" could be recorded as available all week without ever being
 * told. And it carried three fields that were the camp's *opinion* rather than
 * the servant's answer: what they had been "given", whether their safeguarding
 * paperwork was done, and a note about that. Those are gone entirely — see
 * `CampServantDetails` — because what somebody is given is which group they are
 * standing in on the board, and safeguarding is the diocese's record, not a
 * tickbox on a parish website.
 *
 * So this reads. The one thing it can still do is **delete**, which is not a
 * record about anybody: it is how a sign-up accepted by mistake is undone.
 * Correcting a real mistake in what somebody wrote means asking them to send
 * the form again, which is the honest amount of friction for changing what a
 * volunteer said they can do.
 * ---------------------------------------------------------------------------
 */
function ServantSheet({
  id,
  registration,
  config,
  onDone,
  onError,
}: {
  id: string;
  registration: CampRegistrationDraft;
  config: CampConfig;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const servant = registration.servant;
  const weeks = Array.from({ length: config.weeks }, (_unused, index) => index + 1);

  const days = weeks
    .map((week) => ({
      week,
      days: (servant?.days ?? [])
        .map(parseCampDayKey)
        .filter((parsed) => parsed?.week === week)
        .map((parsed) => campWeekdayLabel(parsed!.day)),
    }))
    .filter((entry) => entry.days.length > 0);

  /** Every week and half they ticked something for, in order. */
  const asked = weeks.flatMap((week) =>
    CAMP_SECTIONS.map((section) => ({
      week,
      section,
      roles: servant?.desiredRolesByWeek[campWeekRoleKey(week, section)] ?? [],
    })).filter((row) => row.roles.length > 0),
  );

  async function remove() {
    const who = registration.contact.name.trim() || 'this servant';
    if (
      !window.confirm(
        `Remove ${who} from the camp?\n\nThis deletes the registration. It is for a sign-up ` +
          `accepted by mistake, or somebody who has told the camp they can no longer serve. ` +
          `Anywhere they are placed on the groups board, they will stop matching anybody.`,
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      await deleteRegistration(id);
      onDone();
    } catch (cause) {
      onError((cause as Error)?.message ?? 'The delete did not go through.');
      setRemoving(false);
    }
  }

  return (
    <div className="camp-editor">
      <header className="camp-editor__head">
        <div>
          <button type="button" className="camp-back" onClick={onDone}>
            ← All registrations
          </button>
          <h2>{registration.contact.name.trim() || 'Unnamed servant'}</h2>
        </div>
      </header>

      <p className="note camp-readonly__why">
        This is their own sign-up form, as they filled it in. Nothing here can be edited — if
        something is wrong, ask them to send the form again.
      </p>

      <dl className="camp-readonly">
        <Line term="Phone">{registration.contact.phone || '—'}</Line>
        <Line term="Email">{registration.contact.email || '—'}</Line>
        {registration.contact.address.trim() ? (
          <Line term="Address">{registration.contact.address.trim()}</Line>
        ) : null}
        <Line term="Age">
          {servant?.dateOfBirth
            ? `${campAge(servant.dateOfBirth) ?? '—'} years old`
            : 'Not given'}
        </Line>
        <Line term="Shirt">
          {servant?.shirtSize ? shirtSizeLabel(servant.shirtSize) : 'Not given'}
        </Line>
        <Line term="Half of camp">
          {servant && servant.sections.length > 0
            ? servant.sections.map(campSectionLabel).join(' and ')
            : 'Neither chosen'}
        </Line>
        <Line term="Days">
          {days.length === 0
            ? 'None chosen'
            : days.map((entry) => `Week ${entry.week}: ${entry.days.join(', ')}`).join(' · ')}
        </Line>
        {servant?.availability.trim() ? (
          <Line term="Availability">{servant.availability.trim()}</Line>
        ) : null}
        <Line term="Emergency contact">
          {[registration.emergency.name, registration.emergency.phone, registration.emergency.relationship]
            .filter((entry) => entry.trim())
            .join(' · ') || 'Not given'}
        </Line>
        <Line term="Waiver">
          {registration.waiver.agreed
            ? `Agreed${registration.waiver.signedName ? ` — ${registration.waiver.signedName}` : ''}`
            : 'Not signed'}
        </Line>
        {registration.note.trim() ? (
          <Line term="What they wrote">{registration.note.trim()}</Line>
        ) : null}
      </dl>

      <section className="camp-section">
        <h3>What they asked to do</h3>
        {asked.length === 0 ? (
          <p className="note">Nothing was ticked on the form.</p>
        ) : (
          <ul className="camp-readonly__asked">
            {asked.map((row) => (
              <li key={`${row.week}-${row.section}`}>
                <strong>
                  Week {row.week} · {campSectionLabel(row.section)}
                </strong>
                <span>
                  {row.roles.map((role) => (
                    <span key={role} className="camp-tag">
                      {role}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="camp-editor__foot">
        <button type="button" className="button button--quiet" onClick={onDone}>
          Back
        </button>
        <button type="button" className="camp-danger" disabled={removing} onClick={() => void remove()}>
          {removing ? 'Removing…' : 'Remove from the camp'}
        </button>
      </footer>
    </div>
  );
}

/** One read-only line on a servant's sheet. */
function Line({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/**
 * The one badge left.
 *
 * There were four statuses and three badges. `draft` and `waitlisted` are gone
 * — see `CAMP_STATUSES` — and everything a screen ever needed to know is
 * whether they pulled out. A registration that is simply not finished shows no
 * badge: what is missing is on the editor, in words, where somebody can act
 * on it.
 */
function StatusChip({ status }: { status: CampRegistration['status'] }) {
  if (status !== 'withdrawn') return null;
  return <span className="camp-status camp-status--withdrawn">{statusLabel(status)}</span>;
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
  weeks,
  waiverInForce,
  uid,
  onError,
}: {
  queue: readonly WithId<CampServantRequest>[];
  weeks: number;
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
                  <dd>{servant ? describeCampDays(servant.days, weeks) : '—'}</dd>
                </div>
                <div>
                  <dt>Weeks</dt>
                  <dd>{servant ? campWeeksAttended(servant.days) : 0}</dd>
                </div>
                <div>
                  {/* Week by week, not merged: the point of asking per week is
                      that somebody who wants sports in week one may want the
                      kitchen in week two, and the merge loses exactly that. */}
                  <dt>Would like to</dt>
                  <dd>{describeCampDesiredRoles(servant, weeks) || '—'}</dd>
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
