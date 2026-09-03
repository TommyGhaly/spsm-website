import {
  CAMP_GRADES,
  CAMP_SECTIONS,
  campSectionForGrade,
  campSectionLabel,
  type CampGrade,
  type CampRegistration,
  type CampSection,
} from '../schema/camp.js';
import {
  blankWeekBoard,
  campColourOf,
  campPeople,
  resolveAllocation,
  type CampAllocationDraft,
  type CampBand,
  type CampWeekBoard,
} from '../schema/campAllocation.js';
import { buildXlsx, type CellValue, type Sheet } from '../xlsx.js';

/**
 * The camp's servants, and who each of them is with.
 *
 * ---------------------------------------------------------------------------
 * Why this is in `@spsm/shared` and not in the browser feature that calls it.
 *
 * Because it has two callers and will keep having two. The export button on
 * the groups screen builds these bytes and hands them to a download; the
 * OneDrive upload builds the same bytes in a Cloud Function and PUTs them at
 * Microsoft Graph. If the sheet layout lived next to the button, the Function
 * would grow its own copy, and the file the church opens from OneDrive would
 * quietly stop matching the one somebody downloaded — with no test able to say
 * which was right.
 *
 * ## What is in the file
 *
 * One sheet per week per half of the camp — `Elementary W1`, `Middle school
 * W1`, `Elementary W2` — and on each of them one row per servant: their name,
 * the group they are with, and the grades that group covers.
 *
 * Which weeks and which halves are written is the caller's choice, because
 * that is the question the export button now asks before it saves anything.
 * Passing neither means all of them.
 *
 * ## What used to be in it, and is not
 *
 * Five sheets: the children's roster with allergies and medical notes on it,
 * the stations, everybody unplaced, and a summary of counts and ratios.
 *
 * Tommy: *"I want the servants with their groups and the grades, that's all I
 * really need."* So they are gone rather than kept-in-case, and two things
 * follow from that which are worth knowing before anybody adds a column here:
 *
 * 1. **The file is no longer sensitive.** It carries no allergy, no medical
 *    note, no address, no telephone number and no child's name. That is what
 *    lets it be mailed and printed without the warning line the old workbook
 *    had to carry in its own first sheet. Putting a child back on it puts that
 *    obligation back too.
 * 2. **Nobody with a place is left off it.** A servant on a station, and a
 *    servant with nowhere to be, are both still written — a name silently
 *    absent is how somebody turns up on the Monday expected by nobody. It is
 *    only the *columns* that were cut.
 * ---------------------------------------------------------------------------
 */

export interface AllocationWorkbookInput {
  allocation: CampAllocationDraft;
  registrations: readonly (CampRegistration & { id: string })[];
  /** For the file's own properties. Defaults to now. */
  generatedAt?: Date;
  /** Name of whoever pressed the button, for the file's own properties. */
  generatedBy?: string;
  /**
   * Which weeks to write, in the order given. Empty or absent means every week
   * on the board — the same convention the sign-up form's week tick-boxes use,
   * where nothing ticked means everything rather than nothing.
   */
  weeks?: readonly number[];
  /** Which halves of the camp to write. Empty or absent means both. */
  sections?: readonly CampSection[];
}

/**
 * The filename to save under.
 *
 * `camp-servants-2027-w1-elementary-2027-06-14.xlsx` when the export was
 * narrowed to one week and one half, and `camp-servants-2027-2027-06-14.xlsx`
 * when it was not. The narrowing is in the name because the file is chosen
 * from a dialog and then lives in a downloads folder beside three of its own
 * siblings, and "which one of these is week two" is not a question a date can
 * answer.
 */
export function allocationWorkbookName(
  season: string,
  at: Date = new Date(),
  narrow: {
    weeks?: readonly number[] | undefined;
    sections?: readonly CampSection[] | undefined;
  } = {},
): string {
  const day = at.toISOString().slice(0, 10);
  const safe = season.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'season';
  const week = narrow.weeks?.length === 1 ? `-w${narrow.weeks[0]}` : '';
  const section = narrow.sections?.length === 1 ? `-${narrow.sections[0]}` : '';
  return `camp-servants-${safe}${week}${section}-${day}.xlsx`;
}

export function campAllocationWorkbook(input: AllocationWorkbookInput): Uint8Array {
  const generatedAt = input.generatedAt ?? new Date();
  return buildXlsx(campAllocationSheets({ ...input, generatedAt }), {
    title: `Summer camp ${input.allocation.season} — servants`,
    creator: input.generatedBy || 'St Philopater Mercurius & St Mina',
    created: generatedAt,
  });
}

/**
 * The sheets, before they are zipped.
 *
 * Exported separately from `campAllocationWorkbook` because this is the part
 * worth asserting on: a test that opens a zip to check a column heading is a
 * test about `xlsx.ts`, and a test that reads this array is a test about who
 * is with which group.
 */
export function campAllocationSheets(input: AllocationWorkbookInput): Sheet[] {
  const { allocation, registrations } = input;
  const people = campPeople(registrations);

  /*
   * One resolution per week, computed once.
   *
   * A camp nobody has arranged still gets one week's worth of empty sheets
   * rather than none, so the file always has the shape somebody expects.
   */
  const boards = [...allocation.weeks].sort((left, right) => left.week - right.week);
  const available = boards.length > 0 ? boards : [blankWeekBoard(1)];

  const wanted = input.weeks?.length
    ? available.filter((board) => input.weeks!.includes(board.week))
    : available;
  const halves = input.sections?.length
    ? CAMP_SECTIONS.filter((section) => input.sections!.includes(section))
    : CAMP_SECTIONS;

  /*
   * A week the caller asked for that the board does not have is dropped, and a
   * week-and-half with nothing in it is still written.
   *
   * The two are different on purpose. The first is a request about a week that
   * does not exist; the second is an answer — "nobody is in middle school in
   * week two" is a fact the person who ticked that box needs, and an absent tab
   * reads as a bug in the export.
   */
  const sheets = wanted.flatMap((board) =>
    halves.map((section) =>
      sectionSheet(board, resolveAllocation(allocation, board.week, people), section),
    ),
  );

  return sheets.length > 0 ? sheets : [sectionSheet(blankWeekBoard(1), null, 'elementary')];
}

type Resolved = ReturnType<typeof resolveAllocation> | null;

/* ---------------------------------------------------------------------------
 * One week, one half of the camp
 * ------------------------------------------------------------------------ */

const COLUMNS = [
  { header: 'Servant', width: 26 },
  { header: 'Group', width: 24 },
  { header: 'Grades', width: 16 },
  { header: 'Leader', width: 10 },
];

function sectionSheet(board: CampWeekBoard, resolved: Resolved, section: CampSection): Sheet {
  const rows: CellValue[][] = [];
  const fills: (string | null)[] = [];
  const seams: number[] = [];

  const name = (key: string) => resolved?.byKey.get(key)?.name ?? '';

  for (const band of board.bands) {
    if (bandSection(band) !== section) continue;
    // A rule where each panel begins. The groups inside it are told apart by
    // two strengths of the panel's own colour, so the seam is what says "this
    // is a different panel" rather than "this is a different group".
    seams.push(rows.length);

    for (const [groupIndex, group] of band.groups.entries()) {
      const hex = groupTint(campColourOf(band.colour).hex, groupIndex);
      const grades = gradeList(band.grades);

      /*
       * A group with no servants still gets a row.
       *
       * It is the row this sheet exists for: thirty children with nobody
       * standing with them. Skipping it makes the file agree with itself and
       * disagree with the board, and the person reading the file is the one
       * who cannot check.
       */
      if (group.servantKeys.length === 0) {
        rows.push(['(nobody with this group)', group.name, grades, '']);
        fills.push(hex);
        continue;
      }

      for (const key of group.servantKeys) {
        const who = name(key);
        if (!who) continue;
        rows.push([
          who,
          group.name,
          grades,
          // Leader or not, in words. The whole point of the mark is that
          // somebody standing in a hall can tell who is in charge, and a blank
          // cell beside four names does that better than a TRUE.
          group.leaderKey === key ? 'LEADER' : '',
        ]);
        fills.push(hex);
      }
    }
  }

  /*
   * The stations, under the panels.
   *
   * A servant on sports is not with a group and has no grades, and dropping
   * them would take a name off the file altogether. `(station)` is written into
   * the group column rather than given a column of its own: one word on six
   * rows costs less than a column that is empty on every other row.
   */
  for (const [stationIndex, station] of board.stations.entries()) {
    if (station.section !== section) continue;
    seams.push(rows.length);
    const hex = groupTint(campColourOf(station.colour).hex, stationIndex);
    const where = `${station.name} (station)`;

    if (station.servantKeys.length === 0) {
      rows.push(['(nobody assigned)', where, '', '']);
      fills.push(hex);
      continue;
    }

    for (const key of station.servantKeys) {
      const who = name(key);
      if (!who) continue;
      rows.push([who, where, '', station.leaderKey === key ? 'LEADER' : '']);
      fills.push(hex);
    }
  }

  /*
   * Everybody with nowhere to be, on the sheet for the half they asked for.
   *
   * A servant who ticked neither half is written on both, because the
   * alternative is a registration that appears on no sheet in the workbook —
   * and somebody who asked for nothing is precisely the one nobody has thought
   * about yet.
   */
  const spare = (resolved?.freeServants ?? []).filter(
    (person) => person.sections.length === 0 || person.sections.includes(section),
  );
  if (spare.length > 0) {
    seams.push(rows.length);
    for (const person of spare) {
      rows.push([person.name, '(not placed)', '', '']);
      fills.push(UNPLACED_FILL);
    }
  }

  return {
    name: `${campSectionLabel(section)} W${board.week}`,
    columns: COLUMNS,
    rows,
    rowFills: fills,
    separatorRows: seams,
    // The rows are banded by group already; the grey grid drawn over that says
    // the same thing less well.
    gridLines: false,
  };
}

/* ---------------------------------------------------------------------------
 * Labels and colour
 * ------------------------------------------------------------------------ */

/**
 * Which half of the camp a panel belongs to.
 *
 * A panel is a list of grades and nothing else, so this is derived rather than
 * stored — and it has to answer for a panel that straddles the boundary, like
 * one running 5th to 8th when 5th grade is elementary and the rest are not.
 * The half most of its grades fall in wins, and a tie goes to elementary,
 * which is the larger half of this camp and the one a mixed panel is run like.
 *
 * The straddling panel's own grades are printed in the Grades column, so the
 * sheet never hides that a 5th-grader is on a middle-school tab.
 */
export function bandSection(band: CampBand): CampSection {
  let middle = 0;
  let elementary = 0;
  for (const grade of band.grades) {
    if (campSectionForGrade(grade) === 'middle-school') middle += 1;
    else if (campSectionForGrade(grade) === 'elementary') elementary += 1;
  }
  return middle > elementary ? 'middle-school' : 'elementary';
}

/** `['k','1','2']` → `K, 1, 2`. In board order, not registration order, so two
    panels with the same grades read identically. */
function gradeList(grades: readonly CampGrade[]): string {
  const ordered = CAMP_GRADES.filter((grade) => grades.includes(grade));
  return ordered.map((grade) => (grade === 'k' ? 'K' : grade)).join(', ');
}

/**
 * A camp colour, watered down for a row fill.
 *
 * ---------------------------------------------------------------------------
 * The sheets used to be filled with the colour *itself* — #9E9D24 with black
 * type on it, for row after row. It carries the panel, which is the point, and
 * it is unreadable and unprintable, which is not: a saturated fill behind body
 * text is the single most common way a coloured spreadsheet ends up being
 * re-made by hand in black and white.
 *
 * Two strengths rather than one, alternating per group inside a panel. Every
 * group in a panel shares one colour, so a panel would otherwise be one
 * unbroken block with the group only named in column B; banding puts a visible
 * seam at each group boundary while keeping the panel obviously one thing.
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

/** A warm grey for the unplaced, which is the one block on the sheet that
    carries no panel colour because it belongs to no panel. */
const UNPLACED_FILL = 'F3EAE6';
