import { describe, expect, it } from 'vitest';
import {
  CAMP_AFTERNOON_FROM_HOUR,
  MAX_ATTENDANCE_ENTRIES,
  attendancePresence,
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
  campHalfForDay,
  campHalfLabel,
  campPeople,
  childKey,
  daysWithChildren,
  describeAttendance,
  everyoneCollected,
  nearestCampDay,
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
    return {
      ...blankAllocation('summercamp', '2027'),
      weeks: [{ week: 1, bands: [band], stations: [] }],
    };
  }

  it('puts everybody in one section when the season has not been arranged', () => {
    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), null, 1);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.name).toBe('Not in a group yet');
    expect(sections[0]!.rows).toHaveLength(3);
  });

  it('names a group by its panel, and leaves the unplaced at the end', () => {
    const week = board();
    week.weeks[0]!.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1')];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week, 1);
    expect(sections.map((section) => section.name)).toEqual(['Grade 3 · Blue 1', 'Not in a group yet']);
    expect(sections[1]!.rows).toHaveLength(2);
  });

  it('draws a child placed twice once, not once per group', () => {
    // A console edit can put the same key in two groups. Drawing them in both
    // would let a servant tick them in one section and read them as absent in
    // the other — the register disagreeing with itself on one screen.
    const week = board();
    week.weeks[0]!.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1')];
    week.weeks[0]!.bands[0]!.groups[1]!.childKeys = [childKey('reg-1', 'c1')];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week, 1);
    const drawn = sections.flatMap((section) => section.rows.map((row) => row.person.key));
    expect(drawn.filter((key) => key === childKey('reg-1', 'c1'))).toHaveLength(1);
  });

  it('ignores a placement whose child is gone', () => {
    const week = board();
    week.weeks[0]!.bands[0]!.groups[0]!.childKeys = ['reg-deleted/child-deleted'];

    const sections = attendanceByGroup(attendanceRows(people, 'w1-mon', {}), week, 1);
    expect(sections.map((section) => section.name)).toEqual(['Not in a group yet']);
    expect(sections[0]!.rows).toHaveLength(3);
  });

  it('counts the same three children whichever way they are cut', () => {
    const week = board();
    week.weeks[0]!.bands[0]!.groups[0]!.childKeys = [childKey('reg-1', 'c1'), childKey('reg-1', 'c2')];

    const rows = attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN });
    const byGrade = attendanceByGrade(rows);
    const byGroup = attendanceByGroup(rows, week, 1);

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

/* ---- the two halves ----------------------------------------------------- */

describe('the day the register opens on', () => {
  // Week 1 is Mon 21 – Fri 25 June 2027, week 2 is Mon 28 – Fri 2 July.
  const weekStarts = ['2027-06-21', '2027-06-28'];

  function on(year: number, month: number, day: number, hour = 9): Date {
    return new Date(year, month - 1, day, hour, 0, 0, 0);
  }

  it('opens on today when today is a day of camp', () => {
    expect(nearestCampDay(weekStarts, 2, on(2027, 6, 23))).toBe('w1-wed');
    expect(nearestCampDay(weekStarts, 2, on(2027, 6, 30))).toBe('w2-wed');
  });

  it('opens on the nearer side when today is not', () => {
    // The Saturday in the middle: Friday is one day back, Monday is two forward.
    expect(nearestCampDay(weekStarts, 2, on(2027, 6, 26))).toBe('w1-fri');
    // The Sunday: one each way, and a tie goes to the day ahead, because a
    // register opened the night before camp is being read for tomorrow.
    expect(nearestCampDay(weekStarts, 2, on(2027, 6, 27))).toBe('w2-mon');
  });

  it('collapses to the first and last day outside the camp', () => {
    expect(nearestCampDay(weekStarts, 2, on(2027, 2, 14))).toBe('w1-mon');
    expect(nearestCampDay(weekStarts, 2, on(2027, 11, 3))).toBe('w2-fri');
  });

  it('only offers the weeks the camp is running', () => {
    // Week 2's dates are set but the camp is one week long: nothing in week 2
    // is a day of camp, so the Tuesday of it is nearest to week 1's Friday.
    expect(nearestCampDay(weekStarts, 1, on(2027, 6, 29))).toBe('w1-fri');
  });

  it('falls back to week one Monday with no dates set', () => {
    expect(nearestCampDay([], 2, on(2027, 6, 23))).toBe('w1-mon');
    expect(nearestCampDay(['not-a-date'], 2, on(2027, 6, 23))).toBe('w1-mon');
  });
});

describe('which half a day opens on', () => {
  const weekStarts = ['2027-06-21', '2027-06-28'];

  function at(month: number, day: number, hour: number): Date {
    return new Date(2027, month - 1, day, hour, 30, 0, 0);
  }

  it('turns today over at noon', () => {
    expect(campHalfForDay(weekStarts, 'w1-wed', at(6, 23, 9))).toBe('morning');
    expect(campHalfForDay(weekStarts, 'w1-wed', at(6, 23, 11))).toBe('morning');
    expect(campHalfForDay(weekStarts, 'w1-wed', at(6, 23, CAMP_AFTERNOON_FROM_HOUR))).toBe(
      'afternoon',
    );
    expect(campHalfForDay(weekStarts, 'w1-wed', at(6, 23, 16))).toBe('afternoon');
  });

  it('reads a day that has been on its afternoon, whatever the time', () => {
    // Tuesday, opened at nine on Wednesday morning: the day is over, and the
    // afternoon is where its ending is.
    expect(campHalfForDay(weekStarts, 'w1-tue', at(6, 23, 9))).toBe('afternoon');
  });

  it('opens a day still to come on its morning, whatever the time', () => {
    expect(campHalfForDay(weekStarts, 'w1-thu', at(6, 23, 16))).toBe('morning');
  });

  it('follows the clock alone when the camp has no dates', () => {
    expect(campHalfForDay([], 'w2-fri', at(6, 23, 9))).toBe('morning');
    expect(campHalfForDay([], 'w2-fri', at(6, 23, 15))).toBe('afternoon');
  });

  it('names both halves', () => {
    expect(campHalfLabel('morning')).toBe('Morning');
    expect(campHalfLabel('afternoon')).toBe('Afternoon');
  });
});

describe('the afternoon list', () => {
  const people = campPeople([
    family('reg-1', [
      { id: 'c1', name: 'Marina', grade: '3', days: ['w1-mon'] },
      { id: 'c2', name: 'Mina', grade: '3', days: ['w1-mon'] },
      { id: 'c3', name: 'Sara', grade: 'k', days: ['w1-mon'] },
    ]),
    family('reg-2', [{ id: 'c4', name: 'Verena', grade: 'k', days: ['w1-tue'] }]),
  ]);

  it('is the children who arrived and nobody else', () => {
    const rows = attendanceRows(people, 'w1-mon', {
      [childKey('reg-1', 'c1')]: IN,
      [childKey('reg-1', 'c2')]: OUT,
    });
    const { onSite, goneHome } = attendancePresence(rows);

    // Sara was expected and never came. She is the morning's business and has
    // no place on a list of pickups.
    expect(onSite.map((row) => row.person.name)).toEqual(['Marina Test']);
    expect(goneHome.map((row) => row.person.name)).toEqual(['Mina Test']);
  });

  it('keeps a walk-in on it', () => {
    // Verena was down for Tuesday and came on Monday. She still has to be
    // collected by somebody.
    const rows = attendanceRows(people, 'w1-mon', { [childKey('reg-2', 'c4')]: IN });
    const { onSite } = attendancePresence(rows);

    expect(onSite.map((row) => row.person.name)).toEqual(['Verena Test']);
    expect(onSite[0]?.expected).toBe(false);
  });

  /*
   * The rule stated in its own test, because it is a promise now rather than a
   * property that happens to hold.
   *
   * Confirmed on 2 Sep 2026: **anybody ticked in is on the afternoon list,
   * whether or not today is one of their days.** `attendancePresence` keys off
   * the arrival mark alone and never looks at `expected`, and the two cuts the
   * screen draws over its result must not put that back — a walk-in dropped by
   * the grouping is a child on site who appears on no pickup list at all.
   */
  it('keeps a walk-in through both cuts of the afternoon', () => {
    const rows = attendanceRows(people, 'w1-mon', {
      [childKey('reg-1', 'c1')]: IN,
      [childKey('reg-2', 'c4')]: IN,
    });
    const { onSite } = attendancePresence(rows);
    expect(onSite.map((row) => [row.person.name, row.expected])).toEqual([
      ['Marina Test', true],
      ['Verena Test', false],
    ]);

    const named = (sections: { rows: { person: { name: string } }[] }[]) =>
      sections.flatMap((section) => section.rows.map((row) => row.person.name)).sort();

    // By grade: Verena is a kindergartener who was down for Tuesday.
    expect(named(attendanceByGrade(onSite))).toEqual(['Marina Test', 'Verena Test']);

    // By group, with Marina placed and Verena in no group at all — which is the
    // ordinary state of a child who was not expected today.
    const blue = { ...blankGroup('Blue 1'), id: 'g-blue', childKeys: [childKey('reg-1', 'c1')] };
    const band = { ...blankBand('Grade 3', ['3'], 'blue'), id: 'b-3', groups: [blue] };
    const board = {
      ...blankAllocation('summercamp', '2027'),
      weeks: [{ week: 1, bands: [band], stations: [] }],
    };
    const sections = attendanceByGroup(onSite, board, 1);
    expect(sections.map((section) => section.name)).toEqual([
      'Grade 3 · Blue 1',
      'Not in a group yet',
    ]);
    expect(named(sections)).toEqual(['Marina Test', 'Verena Test']);
  });

  it('counts the walk-ins the afternoon is holding', () => {
    // What the afternoon's tally line reads: two on site, one of whom is not
    // down for today. `expected` stays at what the morning expected.
    const rows = attendanceRows(people, 'w1-mon', {
      [childKey('reg-1', 'c1')]: IN,
      [childKey('reg-2', 'c4')]: IN,
    });
    const tally = attendanceTally(rows);
    expect(tally.here).toBe(2);
    expect(tally.extra).toBe(1);
    expect(tally.expected).toBe(3);
  });

  it('carries the guardian to ring on every row', () => {
    const rows = attendanceRows(people, 'w1-mon', { [childKey('reg-1', 'c1')]: IN });
    const { onSite } = attendancePresence(rows);

    expect(onSite[0]?.person.contactName).toBe('reg-1 guardian');
    expect(onSite[0]?.person.contactPhone).toBe('555-0100');
  });

  it('is empty on a register nobody has ticked', () => {
    const { onSite, goneHome } = attendancePresence(attendanceRows(people, 'w1-mon', {}));
    expect(onSite).toEqual([]);
    expect(goneHome).toEqual([]);
  });
});
