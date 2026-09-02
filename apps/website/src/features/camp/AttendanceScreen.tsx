'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CAMP_WEEKDAYS,
  attendanceByGrade,
  attendanceByGroup,
  attendanceRows,
  attendanceTally,
  campDayDate,
  campDayDateLabel,
  campDayHeading,
  campDayKey,
  campPeople,
  campWeekdayLabel,
  campWeekRangeLabel,
  everyoneCollected,
  toDate,
  type CampAllocationDraft,
  type CampAttendanceEntry,
  type CampAttendanceRow,
  type CampAttendanceSection,
  type CampDayKey,
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
 * One list, two columns, children only. That was decided at the start and none
 * of it changed in the rebuild:
 *
 * - **A tick and a time, not a name.** Recording *who* collected each child was
 *   offered and turned down; `by` carries the uid of whoever tapped.
 * - **In and Out on the same row**, rather than an Arrival mode and a Pickup
 *   mode, so nobody can be in the wrong mode at the one moment where being
 *   wrong means a child is marked as gone home who is not.
 * - **Children only.** Servants carry days too and are deliberately not here.
 *
 * What did change is that a day is now **a date**. The tabs say "Mon, Jun 22"
 * instead of "Week 1 · Mon" wherever `config/camp.weekStarts` is set, and the
 * screen opens on today when today is a day of camp. Nothing stored changed —
 * the keys are still `w1-mon`, and the fallback wording is the old wording.
 *
 * ## Every tick is a merge of one field path
 *
 * Never a read-modify-write. Two servants marking the same morning from two
 * devices, and a replacing write would put back a register missing every tick
 * the other made in between — silently, with no conflict to report.
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
  const [day, setDay] = useState<CampDayKey>(() => todayOrFirst(weekStarts, weeks));

  // The camp's dates arrive a moment after the page does, so "today" has to be
  // asked again once they are known — otherwise the register always opens on
  // the first Monday of camp, which is right one day a year.
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (pinned) return;
    if (weekStarts.some(Boolean)) setDay(todayOrFirst(weekStarts, weeks));
  }, [pinned, weekStarts, weeks]);

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
  const sections = useMemo(
    () => (cut === 'group' ? attendanceByGroup(rows, allocation) : attendanceByGrade(rows)),
    [cut, rows, allocation],
  );

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
              setPinned(true);
              setDay(next);
            }}
          />

          <p className="camp-tally">
            <strong>{tally.in}</strong> of {tally.expected} in
            {tally.missing > 0 ? <span className="camp-tally__miss"> · {tally.missing} not here yet</span> : null}
            {tally.here > 0 ? <span> · {tally.here} still on site</span> : null}
            {tally.extra > 0 ? <span> · {tally.extra} not expected today</span> : null}
            {tally.expected > 0 && everyoneCollected(tally) ? (
              <span className="camp-tally__done"> · everybody has gone home</span>
            ) : null}
          </p>
        </div>
      </section>

      <section className="band camp-band">
        <div className="wrap camp-wrap">
          {sections.length === 0 ? (
            <p className="camp-empty">
              Nobody is registered for {campDayHeading(weekStarts, day)}.
            </p>
          ) : (
            sections.map((section) => (
              <Section key={section.id} section={section} onTick={tick} />
            ))
          )}
        </div>
      </section>
    </CampShell>
  );
}

/* ---------------------------------------------------------------------------
 * The day
 * ------------------------------------------------------------------------ */

/**
 * The day of camp that is today, or the first day of camp.
 *
 * Opening on today is most of what makes this screen usable at a door on a
 * Wednesday morning: the alternative is that everybody's first action, every
 * day, is to find the right tab. Falls back to week one Monday, which is what
 * it always did and what a camp with no dates set can only do.
 */
function todayOrFirst(weekStarts: readonly string[], weeks: number): CampDayKey {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let week = 1; week <= weeks; week += 1) {
    for (const weekday of CAMP_WEEKDAYS) {
      const key = campDayKey(week, weekday);
      const date = campDayDate(weekStarts, key);
      if (date && sameDay(date, now)) return key;
    }
  }
  return campDayKey(1, 'mon');
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

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

/* ---------------------------------------------------------------------------
 * The list
 * ------------------------------------------------------------------------ */

function Section({
  section,
  onTick,
}: {
  section: CampAttendanceSection;
  onTick: (key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) => void;
}) {
  return (
    <section className="camp-register">
      <header className="camp-register__head">
        <h3>{section.name}</h3>
        <span className="note">
          {section.tally.in} of {section.tally.expected} in
          {section.tally.missing > 0 ? ` · ${section.tally.missing} missing` : ''}
        </span>
      </header>

      <ul className="camp-register__rows">
        {section.rows.map((row) => (
          <Row key={row.person.key} row={row} onTick={onTick} />
        ))}
      </ul>
    </section>
  );
}

function Row({
  row,
  onTick,
}: {
  row: CampAttendanceRow;
  onTick: (key: CampPersonKey, which: 'arrived' | 'collected', on: boolean) => void;
}) {
  const arrived = row.entry?.arrived ?? null;
  const collected = row.entry?.collected ?? null;

  return (
    <li className={`camp-mark camp-mark--${row.state}${row.expected ? '' : ' is-unexpected'}`}>
      <span className="camp-mark__name">
        {row.person.name || 'Unnamed'}
        {row.person.allergies.trim() ? (
          <span className="camp-chip__flag" title={row.person.allergies}>
            allergy
          </span>
        ) : null}
        {!row.expected ? <span className="camp-chip__flag">not down for today</span> : null}
      </span>

      <Tick
        label="In"
        on={arrived !== null}
        at={arrived?.at}
        onChange={(on) => onTick(row.person.key, 'arrived', on)}
      />
      <Tick
        label="Out"
        on={collected !== null}
        at={collected?.at}
        // Collecting a child who was never ticked in is possible and is left
        // possible: the alternative is a servant at a gate unable to record
        // what has actually just happened because of a tick nobody made at
        // nine in the morning.
        onChange={(on) => onTick(row.person.key, 'collected', on)}
      />
    </li>
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
  const when = on ? toDate(at as Parameters<typeof toDate>[0]) : null;

  return (
    <button
      type="button"
      className={`camp-tickBtn${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <span className="camp-tickBtn__label">{label}</span>
      <span className="camp-tickBtn__time">
        {when
          ? when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
          : '—'}
      </span>
    </button>
  );
}
