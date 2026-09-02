import { describe, expect, it } from 'vitest';
import {
  MAX_ATTENDANCE_ENTRIES,
  attendanceByGrade,
  attendanceByGroup,
  attendanceDocId,
  attendanceRows,
  attendanceState,
  attendanceTally,
  blankAttendanceDay,
  blankBand,
  blankGroup,
  blankRegistration,
  blankAllocation,
  campPeople,
  childKey,
  daysWithChildren,
  describeAttendance,
  everyoneCollected,
  parseCampAttendanceDay,
  type CampAttendanceEntry,
  type CampGrade,
  type CampRegistration,
  type CampAllocationDraft,
} from '@spsm/shared';

/**
 * The register, and the two questions it exists to answer.
 *
 * ---------------------------------------------------------------------------
 * The morning: **who is missing?** — which is a count of the children down for
 * today who have no arrival mark, per grade. The afternoon: **is everybody
 * gone?** — which is not the same as "nobody is here", and the difference is
 * the one thing in this file that could quietly go wrong and be believed. A
 * register at nine in the morning has nobody marked as still here, and a screen
 * that told a servant everybody had been collected would be telling them the
 * truth about the data and a lie about the children.
 *
 * The rest is the arithmetic that has to keep agreeing with itself while three
 * people tick at once: expected + not expected, in + missing, here + gone.
 * ---------------------------------------------------------------------------
 */

/* ---- fixtures ----------------------------------------------------------- */

function family(
  registrationId: string,
  children: { id: string; name: string; grade: CampGrade; days: string[] }[],
  status: CampRegistration['status'] = 'registered',
): CampRegistration & { id: string } {
  const draft = blankRegistration({
    programId: 'summercamp',
    season: '2027',
    kind: 'family',
    baseCents: 0,
    takenByUid: 'lead-1',
  });

  return {
    ...draft,
    id: registrationId,
    status,
    contact: { ...draft.contact, name: `${registrationId} guardian`, phone: '555-0100' },
    children: children.map((child) => ({
      id: child.id,
      firstName: child.name,
      lastName: 'Test',
      dateOfBirth: '',
      grade: child.grade,
      shirtSize: 'YM' as const,
      days: child.days,
      allergies: '',
      medicalNotes: '',
      groupName: '',
      photoConsent: false,
      note: '',
    })),
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function servantRow(registrationId: string, days: string[]): CampRegistration & { id: string } {
  const draft = blankRegistration({
    programId: 'summercamp',
    season: '2027',
    kind: 'servant',
    baseCents: 0,
    takenByUid: 'lead-1',
  });

  return {
    ...draft,
    id: registrationId,
    status: 'registered',
    contact: { ...draft.contact, name: `${registrationId} servant` },
    servant: { ...draft.servant!, days },
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

const IN: CampAttendanceEntry = { arrived: { at: null, by: 'lead-1' }, collected: null };
const OUT: CampAttendanceEntry = {
  arrived: { at: null, by: 'lead-1' },
  collected: { at: null, by: 'lead-1' },
};

/* ---- the document ------------------------------------------------------- */

describe('the day document', () => {
  it('derives its id from the program, the season and the day', () => {
    expect(attendanceDocId('summercamp', '2027', 'w1-tue')).toBe('summercamp__2027__w1-tue');
  });

  it('opens a day nobody has ticked as an empty register', () => {
    const blank = blankAttendanceDay('summercamp', '2027', 'w2-fri');
    expect(blank.entries).toEqual({});
    expect(attendanceTally(attendanceRows([], 'w2-fri', blank.entries)).expected).toBe(0);
  });

  it('reads a mark whose timestamp has not landed yet as a mark', () => {
    // `serverTimestamp()` is a sentinel until the write is acknowledged, and a
    // cached snapshot hands back null for it. Treating that as "not ticked"
    // would flick a child out of the register for the length of a round trip.
    const parsed = parseCampAttendanceDay({
      programId: 'summercamp',
      season: '2027',
      day: 'w1-mon',
      entries: { 'reg-1/child-1': { arrived: { at: null, by: 'lead-1' } } },
    });

    expect(attendanceState(parsed.entries['reg-1/child-1'])).toBe('here');
  });

  it('drops an entry whose marks have both been taken back', () => {
    // Undo writes null rather than deleting the field, so a day that has been
    // ticked and untucked must read as untouched rather than as a register
    // with entries in it.
    const parsed = parseCampAttendanceDay({
      season: '2027',
      day: 'w1-mon',
      entries: {
        'reg-1/child-1': { arrived: null, collected: null },
        'reg-1/child-2': { arrived: { at: null, by: 'lead-1' }, collected: null },
      },
    });

    expect(Object.keys(parsed.entries)).toEqual(['reg-1/child-2']);
  });

  it('keeps a slash in a key intact', () => {
    // The key is `registrationId/childId` and is a Firestore *field name*, not
    // a path. A parser that split on the slash would silently re-key the whole
    // register onto registrations.
    const parsed = parseCampAttendanceDay({
      entries: { 'reg-1/child-9': { collected: { at: null, by: 'x' } } },
    });
    expect(Object.keys(parsed.entries)).toEqual(['reg-1/child-9']);
  });

  it('will not read more entries than the rules allow to be written', () => {
    const entries: Record<string, unknown> = {};
    for (let index = 0; index < MAX_ATTENDANCE_ENTRIES + 40; index += 1) {
      entries[`reg-1/child-${index}`] = { arrived: { at: null, by: 'lead-1' } };
    }

    const parsed = parseCampAttendanceDay({ season: '2027', day: 'w1-mon', entries });
    expect(Object.keys(parsed.entries)).toHaveLength(MAX_ATTENDANCE_ENTRIES);
  });

  it('survives a document with nothing in it', () => {
    const parsed = parseCampAttendanceDay(undefined);
    expect(parsed.entries).toEqual({});
    expect(parsed.programId).toBe('summercamp');
  });
});

/* ---- the roster --------------------------------------------------------- */

describe('the day’s roster', () => {
  const registrations = [
    family('reg-1', [
      { id: 'c1', name: 'Marina', grade: '3', days: ['w1-mon', 'w1-tue'] },
      { id: 'c2', name: 'Mina', grade: 'k', days: ['w1-mon'] },
    ]),
    family('reg-2', [{ id: 'c3', name: 'Verena', grade: '3', days: ['w1-tue'] }]),
    servantRow('reg-3', ['w1-mon', 'w1-tue']),
  ];
  const people = campPeople(registrations);

  it('is children only — a servant is never on it', () => {
    const rows = attendanceRows(people, 'w1-mon', {});
    expect(rows.map((row) => row.person.name)).toEqual(['Marina Test', 'Mina Test', 'Verena Test']);
    expect(rows.every((row) => row.person.kind === 'child')).toBe(true);
  });

  it('marks who is down for the chosen day without dropping the others', () => {
    const rows = attendanceRows(people, 'w1-mon', {});
    expect(rows.filter((row) => row.expected).map((row) => row.person.name)).toEqual([
      'Marina Test',
      'Mina Test',
    ]);
    // Verena is registered for Tuesday. She stays on the roster as not
    // expected, because a register that cannot record a child standing in
    // front of you is a register that gets kept on paper instead.
    expect(rows.find((row) => row.person.name === 'Verena Test')?.expected).toBe(false);
  });

  it('leaves a withdrawn child off entirely', () => {
    const withdrawn = campPeople([
      family('reg-9', [{ id: 'c9', name: 'Gone', grade: '4', days: ['w1-mon'] }], 'withdrawn'),
    ]);
    expect(attendanceRows(withdrawn, 'w1-mon', {})).toHaveLength(0);
  });

  it('lists the days somebody is actually registered for', () => {
    expect([...daysWithChildren(people)].sort()).toEqual(['w1-mon', 'w1-tue']);
  });
});

/* ---- the counts --------------------------------------------------------- */

describe('the counts', () => {
  const registrations = [
    family('reg-1', [
      { id: 'c1', name: 'Marina', grade: '3', days: ['w1-mon'] },
      { id: 'c2', name: 'Mina', grade: '3', days: ['w1-mon'] },
      { id: 'c3', name: 'Sara', grade: 'k', days: ['w1-mon'] },
    ]),
    family('reg-2', [{ id: 'c4', name: 'Verena', grade: 'k', days: ['w1-tue'] }]),
  ];
  const people = campPeople(registrations);

  it('splits the expected into in and missing, and nothing else', () => {
    const tally = attendanceTally(
      attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN }),
    );

    expect(tally.expected).toBe(3);
    expect(tally.in).toBe(1);
    expect(tally.missing).toBe(2);
    expect(tally.in + tally.missing).toBe(tally.expected);
  });

  it('counts a walk-in as here without inflating what was expected', () => {
    // Verena is down for Tuesday and turned up on Monday. The camp took her;
    // the morning's "3 expected" must not become "4 expected" retrospectively.
    const tally = attendanceTally(
      attendanceRows(people, 'w1-mon', { [childKey('reg-2', 'c4')]: IN }),
    );

    expect(tally.expected).toBe(3);
    expect(tally.in).toBe(0);
    expect(tally.missing).toBe(3);
    expect(tally.extra).toBe(1);
    expect(tally.here).toBe(1);
  });

  it('moves a child from here to gone when they are collected', () => {
    const rows = attendanceRows(people, 'w1-mon', {
      [childKey('reg-1', 'c1')]: OUT,
      [childKey('reg-1', 'c2')]: IN,
    });
    const tally = attendanceTally(rows);

    expect(tally.in).toBe(2);
    expect(tally.here).toBe(1);
    expect(tally.gone).toBe(1);
    // Being collected does not undo having been in. "84 of 91 came today" has
    // to still be true at four o'clock.
    expect(tally.missing).toBe(1);
  });

  it('does not say everybody has gone home before anybody has arrived', () => {
    // The failure this whole assertion exists for: `here === 0` is true of an
    // empty register, and a screen that says "all collected" at nine in the
    // morning is a screen that will one day say it at four.
    const empty = attendanceTally(attendanceRows(people, 'w1-mon', {}));
    expect(empty.here).toBe(0);
    expect(everyoneCollected(empty)).toBe(false);

    const half = attendanceTally(
      attendanceRows(people, 'w1-mon', {
        [childKey('reg-1', 'c1')]: OUT,
        [childKey('reg-1', 'c2')]: IN,
      }),
    );
    expect(everyoneCollected(half)).toBe(false);

    const done = attendanceTally(
      attendanceRows(people, 'w1-mon', {
        [childKey('reg-1', 'c1')]: OUT,
        [childKey('reg-1', 'c2')]: OUT,
      }),
    );
    expect(everyoneCollected(done)).toBe(true);
  });

  it('says the day in one line', () => {
    const tally = attendanceTally(
      attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN }),
    );
    expect(describeAttendance('w1-mon', tally)).toBe(
      'Week 1 · Mon — 1 of 3 in, 2 missing, 1 still here',
    );
  });
});

/* ---- sections ----------------------------------------------------------- */

describe('cut by grade', () => {
  const people = campPeople([
    family('reg-1', [
      { id: 'c1', name: 'Marina', grade: '3', days: ['w1-mon'] },
      { id: 'c2', name: 'Sara', grade: 'k', days: ['w1-mon'] },
      { id: 'c3', name: 'Mina', grade: '10', days: ['w1-mon'] },
    ]),
  ]);

  it('reads kindergarten first and skips the grades nobody is in', () => {
    const sections = attendanceByGrade(attendanceRows(people, 'w1-mon', {}));
    expect(sections.map((section) => section.name)).toEqual([
      'Kindergarten',
      'Grade 3',
      'Grade 10',
    ]);
  });

  it('counts each grade on its own', () => {
    const sections = attendanceByGrade(
      attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN }),
    );
    const third = sections.find((section) => section.name === 'Grade 3');
    const kindergarten = sections.find((section) => section.name === 'Kindergarten');

    expect(third?.tally.missing).toBe(0);
    expect(kindergarten?.tally.missing).toBe(1);
  });
});

describe('cut by group', () => {
  const people = campPeople([
    family('reg-1', [
      { id: 'c1', name: 'Marina', grade: '3', days: ['w1-mon'] },
      { id: 'c2', name: 'Sara', grade: '3', days: ['w1-mon'] },
      { id: 'c3', name: 'Mina', grade: '3', days: ['w1-mon'] },
    ]),
  ]);

  function board(): CampAllocationDraft {
    const blue = { ...blankGroup('Blue 1'), id: 'g-blue' };
    const green = { ...blankGroup('Green 1'), id: 'g-green' };
    const band = { ...blankBand('Grade 3', ['3'], 'blue'), id: 'b-3', groups: [blue, green] };
    return { ...blankAllocation('summercamp', '2027'), bands: [band] };
  }

  it('puts everybody in one section when the season has not been arranged', () => {
    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), null);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.name).toBe('Not in a group yet');
    expect(sections[0]!.rows).toHaveLength(3);
  });

  it('names a group by its panel, and leaves the unplaced at the end', () => {
    const week = board();
    week.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1')];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week);
    expect(sections.map((section) => section.name)).toEqual(['Grade 3 · Blue 1', 'Not in a group yet']);
    expect(sections[1]!.rows).toHaveLength(2);
  });

  it('draws a child placed twice once, not once per group', () => {
    // A console edit can put the same key in two groups. Drawing them in both
    // would let a servant tick them in one section and read them as absent in
    // the other — the register disagreeing with itself on one screen.
    const week = board();
    week.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1')];
    week.bands[0]!.groups[1]!.childKeys = [childKey('reg-1', 'c1')];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week);
    const drawn = sections.flatMap((section) => section.rows.map((row) => row.person.key));
    expect(drawn.filter((key) => key === childKey('reg-1', 'c1'))).toHaveLength(1);
  });

  it('ignores a placement whose child is gone', () => {
    const week = board();
    week.bands[0]!.groups[0]!.childKeys = ['reg-deleted/child-deleted'];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week);
    expect(sections.map((section) => section.name)).toEqual(['Not in a group yet']);
    expect(sections[0]!.rows).toHaveLength(3);
  });

  it('counts the same three children whichever way they are cut', () => {
    const week = board();
    week.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1'), childKey('reg-1', 'c2')];

    const rows = attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN });
    const byGrade = attendanceByGrade(rows);
    const byGroup = attendanceByGroup(rows, week);

    const total = (sections: { tally: { expected: number; missing: number } }[]) =>
      sections.reduce(
        (sum, section) => ({
          expected: sum.expected + section.tally.expected,
          missing: sum.missing + section.tally.missing,
        }),
        { expected: 0, missing: 0 },
      );

    expect(total(byGroup)).toEqual(total(byGrade));
    expect(total(byGrade)).toEqual({ expected: 3, missing: 2 });
  });
});
