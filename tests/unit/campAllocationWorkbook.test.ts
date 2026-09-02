import { describe, expect, it } from 'vitest';
import {
  allocationWorkbookName,
  blankBand,
  blankGroup,
  blankRegistration,
  blankStation,
  campAllocationSheets,
  campColour,
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
 * This file asserts the *roster*, not the file format — `xlsx.test.ts` covers
 * the bytes. Everything here is a claim about content that somebody at camp
 * would act on, and every one of them is a claim that could be quietly wrong in
 * a file that opens perfectly.
 *
 * The two that matter most: an allergy has to reach the sheet, and a group with
 * nobody on it has to appear rather than be skipped. A missing allergy is the
 * worst failure this codebase can produce; a silently absent empty group is how
 * a station goes unstaffed because the spreadsheet said nothing about it.
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
      shirtSize: 'YM' as const,
      // Registered for week one only, so the `Weeks` column has something true
      // to say — it is what replaced the old per-week duplicate rows.
      days: ['w1-mon', 'w1-tue', 'w1-wed', 'w1-thu', 'w1-fri'],
      allergies: child.allergies ?? '',
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
    servant: { ...draft.servant!, cleared, desiredRoles: ['Sports'] },
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
    bands: [band],
    stations: [station],
    archivedAt: null,
    archivedBy: null,
    note: '',
  };

  const target = { kind: 'group' as const, bandId: band.id, groupId: one.id };
  board = placeChild(board, childKey('reg-1', 'c1'), target);
  board = placeChild(board, childKey('reg-1', 'c2'), target);
  board = placeServant(board, 'reg-s1', target);
  board = placeServant(board, 'reg-s2', { kind: 'station', stationId: station.id });
  // Marina leads Blue 1; Youssef runs Sports.
  board = setLeader(board, target, 'reg-s1');
  board = setLeader(board, { kind: 'station', stationId: station.id }, 'reg-s2');

  const allocation: CampAllocationDraft = board;

  // Anne is left out on purpose, and group two is left empty on purpose.
  return { allocation, board, registrations };
}

describe('campAllocationSheets', () => {
  const { allocation, board, registrations } = scenario();
  const sheets = campAllocationSheets({
    allocation,
    registrations,
    generatedAt: new Date('2027-06-01T09:30:00Z'),
    generatedBy: 'Mina',
  });

  it('has the five sheets, in the order the work needs them, each named for its season', () => {
    // The season is on every tab, not only in the filename. These files get
    // forwarded and printed, and a tab called "Groups" tells the person holding
    // it nothing about which summer it is.
    expect(sheets.map((entry) => entry.name)).toEqual([
      'Groups 2027',
      'Group servants 2027',
      'Stations 2027',
      'Unassigned 2027',
      'Summary 2027',
    ]);
  });

  it('puts a child’s allergies on the roster and flags them', () => {
    const groups = sheet(sheets, 'Groups 2027');
    const row = groups.rows.find((entry) => entry[column(groups, 'Child')] === 'Mariam Test');
    expect(row, 'Mariam is not on the roster').toBeDefined();

    expect(row![column(groups, 'Allergies')]).toBe('Peanuts');
    // The flags column repeats it as a word. The allergies column is a
    // paragraph and a paragraph does not read as a warning at a glance.
    expect(String(row![column(groups, 'Flags')])).toContain('allergies');
    expect(row![column(groups, 'Weeks')]).toBe('1');
    expect(row![column(groups, 'Panel')]).toBe('3rd & 4th grade');
    expect(row![column(groups, 'Group leader')]).toBe('Marina');
    expect(row![column(groups, 'Group')]).toBe('Blue 1');
    expect(row![column(groups, 'Grade')]).toBe('Grade 3');
    expect(row![column(groups, 'Section')]).toBe('Elementary');
    expect(row![column(groups, 'Emergency contact')]).toContain('Aunt Sara');
    // The servants who are with this group, on the child's own row — so one
    // printed page answers "who is looking after this child".
    expect(row![column(groups, 'Group servants')]).toBe('Marina');
  });

  it('fills a panel’s rows with a readable tint of its colour, banded per group', () => {
    const groups = sheet(sheets, 'Groups 2027');
    const fills = (groups.rowFills ?? []).filter(Boolean) as string[];

    // One colour per grade, or per set of merged grades — not one per group. A
    // colour that means "3rd and 4th" is something a parent at the gate can be
    // told; a colour per group needs a chart to read.
    //
    // But *tinted*: the raw colour behind sixteen columns of body text for two
    // hundred rows is the thing that gets a spreadsheet re-made by hand.
    expect(fills).not.toContain(campColour('green').hex.replace('#', ''));

    // Two strengths, alternating, so the seam between Blue 1 and Blue 2 is
    // visible without reading the Group column.
    expect(new Set(fills).size).toBe(2);

    /*
     * Every fill light enough to read black text on.
     *
     * The assertion that actually matters, and the one a hex comparison cannot
     * make: this sheet is printed and read by a servant holding it in a hall.
     * 0.6 relative luminance is comfortably inside "black text is fine" for all
     * twelve camp colours at these strengths.
     */
    for (const fill of fills) {
      const channel = (at: number) => {
        const value = parseInt(fill.slice(at, at + 2), 16) / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
      };
      const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
      expect(luminance, `${fill} is too dark to read black text on`).toBeGreaterThan(0.6);
    }
  });

  it('freezes the columns that say who a row is about', () => {
    // Sixteen columns wide, and the four that identify the row are the first
    // four. Reading somebody's allergies with their name gone off the left edge
    // is the state this avoids.
    expect(sheet(sheets, 'Groups 2027').freezeColumns).toBe(5);
    expect(sheet(sheets, 'Unassigned 2027').freezeColumns).toBe(3);
  });

  it('shows a group with nobody in it rather than skipping it', () => {
    const groups = sheet(sheets, 'Groups 2027');
    const names = groups.rows.map((entry) => entry[column(groups, 'Group')]);
    expect(names).toContain('Blue 2');
  });

  it('shows a station with nobody on it, because that is the row that needs fixing', () => {
    const empty = campAllocationSheets({
      allocation: {
        ...allocation,
        bands: [],
        stations: [blankStation('Kitchen', 'red')],
      },
      registrations,
    });
    const stations = sheet(empty, 'Stations 2027');
    expect(stations.rows[0]![column(stations, 'Servant')]).toBe('(nobody assigned)');
  });

  it('says in words whether a servant is cleared', () => {
    const servants = sheet(sheets, 'Group servants 2027');
    const marina = servants.rows.find((entry) => entry[column(servants, 'Servant')] === 'Marina');
    expect(marina![column(servants, 'Safeguarding')]).toBe('Cleared');

    const stations = sheet(sheets, 'Stations 2027');
    const youssef = stations.rows.find((entry) => entry[column(stations, 'Servant')] === 'Youssef');
    expect(youssef![column(stations, 'Safeguarding')]).toBe('Not cleared');
  });

  it('lists everybody with nowhere to be, once each', () => {
    const unassigned = sheet(sheets, 'Unassigned 2027');
    expect(unassigned.rows.map((entry) => entry[column(unassigned, 'Name')])).toEqual(['Anne Test']);
    expect(unassigned.rows[0]![column(unassigned, 'Weeks')]).toBe('1');
  });

  it('marks the leader of a group and of a station, and nobody else', () => {
    const servants = sheet(sheets, 'Group servants 2027');
    const marina = servants.rows.find(
      (entry) => entry[column(servants, 'Servant')] === 'Marina',
    );
    expect(marina![column(servants, 'Leader')]).toBe('LEADER');

    const stations = sheet(sheets, 'Stations 2027');
    const youssef = stations.rows.find(
      (entry) => entry[column(stations, 'Servant')] === 'Youssef',
    );
    expect(youssef![column(stations, 'Leader')]).toBe('LEADER');
  });

  it('carries the season, the export time and the warning on the summary', () => {
    const summary = sheet(sheets, 'Summary 2027');
    const flat = summary.rows.map((entry) => String(entry[0] ?? ''));

    expect(flat[0]).toBe('Summer camp 2027 — group allocation');
    expect(flat[1]).toContain('2027-06-01 09:30');
    expect(flat[1]).toContain('Mina');
    // The warning is not decoration and should not be tidied away. See the top
    // of camp/allocationWorkbook.ts.
    expect(flat[2]).toContain('allergies and medical notes');
  });

  it('counts placed and unplaced, and never divides by zero', () => {
    const summary = sheet(sheets, 'Summary 2027');
    const find = (label: string) =>
      summary.rows.find((entry) => entry[0] === label)?.[1];

    expect(find('Children registered')).toBe(3);
    expect(find('Children placed')).toBe(2);
    expect(find('Children unplaced')).toBe(1);
    expect(find('Servants placed')).toBe(2);

    // The empty group's ratio: children over zero servants is not Infinity here.
    const ratios = summary.rows.map((entry) => entry[4]);
    expect(ratios).not.toContain(Infinity);
    expect(ratios.filter((value) => typeof value === 'string')).toContain('2:1');
  });

  it('reports a dangling placement in the summary', () => {
    const brokenBoard = placeChild(board, childKey('reg-gone', 'c9'), {
      kind: 'group',
      bandId: 'band-1',
      groupId: 'group-1',
    });
    const broken = brokenBoard;
    const summary = sheet(campAllocationSheets({ allocation: broken, registrations }), 'Summary 2027');
    const row = summary.rows.find((entry) => entry[0] === 'Placements matching nobody');
    expect(row?.[1]).toBe(1);
  });
});

describe('allocationWorkbookName', () => {
  it('names the file after the season and the day', () => {
    expect(allocationWorkbookName('2027', new Date('2027-06-01T09:30:00Z'))).toBe(
      'camp-allocation-2027-2027-06-01.xlsx',
    );
  });

  it('survives a season somebody named with punctuation', () => {
    // `season` is a free string — "2027, week 1" is a name a parish could give
    // it, and a slash in a filename is a directory.
    expect(allocationWorkbookName('2027 / week 1', new Date('2027-06-01T00:00:00Z'))).toBe(
      'camp-allocation-2027-week-1-2027-06-01.xlsx',
    );
  });
});
