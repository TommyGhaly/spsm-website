'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CAMP_AFTERNOON_FROM_HOUR,
  CAMP_WEEKDAYS,
  attendanceByGrade,
  attendanceByGroup,
  parseCampDayKey,
  attendancePresence,
  attendanceRows,
  attendanceTally,
  campDayDateLabel,
  campDayHeading,
  campDayKey,
  campHalfForDay,
  campPeople,
  campWeekdayLabel,
  campWeekRangeLabel,
  everyoneCollected,
  nearestCampDay,
  toDate,
  type CampAllocationDraft,
  type CampAttendanceEntry,
  type CampAttendanceRow,
  type CampAttendanceSection,
  type CampDayKey,
  type CampHalf,
  type CampPersonKey,
  type CampRegistration,
} from '@spsm/shared';
import { CampError, CampLoading, CampShell } from './CampShell';
import { markAttendance, subscribeAttendance } from './attendanceData';
import { subscribeAllocation } from './allocationData';
import { subscribeRegistrations, type WithId } from './data';
import { useCampAdmin } from './useCampAdmin';

/**
 * The register, at /admin/camp/attendance.
 *
 * ---------------------------------------------------------------------------
 * Children only, one day at a time, and a tick with a time on it. That was
 * decided at the start and none of it has changed:
 *
 * - **A tick and a time, not a name.** Recording *who* collected each child was
 *   offered and turned down; `by` carries the uid of whoever tapped.
 * - **Children only.** Servants carry days too and are deliberately not here.
 * - Every tick is a **merge of one field path**, never a read-modify-write. Two
 *   servants marking the same morning from two devices, and a replacing write
 *   would put back a register missing every tick the other made in between —
 *   silently, with no conflict to report.
 *
 * ## Two halves, which reverses something
 *
 * In and Out used to sit on the same row, on purpose: nobody could then be in
 * the wrong half at the one moment where being wrong means a child is marked as
 * gone home who is not. The halves were asked for anyway, and they earn it —
 * the afternoon list is *only* the children actually on site, with a guardian's
 * number beside each one, which is a different and much shorter screen than
 * ninety names. What keeps it safe:
 *
 * - **anybody ticked in is on the afternoon list**, whether or not today is one
 *   of their registered days. Confirmed as the intended rule on 2 Sep 2026: a
 *   walk-in and a Tuesday-for-Wednesday swap are children who have to be
 *   collected by somebody, and their row carries the same "not down for today"
 *   flag the morning gives them plus a line in the count above. What is left
 *   off is only a child who never arrived;
 * - the half is derived and then **overridable at any time**, so a pickup at
 *   eleven is one tap away rather than impossible;
 * - the afternoon shows each child's **arrival time**, so a "Left" tapped by
 *   mistake is visibly still ticked in;
 * - noon only ever moves the half **for the day being looked at**, and never
 *   once a servant has chosen a half by hand.
 *
 * The day opens on `nearestCampDay` — today during camp, and the closest day
 * either side of it the rest of the year.
 * ---------------------------------------------------------------------------
 */
export function AttendanceScreen() {
  const session = useCampAdmin();
  const { canEdit, config, uid } = session;
  const { programId, season, weeks, weekStarts } = config;

  const [registrations, setRegistrations] = useState<WithId<CampRegistration>[] | null>(null);
  const [allocation, setAllocation] = useState<CampAllocationDraft | null>(null);
  const [entries, setEntries] = useState<Record<CampPersonKey, CampAttendanceEntry>>({});
  const [dayExists, setDayExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cut, setCut] = useState<'grade' | 'group'>('grade');
  const [day, setDay] = useState<CampDayKey>(() => nearestCampDay(weekStarts, weeks));

  /*
   * The clock, asked again every half minute.
   *
   * Not decoration: the register is opened at nine and is still open at noon,
   * on a tablet nobody has touched for an hour, and "it flips at twelve" has to
   * mean that and not "it would have flipped if somebody had reloaded". Half a
   * minute is fine — this drives one boundary a day, and nothing here renders a
   * running clock.
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // The camp's dates arrive a moment after the page does, so the nearest day
  // has to be asked again once they are known — otherwise the register always
  // opens on the first Monday of camp, which is right one day a year.
  const [pinnedDay, setPinnedDay] = useState(false);
  useEffect(() => {
    if (pinnedDay) return;
    if (weekStarts.some(Boolean)) setDay(nearestCampDay(weekStarts, weeks));
  }, [pinnedDay, weekStarts, weeks]);

  /*
   * The half: derived from the day and the clock, until somebody says otherwise.
   *
   * `pinnedHalf` is cleared whenever the day changes, so picking Thursday
   * re-applies the rule rather than carrying Tuesday's choice across. Within one
   * day a manual choice wins for as long as that day is open, noon included —
   * a servant who went to the morning list at 12:20 to tick in a late arrival
   * would not thank us for taking it away thirty seconds later.
   */
  const [pinnedHalf, setPinnedHalf] = useState<CampHalf | null>(null);
  const half = pinnedHalf ?? campHalfForDay(weekStarts, day, now);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeRegistrations(programId, season, setRegistrations, (cause) =>
      setError(cause.message),
    );
  }, [canEdit, programId, season]);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeAllocation(
      programId,
      season,
      (update) => setAllocation(update.draft),
      // The register still works with no groups arranged: the By group cut
      // simply puts everybody in one section at the end.
      () => setAllocation(null),
    );
  }, [canEdit, programId, season]);

  useEffect(() => {
    if (!canEdit) return;
    return subscribeAttendance(
      programId,
      season,
      day,
      (snapshot) => {
        setEntries(snapshot.day?.entries ?? {});
        setDayExists(snapshot.day !== null);
      },
      (cause) => setError(cause.message),
    );
  }, [canEdit, programId, season, day]);

  const people = useMemo(() => campPeople(registrations ?? []), [registrations]);
  const rows = useMemo(() => attendanceRows(people, day, entries), [people, day, entries]);
  const tally = useMemo(() => attendanceTally(rows), [rows]);
  const presence = useMemo(() => attendancePresence(rows), [rows]);

  // The morning is cut the way the pills say; the afternoon is cut the same way
  // but over the children on site alone, which is the half's whole point.
  const sections = useMemo(() => {
    const subject = half === 'afternoon' ? presence.onSite : rows;
    return cut === 'group'
      ? // The board is one arrangement per week again, so the register has to
        // say which week it is reading. The day key already knows.
        attendanceByGroup(subject, allocation, parseCampDayKey(day)?.week ?? 1)
      : attendanceByGrade(subject);
  }, [half, presence.onSite, rows, cut, allocation, day]);

  function tick(key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) {
    void markAttendance({
      programId,
      season,
      day,
      key,
      which,
      on,
      uid,
      exists: dayExists,
    }).catch((cause: Error) => setError(cause.message));
  }

  if (!canEdit || registrations === null) {
    return (
      <CampShell session={session} tab="attendance" title="Summer camp">
        {error ? <CampError error={error} /> : <CampLoading what="the register" />}
      </CampShell>
    );
  }

  return (
    <CampShell
      session={session}
      tab="attendance"
      title="Summer camp"
      actions={
        <div className="camp-pills" role="tablist" aria-label="How the register is cut">
          <button
            type="button"
            role="tab"
            aria-selected={cut === 'grade'}
            className={`camp-pill${cut === 'grade' ? ' is-on' : ''}`}
            onClick={() => setCut('grade')}
          >
            By grade
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cut === 'group'}
            className={`camp-pill${cut === 'group' ? ' is-on' : ''}`}
            onClick={() => setCut('group')}
          >
            By group
          </button>
        </div>
      }
    >
      {error ? <CampError error={error} /> : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          <DayPicker
            weeks={weeks}
            weekStarts={weekStarts}
            day={day}
            onPick={(next) => {
              setPinnedDay(true);
              // A new day is a new question. Thursday afternoon does not mean
              // the servant wants Friday afternoon, and the rule is better at
              // guessing than the last tap was.
              setPinnedHalf(null);
              setDay(next);
            }}
          />

          <div className="camp-half">
            <HalfSwitch half={half} onPick={setPinnedHalf} />
            {pinnedHalf ? (
              <button type="button" className="camp-half__auto" onClick={() => setPinnedHalf(null)}>
                Follow the clock
              </button>
            ) : (
              <span className="note camp-half__auto">
                {half === 'morning'
                  ? `Turns over at ${CAMP_AFTERNOON_FROM_HOUR % 12 || 12} pm`
                  : 'Following the clock'}
              </span>
            )}
          </div>

          {half === 'morning' ? (
            <p className="camp-tally">
              <strong>{tally.in}</strong> of {tally.expected} in
              {tally.missing > 0 ? (
                <span className="camp-tally__miss"> · {tally.missing} not here yet</span>
              ) : null}
              {tally.extra > 0 ? <span> · {tally.extra} not expected today</span> : null}
            </p>
          ) : (
            <p className="camp-tally">
              <strong>{tally.here}</strong> still on site · {tally.gone} gone home
              {/*
                * Walk-ins, counted in the afternoon as well as the morning.
                *
                * The list itself has always held them — anybody ticked in is on
                * it, down for today or not, and each row says "not down for
                * today". What was missing was the number: a servant reading
                * "14 still on site" against a morning that expected twelve had
                * no way to see that the extra two are the two who swapped days,
                * and a count that cannot be reconciled is a count somebody
                * stops trusting.
                */}
              {tally.extra > 0 ? <span> · {tally.extra} not down for today</span> : null}
              {tally.expected > 0 && everyoneCollected(tally) ? (
                <span className="camp-tally__done"> · everybody has gone home</span>
              ) : null}
            </p>
          )}
        </div>
      </section>

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          {half === 'afternoon' && presence.onSite.length === 0 ? (
            <p className="camp-empty">
              {presence.goneHome.length > 0
                ? 'Everybody who came today has gone home.'
                : `Nobody has been ticked in for ${campDayHeading(weekStarts, day)} yet.`}
            </p>
          ) : sections.length === 0 ? (
            <p className="camp-empty">
              Nobody is registered for {campDayHeading(weekStarts, day)}.
            </p>
          ) : (
            sections.map((section) => (
              <Section key={section.id} section={section} half={half} onTick={tick} />
            ))
          )}

          {half === 'afternoon' ? (
            <>
              <GoneHome rows={presence.goneHome} onTick={tick} />
              {/*
                * The one thing the afternoon cannot do, said out loud.
                *
                * A child collected who was never ticked in used to be markable
                * from this screen, because a servant at a gate has to be able
                * to record what has just happened. The half took the control
                * away, so it says where the control went instead of leaving
                * somebody tapping at a name that is not on the list.
                */}
              <p className="note camp-half__hint">
                Collecting a child who was never ticked in? Mark them in on the
                morning list first.
              </p>
            </>
          ) : null}
        </div>
      </section>
    </CampShell>
  );
}

/* ---------------------------------------------------------------------------
 * The day, and the half
 * ------------------------------------------------------------------------ */

function DayPicker({
  weeks,
  weekStarts,
  day,
  onPick,
}: {
  weeks: number;
  weekStarts: readonly string[];
  day: CampDayKey;
  onPick: (day: CampDayKey) => void;
}) {
  return (
    <div className="camp-dayPick">
      {Array.from({ length: weeks }, (_unused, index) => index + 1).map((week) => (
        <div className="camp-dayPick__week" key={week}>
          <span className="camp-dayPick__label">
            Week {week}
            {campWeekRangeLabel(weekStarts, week) === `Week ${week}` ? null : (
              <em> · {campWeekRangeLabel(weekStarts, week)}</em>
            )}
          </span>
          <div className="camp-dayPick__row" role="tablist" aria-label={`Week ${week}`}>
            {CAMP_WEEKDAYS.map((weekday) => {
              const key = campDayKey(week, weekday);
              const date = campDayDateLabel(weekStarts, key);
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={key === day}
                  className={`camp-dayTab${key === day ? ' is-on' : ''}`}
                  onClick={() => onPick(key)}
                >
                  <span>{campWeekdayLabel(weekday)}</span>
                  {date ? <em>{date.split(' ').slice(1).join(' ')}</em> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Morning or afternoon.
 *
 * Two tabs rather than a sliding switch. A switch has an off state and a state
 * it is *going* to, and this is neither — it is two named lists, one of which
 * is showing, and both names have to be readable by a thumb at a gate.
 */
function HalfSwitch({
  half,
  onPick,
}: {
  half: CampHalf;
  onPick: (half: CampHalf) => void;
}) {
  return (
    <div className="camp-halfSwitch" role="tablist" aria-label="Which half of the day">
      <button
        type="button"
        role="tab"
        aria-selected={half === 'morning'}
        className={`camp-halfBtn${half === 'morning' ? ' is-on' : ''}`}
        onClick={() => onPick('morning')}
      >
        Morning
        <em>who showed up</em>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={half === 'afternoon'}
        className={`camp-halfBtn${half === 'afternoon' ? ' is-on' : ''}`}
        onClick={() => onPick('afternoon')}
      >
        Afternoon
        <em>who is still here</em>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The list
 * ------------------------------------------------------------------------ */

function Section({
  section,
  half,
  onTick,
}: {
  section: CampAttendanceSection;
  half: CampHalf;
  onTick: (key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) => void;
}) {
  return (
    <section className="camp-register">
      <header className="camp-register__head">
        <h3>{section.name}</h3>
        <span className="note">
          {half === 'afternoon'
            ? `${section.rows.length} still here`
            : `${section.tally.in} of ${section.tally.expected} in${
                section.tally.missing > 0 ? ` · ${section.tally.missing} missing` : ''
              }`}
        </span>
      </header>

      <ul className="camp-register__rows">
        {section.rows.map((row) => (
          <Row key={row.person.key} row={row} half={half} onTick={onTick} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The children who have gone home, in a shut drawer under the afternoon.
 *
 * They are kept rather than dropped so that a "Left" tapped on the wrong row is
 * one tap from being taken back, and shut so that the top of the screen is
 * always the list that has to reach empty.
 */
function GoneHome({
  rows,
  onTick,
}: {
  rows: readonly CampAttendanceRow[];
  onTick: (key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <details className="camp-goneHome">
      <summary>
        Gone home · {rows.length} {rows.length === 1 ? 'child' : 'children'}
      </summary>
      <ul className="camp-register__rows">
        {rows.map((row) => (
          <Row key={row.person.key} row={row} half="afternoon" onTick={onTick} />
        ))}
      </ul>
    </details>
  );
}

function Row({
  row,
  half,
  onTick,
}: {
  row: CampAttendanceRow;
  half: CampHalf;
  onTick: (key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) => void;
}) {
  const arrived = row.entry?.arrived ?? null;
  const collected = row.entry?.collected ?? null;

  return (
    <li className={`camp-mark camp-mark--${row.state}${row.expected ? '' : ' is-unexpected'}`}>
      <span className="camp-mark__who">
        <span className="camp-mark__name">
          {/*
            * The name, and nothing medical.
            *
            * An allergy chip used to sit here. It came off on Tommy's word: a
            * register is a tick at a door, and what the kitchen and the
            * first-aid box need belongs where somebody can act on it — the
            * roster and the group board — not on the one screen whose whole
            * job is a name and a time.
            */}
          {row.person.name || 'Unnamed'}
          {/* A child who is not down for today is still tickable — camps take
              walk-ins and a parent swaps Tuesday for Wednesday at the gate. The
              flag is so the count above reads honestly, not a refusal. */}
          {!row.expected ? <span className="camp-person__flag">not down for today</span> : null}
        </span>

        {half === 'afternoon' ? (
          <span className="camp-mark__guardian">
            <Guardian name={row.person.contactName} phone={row.person.contactPhone} />
            {arrived ? <em> · in {timeOf(arrived.at)}</em> : null}
          </span>
        ) : null}
      </span>

      {half === 'morning' ? (
        <Tick
          label="In"
          on={arrived !== null}
          at={arrived?.at}
          onChange={(on) => onTick(row.person.key, 'arrived', on)}
        />
      ) : (
        <Tick
          label="Left"
          on={collected !== null}
          at={collected?.at}
          onChange={(on) => onTick(row.person.key, 'collected', on)}
        />
      )}
    </li>
  );
}

/**
 * Who is collecting, and their number as a `tel:` link.
 *
 * The registration's contact, which is the guardian on a family registration.
 * A link because this is read on a phone, standing outside, by somebody who
 * needs to ring a mother who is late — and the punctuation has to come out or
 * some dialers choke on it.
 */
function Guardian({ name, phone }: { name: string; phone: string }) {
  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();

  if (!trimmedName && !trimmedPhone) {
    return <span className="camp-mark__guardian-none">No contact on the registration</span>;
  }

  return (
    <>
      {trimmedName ? <span>{trimmedName}</span> : null}
      {trimmedPhone ? (
        <a href={`tel:${trimmedPhone.replace(/[^\d+]/g, '')}`}>{trimmedPhone}</a>
      ) : null}
    </>
  );
}

function Tick({
  label,
  on,
  at,
  onChange,
}: {
  label: string;
  on: boolean;
  at?: unknown;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`camp-tickBtn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <span className="camp-tickBtn__label">{label}</span>
      <span className="camp-tickBtn__time">{on ? timeOf(at) : '—'}</span>
    </button>
  );
}

function timeOf(at: unknown): string {
  const when = toDate(at as Parameters<typeof toDate>[0]);
  return when ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';
}
