import type { AuditFields, Timestamped } from './common.js';
import {
  CAMP_GRADES,
  CAMP_WEEKDAYS,
  campDayDate,
  campDayKey,
  campDayLabel,
  campGradeLabel,
  parseCampDayKey,
  type CampDayKey,
  type CampGrade,
} from './camp.js';
import {
  weekBoardOf,
  type CampAllocationDraft,
  type CampPerson,
  type CampPersonKey,
} from './campAllocation.js';

/**
 * The camp's register: one document per day of camp, one tick per child.
 *
 * ---------------------------------------------------------------------------
 * ## The question this answers, and the answer that was given
 *
 * `AttendanceScreen` was a stub for a day, and the sentence written on it was
 * the open question: is the register **ticked here**, on a screen a servant
 * holds at nine in the morning, or does the camp print who is expected and
 * mark paper? Tommy answered the first, and added the half that decides the
 * shape of this file:
 *
 *   > it will go day by day starting by taking attendance of who shows up
 *   > identifying whos missing in each grade and then making sure each person
 *   > that is there is picked up at the end and this is only for the kids
 *
 * Three things follow, and none of them is negotiable by a later refactor:
 *
 *  1. **A day is the unit.** Not a week, not a season — the register is opened
 *     on Tuesday morning and closed on Tuesday afternoon. So: one document per
 *     `CampDayKey`, id `<programId>__<season>__<day>`, derived exactly as
 *     `allocationDocId` derives its own so neither is ever searched for.
 *  2. **Two marks per child, not one.** Arriving and being collected are
 *     different events with different times, and the afternoon question — *is
 *     everybody who came this morning gone home with somebody?* — cannot be
 *     asked of a single boolean. `arrived` without `collected` is the child
 *     still on site; that set emptying is the end of the day.
 *  3. **Children only.** Servants carry `days` too and are deliberately not in
 *     here. A register that mixes them makes "four missing from 3rd grade" a
 *     number somebody has to check the meaning of, and a servant running late
 *     is not the same kind of fact as a nine-year-old who did not arrive.
 *
 * ## Who collected them is not stored
 *
 * Offered, and declined: a tick and a time, with the uid of whoever tapped it.
 * That is worth being explicit about because it is the sort of field somebody
 * adds back in good faith. It was a choice — the camp knows its families and
 * a name typed at a gate by a tired servant is a record nobody would rely on
 * anyway — and `by` on the mark is what makes the tick attributable at all.
 *
 * ## Why `entries` is a map keyed by `CampPersonKey`
 *
 * Because two servants mark at once. A list would mean read-modify-write of the
 * whole day and one tablet quietly undoing the other's last four children;
 * a map means each tick is a `setDoc(…, { merge: true })` touching exactly one
 * field path, and Firestore merges them server-side without either device
 * knowing the other exists. The screen listens with `onSnapshot`, so the gate
 * and the classroom see the same register within a second.
 *
 * The keys are `registrationId/childId` — `childKey()`, the same keys the
 * allocation places. A slash in a map key is legal (it is a *field name*, not a
 * document path) and the SDK builds the merge mask from the object rather than
 * parsing a dotted string, so nothing here needs escaping. What it does mean is
 * that a key must never be interpolated into a `FieldPath.fromDotSeparated`
 * call — write the nested object and let the SDK do it.
 * ---------------------------------------------------------------------------
 */

/**
 * A ceiling on how many children one day's register can hold.
 *
 * Generous on purpose: a camp of 300 with a few marked who were not expected
 * is nowhere near it. It exists so a document that has been edited in a console
 * cannot be made unopenable, and so `firestore.rules` has a number to check —
 * rules cannot see inside a map's values, so the count is the only bound it can
 * enforce at all.
 */
export const MAX_ATTENDANCE_ENTRIES = 800;

/* ---------------------------------------------------------------------------
 * The document
 * ------------------------------------------------------------------------ */

/**
 * One tick: when, and by whom.
 *
 * `at` is written as `serverTimestamp()`, never the tablet's clock. A register
 * is the only record of when a child was collected, and a device two hours out
 * would put that in writing. The screen reads it back with
 * `data({ serverTimestamps: 'estimate' })` so the time appears the instant it
 * is tapped rather than blinking in when the write lands.
 */
export interface CampAttendanceMark {
  at: Timestamped | null;
  /** uid of whoever tapped it. Null only for a document written by a script. */
  by: string | null;
}

/**
 * One child's day.
 *
 * Both marks nullable and independent. `collected` without `arrived` is not a
 * state the screen can produce any more — the afternoon half lists only
 * children who arrived, so there is no Out control on a child who has no In —
 * but it is a state a console can, and one that older registers hold, so
 * nothing here treats it as impossible. `attendanceState` still reads it as
 * `gone`.
 */
export interface CampAttendanceEntry {
  arrived: CampAttendanceMark | null;
  collected: CampAttendanceMark | null;
}

export const NO_ENTRY: CampAttendanceEntry = { arrived: null, collected: null };

export interface CampAttendanceDay extends AuditFields {
  /** The ministry that owns the camp. What `firestore.rules` reads. */
  programId: string;
  season: string;
  /** `w1-mon`. Pinned across an update by the rules, like `programId`. */
  day: CampDayKey;
  /** `childKey(registrationId, childId)` → that child's two marks. */
  entries: Record<CampPersonKey, CampAttendanceEntry>;
}

export type CampAttendanceDayDraft = Omit<CampAttendanceDay, keyof AuditFields>;

/**
 * The id of a day's register.
 *
 * Derived, so the screen `get`s it and the collection is never queried for the
 * day it is already looking at. Same reasoning as `allocationDocId`, and the
 * same consequence: `firestore.rules` allows a `get` of a document that does
 * not exist, because a day nobody has ticked yet is the normal first state.
 */
export function attendanceDocId(programId: string, season: string, day: CampDayKey): string {
  return `${programId}__${season}__${day}`;
}

export function blankAttendanceDay(
  programId: string,
  season: string,
  day: CampDayKey,
): CampAttendanceDayDraft {
  return { programId, season, day, entries: {} };
}

export function parseCampAttendanceDay(raw: unknown): CampAttendanceDay {
  const doc = asRecord(raw);
  const entries: Record<CampPersonKey, CampAttendanceEntry> = {};

  let kept = 0;
  for (const [key, value] of Object.entries(asRecord(doc['entries']))) {
    if (kept >= MAX_ATTENDANCE_ENTRIES) break;
    if (!key.trim()) continue;
    const entry = parseEntry(value);
    // A key whose marks are both absent says nothing. Dropping it on read keeps
    // "how many children were touched today" honest after an undo, which the
    // screen writes as nulls rather than deleting the field.
    if (!entry.arrived && !entry.collected) continue;
    entries[key] = entry;
    kept += 1;
  }

  return {
    programId: str(doc['programId']) || 'summercamp',
    season: str(doc['season']),
    day: str(doc['day']),
    entries,
    createdAt: (doc['createdAt'] ?? null) as CampAttendanceDay['createdAt'],
    updatedAt: (doc['updatedAt'] ?? null) as CampAttendanceDay['updatedAt'],
    updatedBy: nullableStr(doc['updatedBy']),
  };
}

function parseEntry(raw: unknown): CampAttendanceEntry {
  const doc = asRecord(raw);
  return { arrived: parseMark(doc['arrived']), collected: parseMark(doc['collected']) };
}

function parseMark(raw: unknown): CampAttendanceMark | null {
  if (raw == null) return null;
  const doc = asRecord(raw);
  /*
   * A mark with no `at` is still a mark.
   *
   * `serverTimestamp()` is a sentinel until the write is acknowledged, and a
   * snapshot read from cache without the estimate option hands back null for
   * it. Treating that as "not ticked" would make a child flick out of the
   * register for the second between the tap and the round trip.
   */
  return { at: (doc['at'] ?? null) as Timestamped | null, by: nullableStr(doc['by']) };
}

/* ---------------------------------------------------------------------------
 * Reading a register
 * ------------------------------------------------------------------------ */

/**
 * Where one child stands right now.
 *
 * `expected` is deliberately not in here. Whether a child was down for today is
 * a fact about their registration, not about the register, and conflating them
 * gives a fourth state that means two different things.
 */
export type CampAttendanceState = 'absent' | 'here' | 'gone';

export function attendanceState(entry: CampAttendanceEntry | null | undefined): CampAttendanceState {
  if (!entry) return 'absent';
  if (entry.collected) return 'gone';
  if (entry.arrived) return 'here';
  return 'absent';
}

export function attendanceStateLabel(state: CampAttendanceState): string {
  if (state === 'here') return 'Here';
  if (state === 'gone') return 'Collected';
  return 'Not in';
}

/** One line of the register: a child, whether they were due, and their marks. */
export interface CampAttendanceRow {
  person: CampPerson;
  /** True when this day is in the child's registered days. */
  expected: boolean;
  entry: CampAttendanceEntry | null;
  state: CampAttendanceState;
}

/**
 * The day's register, children only, in the order the registrations sorted.
 *
 * Withdrawn children are dropped outright rather than shown and flagged, which
 * is the opposite of what the allocation board does with them — and on purpose.
 * A withdrawn child on an allocation is a placement somebody has to deal with;
 * a withdrawn child on a register is a name a servant would call out at nine in
 * the morning for a family that is not coming. If they turn up anyway they are
 * a registration to un-withdraw, not a row to tick.
 *
 * A child who is *not* down for today is kept, marked `expected: false`. Camps
 * take walk-ins, a parent swaps Tuesday for Wednesday at the gate, and a
 * register that cannot record somebody standing in front of you is a register
 * that gets kept on paper instead.
 */
export function attendanceRows(
  people: readonly CampPerson[],
  day: CampDayKey,
  entries: Record<CampPersonKey, CampAttendanceEntry>,
): CampAttendanceRow[] {
  const rows: CampAttendanceRow[] = [];

  for (const person of people) {
    if (person.kind !== 'child') continue;
    if (person.withdrawn) continue;

    const entry = entries[person.key] ?? null;
    rows.push({
      person,
      expected: person.days.includes(day),
      entry,
      state: attendanceState(entry),
    });
  }

  return rows;
}

export interface CampAttendanceTally {
  /** Children down for this day. */
  expected: number;
  /** Expected children who have been ticked in at some point today. */
  in: number;
  /** Expected children with no arrival mark. The morning's answer. */
  missing: number;
  /** Anybody arrived and not yet collected — expected or not. */
  here: number;
  /** Anybody collected. */
  gone: number;
  /** Ticked in without being down for today. Walk-ins and day swaps. */
  extra: number;
}

export function attendanceTally(rows: readonly CampAttendanceRow[]): CampAttendanceTally {
  const tally: CampAttendanceTally = { expected: 0, in: 0, missing: 0, here: 0, gone: 0, extra: 0 };

  for (const row of rows) {
    if (row.expected) {
      tally.expected += 1;
      if (row.state === 'absent') tally.missing += 1;
      else tally.in += 1;
    } else if (row.state !== 'absent') {
      tally.extra += 1;
    }

    if (row.state === 'here') tally.here += 1;
    if (row.state === 'gone') tally.gone += 1;
  }

  return tally;
}

/**
 * True when every child who came today has gone home.
 *
 * The one question the afternoon exists to answer, and it is a function rather
 * than `tally.here === 0` written at the call site because the empty register
 * satisfies that too. Nobody arrived is not the same fact as everybody left,
 * and a screen that says "all collected" at nine in the morning is a screen
 * that will one day say it at four.
 */
export function everyoneCollected(tally: CampAttendanceTally): boolean {
  return tally.here === 0 && tally.gone > 0;
}

/* ---------------------------------------------------------------------------
 * The two halves of a day
 * ---------------------------------------------------------------------------
 *
 * A day of camp is worked in two halves, and the register is a different screen
 * in each of them. The morning is *who showed up* — every child down for today,
 * plus anybody who turned up who was not, and one tick each. The afternoon is
 * *who is still here and who is collecting them* — only the children who
 * actually arrived, with a guardian's name and number beside each one.
 *
 * This reverses something written at the top of this file: In and Out used to
 * sit on the same row, on purpose, so that nobody could be in the wrong half at
 * the one moment where being in the wrong half means a child is marked as gone
 * home who is not. Tommy asked for the halves anyway, and the two things that
 * make it safe are here rather than in the screen:
 *
 *  - the half is **derived, then overridable** — `campHalfForDay` says which
 *    half a day is in and the servant can say otherwise at any time, so a
 *    pickup at eleven or an arrival at one is never blocked, only a tap away;
 *  - the afternoon still shows **the arrival time** on every row, so a child
 *    whose "Left" was tapped by mistake is visibly still ticked in.
 * ------------------------------------------------------------------------ */

/** Which half of a day of camp is being worked. */
export type CampHalf = 'morning' | 'afternoon';

/**
 * Noon, local, is when a day of camp turns over.
 *
 * The camp's own boundary, not a computed one: there is no "sessions" field on
 * `config/camp` and inventing one would be a setting nobody would ever change.
 * A servant who needs the other half before or after noon taps for it.
 */
export const CAMP_AFTERNOON_FROM_HOUR = 12;

export function campHalfLabel(half: CampHalf): string {
  return half === 'afternoon' ? 'Afternoon' : 'Morning';
}

/**
 * Which half a given day of camp should open on.
 *
 * A day that has already been and gone opens on the afternoon — it is being
 * read, not worked, and the afternoon is where the day's ending is. A day still
 * to come opens on the morning. Today is the only one that depends on the
 * clock, and it flips at noon.
 *
 * With no dates on `config/camp` there is no way to know whether the chosen day
 * is past or future — every day key is equally undated — so the clock alone
 * decides, which is right for the only day anybody is ticking.
 */
export function campHalfForDay(
  weekStarts: readonly string[],
  day: CampDayKey,
  now: Date = new Date(),
): CampHalf {
  const byClock: CampHalf =
    now.getHours() >= CAMP_AFTERNOON_FROM_HOUR ? 'afternoon' : 'morning';

  const date = campDayDate(weekStarts, day);
  if (!date) return byClock;

  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  if (date.getTime() < midnight.getTime()) return 'afternoon';
  if (date.getTime() > midnight.getTime()) return 'morning';
  return byClock;
}

/**
 * The day of camp nearest to now, which is the day the register opens on.
 *
 * Today when today is a day of camp, and otherwise the closest one in either
 * direction — the Saturday in the middle of a fortnight opens Friday, which was
 * yesterday, over Monday, which is two days off. A tie goes to the day ahead:
 * on the Sunday between the two weeks, the register is far more likely to be
 * being read in preparation for Monday than in review of Friday.
 *
 * Before and after the camp this collapses to the first and last day, which is
 * what an administrator opening the register in February wants — the alternative
 * was week one Monday all year, right one day in twelve months.
 */
export function nearestCampDay(
  weekStarts: readonly string[],
  weeks: number,
  now: Date = new Date(),
): CampDayKey {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);

  let best: CampDayKey | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAhead = false;

  for (let week = 1; week <= weeks; week += 1) {
    for (const weekday of CAMP_WEEKDAYS) {
      const key = campDayKey(week, weekday);
      const date = campDayDate(weekStarts, key);
      if (!date) continue;

      const offset = date.getTime() - midnight.getTime();
      const distance = Math.abs(offset);
      const ahead = offset >= 0;

      // Strictly closer wins; equally close and ahead beats equally close and
      // behind. Only ever one comparison, so the whole rule is these two lines.
      if (distance < bestDistance || (distance === bestDistance && ahead && !bestAhead)) {
        best = key;
        bestDistance = distance;
        bestAhead = ahead;
      }
    }
  }

  // A camp with no dates set has no nearest day. Week one Monday is the only
  // honest answer, and it is what this screen always did.
  return best ?? campDayKey(1, 'mon');
}

/** The afternoon's register: who is still on site, and who has gone home. */
export interface CampAttendancePresence {
  /** Arrived, not yet collected. The list that has to reach empty. */
  onSite: CampAttendanceRow[];
  /** Collected, newest tick last. Kept, so a mistap is undoable. */
  goneHome: CampAttendanceRow[];
}

/**
 * The afternoon's two lists, out of the day's rows.
 *
 * Children who never arrived are dropped outright — that is the whole
 * difference between the two halves. Somebody absent all morning is not a
 * pickup anybody is waiting on, and a Friday afternoon list of ninety names
 * where eleven of them matter is a list that gets read wrong.
 *
 * Collected children are *kept*, in their own list, rather than vanishing. A
 * servant taps the row below the one they meant perhaps once a week, and a
 * child who has disappeared off the only screen they were on cannot be put
 * back without changing half.
 */
export function attendancePresence(
  rows: readonly CampAttendanceRow[],
): CampAttendancePresence {
  const onSite: CampAttendanceRow[] = [];
  const goneHome: CampAttendanceRow[] = [];

  for (const row of rows) {
    if (row.state === 'here') onSite.push(row);
    else if (row.state === 'gone') goneHome.push(row);
  }

  return { onSite, goneHome };
}

/* ---------------------------------------------------------------------------
 * Sections
 * ------------------------------------------------------------------------ */

/**
 * A block of the register with its own heading and its own counts.
 *
 * Two things produce these — grade, which is what was asked for, and the
 * allocation's own groups, which is how a servant standing with nine children
 * actually reads a list. Both come out as the same shape so the screen draws
 * one thing.
 */
export interface CampAttendanceSection {
  id: string;
  name: string;
  rows: CampAttendanceRow[];
  tally: CampAttendanceTally;
}

/**
 * The register cut by grade, kindergarten first, empty grades omitted.
 *
 * `CAMP_GRADES` order rather than whatever order the registrations came in, so
 * the sections read the way a camp lists them and stay in the same place all
 * fortnight — a heading that moves between two Tuesdays is a heading somebody
 * scrolls past looking for.
 */
export function attendanceByGrade(rows: readonly CampAttendanceRow[]): CampAttendanceSection[] {
  const byGrade = new Map<CampGrade, CampAttendanceRow[]>();

  for (const row of rows) {
    const grade = row.person.grade;
    if (!grade) continue;
    const bucket = byGrade.get(grade);
    if (bucket) bucket.push(row);
    else byGrade.set(grade, [row]);
  }

  const sections: CampAttendanceSection[] = [];
  for (const grade of CAMP_GRADES) {
    const bucket = byGrade.get(grade);
    if (!bucket || bucket.length === 0) continue;
    sections.push({
      id: `grade-${grade}`,
      name: campGradeLabel(grade),
      rows: bucket,
      tally: attendanceTally(bucket),
    });
  }

  return sections;
}

/**
 * The register cut by the allocation's own groups, for one week's board.
 *
 * ---------------------------------------------------------------------------
 * The second half of "grade, with a group toggle". Grade is what was asked for
 * and is the default; this is what the person actually holding the phone at
 * nine in the morning wants, because they are standing with *their* nine
 * children and not with the thirty-one third-graders. A servant who has to
 * scroll a grade to find their group will mark paper instead.
 *
 * Panels are walked in allocation order and groups in panel order, so the
 * sections come out in the same order as the groups screen draws them — the same
 * colours, the same names, in the same places. Empty groups are dropped: a
 * group with nobody in it *today* is noise, and one with nobody in it at all is
 * the allocation's problem, not the register's.
 *
 * Children the board has not placed land in one section at the end rather than
 * being hidden. On the first morning of camp that section is the whole camp,
 * which is exactly the right way for an unallocated season to look — the toggle
 * says so instead of showing an empty screen.
 * ---------------------------------------------------------------------------
 */
export function attendanceByGroup(
  rows: readonly CampAttendanceRow[],
  allocation: CampAllocationDraft | null,
  /**
   * Which week's arrangement to read.
   *
   * Required since the board went back to one arrangement per week: the same
   * child is in Blue in week one and Green in week two, and a register that
   * guessed the week would head a Tuesday-of-week-two section with week one's
   * group. The caller has the day key, so it knows.
   */
  week: number,
): CampAttendanceSection[] {
  const board = allocation ? weekBoardOf(allocation, week) : null;
  const byKey = new Map<CampPersonKey, CampAttendanceRow>();
  for (const row of rows) byKey.set(row.person.key, row);

  const sections: CampAttendanceSection[] = [];
  const placed = new Set<CampPersonKey>();

  for (const band of board?.bands ?? []) {
    for (const group of band.groups) {
      const bucket: CampAttendanceRow[] = [];
      for (const key of group.childKeys) {
        const row = byKey.get(key);
        // A key with no row is a child who has withdrawn or been deleted since
        // the board was arranged. The allocation screen reports those as
        // dangling and offers to clear them; a register is not the place to
        // start telling somebody about it at nine in the morning.
        if (!row) continue;
        // A child placed in two groups by a console edit is drawn once, in the
        // first one, rather than ticked in one section and absent in another.
        if (placed.has(key)) continue;
        placed.add(key);
        bucket.push(row);
      }

      if (bucket.length === 0) continue;
      sections.push({
        id: `group-${group.id}`,
        // Qualified, because "Blue 1" and "Green 1" are told apart by the panel
        // on the allocation board and there is no panel here to tell them apart.
        name: band.name ? `${band.name} · ${group.name}` : group.name,
        rows: bucket,
        tally: attendanceTally(bucket),
      });
    }
  }

  const loose = rows.filter((row) => !placed.has(row.person.key));
  if (loose.length > 0) {
    sections.push({
      id: 'group-none',
      name: 'Not in a group yet',
      rows: loose,
      tally: attendanceTally(loose),
    });
  }

  return sections;
}

/** Every day of camp that at least one child is registered for. */
export function daysWithChildren(people: readonly CampPerson[]): Set<CampDayKey> {
  const days = new Set<CampDayKey>();
  for (const person of people) {
    if (person.kind !== 'child' || person.withdrawn) continue;
    for (const day of person.days) if (parseCampDayKey(day)) days.add(day);
  }
  return days;
}

/**
 * A day's register, said in one line, for a heading or an export.
 *
 * Reads as the camp would say it — "Week 1 · Tue — 84 of 91 in, 7 missing" —
 * rather than as a row of labelled numbers.
 */
export function describeAttendance(day: CampDayKey, tally: CampAttendanceTally): string {
  if (tally.expected === 0 && tally.extra === 0) return `${campDayLabel(day)} — nobody registered`;
  const parts = [`${tally.in} of ${tally.expected} in`];
  if (tally.missing > 0) parts.push(`${tally.missing} missing`);
  if (tally.extra > 0) parts.push(`${tally.extra} not expected`);
  if (tally.here > 0) parts.push(`${tally.here} still here`);
  return `${campDayLabel(day)} — ${parts.join(', ')}`;
}

/* ---------------------------------------------------------------------------
 * The same tiny readers every camp parser uses.
 * ------------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableStr(value: unknown): string | null {
  const out = str(value);
  return out || null;
}
