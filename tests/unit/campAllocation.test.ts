import { describe, expect, it } from 'vitest';
import {
  CAMP_COLOURS,
  MAX_GROUPS_PER_BAND,
  blankBand,
  blankGroup,
  blankRegistration,
  blankStation,
  campGradesForSection,
  campPeople,
  childKey,
  countPlacements,
  dealBand,
  dropDangling,
  eligibleForPanel,
  groupNameUpdates,
  nextCampColour,
  panelSection,
  parseCampAllocation,
  parsePersonKey,
  placeChild,
  placeServant,
  resolveAllocation,
  setLeader,
  starterPanels,
  suggestBandName,
  suggestGroupName,
  type CampAllocationDraft,
  type CampGrade,
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
  children: { id: string; name: string; grade: CampGrade }[],
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
      shirtSize: 'YM' as const,
      days: [],
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
function boardOf(...bands: ReturnType<typeof bandWith>[]): CampAllocationDraft {
  return {
    programId: 'summercamp',
    season: '2027',
    bands,
    stations: [],
    archivedAt: null,
    archivedBy: null,
    note: '',
  };
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
    board = placeChild(board, key, { kind: 'group', bandId: band.id, groupId: first!.id });
    board = placeChild(board, key, { kind: 'group', bandId: band.id, groupId: second!.id });

    expect(board.bands[0]!.groups[0]!.childKeys).toEqual([]);
    expect(board.bands[0]!.groups[1]!.childKeys).toEqual([key]);
    expect(countPlacements(docOf(board))).toBe(1);
  });

  it('dropping a child on the group they are already in reorders rather than duplicates', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    const a = childKey('reg-1', 'a');
    const b = childKey('reg-1', 'b');

    let board = boardOf(band);
    board = placeChild(board, a, target);
    board = placeChild(board, b, target);
    expect(board.bands[0]!.groups[0]!.childKeys).toEqual([a, b]);

    board = placeChild(board, b, target, 0);
    expect(board.bands[0]!.groups[0]!.childKeys).toEqual([b, a]);
  });

  it('a servant moved from a group to a station leaves the group', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const station = blankStation('Sports', 'teal');
    station.id = id('station');
    const key = 'reg-servant-1';

    let board: CampWeekBoard = { ...boardOf(band), stations: [station] };
    board = placeServant(board, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });
    expect(board.bands[0]!.groups[0]!.servantKeys).toEqual([key]);

    board = placeServant(board, key, { kind: 'station', stationId: station.id });
    expect(board.bands[0]!.groups[0]!.servantKeys).toEqual([]);
    expect(board.stations[0]!.servantKeys).toEqual([key]);
    expect(countPlacements(docOf(board))).toBe(1);
  });

  it('a null target is the pool, and empties every list', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const key = childKey('reg-1', 'child-1');

    let board = boardOf(band);
    board = placeChild(board, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });
    board = placeChild(board, key, null);

    expect(countPlacements(docOf(board))).toBe(0);
  });

  it('refuses a child on a station outright', () => {
    const station = blankStation('Sports', 'teal');
    station.id = id('station');
    const board: CampWeekBoard = { week: 1, bands: [], stations: [station] };

    const after = placeChild(board, childKey('reg-1', 'child-1'), {
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

    expect(parsed.bands[0]!.groups[0]!.childKeys).toEqual([key]);
    expect(parsed.bands[0]!.groups[1]!.childKeys).toEqual([]);
    expect(parsed.bands[0]!.groups[0]!.servantKeys).toEqual([servant]);
    expect(parsed.bands[0]!.groups[1]!.servantKeys).toEqual([]);
    expect(parsed.stations[0]!.servantKeys).toEqual([]);
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

    expect(parsed.bands[0]!.groups[0]!.childKeys).toEqual([]);
    expect(parsed.bands[0]!.groups[0]!.servantKeys).toEqual([]);
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
    const resolved = resolveAllocation(boardOf(), people);
    expect(resolved.freeChildren).toHaveLength(3);
    expect(resolved.freeServants).toHaveLength(1);
  });

  it('takes somebody out of the pool the moment they are placed', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    let board = boardOf(band);
    board = placeChild(board, childKey('reg-1', 'c1'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[0]!.id,
    });

    const resolved = resolveAllocation(board, people);
    expect(resolved.freeChildren.map((person) => person.name)).toEqual(['Peter Test', 'Anne Test']);
    expect(resolved.placement.has(childKey('reg-1', 'c1'))).toBe(true);
  });

  it('flags a child placed outside their band’s grades without refusing them', () => {
    const band = bandWith('3rd & 4th', ['3', '4'], 1);
    const key = childKey('reg-2', 'c3'); // Anne is entering 7th.
    let board = boardOf(band);
    board = placeChild(board, key, { kind: 'group', bandId: band.id, groupId: band.groups[0]!.id });

    const resolved = resolveAllocation(board, people);
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
    board = placeChild(board, childKey('reg-gone', 'c9'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[0]!.id,
    });

    const resolved = resolveAllocation(board, people);
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

    const dealt = dealBand(boardOf(band), band.id, people);
    const sizes = dealt.bands[0]!.groups.map((group) => group.childKeys.length);
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
    board = placeChild(board, childKey('reg-1', 'c1'), {
      kind: 'group',
      bandId: band.id,
      groupId: band.groups[1]!.id,
    });

    const dealt = dealBand(board, band.id, people);
    expect(dealt.bands[0]!.groups[1]!.childKeys).toContain(childKey('reg-1', 'c1'));
    expect(dealt.bands[0]!.groups[0]!.childKeys).toEqual([childKey('reg-1', 'c2')]);
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

    const dealt = dealBand(boardOf(band), band.id, people);
    expect(dealt.bands[0]!.groups[0]!.childKeys).toEqual([childKey('reg-1', 'c1')]);
  });

  it('skips a withdrawn child', () => {
    const withdrawn = family('reg-1', [{ id: 'c1', name: 'A', grade: '3' }]);
    withdrawn.status = 'withdrawn';
    const people = campPeople([withdrawn]);
    const band = bandWith('3rd & 4th', ['3', '4'], 1);

    const dealt = dealBand(boardOf(band), band.id, people);
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
    board = placeChild(board, childKey('reg-1', 'c1'), target);
    board = placeChild(board, childKey('reg-1', 'c2'), target);

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
    expect(parsed.bands[0]!.groups).toHaveLength(MAX_GROUPS_PER_BAND);
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

  it('falls back to a known colour when the stored one is not one of ours', () => {
    const parsed = parseCampAllocation({
      season: '2027',
      bands: [{ id: 'b', name: 'A', colour: 'chartreuse', groups: [] }],
    });
    expect(CAMP_COLOURS.map((colour) => colour.value)).toContain(parsed.bands[0]!.colour);
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
    board = placeServant(board, 'reg-s1', target);

    board = setLeader(board, target, 'reg-s2');
    expect(board.bands[0]!.groups[0]!.leaderKey).toBe('');

    board = setLeader(board, target, 'reg-s1');
    expect(board.bands[0]!.groups[0]!.leaderKey).toBe('reg-s1');

    // Clicking the leader again takes the mark off.
    board = setLeader(board, target, 'reg-s1');
    expect(board.bands[0]!.groups[0]!.leaderKey).toBe('');
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
    let board: CampWeekBoard = { ...boardOf(band), stations: [post] };

    board = placeServant(board, 'reg-s1', target);
    board = setLeader(board, target, 'reg-s1');
    expect(board.bands[0]!.groups[0]!.leaderKey).toBe('reg-s1');

    board = placeServant(board, 'reg-s1', { kind: 'station', stationId: post.id });
    expect(board.bands[0]!.groups[0]!.servantKeys).toEqual([]);
    expect(board.bands[0]!.groups[0]!.leaderKey).toBe('');
    // They can lead the station instead, and that is one leadership, not two.
    board = setLeader(board, { kind: 'station', stationId: post.id }, 'reg-s1');
    expect(board.stations[0]!.leaderKey).toBe('reg-s1');
  });

  it('drops a leader who matches nobody, along with the placement', () => {
    const band = bandWith('3rd grade', ['3'], 1);
    const target = { kind: 'group' as const, bandId: band.id, groupId: band.groups[0]!.id };
    let board = boardOf(band);
    board = placeServant(board, 'reg-gone', target);
    board = setLeader(board, target, 'reg-gone');

    const cleared = dropDangling(board, []);
    expect(cleared.bands[0]!.groups[0]!.leaderKey).toBe('');
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

    expect(parsed.bands[0]!.groups[0]!.leaderKey).toBe('');
  });
});
