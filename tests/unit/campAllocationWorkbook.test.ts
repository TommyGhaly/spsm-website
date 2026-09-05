import { describe, expect, it } from 'vitest';
import {
  allocationWorkbookName,
  blankBand,
  blankGroup,
  blankRegistration,
  blankStation,
  bandSection,
  campAllocationSheets,
  childKey,
  placeChild,
  placeServant,
  type CampAllocationDraft,
  setLeader,
  type CampGrade,
  type CampRegistration,
  type Sheet,
} from '@spsm/shared';

/**
 * What ends up in the exported spreadsheet.
 *
 * ---------------------------------------------------------------------------
 * This file asserts the *sheets*, not the file format — `xlsx.test.ts` covers
 * the bytes. Everything here is a claim about content that somebody at camp
 * would act on, and every one of them is a claim that could be quietly wrong in
 * a file that opens perfectly.
 *
 * The three that matter most:
 *
 * - **No child reaches the file.** The workbook was cut back to the servants,
 *   which is what makes it a file that can be printed and mailed. A column
 *   added carelessly here puts a child's allergies back into somebody's
 *   downloads folder, and nothing else in the codebase would notice.
 * - **A group with nobody on it appears.** It is the row the sheet exists for.
 * - **A servant with nowhere to be appears.** A name silently absent is how
 *   somebody turns up on the Monday expected by nobody.
 * ---------------------------------------------------------------------------
 */

function sheet(sheets: Sheet[], name: string): Sheet {
  const found = sheets.find((entry) => entry.name === name);
  expect(found, `no sheet called ${name}`).toBeDefined();
  return found!;
}

/** Which column a heading is in, so the assertions below survive a reordering
    of the roster's columns rather than pinning them by number. */
function column(target: Sheet, header: string): number {
  const at = target.columns.findIndex((entry) => entry.header === header);
  expect(at, `no column called ${header}`).toBeGreaterThan(-1);
  return at;
}

function family(
  registrationId: string,
  children: {
    id: string;
    name: string;
    grade: CampGrade;
    allergies?: string;
  }[],
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
    contact: { ...draft.contact, name: 'Guardian', phone: '555-0100' },
    emergency: { name: 'Aunt Sara', phone: '555-0101', relationship: 'Aunt' },
    children: children.map((child) => ({
      id: child.id,
      firstName: child.name,
      lastName: 'Test',
      dateOfBirth: '',
      grade: child.grade,
      // Neither of these suites reads it; it is here because `CampChild`
      // requires it, and a fixture that quietly diverges from the type is how
      // one of these starts testing a shape nothing writes.
      gender: '' as const,
      shirtSize: 'YM' as const,
      // Registered for week one only, so the `Weeks` column has something true
      // to say — it is what replaced the old per-week duplicate rows.
      days: ['w1-mon', 'w1-tue', 'w1-wed', 'w1-thu', 'w1-fri'],
      allergies: child.allergies ?? '',
      medicalNotes: '',
      groupName: '',
      note: '',
    })),
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function servantRow(registrationId: string, name: string, cleared: boolean) {
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
    contact: { ...draft.contact, name, phone: '555-0200' },
    servant: { ...draft.servant!, cleared, desiredRolesByWeek: { w1: ['Sports'] } },
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  } as CampRegistration & { id: string };
}

/** A board with one band of two groups, one station, and everybody placed. */
function scenario() {
  const registrations = [
    family('reg-1', [
      { id: 'c1', name: 'Mariam', grade: '3', allergies: 'Peanuts' },
      { id: 'c2', name: 'Peter', grade: '4' },
    ]),
    family('reg-2', [{ id: 'c3', name: 'Anne', grade: '4' }]),
    servantRow('reg-s1', 'Marina', true),
    servantRow('reg-s2', 'Youssef', false),
  ];

  const band = blankBand('3rd & 4th grade', ['3', '4'], 'green');
  band.id = 'band-1';
  const one = blankGroup('Blue 1');
  one.id = 'group-1';
  const two = blankGroup('Blue 2');
  two.id = 'group-2';
  band.groups = [one, two];

  const station = blankStation('Sports', 'teal');
  station.id = 'station-1';

  let board: CampAllocationDraft = {
    programId: 'summercamp',
    season: '2027',
    weeks: [{ week: 1, bands: [band], stations: [station] }],
    archivedAt: null,
    archivedBy: null,
    note: '',
  };

  const target = { kind: 'group' as const, bandId: band.id, groupId: one.id };
  board = placeChild(board, 1, childKey('reg-1', 'c1'), target);
  board = placeChild(board, 1, childKey('reg-1', 'c2'), target);
  board = placeServant(board, 1, 'reg-s1', target);
  board = placeServant(board, 1, 'reg-s2', { kind: 'station', stationId: station.id });
  // Marina leads Blue 1; Youssef runs Sports.
  board = setLeader(board, 1, target, 'reg-s1');
  board = setLeader(board, 1, { kind: 'station', stationId: station.id }, 'reg-s2');

  const allocation: CampAllocationDraft = board;

  // Anne is left out on purpose, and group two is left empty on purpose.
  return { allocation, board, registrations };
}

describe('campAllocationSheets', () => {
  const { allocation, registrations } = scenario();
  const sheets = campAllocationSheets({
    allocation,
    registrations,
    generatedAt: new Date('2027-06-01T09:30:00Z'),
    generatedBy: 'Mina',
  });

  it('writes one sheet per week per half of the camp', () => {
    // The fixture's board is one week, so two sheets — and the middle-school
    // one is written even though nobody is in it, because "nobody is in middle
    // school this week" is an answer and a missing tab reads as a bug.
    expect(sheets.map((entry) => entry.name)).toEqual(['Elementary W1', 'Middle school W1']);
  });

  it('is four columns: who, where, which grades, and whether they lead', () => {
    expect(sheets[0]!.columns.map((entry) => entry.header)).toEqual([
      'Servant',
      'Group',
      'Grades',
      'Leader',
    ]);
  });

  it('puts a servant on their group, with the grades that group covers', () => {
    const elementary = sheet(sheets, 'Elementary W1');
    const marina = elementary.rows.find((entry) => entry[column(elementary, 'Servant')] === 'Marina');
    expect(marina, 'Marina is not on the sheet').toBeDefined();
    expect(marina![column(elementary, 'Group')]).toBe('Blue 1');
    // The panel runs 3rd and 4th, and says so — `K, 1, 2` style rather than
    // the panel's name, which is a third way of saying the same thing.
    expect(marina![column(elementary, 'Grades')]).toBe('3, 4');
    expect(marina![column(elementary, 'Leader')]).toBe('LEADER');
  });

  it('writes a station servant, with the station where the group would be', () => {
    const elementary = sheet(sheets, 'Elementary W1');
    const youssef = elementary.rows.find(
      (entry) => entry[column(elementary, 'Servant')] === 'Youssef',
    );
    expect(youssef, 'the servant on sports is not on the sheet').toBeDefined();
    expect(youssef![column(elementary, 'Group')]).toBe('Sports (station)');
    // No grades: a station serves the whole half of the camp, and inventing a
    // range for it would be a fact nobody put there.
    expect(youssef![column(elementary, 'Grades')]).toBe('');
    expect(youssef![column(elementary, 'Leader')]).toBe('LEADER');
  });

  it('shows a group with no servants, because that is the row that needs fixing', () => {
    const elementary = sheet(sheets, 'Elementary W1');
    const empty = elementary.rows.find((entry) => entry[column(elementary, 'Group')] === 'Blue 2');
    expect(empty, 'the empty group was skipped').toBeDefined();
    expect(empty![column(elementary, 'Servant')]).toBe('(nobody with this group)');
  });

  it('writes a servant with nowhere to be rather than leaving them off', () => {
    const bare = campAllocationSheets({
      allocation: { ...allocation, weeks: [{ ...allocation.weeks[0]!, bands: [], stations: [] }] },
      registrations,
    });
    const elementary = sheet(bare, 'Elementary W1');
    const rows = elementary.rows.map((entry) => entry[column(elementary, 'Servant')]);
    expect(rows).toContain('Marina');
    expect(rows).toContain('Youssef');
    expect(elementary.rows.every((entry) => entry[column(elementary, 'Group')] === '(not placed)')).toBe(
      true,
    );
  });

  it('carries no child, and therefore no allergy, anywhere in the file', () => {
    /*
     * The claim that makes this file mailable, asserted over every cell of
     * every sheet rather than over the columns — a child's name reaching the
     * export through some other column is the same leak.
     */
    const cells = sheets.flatMap((entry) =>
      entry.rows.flat().map((value) => String(value ?? '')),
    );
    for (const forbidden of ['Mariam', 'Peter', 'Anne', 'Peanuts', 'Guardian', '555-0100']) {
      expect(cells, `${forbidden} reached the servants file`).not.toContain(forbidden);
    }
    for (const entry of sheets) {
      expect(entry.columns.map((c) => c.header)).not.toContain('Allergies');
      expect(entry.columns.map((c) => c.header)).not.toContain('Medical notes');
    }
  });

  it('narrows to the weeks and halves the export dialog was given', () => {
    const only = campAllocationSheets({
      allocation,
      registrations,
      weeks: [1],
      sections: ['elementary'],
    });
    expect(only.map((entry) => entry.name)).toEqual(['Elementary W1']);
  });

  it('treats an empty choice as every week and both halves', () => {
    // The same convention the sign-up form's tick-boxes use: nothing ticked
    // means everything, because a workbook with no sheets in it is not a file
    // anybody asked for.
    const all = campAllocationSheets({ allocation, registrations, weeks: [], sections: [] });
    expect(all.map((entry) => entry.name)).toEqual(['Elementary W1', 'Middle school W1']);
  });

  it('drops a week the board does not have rather than inventing it', () => {
    const asked = campAllocationSheets({ allocation, registrations, weeks: [9] });
    // Never zero sheets — `buildXlsx` refuses an empty workbook, and a button
    // that throws is worse than a tab that says nobody is there.
    expect(asked.map((entry) => entry.name)).toEqual(['Elementary W1']);
    expect(asked[0]!.rows).toEqual([]);
  });

  it('sends a panel that straddles the boundary to the half most of it is in', () => {
    const band = blankBand('5th – 8th grade', ['5', '6', '7', '8'], 'blue');
    // 5th is elementary and the other three are not, so it is a middle-school
    // panel — and its Grades column still says 5 is in there.
    expect(bandSection(band)).toBe('middle-school');
    expect(bandSection(blankBand('K – 2nd', ['k', '1', '2'], 'green'))).toBe('elementary');
    // A tie goes to elementary, which is the half a mixed panel is run like.
    expect(bandSection(blankBand('5th & 6th', ['5', '6'], 'gold'))).toBe('elementary');
  });

  it('names the file for the season, the day, and what it was narrowed to', () => {
    const at = new Date('2027-06-14T13:05:00Z');
    expect(allocationWorkbookName('2027', at)).toBe('camp-servants-2027-2027-06-14.xlsx');
    expect(allocationWorkbookName('2027', at, { weeks: [2], sections: ['middle-school'] })).toBe(
      'camp-servants-2027-w2-middle-school-2027-06-14.xlsx',
    );
    // Two weeks is not a week, so it is left out rather than run together.
    expect(allocationWorkbookName('2027', at, { weeks: [1, 2] })).toBe(
      'camp-servants-2027-2027-06-14.xlsx',
    );
  });

  it('keeps a season with a slash in it out of the filename', () => {
    expect(allocationWorkbookName('2027 / week 1', new Date('2027-06-01T00:00:00Z'))).toBe(
      'camp-servants-2027-week-1-2027-06-01.xlsx',
    );
  });
});
