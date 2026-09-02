import {
  CAMP_GRADES,
  campGradeLabel,
  campSectionForGrade,
  campSectionLabel,
  shirtSizeLabel,
  type CampGrade,
  type CampRegistration,
  type ShirtSize,
} from '../schema/camp.js';
import {
  campColour,
  campPeople,
  type CampColour,
  resolveAllocation,
  type CampAllocationDraft,
  type CampPerson,
  type CampPersonKey,
} from '../schema/campAllocation.js';
import { buildXlsx, type CellValue, type Sheet } from '../xlsx.js';

/**
 * The camp's allocation, as a spreadsheet.
 *
 * ---------------------------------------------------------------------------
 * Why this is in `@spsm/shared` and not in the browser feature that calls it.
 *
 * Because it has two callers and will keep having two. The export button on
 * /admin/camp-allocation builds these bytes and hands them to a download; the
 * OneDrive upload builds the same bytes in a Cloud Function and PUTs them at
 * Microsoft Graph. If the sheet layout lived next to the button, the Function
 * would grow its own copy, and the file the church opens from OneDrive would
 * quietly stop matching the one somebody downloaded — with no test able to say
 * which was right.
 *
 * So: this module knows the layout, and nothing else. It touches no Firestore
 * and no network. `campAllocationWorkbook` takes the two documents and returns
 * bytes.
 *
 * ## What is in the file
 *
 * Five sheets, in the order somebody working from it needs them:
 *
 *   Groups          one row per child — the roster, colour-banded by group
 *   Group servants  who is with each group
 *   Stations        who is running what
 *   Unassigned      everybody not yet placed, which is the working list
 *   Summary         counts by band, group, grade and section
 *
 * ## It contains allergies and medical notes, on purpose
 *
 * That is what a group roster is *for* — the servant holding the sheet is the
 * person who needs to know before lunch. It also means the exported file is the
 * most sensitive thing this site produces, and once it is in OneDrive this
 * codebase has no further say over who opens it. The workbook says so in its
 * own first sheet rather than leaving it for somebody to notice; that line is
 * not decoration and should not be removed to tidy the header up.
 * ---------------------------------------------------------------------------
 */

export interface AllocationWorkbookInput {
  allocation: CampAllocationDraft;
  registrations: readonly (CampRegistration & { id: string })[];
  /** For the header line. Defaults to now. */
  generatedAt?: Date;
  /** Name of whoever pressed the button, for the header line. */
  generatedBy?: string;
}

/** The filename to save under: `camp-allocation-2027-2026-08-30.xlsx`. */
export function allocationWorkbookName(season: string, at: Date = new Date()): string {
  const day = at.toISOString().slice(0, 10);
  const safe = season.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'season';
  return `camp-allocation-${safe}-${day}.xlsx`;
}

export function campAllocationWorkbook(input: AllocationWorkbookInput): Uint8Array {
  return buildXlsx(campAllocationSheets(input));
}

/**
 * The sheets, before they are zipped.
 *
 * Exported separately from `campAllocationWorkbook` because this is the part
 * worth asserting on: a test that opens a zip to check a column heading is a
 * test about `xlsx.ts`, and a test that reads this array is a test about the
 * roster.
 */
export function campAllocationSheets(input: AllocationWorkbookInput): Sheet[] {
  const { allocation, registrations } = input;
  const generatedAt = input.generatedAt ?? new Date();

  const people = campPeople(registrations);

  /*
   * One resolution for the whole camp, computed once and handed to every sheet.
   *
   * This was one per week, and every sheet led with a Week column repeating
   * each child once per week of camp. With one arrangement for the season that
   * duplication says nothing: a child is in one group, and *which weeks they
   * come* is a fact about them rather than about the group, so it is a column
   * on their own row — "1, 2" — instead of two rows differing in one cell.
   */
  const resolved = resolveAllocation(allocation, people);

  /*
   * The season is on every tab name, not only in the filename and the summary.
   *
   * A tab called "Groups" tells whoever it was forwarded to nothing, and these
   * files are forwarded — printed, mailed, opened next June beside last June's.
   * `sanitiseSheetName` caps at 31 characters, which "Group servants 2027"
   * clears comfortably.
   */
  const year = allocation.season || 'season';

  return [
    groupsSheet(allocation, resolved, year),
    groupServantsSheet(allocation, resolved, year),
    stationsSheet(allocation, resolved, year),
    unassignedSheet(resolved, year),
    summarySheet(allocation, resolved, people, generatedAt, input.generatedBy ?? '', year),
  ];
}

type Resolved = ReturnType<typeof resolveAllocation>;

/**
 * A camp colour, watered down for a row fill.
 *
 * ---------------------------------------------------------------------------
 * The rosters used to be filled with the colour *itself* — sixteen columns of
 * #9E9D24 with black type on it, for two hundred rows. It carries the group,
 * which is the point, and it is unreadable and unprintable, which is not: a
 * saturated fill behind body text is the single most common way a coloured
 * spreadsheet ends up being re-made by hand in black and white.
 *
 * Two strengths rather than one, alternating per group inside a panel. Every
 * group of 3rd & 4th grade now shares one colour, so a panel would otherwise be
 * one unbroken block of thirty rows with the group only named in column C;
 * banding puts a visible seam at each group boundary while keeping the panel
 * obviously one thing.
 * ---------------------------------------------------------------------------
 */
function tint(hex: string, strength: number): string {
  const value = hex.replace('#', '');
  const mix = (start: number) => {
    const channel = parseInt(value.slice(start, start + 2), 16);
    return Math.round(channel * strength + 255 * (1 - strength));
  };
  return [mix(0), mix(2), mix(4)]
    .map((channel) => channel.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/** The two strengths a group's rows alternate between. */
const BAND_STRENGTHS = [0.14, 0.26] as const;

function groupTint(hex: string, groupIndex: number): string {
  return tint(hex, BAND_STRENGTHS[groupIndex % BAND_STRENGTHS.length]!);
}

/**
 * Which weeks somebody is coming, from their registered days: "1, 2".
 *
 * The column that replaced the per-week rows. Empty when they have no days at
 * all, which is the state the `Flags` column calls out — a child in a group who
 * is registered for no day of camp is the mistake these sheets exist to catch.
 */
function weeksLabel(person: CampPerson): string {
  const weeks = new Set<number>();
  for (const day of person.days) {
    const match = /^w(\d+)-/.exec(day);
    if (match) weeks.add(Number(match[1]));
  }
  return [...weeks].sort((a, b) => a - b).join(', ');
}

/* ---------------------------------------------------------------------------
 * Groups — the roster
 * ------------------------------------------------------------------------ */

function groupsSheet(board: CampAllocationDraft, resolved: Resolved, year: string): Sheet {
  const rows: CellValue[][] = [];
  const fills: (string | null)[] = [];

  for (const band of board.bands) {
    for (const [groupIndex, group] of band.groups.entries()) {
      const hex = groupTint(campColour(band.colour).hex, groupIndex);
      const leader = group.leaderKey ? resolved.byKey.get(group.leaderKey)?.name ?? '' : '';
      const servants = group.servantKeys
        .map((key) => resolved.byKey.get(key)?.name)
        .filter(Boolean)
        .join(', ');

      /*
       * A group with no children in it still gets a row.
       *
       * It is the state somebody has to see: a group that was created and never
       * filled, or one a re-shuffle emptied. Skipping it makes the sheet agree
       * with itself and disagree with the screen, and the person reading the
       * spreadsheet is the one who cannot check.
       */
      if (group.childKeys.length === 0) {
        rows.push([
          '',
          band.name,
          group.name,
          campColour(band.colour).label,
          '(no children)',
          '', '', '', '', '', '', '', '', '',
          leader,
          servants,
          '',
        ]);
        fills.push(hex);
        continue;
      }

      for (const key of group.childKeys) {
        const person = resolved.byKey.get(key);
        if (!person) continue;
        rows.push(
          childRow(
            band.name,
            group.name,
            band.colour,
            person,
            leader,
            servants,
            resolved.offBand.includes(key),
          ),
        );
        fills.push(hex);
      }
    }
  }

  // Weeks, Panel, Group and Child stay put while the allergies and the
  // emergency contact are read off the right-hand end.
  return {
    name: `Groups ${year}`,
    columns: GROUP_COLUMNS,
    rows,
    rowFills: fills,
    freezeColumns: 5,
  };
}

/**
 * The roster's columns.
 *
 * Widths are spelled out rather than left to Excel's 8.43-character default,
 * because the two that matter most — allergies and medical notes — are
 * paragraphs. Unwidened, the roster prints as a wall of `####` and the one fact
 * the servant needed is the one they cannot see.
 */
const GROUP_COLUMNS = [
  { header: 'Weeks', width: 9 },
  { header: 'Panel', width: 18 },
  { header: 'Group', width: 18 },
  { header: 'Colour', width: 10 },
  { header: 'Child', width: 24 },
  { header: 'Grade', width: 14 },
  { header: 'Section', width: 14 },
  { header: 'Shirt', width: 16 },
  { header: 'Days', width: 24 },
  { header: 'Allergies', width: 30 },
  { header: 'Medical notes', width: 34 },
  { header: 'Guardian', width: 22 },
  { header: 'Phone', width: 16 },
  { header: 'Emergency contact', width: 26 },
  { header: 'Group leader', width: 22 },
  { header: 'Group servants', width: 26 },
  { header: 'Flags', width: 22 },
];

/**
 * One child's row on the roster.
 *
 * The `Flags` column exists so that the three things worth noticing are in one
 * place a servant can scan down, rather than spread across three columns they
 * would have to compare. "allergies" is repeated there even though the
 * allergies column is right beside it: that column holds a paragraph, and a
 * paragraph does not read as a warning at a glance.
 */
function childRow(
  bandName: string,
  groupName: string,
  colour: CampColour,
  person: CampPerson,
  leader: string,
  servants: string,
  offBand: boolean,
): CellValue[] {
  const flags: string[] = [];
  if (person.withdrawn) flags.push('WITHDRAWN');
  if (person.allergies.trim()) flags.push('allergies');
  if (offBand) flags.push('grade outside panel');
  // A child in a group who is registered for no day at all is the mistake this
  // sheet exists to catch, and it is invisible without saying so.
  if (person.days.length === 0) flags.push('no days registered');

  return [
    weeksLabel(person),
    bandName,
    groupName,
    campColour(colour).label,
    person.name,
    person.grade ? campGradeLabel(person.grade) : '',
    person.grade ? sectionLabelOf(person.grade) : '',
    person.shirtSize ? shirtSizeLabel(person.shirtSize as ShirtSize) : '',
    person.days.join(', '),
    person.allergies,
    person.medicalNotes,
    person.contactName,
    person.contactPhone,
    [person.emergencyName, person.emergencyPhone].filter(Boolean).join(' — '),
    leader,
    servants,
    flags.join('; '),
  ];
}

/** Elementary or middle school, or blank for grade 9 and above — which
    `campSectionForGrade` answers `null` for on purpose. */
function sectionLabelOf(grade: CampGrade): string {
  const section = campSectionForGrade(grade);
  return section ? campSectionLabel(section) : '';
}

/* ---------------------------------------------------------------------------
 * Group servants
 * ------------------------------------------------------------------------ */

function groupServantsSheet(board: CampAllocationDraft, resolved: Resolved, year: string): Sheet {
  const rows: CellValue[][] = [];
  const fills: (string | null)[] = [];

  for (const band of board.bands) {
    for (const [groupIndex, group] of band.groups.entries()) {
      const hex = groupTint(campColour(band.colour).hex, groupIndex);
      for (const key of group.servantKeys) {
        const person = resolved.byKey.get(key);
        if (!person) continue;
        const flags: string[] = [];
        if (person.withdrawn) flags.push('WITHDRAWN');
        if (person.days.length === 0) flags.push('no days chosen');
        rows.push([
          weeksLabel(person),
          band.name,
          group.name,
          campColour(band.colour).label,
          person.name,
          // Leader or not, in words. The whole point of the mark is that
          // somebody standing in a hall can tell who is in charge, and a
          // blank cell beside four names does that better than a TRUE.
          group.leaderKey === key ? 'LEADER' : '',
          person.age ?? '',
          person.contactPhone,
          person.contactEmail,
          person.roles.join(', '),
          // Written as words rather than TRUE/FALSE. A head servant scanning
          // this column for who still needs paperwork should not have to
          // remember which way round the boolean reads.
          person.cleared ? 'Cleared' : 'Not cleared',
          person.shirtSize ? shirtSizeLabel(person.shirtSize as never) : '',
          person.days.join(', '),
          person.availability,
          flags.join('; '),
        ]);
        fills.push(hex);
      }
    }
  }

  return {
    name: `Group servants ${year}`,
    freezeColumns: 5,
    columns: [
      { header: 'Weeks', width: 9 },
      { header: 'Panel', width: 18 },
      { header: 'Group', width: 18 },
      { header: 'Colour', width: 10 },
      { header: 'Servant', width: 24 },
      { header: 'Leader', width: 10 },
      { header: 'Age', width: 7 },
      { header: 'Phone', width: 16 },
      { header: 'Email', width: 28 },
      { header: 'Roles', width: 26 },
      { header: 'Safeguarding', width: 14 },
      { header: 'Shirt', width: 16 },
      { header: 'Days', width: 26 },
      { header: 'Availability', width: 30 },
      { header: 'Flags', width: 22 },
    ],
    rows,
    rowFills: fills,
  };
}

/* ---------------------------------------------------------------------------
 * Stations
 * ------------------------------------------------------------------------ */

function stationsSheet(board: CampAllocationDraft, resolved: Resolved, year: string): Sheet {
  const rows: CellValue[][] = [];
  const fills: (string | null)[] = [];

  for (const [stationIndex, station] of board.stations.entries()) {
    const hex = groupTint(campColour(station.colour).hex, stationIndex);

    // A station with nobody on it is the single most useful row in this
    // sheet: it is the job that is not covered. Emitted rather than skipped.
    if (station.servantKeys.length === 0) {
      rows.push([
        '',
        campSectionLabel(station.section),
        station.name,
        station.location,
        campColour(station.colour).label,
        '(nobody assigned)',
        '', '', '', '', '', '',
        station.note,
      ]);
      fills.push(hex);
      continue;
    }

    for (const key of station.servantKeys) {
      const person = resolved.byKey.get(key);
      if (!person) continue;
      rows.push([
        weeksLabel(person),
        campSectionLabel(station.section),
        station.name,
        station.location,
        campColour(station.colour).label,
        person.name,
        station.leaderKey === key ? 'LEADER' : '',
        person.age ?? '',
        person.contactPhone,
        person.contactEmail,
        person.roles.join(', '),
        person.cleared ? 'Cleared' : 'Not cleared',
        station.note,
      ]);
      fills.push(hex);
    }
  }

  return {
    name: `Stations ${year}`,
    freezeColumns: 5,
    columns: [
      { header: 'Weeks', width: 9 },
      { header: 'Section', width: 14 },
      { header: 'Station', width: 22 },
      { header: 'Where', width: 18 },
      { header: 'Colour', width: 10 },
      { header: 'Servant', width: 24 },
      { header: 'Leader', width: 10 },
      { header: 'Age', width: 7 },
      { header: 'Phone', width: 16 },
      { header: 'Email', width: 28 },
      { header: 'Roles', width: 26 },
      { header: 'Safeguarding', width: 14 },
      { header: 'Note', width: 30 },
    ],
    rows,
    rowFills: fills,
  };
}

/* ---------------------------------------------------------------------------
 * Unassigned
 * ------------------------------------------------------------------------ */

/**
 * Everybody with nowhere to be.
 *
 * The sheet the camp director works from in the last week, so it is a real
 * sheet rather than a note at the bottom of the roster. Children first, then
 * servants, each in registration order — which is roughly the order they
 * arrived, and therefore roughly the order somebody remembers them in.
 */
function unassignedSheet(resolved: Resolved, year: string): Sheet {
  const rows: CellValue[][] = [];
  const fills: string[] = [];

  /*
   * One list, because with one arrangement "unplaced" has one answer.
   *
   * It was per week, and it had to be: somebody placed in week one and nowhere
   * in week two appeared under week two, and that was the whole use of the
   * sheet in the last few days before camp. A child now has one group or none,
   * so the same person appearing twice would be the same fact printed twice.
   *
   * The `Weeks` column is what stops the sheet crying wolf: a name here with no
   * weeks against it is somebody who registered and then chose no days, which
   * is a different problem from one nobody has grouped yet.
   */
  // Two warm greys, one for the children and one for the servants, so the seam
  // between the two lists is visible without reading the second column.
  for (const person of resolved.freeChildren) {
    fills.push('FDFAF8');
    rows.push([
      weeksLabel(person),
      'Child',
      person.name,
      person.age ?? '',
      person.grade ? campGradeLabel(person.grade) : '',
      person.grade ? (sectionLabelOf(person.grade) ?? '') : '',
      person.contactName,
      person.contactPhone,
      person.days.join(', '),
      person.withdrawn ? 'WITHDRAWN' : '',
    ]);
  }

  for (const person of resolved.freeServants) {
    fills.push('F3EAE6');
    rows.push([
      weeksLabel(person),
      'Servant',
      person.name,
      person.age ?? '',
      '',
      person.roles.join(', '),
      person.contactName,
      person.contactPhone,
      person.days.join(', '),
      [person.withdrawn ? 'WITHDRAWN' : '', person.cleared ? '' : 'not cleared']
        .filter(Boolean)
        .join('; '),
    ]);
  }

  return {
    name: `Unassigned ${year}`,
    freezeColumns: 3,
    // Banded by kind rather than by colour: nobody here has a group, so there
    // is no colour to carry, and a two-hundred-row list with no banding is one
    // somebody loses their place in.
    rowFills: fills,
    columns: [
      { header: 'Weeks', width: 9 },
      { header: 'Who', width: 10 },
      { header: 'Name', width: 24 },
      { header: 'Age', width: 7 },
      { header: 'Grade', width: 14 },
      { header: 'Section / roles', width: 26 },
      { header: 'Contact', width: 24 },
      { header: 'Phone', width: 16 },
      { header: 'Days', width: 26 },
      { header: 'Flags', width: 20 },
    ],
    rows,
  };
}

/* ---------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------ */

function summarySheet(
  allocation: CampAllocationDraft,
  resolved: Resolved,
  people: readonly CampPerson[],
  generatedAt: Date,
  generatedBy: string,
  year: string,
): Sheet {
  const rows: CellValue[][] = [];
  /*
   * Which rows are headings, collected as the sheet is built.
   *
   * This sheet is five small tables stacked and has no header row to band, so
   * without this the week markers, the column labels and the figures under them
   * are all the same weight — which is a page of numbers rather than a report.
   */
  const bold: number[] = [];
  const heading = (values: CellValue[]) => {
    bold.push(rows.length);
    rows.push(values);
  };

  const children = people.filter((person) => person.kind === 'child');
  const servants = people.filter((person) => person.kind === 'servant');

  /*
   * The provenance lines, and the warning, live here rather than above the
   * roster.
   *
   * They were on the Groups sheet first and had to move. Three free-text lines
   * before a table cost that table its header row, its frozen pane and its
   * autofilter — a two-hundred-row roster that cannot be filtered by group is
   * the sheet somebody re-sorts by hand and then works from their own copy of.
   * The Summary sheet has no table above these lines to spoil, and "which
   * season is this and when was it printed" is a summary question anyway.
   */
  heading([`Summer camp ${year} — group allocation`, '', '', '', '']);
  rows.push([
    `Exported ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` +
      (generatedBy ? ` by ${generatedBy}` : ''),
    '', '', '', '',
  ]);
  rows.push([
    'The Groups sheet contains children’s allergies and medical notes. Share only with the people running the camp.',
    '', '', '', '',
  ]);
  if (allocation.archivedAt) {
    // An archived board is a past summer's answer. Somebody opening this file
    // next June needs to know that before they act on it, and the tab name
    // alone does not say it loudly enough.
    rows.push(['ARCHIVED — this season was rolled over and is read-only', '', '', '', '']);
  }
  rows.push([]);

  rows.push(['Season', year, '', '', '']);
  rows.push(['Children registered', children.length, '', '', '']);
  rows.push(['Servants registered', servants.length, '', '', '']);
  rows.push([]);

  /*
   * One block, not one per week.
   *
   * "Children placed" across a two-week camp used not to be a number — a child
   * placed in week one and not in week two was both, and any single figure had
   * to pick one and be wrong about the other. With one arrangement it is a
   * number again, and the report is a page instead of a page per week.
   */
  rows.push(['Children placed', children.length - resolved.freeChildren.length, '', '', '']);
  rows.push(['Children unplaced', resolved.freeChildren.length, '', '', '']);
  rows.push(['Servants placed', servants.length - resolved.freeServants.length, '', '', '']);
  rows.push(['Servants unplaced', resolved.freeServants.length, '', '', '']);
  rows.push([]);

  heading(['Panel', 'Group', 'Children', 'Servants', 'Ratio']);
  for (const band of allocation.bands) {
    const bandChildren = band.groups.reduce((sum, group) => sum + group.childKeys.length, 0);
    const bandServants = band.groups.reduce((sum, group) => sum + group.servantKeys.length, 0);
    rows.push([
      band.name,
      '— whole panel —',
      bandChildren,
      bandServants,
      ratio(bandChildren, bandServants),
    ]);
    for (const group of band.groups) {
      rows.push([
        '',
        `    ${group.name}`,
        group.childKeys.length,
        group.servantKeys.length,
        ratio(group.childKeys.length, group.servantKeys.length),
      ]);
    }
  }

  rows.push([]);
  heading(['Grade', 'Registered', 'Placed', 'Unplaced', '']);
  for (const grade of CAMP_GRADES) {
    const inGrade = children.filter((person) => person.grade === grade);
    if (inGrade.length === 0) continue;
    const unplaced = inGrade.filter((person) => !resolved.placement.has(person.key)).length;
    rows.push([campGradeLabel(grade), inGrade.length, inGrade.length - unplaced, unplaced, '']);
  }

  if (resolved.dangling.length > 0) {
    rows.push([]);
    heading(['Placements matching nobody', resolved.dangling.length, '', '', '']);
    for (const entry of dedupeDangling(resolved.dangling)) {
      rows.push(['', entry.where, entry.key, '', '']);
    }
  }

  rows.push([]);

  return {
    name: `Summary ${year}`,
    // Widths, but no header row — see `Sheet.headerRow`. This sheet is several
    // small tables stacked and there is no one row that labels them all; the
    // headings inside it are bold instead.
    headerRow: false,
    boldRows: bold,
    columns: [
      { header: '', width: 30 },
      { header: '', width: 26 },
      { header: '', width: 12 },
      { header: '', width: 12 },
      { header: '', width: 12 },
    ],
    rows,
  };
}

/**
 * `12:1`, or `no servants` — never a division by zero and never a decimal.
 *
 * A ratio is what a camp director actually asks ("how many kids per servant in
 * that group"), and `Infinity` in a cell is not an answer. A group with
 * children and no servants says so in words, because it is the state that needs
 * fixing and a number would be scanned past.
 */
function ratio(children: number, servants: number): string {
  if (children === 0 && servants === 0) return '';
  if (servants === 0) return 'no servants';
  if (children === 0) return 'no children';
  return `${Math.round((children / servants) * 10) / 10}:1`;
}

function dedupeDangling(
  dangling: readonly { key: CampPersonKey; where: string }[],
): { key: CampPersonKey; where: string }[] {
  const seen = new Set<string>();
  const out: { key: CampPersonKey; where: string }[] = [];
  for (const entry of dangling) {
    const id = `${entry.where} ${entry.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
  }
  return out;
}
