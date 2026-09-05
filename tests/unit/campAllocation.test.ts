import { describe, expect, it } from 'vitest';
import {
  CAMP_COLOURS,
  CAMP_UNCOLOURED,
  MAX_GROUPS_PER_BAND,
  bandForGrade,
  bandOfGroup,
  bandStraddles,
  bandsInSection,
  blankBand,
  blankGroup,
  blankRegistration,
  blankStation,
  CAMP_CREW_ROLE,
  campColour,
  campColourOf,
  campCanPlace,
  campComesInWeek,
  campCoverage,
  campMisplacedChildren,
  campDaysInWeek,
  campGenderSplit,
  campGroupMetrics,
  campReliability,
  campSplitEmpty,
  campSectionBaseline,
  campStationRoles,
  campStationMetrics,
  campWeekKeys,
  campWeekRoleKey,
  campWishMet,
  campGradesForSection,
  arrangedWeeks,
  copyWeekStructure,
  editWeekBoard,
  campPeople,
  childKey,
  countPlacements,
  dealBand,
  dropDangling,
  ensureBand,
  ensureStation,
  mergeBands,
  mergeGroups,
  splitBand,
  stationForRole,
  eligibleForPanel,
  groupNameUpdates,
  nextCampColour,
  panelSection,
  parseCampAllocation,
  parsePersonKey,
  placeChild,
  placeServant,
  resolveAllocation,
  setBandGrades,
  weekBoardOf,
  setLeader,
  starterPanels,
  uncoveredGrades,
  suggestBandName,
  suggestGroupName,
  type CampAllocationDraft,
  type CampGenderField,
  type CampGrade,
  type CampPerson,
  type CampWeekBoard,
  type CampRegistration,
} from '@spsm/shared';

/**
 * The allocation's one invariant, and the arithmetic that depends on it.
 *
 * ---------------------------------------------------------------------------
 * **A person is in exactly one place.** Everything the screen is for rests on
 * it: the available-people menu is "everybody minus everybody placed", so a
 * child who is in two groups appears in neither list, is counted twice in the
 * summary, and is printed on two rosters — which on a camp roster means a child
 * nobody is actually watching.
 *
 * It is enforced in three separate places and each of them is tested here,
 * because each can fail on its own: `placeChild`/`placeServant` remove before
 * they insert, `parseCampAllocation` dedupes a document that has been
 * hand-edited, and `resolveAllocation` derives the pool rather than storing it.
 * ---------------------------------------------------------------------------
 */

/* ---- fixtures ----------------------------------------------------------- */

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function family(
  registrationId: string,
  children: { id: string; name: string; grade: CampGrade; gender?: CampGenderField }[],
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
    contact: { ...draft.contact, name: `${registrationId} guardian`, phone: '555-0100' },
    children: children.map((child) => ({
      id: child.id,
      firstName: child.name,
      lastName: 'Test',
      dateOfBirth: '',
      grade: child.grade,
      // Unset unless a test says otherwise, which is the state most of the
      // season's real documents are in.
      gender: child.gender ?? '',
      shirtSize: 'YM' as const,
      days: [],
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

function servantRow(registrationId: string, name: string): CampRegistration & { id: string } {
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
    contact: { ...draft.contact, name },
    createdAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

/** A band with `groups` empty groups, all named and coloured. */
function bandWith(name: string, grades: CampGrade[], groups: number) {
  const band = blankBand(name, grades, 'blue');
  band.id = id('band');
  band.groups = Array.from({ length: groups }, (_, index) => {
    const group = blankGroup(`Group ${index + 1}`);
    group.id = id('group');
    return group;
  });
  return band;
}

/**
 * An allocation holding these bands. The camp has one arrangement, so this *is*
 * the document — `docOf` is kept as an alias because the whole-document
 * questions (`countPlacements`, `groupNameUpdates`) read better spelled out.
 */
/**
 * A one-week document holding these bands.
 *
 * Week one, because almost every question in this file is about one week's
 * arrangement and spelling the wrapper out at each call site would bury it. The
 * tests that are genuinely *about* the weeks build their own.
 */
function boardOf(...bands: ReturnType<typeof bandWith>[]): CampAllocationDraft {
  return weeksOf({ week: 1, bands, stations: [] });
}

function weeksOf(...weeks: CampWeekBoard[]): CampAllocationDraft {
  return {
    programId: 'summercamp',
    season: '2027',
    weeks,
    archivedAt: null,
    archivedBy: null,
    note: '',
  };
}

/** One week's bands, for a test reading a document it did not build flat. */
function bandsOf(draft: CampAllocationDraft, week = 1) {
  return weekBoardOf(draft, week).bands;
}

/** One week's stations. */
function stationsOf(draft: CampAllocationDraft, week = 1) {
  return weekBoardOf(draft, week).stations;
}

function docOf(board: CampAllocationDraft): CampAllocationDraft {
  return board;
}

/* ---- keys --------------------------------------------------------------- */

describe('person keys', () => {
  it('tells a child from a servant by the slash', () => {
    expect(parsePersonKey('reg-1/child-2')).toEqual({
      kind: 'child',
      registrationId: 'reg-1',
      childId: 'child-2',
    });
    expect(parsePersonKey('reg-1')).toEqual({
      kind: 'servant',
      registrationId: 'reg-1',
      childId: '',
    });
  });

  it('refuses the shapes it never writes', () => {
    // A key edited in a console. Every one of these would otherwise resolve to
    // a registration id that is a prefix of a real one.
    expect(parsePersonKey('reg-1/')).toBeNull();
    expect(parsePersonKey('/child-2')).toBeNull();
    expect(parsePersonKey('reg-1/child-2/extra')).toBeNull();
    expect(parsePersonKey('  ')).toBeNull();
    expect(parsePersonKey(42)).toBeNull();
  });
});

/* ---- the invariant ------------------------------------------------------ */

describe('a person is in exactly one place', () => {
  it('moving a child out of one group takes them out of it', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 2);
    const [first, second] = band.groups;
    const key = childKey('reg-1', 'child-1');

    let board = boardOf(band);
    board = placeChild(board, 1, key, { kind: 'group', bandId: band.id, groupId: first!.id });
    board = placeChild(board, 1, key, { kind: 'group', bandId: band.id, groupId: second!.id });

    expect(bandsOf(board)[0]!.groups[0]!.childKeys).toEqual([]);
    expect(bandsOf(board)[0]!.groups[1]!.childKeys).toEqual([key]);
    expect(countPlacements(docOf(board))).toBe(1);
  });

  it('dropping a child on the group they are already in reorders rather than duplicates', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    const a = childKey('reg-1', 'a');
    const b = childKey('reg-1', 'b');

    let board = boardOf(band);
    board = placeChild(board, 1, a, target);
    board = placeChild(board, 1, b, target);
    expect(bandsOf(board)[0]!.groups[0]!.childKeys).toEqual([a, b]);

    board = placeChild(board, 1, b, target, 0);
    expect(bandsOf(board)[0]!.groups[0]!.childKeys).toEqual([b, a]);
  });

  it('a servant moved from a group to a station leaves the group', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const station = blankStation('Sports', 'teal');
    station.id = id('station');
    const key = 'reg-servant-1';

    let board = weeksOf({ week: 1, bands: [band], stations: [station] });
    board = placeServant(board, 1, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });
    expect(bandsOf(board)[0]!.groups[0]!.servantKeys).toEqual([key]);

    board = placeServant(board, 1, key, { kind: 'station', stationId: station.id });
    expect(bandsOf(board)[0]!.groups[0]!.servantKeys).toEqual([]);
    expect(stationsOf(board)[0]!.servantKeys).toEqual([key]);
    expect(countPlacements(docOf(board))).toBe(1);
  });

  it('a null target is the pool, and empties every list', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const key = childKey('reg-1', 'child-1');

    let board = boardOf(band);
    board = placeChild(board, 1, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });
    board = placeChild(board, 1, key, null);

    expect(countPlacements(docOf(board))).toBe(0);
  });

  it('refuses a child on a station outright', () => {
    const station = blankStation('Sports', 'teal');
    station.id = id('station');
    const board: CampWeekBoard = { week: 1, bands: [], stations: [station] };

    const after = placeChild(board, 1, childKey('reg-1', 'child-1'), {
      kind: 'station',
      stationId: station.id,
    });
    expect(after).toBe(board);
  });

  it('dedupes a hand-edited document across every group and station', () => {
    const key = childKey('reg-1', 'child-1');
    const servant = 'reg-servant-1';

    const parsed = parseCampAllocation({
      programId: 'summercamp',
      season: '2027',
      bands: [
        {
          id: 'band-1',
          name: 'A',
          grades: ['3'],
          colour: 'green',
          groups: [
            { id: 'g1', name: 'One', colour: 'green', childKeys: [key, key], servantKeys: [servant] },
            { id: 'g2', name: 'Two', colour: 'blue', childKeys: [key], servantKeys: [servant] },
          ],
        },
      ],
      stations: [{ id: 's1', name: 'Sports', colour: 'teal', servantKeys: [servant] }],
    });

    expect(bandsOf(parsed)[0]!.groups[0]!.childKeys).toEqual([key]);
    expect(bandsOf(parsed)[0]!.groups[1]!.childKeys).toEqual([]);
    expect(bandsOf(parsed)[0]!.groups[0]!.servantKeys).toEqual([servant]);
    expect(bandsOf(parsed)[0]!.groups[1]!.servantKeys).toEqual([]);
    expect(stationsOf(parsed)[0]!.servantKeys).toEqual([]);
  });

  it('drops keys of the wrong kind rather than trusting the list they were in', () => {
    const parsed = parseCampAllocation({
      programId: 'summercamp',
      season: '2027',
      bands: [
        {
          id: 'band-1',
          name: 'A',
          grades: [],
          colour: 'green',
          // A servant key in the children list and a child key in the servants
          // list. Both are what a console edit or a bad migration looks like.
          groups: [{ id: 'g1', name: 'One', colour: 'green', childKeys: ['reg-1'], servantKeys: ['reg-1/child-1'] }],
        },
      ],
      stations: [],
    });

    expect(bandsOf(parsed)[0]!.groups[0]!.childKeys).toEqual([]);
    expect(bandsOf(parsed)[0]!.groups[0]!.servantKeys).toEqual([]);
  });
});

/* ---- the pool ----------------------------------------------------------- */

describe('resolveAllocation', () => {
  const registrations = [
    family('reg-1', [
      { id: 'c1', name: 'Mariam', grade: '3' },
      { id: 'c2', name: 'Peter', grade: '4' },
    ]),
    family('reg-2', [{ id: 'c3', name: 'Anne', grade: '7' }]),
    servantRow('reg-s1', 'Marina'),
  ];
  const people = campPeople(registrations);

  it('flattens children and servants out of the registrations', () => {
    // Children carry both names; a servant's name is the contact's, whole.
    expect(people.map((person) => person.name)).toEqual([
      'Mariam Test',
      'Peter Test',
      'Anne Test',
      'Marina',
    ]);
    expect(people.filter((person) => person.kind === 'child')).toHaveLength(3);
  });

  it('puts everybody unplaced in the pool', () => {
    const resolved = resolveAllocation(boardOf(), 1, people);
    expect(resolved.freeChildren).toHaveLength(3);
    expect(resolved.freeServants).toHaveLength(1);
  });

  it('takes somebody out of the pool the moment they are placed', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    let board = boardOf(band);
    board = placeChild(board, 1, childKey('reg-1', 'c1'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[0]!.id,
    });

    const resolved = resolveAllocation(board, 1, people);
    expect(resolved.freeChildren.map((person) => person.name)).toEqual(['Peter Test', 'Anne Test']);
    expect(resolved.placement.has(childKey('reg-1', 'c1'))).toBe(true);
  });

  it('flags a child placed outside their band’s grades without refusing them', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const key = childKey('reg-2', 'c3'); // Anne is entering 7th.
    let board = boardOf(band);
    board = placeChild(board, 1, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });

    const resolved = resolveAllocation(board, 1, people);
    expect(resolved.offBand).toEqual([key]);
    // Placed all the same — every camp has the child who has to be with a cousin.
    expect(resolved.placement.get(key)).toEqual({
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[0]!.id,
    });
  });

  it('reports a placement matching nobody rather than quietly dropping it', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    let board = boardOf(band);
    board = placeChild(board, 1, childKey('reg-gone', 'c9'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[0]!.id,
    });

    const resolved = resolveAllocation(board, 1, people);
    expect(resolved.dangling).toHaveLength(1);
    expect(resolved.dangling[0]!.key).toBe('reg-gone/c9');
    // Still stored: an allocation must not lose a group's worth of children to
    // a half-loaded registration list.
    expect(countPlacements(docOf(board))).toBe(1);

    const cleared = dropDangling(board, people);
    expect(countPlacements(docOf(cleared))).toBe(0);
  });
});

/* ---- dealing ------------------------------------------------------------ */

describe('dealBand', () => {
  it('deals the band’s unplaced children evenly, smallest group first', () => {
    const registrations = [
      family('reg-1', [
        { id: 'c1', name: 'A', grade: '3' },
        { id: 'c2', name: 'B', grade: '3' },
        { id: 'c3', name: 'C', grade: '4' },
        { id: 'c4', name: 'D', grade: '4' },
        { id: 'c5', name: 'E', grade: '4' },
      ]),
    ];
    const people = campPeople(registrations);
    const band = bandWith('3rd & 4th', ['3', '4'], 3);

    const dealt = dealBand(boardOf(band), 1, band.id, people);
    const sizes = bandsOf(dealt)[0]!.groups.map((group) => group.childKeys.length);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(5);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('never touches a child who is already in a group', () => {
    const registrations = [
      family('reg-1', [
        { id: 'c1', name: 'A', grade: '3' },
        { id: 'c2', name: 'B', grade: '3' },
      ]),
    ];
    const people = campPeople(registrations);
    const band = bandWith('3rd & 4th', ['3', '4'], 2);

    let board = boardOf(band);
    // A deliberate placement: A is in the *second* group, which round-robin
    // would never have chosen first.
    board = placeChild(board, 1, childKey('reg-1', 'c1'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[1]!.id,
    });

    const dealt = dealBand(board, 1, band.id, people);
    expect(bandsOf(dealt)[0]!.groups[1]!.childKeys).toContain(childKey('reg-1', 'c1'));
    expect(bandsOf(dealt)[0]!.groups[0]!.childKeys).toEqual([childKey('reg-1', 'c2')]);
  });

  it('leaves other bands’ grades alone', () => {
    const registrations = [
      family('reg-1', [
        { id: 'c1', name: 'A', grade: '3' },
        { id: 'c2', name: 'B', grade: '8' },
      ]),
    ];
    const people = campPeople(registrations);
    const band = bandWith('3rd & 4th', ['3', '4'], 1);

    const dealt = dealBand(boardOf(band), 1, band.id, people);
    expect(bandsOf(dealt)[0]!.groups[0]!.childKeys).toEqual([childKey('reg-1', 'c1')]);
  });

  it('skips a withdrawn child', () => {
    const withdrawn = family('reg-1', [{ id: 'c1', name: 'A', grade: '3' }]);
    withdrawn.status = 'withdrawn';
    const people = campPeople([withdrawn]);
    const band = bandWith('3rd & 4th', ['3', '4'], 1);

    const dealt = dealBand(boardOf(band), 1, band.id, people);
    expect(countPlacements(docOf(dealt))).toBe(0);
  });
});

/* ---- writing names back ------------------------------------------------- */

describe('groupNameUpdates', () => {
  it('returns only the children whose stored name disagrees', () => {
    const registrations = [
      family('reg-1', [
        { id: 'c1', name: 'A', grade: '3' },
        { id: 'c2', name: 'B', grade: '3' },
      ]),
    ];
    // c2 already carries the right name; only c1 should be written.
    registrations[0]!.children[1]!.groupName = '3rd & 4th · Group 1';

    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    let board = boardOf(band);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    board = placeChild(board, 1, childKey('reg-1', 'c1'), target);
    board = placeChild(board, 1, childKey('reg-1', 'c2'), target);

    expect(groupNameUpdates(docOf(board), registrations)).toEqual([
      { registrationId: 'reg-1', childId: 'c1', groupName: '3rd & 4th · Group 1' },
    ]);
  });

  it('clears the name of a child who has been taken out of every group', () => {
    const registrations = [family('reg-1', [{ id: 'c1', name: 'A', grade: '3' }])];
    registrations[0]!.children[0]!.groupName = 'Something stale';

    expect(groupNameUpdates(docOf(boardOf()), registrations)).toEqual([
      { registrationId: 'reg-1', childId: 'c1', groupName: '' },
    ]);
  });
});

/* ---- odds and ends ------------------------------------------------------ */

describe('bands', () => {
  it('suggests a name from the grades', () => {
    expect(suggestBandName(['4', '3'])).toBe('3rd & 4th grade');
    expect(suggestBandName(['1', 'k'])).toBe('Kindergarten & 1st');
    expect(suggestBandName(['11', '12'])).toBe('11th & 12th grade');
    // The nine starter panels each carry one grade, so this is the case that
    // gets read most: "5th grade", the way the camp says it, not "Grade 5".
    expect(suggestBandName(['5'])).toBe('5th grade');
    expect(suggestBandName(['k'])).toBe('Kindergarten');
    expect(suggestBandName([])).toBe('New panel');
  });

  it('caps the groups a stored band can carry', () => {
    const parsed = parseCampAllocation({
      season: '2027',
      bands: [
        {
          id: 'b',
          name: 'A',
          groups: Array.from({ length: MAX_GROUPS_PER_BAND + 5 }, (_, index) => ({
            id: `g${index}`,
            name: `G${index}`,
          })),
        },
      ],
    });
    expect(bandsOf(parsed)[0]!.groups).toHaveLength(MAX_GROUPS_PER_BAND);
  });
});

/* ---- the weeks are separate boards --------------------------------------- */

/**
 * A week is its own arrangement, and the only thing that crosses is a copy.
 *
 * This is the third time the camp has changed its mind about weeks, so the
 * tests are written against the *claim* rather than the shape: placing somebody
 * in week one must not place them in week two, and the copy must never move a
 * person between weeks. Both failures are silent — a servant on two rosters, or
 * a crew that quietly emptied — and neither shows up as an exception.
 */
describe('weeks are separate boards', () => {
  it('places into one week and leaves the other alone', () => {
    const one = bandWith('3rd grade', ['3'], 1);
    const two = bandWith('3rd grade', ['3'], 1);
    let board = weeksOf(
      { week: 1, bands: [one], stations: [] },
      { week: 2, bands: [two], stations: [] },
    );

    const key = childKey('reg-1', 'child-1');
    board = placeChild(board, 1, key, { kind: 'group', bandId: one.id, groupId: one.groups[0]!.id });

    expect(bandsOf(board, 1)[0]!.groups[0]!.childKeys).toEqual([key]);
    expect(bandsOf(board, 2)[0]!.groups[0]!.childKeys).toEqual([]);
  });

  it('lets one servant be in a group one week and on a station the next', () => {
    const crew = bandWith('3rd grade', ['3'], 1);
    const sports = blankStation('Sports', 'teal');
    let board = weeksOf(
      { week: 1, bands: [crew], stations: [] },
      { week: 2, bands: [], stations: [sports] },
    );

    board = placeServant(board, 1, 'reg-s1', {
      kind: 'group',
      bandId: crew.id,
      groupId: crew.groups[0]!.id,
    });
    board = placeServant(board, 2, 'reg-s1', { kind: 'station', stationId: sports.id });

    expect(bandsOf(board, 1)[0]!.groups[0]!.servantKeys).toEqual(['reg-s1']);
    expect(stationsOf(board, 2)[0]!.servantKeys).toEqual(['reg-s1']);
    // Two placements, both legitimate. A document-wide dedupe would eat one.
    expect(countPlacements(board)).toBe(2);
  });

  it('makes a week on demand rather than seeding every week of the camp', () => {
    const empty = weeksOf();
    expect(weekBoardOf(empty, 3)).toEqual({ week: 3, bands: [], stations: [] });
    // Reading a week does not put it in the document.
    expect(empty.weeks).toHaveLength(0);
    expect(arrangedWeeks(empty)).toEqual([]);

    const used = editWeekBoard(empty, 3, (board) => ({
      ...board,
      bands: [bandWith('3rd grade', ['3'], 1)],
    }));
    expect(used.weeks.map((board) => board.week)).toEqual([3]);
    expect(arrangedWeeks(used)).toEqual([3]);
  });

  it('reads a flat document as week one and leaves the other weeks empty', () => {
    const parsed = parseCampAllocation({
      season: '2027',
      bands: [{ id: 'b', name: '3rd grade', grades: ['3'], groups: [{ id: 'g', name: 'One' }] }],
      stations: [{ id: 's', name: 'Sports', weeks: [1, 2] }],
    });
    expect(parsed.weeks.map((board) => board.week)).toEqual([1]);
    expect(bandsOf(parsed)[0]!.name).toBe('3rd grade');
    // A flat-shape station that ran in week one comes with it; week two is not
    // invented, because nobody arranged it.
    expect(stationsOf(parsed).map((entry) => entry.name)).toEqual(['Sports']);
    expect(weekBoardOf(parsed, 2).bands).toEqual([]);
  });

  it('reads the per-week shape back, one seen-set per week', () => {
    const key = childKey('reg-1', 'child-1');
    const parsed = parseCampAllocation({
      season: '2027',
      weeks: [
        {
          week: 1,
          bands: [{ id: 'b1', name: 'A', groups: [{ id: 'g1', name: 'One', childKeys: [key] }] }],
          stations: [],
        },
        {
          week: 2,
          bands: [{ id: 'b2', name: 'B', groups: [{ id: 'g2', name: 'Two', childKeys: [key] }] }],
          stations: [],
        },
      ],
    });
    // The same child in both weeks is two placements, not a duplicate.
    expect(bandsOf(parsed, 1)[0]!.groups[0]!.childKeys).toEqual([key]);
    expect(bandsOf(parsed, 2)[0]!.groups[0]!.childKeys).toEqual([key]);
    // Twice inside *one* week is still a duplicate.
    const twice = parseCampAllocation({
      season: '2027',
      weeks: [
        {
          week: 1,
          bands: [
            {
              id: 'b1',
              name: 'A',
              groups: [
                { id: 'g1', name: 'One', childKeys: [key] },
                { id: 'g2', name: 'Two', childKeys: [key] },
              ],
            },
          ],
          stations: [],
        },
      ],
    });
    expect(bandsOf(twice)[0]!.groups[1]!.childKeys).toEqual([]);
  });
});

/* ---- merging and splitting grades ---------------------------------------- */

/**
 * Merging is one click now, and the thing it must not do is lose anybody.
 *
 * The control it replaced was a row of nine checkboxes inside a settings panel,
 * and the complaint that killed it was that nobody could find it. What matters
 * here is the other half: a merge concatenates two crews' groups, and a
 * concatenation is where two groups both called "Group 1" come from — which the
 * attendance register cannot tell apart, because it heads its sections
 * `band · group`.
 */
describe('mergeBands', () => {
  it('runs two grades together, keeping every group and everybody in them', () => {
    const third = bandWith('3rd grade', ['3'], 1);
    const fourth = bandWith('4th grade', ['4'], 1);
    const a = childKey('reg-1', 'c1');
    const b = childKey('reg-2', 'c1');
    third.groups[0]!.childKeys = [a];
    fourth.groups[0]!.childKeys = [b];

    const board = mergeBands(boardOf(third, fourth), 1, third.id, fourth.id);
    const bands = bandsOf(board);

    expect(bands).toHaveLength(1);
    expect(bands[0]!.id).toBe(third.id);
    expect(bands[0]!.grades).toEqual(['3', '4']);
    expect(bands[0]!.name).toBe('3rd & 4th grade');
    expect(bands[0]!.groups.flatMap((group) => group.childKeys)).toEqual([a, b]);
  });

  it('renumbers the default names it just collided, and leaves typed ones alone', () => {
    const third = bandWith('3rd grade', ['3'], 2);
    const fourth = bandWith('4th grade', ['4'], 2);
    fourth.groups[0]!.name = 'Cherubim';

    const board = mergeBands(boardOf(third, fourth), 1, third.id, fourth.id);
    const names = bandsOf(board)[0]!.groups.map((group) => group.name);

    // "Group 1" and "Group 2" came in twice; the second pair is renumbered.
    // "Cherubim" is a name the camp typed and survives untouched.
    expect(names).toEqual(['Group 1', 'Group 2', 'Cherubim', 'Group 3']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps a name the camp typed, and follows the grades for one of ours', () => {
    const named = bandWith('The Cherubim', ['3'], 0);
    const fourth = bandWith('4th grade', ['4'], 0);
    expect(bandsOf(mergeBands(boardOf(named, fourth), 1, named.id, fourth.id))[0]!.name).toBe(
      'The Cherubim',
    );
  });

  it('refuses to merge a band with itself, or with one that is not there', () => {
    const board = boardOf(bandWith('3rd grade', ['3'], 1));
    expect(mergeBands(board, 1, 'band-x', 'band-x')).toBe(board);
    expect(bandsOf(mergeBands(board, 1, bandsOf(board)[0]!.id, 'band-nope'))).toHaveLength(1);
  });
});

/**
 * Splitting cannot be a clean undo, and the test is about the part that is
 * *lost* on purpose.
 *
 * A merged crew's groups are mixed — "Blue 1" holds 3rd and 4th graders, which
 * is the whole point of merging — so a split has to decide where each person
 * goes. Children go by their own grade, into the group of the same name.
 * Servants have no grade, so nothing in the document says which half of a split
 * crew is theirs, and they go back to the waiting list rather than being
 * guessed at.
 */
describe('splitBand', () => {
  it('sends each child to their own grade, into the group of the same name', () => {
    const band = bandWith('3rd & 4th grade', ['3', '4'], 2);
    band.groups[0]!.name = 'Blue';
    band.groups[1]!.name = 'Green';

    const people = campPeople([
      family('reg-1', [{ id: 'c1', name: 'Third', grade: '3' }]),
      family('reg-2', [{ id: 'c1', name: 'Fourth', grade: '4' }]),
    ]);
    const third = childKey('reg-1', 'c1');
    const fourth = childKey('reg-2', 'c1');
    band.groups[0]!.childKeys = [third, fourth];

    const board = splitBand(boardOf(band), 1, band.id, people);
    const bands = bandsOf(board);

    expect(bands.map((entry) => entry.name)).toEqual(['3rd grade', '4th grade']);
    // Both group names survive on both new bands, and each child lands in the
    // one they were already in.
    for (const entry of bands) {
      expect(entry.groups.map((group) => group.name)).toEqual(['Blue', 'Green']);
    }
    expect(bands[0]!.groups[0]!.childKeys).toEqual([third]);
    expect(bands[1]!.groups[0]!.childKeys).toEqual([fourth]);
  });

  it('sends servants back to the waiting list rather than guessing a grade', () => {
    const band = bandWith('3rd & 4th grade', ['3', '4'], 1);
    band.groups[0]!.servantKeys = ['reg-s1'];
    band.groups[0]!.leaderKey = 'reg-s1';

    const board = splitBand(boardOf(band), 1, band.id, []);
    for (const entry of bandsOf(board)) {
      expect(entry.groups[0]!.servantKeys).toEqual([]);
      expect(entry.groups[0]!.leaderKey).toBe('');
    }
  });

  it('leaves a single-grade band alone — there is nothing to split', () => {
    const board = boardOf(bandWith('3rd grade', ['3'], 1));
    expect(splitBand(board, 1, bandsOf(board)[0]!.id, [])).toBe(board);
  });
});

/**
 * `ensureBand` and `ensureStation`: the cards the screen draws that the
 * document has never seen.
 *
 * Most of the board is a grade nobody has arranged and a station nobody is
 * running. Neither is stored until somebody acts on it, so every action passes
 * through here — and calling it on something already stored has to be free, or
 * every drag would append a duplicate.
 */
describe('ensuring a card is in the document', () => {
  it('adds a band once and never again', () => {
    const band = bandWith('3rd grade', ['3'], 1);
    const once = ensureBand(weeksOf(), 1, band);
    expect(bandsOf(once)).toHaveLength(1);
    // Idempotent, and by identity: a no-op must not make a new draft or the
    // screen re-renders on every drag over an existing card.
    expect(ensureBand(once, 1, band)).toBe(once);
  });

  it('adds a station for a role, and finds it again by name', () => {
    const board = ensureStation(weeksOf(), 1, 'Sports', 'elementary', 'teal');
    const made = stationForRole(weekBoardOf(board, 1), 'sports ', 'elementary');
    expect(made?.name).toBe('Sports');
    // The other half of the camp runs its own, under the same name.
    expect(stationForRole(weekBoardOf(board, 1), 'Sports', 'middle-school')).toBeNull();
    expect(ensureStation(board, 1, 'Sports', 'elementary', 'teal')).toBe(board);
  });
});

/**
 * The stations *are* the camp's roles, minus the crew.
 *
 * Which is what makes the satisfaction meter trustworthy: the string on a
 * station card and the string a servant ticked on the sign-up form are the same
 * string by construction. The crew wish is the one that has to come out, in
 * every spelling the form has ever used.
 */
describe('campStationRoles', () => {
  it('drops every spelling of the crew wish and keeps the rest, in order', () => {
    expect(
      campStationRoles(['Crew leader', 'Sports', 'Group servant', 'Kitchen', 'Head servant']),
    ).toEqual(['Sports', 'Kitchen']);
  });

  it('drops blanks and case-insensitive duplicates', () => {
    expect(campStationRoles(['Sports', '  ', 'sports', 'Kitchen '])).toEqual(['Sports', 'Kitchen']);
  });
});

/**
 * `copyWeekStructure`: the one button that crosses weeks.
 *
 * Everything here is about what it must **not** do. It replaced an automatic
 * link that shared ids across weeks and was scrapped for being unpredictable,
 * so the value of this one is entirely in its restraint.
 */
describe('copyWeekStructure', () => {
  it('copies the grade grouping and the group names, and nobody', () => {
    const merged = bandWith('1st & 2nd grade', ['1', '2'], 2);
    const key = childKey('reg-1', 'child-1');
    merged.groups[0]!.childKeys = [key];

    const copied = copyWeekStructure(
      weeksOf({ week: 1, bands: [merged], stations: [] }, { week: 2, bands: [], stations: [] }),
      1,
      2,
    );

    const week2 = bandsOf(copied, 2);
    expect(week2).toHaveLength(1);
    expect(week2[0]!.grades).toEqual(['1', '2']);
    expect(week2[0]!.name).toBe('1st & 2nd grade');
    expect(week2[0]!.groups.map((group) => group.name)).toEqual(['Group 1', 'Group 2']);
    // Nobody crossed.
    expect(week2[0]!.groups.every((group) => group.childKeys.length === 0)).toBe(true);
    expect(bandsOf(copied, 1)[0]!.groups[0]!.childKeys).toEqual([key]);
    // And the ids are the target's own, so a later edit to one week cannot
    // reach the other.
    expect(week2[0]!.id).not.toBe(merged.id);
  });

  it('merges into a band already covering the same grades, keeping its people', () => {
    const source = bandWith('3rd grade', ['3'], 2);
    const target = bandWith('Third', ['3'], 1);
    const key = childKey('reg-1', 'child-1');
    target.groups[0]!.childKeys = [key];

    const copied = copyWeekStructure(
      weeksOf({ week: 1, bands: [source], stations: [] }, { week: 2, bands: [target], stations: [] }),
      1,
      2,
    );

    const bands = bandsOf(copied, 2);
    expect(bands).toHaveLength(1);
    expect(bands[0]!.id).toBe(target.id);
    // Renamed to match, but the child stayed exactly where they were, and the
    // group the source had beyond it was added empty.
    expect(bands[0]!.name).toBe('3rd grade');
    expect(bands[0]!.groups[0]!.childKeys).toEqual([key]);
    expect(bands[0]!.groups).toHaveLength(2);
  });

  it('keeps a leftover band that holds somebody, and drops one that does not', () => {
    const source = bandWith('3rd grade', ['3'], 1);
    const held = bandWith('5th grade', ['5'], 1);
    const empty = bandWith('4th grade', ['4'], 1);
    held.groups[0]!.childKeys = [childKey('reg-2', 'child-1')];

    const copied = copyWeekStructure(
      weeksOf(
        { week: 1, bands: [source], stations: [] },
        { week: 2, bands: [held, empty], stations: [] },
      ),
      1,
      2,
    );

    const names = bandsOf(copied, 2).map((band) => band.name);
    expect(names).toContain('3rd grade');
    expect(names).toContain('5th grade');
    expect(names).not.toContain('4th grade');
  });

  it('refuses to copy from an empty week, or onto itself', () => {
    const board = weeksOf({ week: 1, bands: [bandWith('3rd grade', ['3'], 1)], stations: [] });
    expect(copyWeekStructure(board, 1, 1)).toBe(board);
    expect(copyWeekStructure(board, 2, 1)).toBe(board);
  });
});

/* ---- the two meters ------------------------------------------------------ */

/** A servant who wants these things in this week and half. */
function wisher(id: string, week: number, section: 'elementary' | 'middle-school', roles: string[]) {
  const person = campPeople([servantRow(id, id)])[0]!;
  return {
    ...person,
    days: campWeekKeys(week),
    desiredRolesByWeek: { [campWeekRoleKey(week, section)]: roles },
  };
}

/** A child coming for `days` days of `week`. */
function comer(registrationId: string, childId: string, week: number, days: number) {
  const person = campPeople([
    family(registrationId, [{ id: childId, name: childId, grade: '3' }]),
  ])[0]!;
  return { ...person, days: campWeekKeys(week).slice(0, days) };
}

function index(people: CampPerson[]) {
  return new Map(people.map((person) => [person.key, person]));
}

/**
 * Satisfaction: did the servant ask for the place they are standing in?
 *
 * The vocabulary is *"just stations and crew leaders"*, so there are two rules
 * and one deliberate third state. The third is the one worth pinning: a servant
 * who asked for **nothing** must be `null` — neither satisfied nor
 * dissatisfied — because counting them as unhappy makes every meter on the
 * board read badly for the commonest case, which is the fastest way to make a
 * metric ignored.
 */
describe('campWishMet', () => {
  it('matches a station on its name, ignoring case and stray space', () => {
    const person = wisher('reg-s1', 1, 'elementary', ['Sports']);
    expect(campWishMet(person, { kind: 'station', name: 'sports ' }, 1, 'elementary')).toBe(true);
    expect(campWishMet(person, { kind: 'station', name: 'Kitchen' }, 1, 'elementary')).toBe(false);
  });

  it('matches a crew wish however the form spelled it', () => {
    for (const spelling of ['Crew leader', 'Group servant', 'Head servant']) {
      const person = wisher('reg-s1', 1, 'elementary', [spelling]);
      expect(campWishMet(person, { kind: 'group' }, 1, 'elementary')).toBe(true);
    }
    // A station wish is not a crew wish.
    const sporty = wisher('reg-s1', 1, 'elementary', ['Sports']);
    expect(campWishMet(sporty, { kind: 'group' }, 1, 'elementary')).toBe(false);
  });

  it('reads the wish for the week and half being asked about, not the summer', () => {
    const person = {
      ...wisher('reg-s1', 1, 'elementary', ['Sports']),
      desiredRolesByWeek: {
        [campWeekRoleKey(1, 'elementary')]: ['Sports'],
        [campWeekRoleKey(2, 'elementary')]: [CAMP_CREW_ROLE],
      },
    };
    expect(campWishMet(person, { kind: 'station', name: 'Sports' }, 1, 'elementary')).toBe(true);
    expect(campWishMet(person, { kind: 'station', name: 'Sports' }, 2, 'elementary')).toBe(false);
    expect(campWishMet(person, { kind: 'group' }, 2, 'elementary')).toBe(true);
    // Nothing said about middle school, so nothing is claimed about it.
    expect(campWishMet(person, { kind: 'group' }, 1, 'middle-school')).toBeNull();
  });

  it('answers null for somebody who asked for nothing, and for a child', () => {
    const quiet = wisher('reg-s1', 1, 'elementary', []);
    expect(campWishMet(quiet, { kind: 'group' }, 1, 'elementary')).toBeNull();
    const child = comer('reg-1', 'c1', 1, 5);
    expect(campWishMet(child, { kind: 'group' }, 1, 'elementary')).toBeNull();
  });
});

/**
 * Coverage: an even spread, not a target.
 *
 * Chosen over a configured children-per-servant ratio, and the consequence
 * worth testing is the one that looks like a bug: **a half that is uniformly
 * thin reads as level.** That is correct — there is nothing on the screen that
 * would conjure more teenagers — and it is exactly the behaviour somebody will
 * one day "fix" by adding a target back.
 */
describe('campCoverage', () => {
  it('flags the crew carrying more than its share, and says how many short', () => {
    const fat = { children: 12, servants: 1 };
    const lean = { children: 6, servants: 3 };
    const baseline = campSectionBaseline([
      { ...fat, satisfied: 0, wishing: 0, ratio: 12 },
      { ...lean, satisfied: 0, wishing: 0, ratio: 2 },
    ]);
    // 18 children, 4 servants: 4.5 each.
    expect(baseline).toBeCloseTo(4.5);
    expect(campCoverage(fat, baseline).level).toBe('thin');
    expect(campCoverage(fat, baseline).short).toBe(2);
    expect(campCoverage(lean, baseline).level).toBe('rich');
  });

  it('reads a uniformly thin half as level, because nothing here would fix it', () => {
    const places = [
      { children: 20, servants: 1, satisfied: 0, wishing: 0, ratio: 20 },
      { children: 20, servants: 1, satisfied: 0, wishing: 0, ratio: 20 },
    ];
    const baseline = campSectionBaseline(places);
    for (const place of places) expect(campCoverage(place, baseline).level).toBe('ok');
  });

  it('always calls out children with nobody at all', () => {
    expect(campCoverage({ children: 6, servants: 0 }, 6).level).toBe('none');
    expect(campCoverage({ children: 6, servants: 0 }, 6).short).toBe(1);
    // With no baseline to compare against, one is still the honest ask.
    expect(campCoverage({ children: 6, servants: 0 }, null).short).toBe(1);
  });

  it('says nothing about a group with no children in it', () => {
    expect(campCoverage({ children: 0, servants: 2 }, 5).level).toBe('empty');
  });
});

/**
 * The measurement itself, which is where the week does its work.
 *
 * Everybody in a group is counted only if they are actually at camp that week —
 * a child registered for week one alone is not part of week two's coverage, and
 * counting them would make week two look short and week one look fine when the
 * truth is the reverse.
 */
describe('campGroupMetrics', () => {
  it('counts only the people who are there that week', () => {
    const here = comer('reg-1', 'c1', 1, 5);
    const gone = comer('reg-2', 'c2', 1, 5);
    const servant = wisher('reg-s1', 1, 'elementary', [CAMP_CREW_ROLE]);
    const byKey = index([here, gone, servant]);

    const group = {
      childKeys: [here.key, gone.key],
      servantKeys: [servant.key],
    };

    expect(campGroupMetrics(group, byKey, 1, 'elementary')).toMatchObject({
      children: 2,
      servants: 1,
      satisfied: 1,
      wishing: 1,
    });
    // In week two nobody is at camp, so the group is empty rather than short.
    expect(campGroupMetrics(group, byKey, 2, 'elementary')).toMatchObject({
      children: 0,
      servants: 0,
      wishing: 0,
    });
  });

  it('leaves a withdrawn child out of the count but not out of the board', () => {
    const here = comer('reg-1', 'c1', 1, 5);
    const out = { ...comer('reg-2', 'c2', 1, 5), withdrawn: true };
    const byKey = index([here, out]);
    expect(
      campGroupMetrics({ childKeys: [here.key, out.key], servantKeys: [] }, byKey, 1, 'elementary')
        .children,
    ).toBe(1);
  });

  it('counts a station by its name against the same week and half', () => {
    const sporty = wisher('reg-s1', 1, 'elementary', ['Sports']);
    const cook = wisher('reg-s2', 1, 'elementary', ['Kitchen']);
    const byKey = index([sporty, cook]);
    expect(
      campStationMetrics(
        { name: 'Sports', servantKeys: [sporty.key, cook.key] },
        byKey,
        1,
        'elementary',
      ),
    ).toMatchObject({ servants: 2, satisfied: 1, wishing: 2 });
  });
});

/* ---- male and female ----------------------------------------------------- */

/** A child of a given sex, coming for the whole of `week`. */
function sexed(childId: string, gender: CampGenderField, week = 1) {
  const person = campPeople([
    family(`reg-${childId}`, [{ id: childId, name: childId, grade: '3', gender }]),
  ])[0]!;
  return { ...person, days: campWeekKeys(week) };
}

/**
 * The split the whole feature exists for.
 *
 * The invariant worth holding onto is that `male + female + unknown` always
 * equals the headcount taken in the same pass — the card prints both, and two
 * numbers beside each other that do not add up is the failure that would send
 * somebody looking for a child who is not missing.
 */
describe('counting a crew male and female', () => {
  it('splits the children and the servants separately', () => {
    const boy = sexed('b1', 'male');
    const girl = sexed('g1', 'female');
    const girl2 = sexed('g2', 'female');
    const servant = { ...wisher('reg-s1', 1, 'elementary', [CAMP_CREW_ROLE]), gender: 'female' as const };
    const byKey = index([boy, girl, girl2, servant]);

    const metrics = campGroupMetrics(
      { childKeys: [boy.key, girl.key, girl2.key], servantKeys: [servant.key] },
      byKey,
      1,
      'elementary',
    );

    expect(metrics.childGender).toEqual({ male: 1, female: 2, unknown: 0 });
    expect(metrics.servantGender).toEqual({ male: 0, female: 1, unknown: 0 });
    // …and both add up to the counts printed beside them.
    expect(metrics.childGender.male + metrics.childGender.female + metrics.childGender.unknown).toBe(
      metrics.children,
    );
    expect(
      metrics.servantGender.male + metrics.servantGender.female + metrics.servantGender.unknown,
    ).toBe(metrics.servants);
  });

  it('keeps the unanswered apart rather than folding them into either side', () => {
    // A crew registered before the field existed. "3 boys" would be a lie; "1
    // boy, 2 not given" is the balance *and* the reason to go and ask.
    const known = sexed('b1', 'male');
    const older = [sexed('x1', ''), sexed('x2', '')];
    const byKey = index([known, ...older]);

    const metrics = campGroupMetrics(
      { childKeys: [known.key, ...older.map((person) => person.key)], servantKeys: [] },
      byKey,
      1,
      'elementary',
    );
    expect(metrics.childGender).toEqual({ male: 1, female: 0, unknown: 2 });
    expect(metrics.children).toBe(3);
  });

  it('counts the same people the headcount counts — this week, withdrawals out', () => {
    const here = sexed('g1', 'female', 1);
    const nextWeek = sexed('g2', 'female', 2);
    const gone = { ...sexed('b1', 'male', 1), withdrawn: true };
    const byKey = index([here, nextWeek, gone]);
    const group = { childKeys: [here.key, nextWeek.key, gone.key], servantKeys: [] };

    // Week one: only the girl who is actually at camp and not withdrawn.
    expect(campGroupMetrics(group, byKey, 1, 'elementary').childGender).toEqual({
      male: 0,
      female: 1,
      unknown: 0,
    });
    // Week two: the other girl, and nobody else.
    expect(campGroupMetrics(group, byKey, 2, 'elementary').childGender).toEqual({
      male: 0,
      female: 1,
      unknown: 0,
    });
  });

  it('reads a station the same way, servants only', () => {
    const sporty = { ...wisher('reg-s1', 1, 'elementary', ['Sports']), gender: 'male' as const };
    const cook = { ...wisher('reg-s2', 1, 'elementary', ['Kitchen']), gender: 'female' as const };
    const metrics = campStationMetrics(
      { name: 'Sports', servantKeys: [sporty.key, cook.key] },
      index([sporty, cook]),
      1,
      'elementary',
    );
    expect(metrics.servantGender).toEqual({ male: 1, female: 1, unknown: 0 });
    // No child is ever on a station, so its children's split is always empty.
    expect(campSplitEmpty(metrics.childGender)).toBe(true);
  });

  it('splits a waiting list the same way a crew is split', () => {
    // What the two rails show. Same rules as `measure`: this week, and nobody
    // withdrawn, so the tally under a rail and the tallies on the cards below
    // it are taken on the same terms.
    const people = [
      sexed('b1', 'male'),
      sexed('g1', 'female'),
      sexed('x1', ''),
      { ...sexed('b2', 'male'), withdrawn: true },
      sexed('g2', 'female', 2),
    ];
    expect(campGenderSplit(people, 1)).toEqual({ male: 1, female: 1, unknown: 1 });
    expect(campGenderSplit(people, 2)).toEqual({ male: 0, female: 1, unknown: 0 });
    expect(campSplitEmpty(campGenderSplit(people, 3))).toBe(true);
  });

  it('carries the answer off both kinds of registration', () => {
    const [child] = campPeople([
      family('reg-1', [{ id: 'c1', name: 'Mariam', grade: '3', gender: 'female' }]),
    ]);
    expect(child!.gender).toBe('female');

    const row = servantRow('reg-s1', 'Peter');
    const [servant] = campPeople([
      { ...row, servant: { ...row.servant!, gender: 'male' } },
    ]);
    expect(servant!.gender).toBe('male');
  });
});

/* ---- who is here this week ----------------------------------------------- */

describe('campDaysInWeek and campComesInWeek', () => {
  it('counts the days of one week only', () => {
    const person = { days: [...campWeekKeys(1).slice(0, 3), ...campWeekKeys(2)] };
    expect(campDaysInWeek(person, 1)).toBe(3);
    expect(campDaysInWeek(person, 2)).toBe(5);
    expect(campDaysInWeek(person, 3)).toBe(0);
  });

  it('treats a registration with no days at all as coming, not as absent', () => {
    // An unfinished registration is a thing to fix, not a person to hide. The
    // chip says "no days" and they stay offered in every week.
    expect(campComesInWeek({ days: [] }, 1)).toBe(true);
    expect(campComesInWeek({ days: campWeekKeys(1) }, 2)).toBe(false);
  });
});

describe('mergeGroups', () => {
  /** One band with two crews, each holding a child and a servant. */
  function board() {
    return {
      season: '2027',
      programId: 'p',
      weeks: [
        {
          week: 1,
          bands: [
            {
              ...blankBand('3rd & 4th grade'),
              id: 'b-34',
              grades: ['3' as const, '4' as const],
              groups: [
                {
                  ...blankGroup('Group 1'),
                  id: 'g-1',
                  childKeys: ['c-1'],
                  servantKeys: ['s-1'],
                  leaderKey: 's-1',
                  note: 'the hall',
                },
                {
                  ...blankGroup('Group 2'),
                  id: 'g-2',
                  childKeys: ['c-2'],
                  servantKeys: ['s-2'],
                  leaderKey: 's-2',
                  note: 'field 2',
                },
              ],
            },
            { ...blankBand('5th grade'), id: 'b-5', grades: ['5' as const], groups: [
              { ...blankGroup('Group 1'), id: 'g-3', childKeys: ['c-3'] },
            ] },
          ],
          stations: [],
        },
      ],
    };
  }

  it('keeps everybody, and the crew you dropped onto', () => {
    const next = mergeGroups(board(), 1, 'b-34', 'g-1', 'g-2');
    const groups = next.weeks[0]!.bands[0]!.groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe('g-1');
    expect(groups[0]!.childKeys).toEqual(['c-1', 'c-2']);
    expect(groups[0]!.servantKeys).toEqual(['s-1', 's-2']);
    // Two crews have two leaders and the joined one can only have the target's;
    // the other stays in the group as an ordinary servant.
    expect(groups[0]!.leaderKey).toBe('s-1');
    expect(groups[0]!.note).toBe('the hall · field 2');
  });

  it('refuses to reach across bands', () => {
    // A group is defined by the grades of the band around it, so joining across
    // bands would put children in a crew their grade is not allowed in.
    const start = board();
    expect(mergeGroups(start, 1, 'b-34', 'g-1', 'g-3')).toEqual(start);
    expect(mergeGroups(start, 1, 'b-34', 'g-1', 'g-1')).toBe(start);
  });

  it('does not duplicate somebody who is somehow in both', () => {
    const start = board();
    start.weeks[0]!.bands[0]!.groups[1]!.childKeys = ['c-1', 'c-2'];
    const groups = mergeGroups(start, 1, 'b-34', 'g-1', 'g-2').weeks[0]!.bands[0]!.groups;
    expect(groups[0]!.childKeys).toEqual(['c-1', 'c-2']);
  });
});

describe('bandOfGroup', () => {
  it('finds the band a crew belongs to, and nothing for a stranger', () => {
    const week = {
      week: 1,
      bands: [
        { ...blankBand('K'), id: 'b-k', grades: ['k' as const], groups: [{ ...blankGroup('Group 1'), id: 'g-1' }] },
      ],
      stations: [],
    };
    expect(bandOfGroup(week, 'g-1')?.id).toBe('b-k');
    expect(bandOfGroup(week, 'nope')).toBeNull();
  });
});

describe('campCanPlace', () => {
  const board = {
    week: 1,
    bands: [
      { ...blankBand('Kindergarten'), id: 'b-k', grades: ['k' as const], groups: [blankGroup('Group 1')] },
      {
        ...blankBand('2nd & 3rd grade'),
        id: 'b-23',
        grades: ['2' as const, '3' as const],
        groups: [blankGroup('Group 1')],
      },
    ],
    stations: [{ ...blankStation('Sports', 'teal'), id: 's-1' }],
  };
  const kGroup = { kind: 'group' as const, bandId: 'b-k', groupId: board.bands[0]!.groups[0]!.id };
  const bigGroup = { kind: 'group' as const, bandId: 'b-23', groupId: board.bands[1]!.groups[0]!.id };
  const station = { kind: 'station' as const, stationId: 's-1' };

  const child = (grade: CampGrade | null) => ({ kind: 'child' as const, grade });
  const servant = { kind: 'servant' as const, grade: null };

  it('only lets a child into a group whose band covers their grade', () => {
    expect(campCanPlace(child('k'), board, kGroup)).toBe(true);
    // The whole point: a 5th grader in a Kindergarten crew is only noticed on
    // the Monday morning.
    expect(campCanPlace(child('5'), board, kGroup)).toBe(false);
    expect(campCanPlace(child('2'), board, bigGroup)).toBe(true);
    expect(campCanPlace(child('3'), board, bigGroup)).toBe(true);
    expect(campCanPlace(child('4'), board, bigGroup)).toBe(false);
  });

  it('refuses a child with no grade recorded, rather than guessing one', () => {
    expect(campCanPlace(child(null), board, kGroup)).toBe(false);
  });

  it('keeps children off stations and lets servants go anywhere', () => {
    expect(campCanPlace(child('k'), board, station)).toBe(false);
    expect(campCanPlace(servant, board, station)).toBe(true);
    // A servant is allocated by half and by what they asked for, never by
    // grade — so no group is closed to them.
    expect(campCanPlace(servant, board, kGroup)).toBe(true);
    expect(campCanPlace(servant, board, bigGroup)).toBe(true);
  });

  it('always takes somebody back out', () => {
    // Undoing a placement that should never have happened must not itself be
    // refused, or a bad board could not be fixed.
    expect(campCanPlace(child('5'), board, null)).toBe(true);
    expect(campCanPlace(child(null), board, null)).toBe(true);
  });

  it('refuses a group whose band is not on this board', () => {
    expect(campCanPlace(child('k'), board, { kind: 'group', bandId: 'gone', groupId: 'g' })).toBe(
      false,
    );
  });
});

describe('campMisplacedChildren', () => {
  it('finds children a board already has in the wrong grade', () => {
    const people = campPeople([
      family('reg-1', [
        { id: 'a', name: 'A', grade: 'k' },
        { id: 'b', name: 'B', grade: '5' },
        { id: 'c', name: 'C', grade: null },
      ]),
    ]);
    const byKey = index(people);
    const keys = people.map((person) => person.key);
    const board = {
      week: 1,
      bands: [
        {
          ...blankBand('Kindergarten'),
          id: 'b-k',
          grades: ['k' as const],
          groups: [{ ...blankGroup('Group 1'), childKeys: keys }],
        },
      ],
      stations: [],
    };
    // The rule is enforced on new placements; the ones already in the document
    // have to be shown rather than silently tolerated — including the child
    // with no grade recorded, who cannot be said to be in the right place.
    expect([...campMisplacedChildren(board, byKey)].sort()).toEqual([keys[1], keys[2]].sort());
  });
});

describe('campReliability', () => {
  /** A servant with a given set of day keys. Only the five fields it reads. */
  function servant(days: string[], extra: Partial<{ availability: string; withdrawn: boolean }> = {}) {
    return {
      kind: 'servant' as const,
      days,
      availability: '',
      withdrawn: false,
      ...extra,
    };
  }

  it('reads the level off how much of that week they are there for', () => {
    expect(campReliability(servant(campWeekKeys(1)), 1)?.level).toBe('full');
    expect(campReliability(servant(campWeekKeys(1).slice(0, 4)), 1)?.level).toBe('high');
    expect(campReliability(servant(campWeekKeys(1).slice(0, 3)), 1)?.level).toBe('some');
    expect(campReliability(servant(campWeekKeys(1).slice(0, 2)), 1)?.level).toBe('some');
    expect(campReliability(servant(campWeekKeys(1).slice(0, 1)), 1)?.level).toBe('low');
  });

  it('is per week, not per summer', () => {
    // The whole reason this takes a week: five days of week 2 says nothing
    // about week 1, and a board that showed the summer's total would offer
    // somebody as a five-day crew leader in a week they are not at camp.
    const only2 = servant(campWeekKeys(2));
    expect(campReliability(only2, 1)?.level).toBe('none');
    expect(campReliability(only2, 2)?.level).toBe('full');
  });

  it('separates "no days given" from "no days this week"', () => {
    // An empty `days` is an unfinished registration, not an unreliable person.
    // Colouring it red says something about somebody that is only true of a
    // form, so it is its own level and it is grey.
    expect(campReliability(servant([]), 1)?.level).toBe('unknown');
    expect(campReliability(servant([]), 1)?.label).toBe('days not given');
    expect(campReliability(servant(campWeekKeys(2)), 1)?.label).toBe('not this week');
  });

  it('keeps the availability note out of the level', () => {
    // "Mornings only" is a *shape* of availability, not an amount of it, so it
    // is a flag beside the reading rather than a step down it. A safeguarding
    // flag used to sit beside it too and went with the field it read — see
    // `CampServantDetails`.
    const noted = campReliability(servant(campWeekKeys(1), { availability: 'mornings only' }), 1);
    expect(noted?.level).toBe('full');
    expect(noted?.noteFlag).toBe(true);
    expect(noted?.detail).toContain('mornings only');
  });

  it('has no reading for a child', () => {
    expect(
      campReliability(
        { kind: 'child', days: campWeekKeys(1), availability: '', withdrawn: false },
        1,
      ),
    ).toBeNull();
  });
});

describe('colours', () => {
  it('hands out an unused one, then cycles rather than refusing', () => {
    expect(nextCampColour([])).toBe(CAMP_COLOURS[0]!.value);
    expect(nextCampColour([CAMP_COLOURS[0]!.value])).toBe(CAMP_COLOURS[1]!.value);

    const all = CAMP_COLOURS.map((colour) => colour.value);
    // A thirteenth band gets a repeat, not an exception. A band that cannot be
    // created is worse than two bands sharing a colour.
    expect(all).toContain(nextCampColour(all));
  });

  /**
   * A band starts with **no** colour, and an unknown stored one reads as none.
   *
   * The old behaviour was to fall back to blue, which was defensible while
   * every band was coloured on creation and is wrong now that none are: a
   * document saying `chartreuse` is a document that has been hand-edited, and
   * answering "blue" invents a colour the camp may have given to somebody else.
   * `null` is the honest answer and the screen already draws it.
   */
  it('reads a band with no colour, or an unknown one, as having none', () => {
    const parsed = parseCampAllocation({
      season: '2027',
      bands: [
        { id: 'b', name: 'A', colour: 'chartreuse', groups: [] },
        { id: 'c', name: 'B', groups: [] },
        { id: 'd', name: 'C', colour: 'violet', groups: [] },
      ],
    });
    expect(bandsOf(parsed).map((band) => band.colour)).toEqual([null, null, 'violet']);
    // A station keeps its fallback: unlike a band it is not what a child's
    // wristband says, and its colour only keeps the export's rows apart.
    expect(CAMP_COLOURS.map((colour) => colour.value)).toContain(
      stationsOf(
        parseCampAllocation({
          season: '2027',
          stations: [{ id: 's', name: 'Sports', colour: 'chartreuse' }],
        }),
      )[0]!.colour,
    );
  });

  it('makes a band with no colour unless one is asked for', () => {
    expect(blankBand('3rd grade', ['3']).colour).toBeNull();
    expect(blankBand('3rd grade', ['3'], 'violet').colour).toBe('violet');
  });

  it('draws an uncoloured band in the grey, and a coloured one in its own', () => {
    expect(campColourOf(null)).toEqual(CAMP_UNCOLOURED);
    expect(campColourOf('violet').hex).toBe(campColour('violet').hex);
    // The grey must not be pickable, or it becomes a thirteenth colour.
    expect(CAMP_COLOURS.map((colour) => colour.hex)).not.toContain(CAMP_UNCOLOURED.hex);
  });
});

/* ---- the two halves ----------------------------------------------------- */

/**
 * Which band belongs on which of the two swiped screens, and which grades have
 * no band at all.
 *
 * These three decide *what is on the strip*, which is the whole of the fourth
 * design's promise that every grade is present. The failure they guard against
 * is silent in both directions: a band drawn on neither screen is unreachable
 * and its children cannot be moved, and a grade that stops being offered is a
 * grade nobody notices is unallocated until July.
 */
describe('splitting the board into elementary and middle school', () => {
  it('puts each band under the half its grades are in', () => {
    const lower = bandWith('3rd & 4th grade', ['3', '4'], 1);
    const upper = bandWith('7th grade', ['7'], 1);
    const bands = [lower, upper];

    expect(bandsInSection(bands, 'elementary').map((band) => band.id)).toEqual([lower.id]);
    expect(bandsInSection(bands, 'middle-school').map((band) => band.id)).toEqual([upper.id]);
  });

  it('orders the strip by grade, not by position in the document', () => {
    const fifth = bandWith('5th grade', ['5'], 0);
    const kinder = bandWith('Kindergarten', ['k'], 0);
    const second = bandWith('2nd grade', ['2'], 0);

    expect(bandsInSection([fifth, kinder, second], 'elementary').map((band) => band.name)).toEqual([
      'Kindergarten',
      '2nd grade',
      '5th grade',
    ]);
  });

  it('shows a band that straddles the halves on both, and says so', () => {
    const straddling = bandWith('5th & 6th', ['5', '6'], 1);
    expect(bandStraddles(straddling)).toBe(true);
    expect(bandsInSection([straddling], 'elementary')).toHaveLength(1);
    expect(bandsInSection([straddling], 'middle-school')).toHaveLength(1);
  });

  it('shows a band with no grades under elementary rather than nowhere', () => {
    const loose = bandWith('Leftovers', [], 1);
    expect(bandsInSection([loose], 'elementary')).toHaveLength(1);
    expect(bandsInSection([loose], 'middle-school')).toHaveLength(0);
  });

  it('offers every grade of a half that no band covers', () => {
    expect(uncoveredGrades([], 'elementary')).toEqual(['k', '1', '2', '3', '4', '5']);
    expect(uncoveredGrades([], 'middle-school')).toEqual(['6', '7', '8']);

    const bands = [bandWith('K & 1st', ['k', '1'], 0), bandWith('4th grade', ['4'], 0)];
    expect(uncoveredGrades(bands, 'elementary')).toEqual(['2', '3', '5']);
    // The other half is untouched by a band in this one.
    expect(uncoveredGrades(bands, 'middle-school')).toEqual(['6', '7', '8']);
  });

  it('finds the band holding a grade, and none for a grade nobody covers', () => {
    const band = bandWith('3rd & 4th grade', ['3', '4'], 0);
    expect(bandForGrade([band], '4')?.id).toBe(band.id);
    expect(bandForGrade([band], '5')).toBeNull();
  });
});

/* ---- grouping grades together ------------------------------------------- */

/**
 * Grouping grades is editing one band's set of them, and the interesting half
 * of the work is the band that just *lost* one.
 *
 * A grade left in two bands offers the same children in two places, which is
 * the one state the pool filter cannot make sense of — so `setBandGrades` takes
 * it off everybody else. What it must not do is tip children onto the waiting
 * list as a side effect of a tick.
 */
describe('setBandGrades', () => {
  it('takes the grade off the band that had it, and deletes that band when it is empty', () => {
    const third = bandWith('3rd grade', ['3'], 1);
    const fourth = bandWith('4th grade', ['4'], 1);
    const board = setBandGrades(boardOf(third, fourth), 1, third.id, ['3', '4']);

    expect(bandsOf(board)).toHaveLength(1);
    expect(bandsOf(board)[0]!.grades).toEqual(['3', '4']);
    // The name was ours — "3rd grade" is exactly `suggestBandName(['3'])` — so
    // it follows the grades.
    expect(bandsOf(board)[0]!.name).toBe('3rd & 4th grade');
  });

  it('keeps a band it emptied of grades when somebody is still in it', () => {
    const third = bandWith('3rd grade', ['3'], 1);
    const fourth = bandWith('4th grade', ['4'], 1);
    const key = childKey('reg-1', 'child-1');
    fourth.groups[0]!.childKeys = [key];

    const board = setBandGrades(boardOf(third, fourth), 1, third.id, ['3', '4']);

    expect(bandsOf(board)).toHaveLength(2);
    const left = bandsOf(board).find((band) => band.id === fourth.id)!;
    expect(left.grades).toEqual([]);
    // The child stayed exactly where they were. A checkbox may not empty a
    // group.
    expect(left.groups[0]!.childKeys).toEqual([key]);
  });

  it('never renames a name the camp typed', () => {
    const band = bandWith('The Cherubim', ['3'], 0);
    const board = setBandGrades(boardOf(band), 1, band.id, ['3', '4']);
    expect(bandsOf(board)[0]!.name).toBe('The Cherubim');
  });

  it('puts the grades in canonical order however they arrive', () => {
    const band = bandWith('3rd grade', ['3'], 0);
    const board = setBandGrades(boardOf(band), 1, band.id, ['4', 'k', '3']);
    expect(bandsOf(board)[0]!.grades).toEqual(['k', '3', '4']);
  });

  it('leaves the board alone for a band it does not have', () => {
    const board = boardOf(bandWith('3rd grade', ['3'], 0));
    expect(setBandGrades(board, 1, 'band-nope', ['4'])).toStrictEqual(board);
  });
});

/* ---- panels ------------------------------------------------------------- */

/**
 * The three questions the accordion asks of a panel, and one it must refuse.
 *
 * These are pure and tiny and would still be worth a test, because between them
 * they decide *which of nine lists a person appears in* — and the failure mode
 * is not an exception, it is a child quietly offered in two panels at once, or
 * a servant offered in none. Neither shows up as a crash; both show up in July
 * as a group that is one child short.
 */
describe('panels', () => {
  it('files a panel under the half of the camp its grades belong to', () => {
    expect(panelSection(['k'])).toBe('elementary');
    expect(panelSection(['3', '4'])).toBe('elementary');
    expect(panelSection(['7', '8'])).toBe('middle-school');
  });

  it('refuses to file a panel that straddles the two halves, or covers nothing', () => {
    // The screen will not build one of these — the grade picker offers a
    // panel's own section only — but a document can hold one, and guessing
    // would put eighth graders under the elementary heading.
    expect(panelSection(['5', '6'])).toBeNull();
    expect(panelSection([])).toBeNull();
    // Grade 9 is in neither section, so a panel of it belongs to neither.
    expect(panelSection(['9'])).toBeNull();
  });

  it('offers a child by grade and a servant by the half they volunteered for', () => {
    const child = { kind: 'child' as const, grade: '3' as CampGrade, sections: [] };
    const elementary = {
      kind: 'servant' as const,
      grade: null,
      sections: ['elementary' as const],
    };
    const either = {
      kind: 'servant' as const,
      grade: null,
      sections: ['elementary' as const, 'middle-school' as const],
    };
    const neither = { kind: 'servant' as const, grade: null, sections: [] };

    expect(eligibleForPanel(child, ['3'])).toBe(true);
    expect(eligibleForPanel(child, ['3', '4'])).toBe(true);
    expect(eligibleForPanel(child, ['4'])).toBe(false);

    // One elementary servant, offered in all six elementary panels at once.
    // That is not a bug and it is why placement has to be exclusive: putting
    // them in 3rd grade takes them out of the other five lists.
    for (const grade of campGradesForSection('elementary')) {
      expect(eligibleForPanel(elementary, [grade])).toBe(true);
    }
    expect(eligibleForPanel(elementary, ['7'])).toBe(false);
    expect(eligibleForPanel(either, ['7'])).toBe(true);
    expect(eligibleForPanel(neither, ['3'])).toBe(false);
  });

  it('opens a season with one panel per grade, K to 8th, and no others', () => {
    const panels = starterPanels();
    expect(panels).toHaveLength(9);
    expect(panels.map((panel) => panel.name)).toEqual([
      'Kindergarten',
      '1st grade',
      '2nd grade',
      '3rd grade',
      '4th grade',
      '5th grade',
      '6th grade',
      '7th grade',
      '8th grade',
    ]);
    // One grade each, and every grade exactly once: two panels listing 4th
    // grade would offer the same ten children twice, and the emptying list
    // would stop counting down.
    const seen = panels.flatMap((panel) => panel.grades);
    expect(seen).toEqual(['k', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

/* ---- merging, splitting, leading and weeks ------------------------------ */

describe('naming a new group', () => {
  /**
   * "Add a group" adds `blankGroup(suggestGroupName(band.groups))` to the panel
   * the button sits on, so three clicks in a row is the sequence below: each
   * name is computed against the panel the click before it left behind.
   *
   * It used to be `groups.length + 1`, which counted, and the duplicates in the
   * stored season came from `mergePanels` instead — but the length is the wrong
   * question either way, and asking it here is what the register depends on.
   */
  it('counts the panel it is joining, so three added in a row read 1, 2, 3', () => {
    let band = blankBand('3rd grade', ['3'], 'blue');
    const offered: string[] = [];

    for (let click = 0; click < 3; click += 1) {
      const name = suggestGroupName(band.groups);
      offered.push(name);
      band = { ...band, groups: [...band.groups, blankGroup(name)] };
    }

    expect(offered).toEqual(['Group 1', 'Group 2', 'Group 3']);
    expect(band.groups.map((group) => group.name)).toEqual([
      'Group 1',
      'Group 2',
      'Group 3',
    ]);
    // The point of the whole exercise: the register can tell them apart.
    expect(new Set(band.groups.map((group) => group.name)).size).toBe(3);
  });

  it('takes the lowest free number, so a deleted middle group gets its gap back', () => {
    const band = bandWith('3rd grade', ['3'], 3);
    expect(suggestGroupName([band.groups[0]!, band.groups[2]!])).toBe('Group 2');
  });

  it('offers Group 1 to a panel whose only group the camp has renamed', () => {
    // `length + 1` said "Group 2" on a panel that has no Group 1.
    expect(suggestGroupName([blankGroup('Cherubim')])).toBe('Group 1');
  });

  it('is not fooled by the whitespace a renamed group picks up', () => {
    expect(suggestGroupName([blankGroup('Group 1 ')])).toBe('Group 2');
  });

  it('never runs out below the cap', () => {
    const band = bandWith('3rd grade', ['3'], MAX_GROUPS_PER_BAND - 1);
    expect(suggestGroupName(band.groups)).toBe(`Group ${MAX_GROUPS_PER_BAND}`);
  });
});

describe('leaders', () => {
  const station = () => {
    const built = blankStation('Sports', 'teal', 'elementary');
    built.id = id('station');
    return built;
  };

  it('marks a servant who is in the group, and refuses one who is not', () => {
    const band = bandWith('3rd grade', ['3'], 1);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    let board = boardOf(band);
    board = placeServant(board, 1, 'reg-s1', target);

    board = setLeader(board, 1, target, 'reg-s2');
    expect(bandsOf(board)[0]!.groups[0]!.leaderKey).toBe('');

    board = setLeader(board, 1, target, 'reg-s1');
    expect(bandsOf(board)[0]!.groups[0]!.leaderKey).toBe('reg-s1');

    // Clicking the leader again takes the mark off.
    board = setLeader(board, 1, target, 'reg-s1');
    expect(bandsOf(board)[0]!.groups[0]!.leaderKey).toBe('');
  });

  /*
   * The claim the whole design rests on: "group leader or station leader, but
   * only one" needs no rule of its own, because a servant is in one place per
   * week and leading is something about the place they are in.
   */
  it('gives up leading a group the moment the leader is moved to a station', () => {
    const band = bandWith('3rd grade', ['3'], 1);
    const post = station();
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    let board = weeksOf({ week: 1, bands: [band], stations: [post] });

    board = placeServant(board, 1, 'reg-s1', target);
    board = setLeader(board, 1, target, 'reg-s1');
    expect(bandsOf(board)[0]!.groups[0]!.leaderKey).toBe('reg-s1');

    board = placeServant(board, 1, 'reg-s1', { kind: 'station', stationId: post.id });
    expect(bandsOf(board)[0]!.groups[0]!.servantKeys).toEqual([]);
    expect(bandsOf(board)[0]!.groups[0]!.leaderKey).toBe('');
    // They can lead the station instead, and that is one leadership, not two.
    board = setLeader(board, 1, { kind: 'station', stationId: post.id }, 'reg-s1');
    expect(stationsOf(board)[0]!.leaderKey).toBe('reg-s1');
  });

  it('drops a leader who matches nobody, along with the placement', () => {
    const band = bandWith('3rd grade', ['3'], 1);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    let board = boardOf(band);
    board = placeServant(board, 1, 'reg-gone', target);
    board = setLeader(board, 1, target, 'reg-gone');

    const cleared = dropDangling(board, []);
    expect(bandsOf(cleared)[0]!.groups[0]!.leaderKey).toBe('');
  });

  it('refuses a stored leader who is not in the list beside them', () => {
    const parsed = parseCampAllocation({
      programId: 'summercamp',
      season: '2027',
      weeks: [
        {
          week: 1,
          bands: [
            {
              id: 'b1',
              name: 'A',
              grades: ['3'],
              colour: 'green',
              groups: [
                {
                  id: 'g1',
                  name: 'One',
                  colour: 'green',
                  childKeys: [],
                  servantKeys: ['reg-s1'],
                  // Somebody who is not on this group at all.
                  leaderKey: 'reg-s9',
                },
              ],
            },
          ],
          stations: [],
        },
      ],
    });

    expect(bandsOf(parsed)[0]!.groups[0]!.leaderKey).toBe('');
  });
});
