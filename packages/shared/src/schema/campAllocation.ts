import type { AuditFields } from './common.js';
import {
  CAMP_GRADES,
  CAMP_SECTIONS,
  campGradesForSection,
  campAge,
  campSectionForGrade,
  DEFAULT_CAMP_WEEKS,
  isCampGrade,
  isCampSection,
  MAX_CAMP_WEEKS,
  type CampChild,
  type CampGrade,
  type CampRegistration,
  type CampSection,
} from './camp.js';

/**
 * How a camp season is divided up: bands, groups, stations, and who is in each.
 *
 * ---------------------------------------------------------------------------
 * Why this is a document of its own and not fields on the registrations.
 *
 * `CampChild.groupName` already exists and is a free string. It is the wrong
 * place for this and always was — it can say *which* group a child is in, and
 * nothing else. It cannot say that the 3rd and 4th graders are run together as
 * one band of three groups, that the band is green, that Marina and Peter lead
 * group two, or that the sports station has four servants on it. Those are
 * facts about the *camp*, not about any one child, and a fact about the camp
 * stored once per child is a fact that can disagree with itself.
 *
 * The practical argument is the same one and sharper. Allocation is done by
 * dragging: a child moves from one group to another, and then back, and then
 * six more do the same while somebody watches over a shoulder. Held on the
 * registrations that is one Firestore write per child per drag, on documents
 * that also hold a payment ledger somebody else may be editing at the same
 * moment. Held here it is one read, one document in memory, and one write when
 * the administrator is finished.
 *
 * ## What is stored, and what is not
 *
 * Stored: the arrangement. Bands, their groups, the keys of the children and
 * servants placed in each, the stations and their servants.
 *
 * Not stored: **anybody's name, grade, phone number or allergies.** A group
 * holds keys — `registrationId/childId` — and every name on the screen is
 * looked up from `campRegistrations`, which is the record. Copying a name here
 * would create a second copy of a child's name that goes stale the moment a
 * spelling is corrected, and it would put children's names in a document with
 * its own permission surface for no gain at all. It also means a registration
 * that is deleted or withdrawn leaves a key that resolves to nobody, which
 * `resolveAllocation` reports as a dangling placement rather than hiding.
 *
 * ## The pool is derived
 *
 * "Who is still available" is not a field. It is every child and every servant
 * in the season, minus everybody placed — computed on read by
 * `resolveAllocation`. Storing it would be storing the same fact twice, and
 * the failure mode of the two disagreeing is a child who appears both in the
 * pool and in a group, which is exactly the bug this screen exists to prevent.
 *
 * ## One placement each
 *
 * A child is in at most one group. A servant is in at most one group *or* one
 * station. This is a real constraint, not an incidental one: the point of the
 * available-people menu is that it empties as the work is finished, and a
 * servant who can be in three places at once makes it meaningless. `placeChild`
 * and `placeServant` therefore *move* rather than add — they remove the key
 * from wherever it was first. That is also what makes a drag from one group to
 * another a single operation instead of a remove and an add the administrator
 * has to remember to do in the right order.
 *
 * ## The permission
 *
 * The same program grant as the registrations themselves — `programAdmin`
 * containing the camp's program id. Transcribed into `firestore.rules`; see
 * the `campAllocations` block there. This document is much less sensitive than
 * a registration (it has no names in it at all), but it is derived entirely
 * from them and there is no reason for a wider door.
 * ---------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * Bounds — the flat ones are mirrored in firestore.rules
 * ------------------------------------------------------------------------ */

/**
 * Grade bands in one season.
 *
 * Fourteen grades exist, so a band per grade is the most anybody could
 * reasonably want and this is that plus room to be untidy.
 */
export const MAX_BANDS = 16;

/** Groups inside one band. Three groups of 3rd-and-4th graders was the example;
    twelve is comfortably past any camp this parish runs. */
export const MAX_GROUPS_PER_BAND = 12;

/** Activity stations across the whole camp. */
export const MAX_STATIONS = 40;

/** People in one group or on one station. */
export const MAX_PLACEMENTS_PER_GROUP = 80;

/**
 * People placed anywhere in the whole allocation.
 *
 * This is the bound that actually protects the document. Firestore refuses a
 * write over 1MiB and a key is about forty bytes, so two thousand placements is
 * roughly 80KB of keys plus the names of the groups holding them — an order of
 * magnitude inside the limit, and several times larger than any camp the parish
 * has run. Rules cannot count across nested arrays, so this one is enforced
 * here and here only; what stops a console user is `MAX_BANDS` and the string
 * bounds, which rules *can* see.
 */
export const MAX_PLACEMENTS = 2000;

/** A band name, a group name, a station name, a location. */
export const MAX_ALLOCATION_LINE = 80;

/** A note on a band, a group, a station, or the allocation itself. */
export const MAX_ALLOCATION_NOTE = 1000;

/* ---------------------------------------------------------------------------
 * Colour
 * ------------------------------------------------------------------------ */

export interface CampColourOption {
  value: CampColour;
  label: string;
  /**
   * The swatch, as a hex string.
   *
   * Here rather than in CSS because this list has three consumers that are not
   * a stylesheet: the Excel export fills a cell with it, the mobile app will
   * need it, and the screen draws a swatch in a `<select>`. `globals.css`
   * mirrors these as `--camp-colour-*` for everything that *is* styling — see
   * [[spsm-design-tokens-contract]]: what is stored is the value, never a CSS
   * string.
   */
  hex: string;
  /** Text that stays legible on `hex`. Precomputed rather than derived, because
      a contrast calculation at render time is a lot of arithmetic to answer a
      question with twelve possible answers. */
  ink: string;
}

/**
 * The twelve group colours.
 *
 * ---------------------------------------------------------------------------
 * A closed list, and the reason is the printer as much as the screen.
 *
 * Colour here is not decoration: it is how a servant standing in a hall finds
 * their group, and how the wristbands, the name tags and the exported
 * spreadsheet all agree. A free colour picker produces two greens nobody can
 * tell apart on a laminated card, which is the exact failure this is meant to
 * prevent. Twelve distinguishable hues, named, is the useful shape.
 *
 * They are deliberately *not* the parish palette. The site is oxblood and
 * parchment; a group colour has to be told apart from eleven others at three
 * metres, which is a different job from looking like the church's website.
 * ---------------------------------------------------------------------------
 */
export const CAMP_COLOURS = [
  { value: 'red', label: 'Red', hex: '#C62828', ink: '#FFFFFF' },
  { value: 'orange', label: 'Orange', hex: '#E65100', ink: '#FFFFFF' },
  { value: 'amber', label: 'Amber', hex: '#F9A825', ink: '#2A2118' },
  // Dark ink, like amber. White on #9E9D24 is about 3:1, which fails for the
  // group headers these now fill — and a group's name being hard to read is
  // exactly the failure a colour-coded roster cannot afford.
  { value: 'lime', label: 'Lime', hex: '#9E9D24', ink: '#2A2118' },
  { value: 'green', label: 'Green', hex: '#2E7D32', ink: '#FFFFFF' },
  { value: 'teal', label: 'Teal', hex: '#00796B', ink: '#FFFFFF' },
  // Same again: white on #0097A7 is about 3.4:1.
  { value: 'cyan', label: 'Cyan', hex: '#0097A7', ink: '#2A2118' },
  { value: 'blue', label: 'Blue', hex: '#1565C0', ink: '#FFFFFF' },
  { value: 'indigo', label: 'Indigo', hex: '#3949AB', ink: '#FFFFFF' },
  { value: 'violet', label: 'Violet', hex: '#6A1B9A', ink: '#FFFFFF' },
  { value: 'pink', label: 'Pink', hex: '#C2185B', ink: '#FFFFFF' },
  { value: 'brown', label: 'Brown', hex: '#5D4037', ink: '#FFFFFF' },
] as const satisfies readonly { value: string; label: string; hex: string; ink: string }[];

export type CampColour = (typeof CAMP_COLOURS)[number]['value'];

const COLOUR_VALUES = new Set<string>(CAMP_COLOURS.map((colour) => colour.value));

export function isCampColour(value: unknown): value is CampColour {
  return typeof value === 'string' && COLOUR_VALUES.has(value);
}

export function campColour(value: CampColour): CampColourOption {
  return (
    (CAMP_COLOURS as readonly CampColourOption[]).find((colour) => colour.value === value) ??
    (CAMP_COLOURS[0] as CampColourOption)
  );
}

/**
 * The next colour nobody has used yet.
 *
 * Falls back to cycling once all twelve are spoken for, rather than refusing or
 * returning the same one forever. A thirteenth band sharing a colour with the
 * first is a nuisance the administrator can fix; a band that will not be created
 * is a screen that does not work.
 */
export function nextCampColour(taken: readonly CampColour[]): CampColour {
  const used = new Set(taken);
  for (const colour of CAMP_COLOURS) {
    if (!used.has(colour.value)) return colour.value;
  }
  return CAMP_COLOURS[taken.length % CAMP_COLOURS.length]!.value;
}

/* ---------------------------------------------------------------------------
 * Keys
 * ------------------------------------------------------------------------ */

/**
 * How a person is referred to inside an allocation.
 *
 * ---------------------------------------------------------------------------
 * A string, not a `{ registrationId, childId }` map, and that is a considered
 * choice rather than laziness.
 *
 * These keys are compared constantly: is this child already placed, is this the
 * one being dragged, which group holds them. With a map that is a field-by-field
 * comparison written out at every call site, and the first place somebody
 * forgets is a child silently placed twice. With a string it is `===`, and
 * `Set` and `Map` work on them directly.
 *
 * The format is `registrationId/childId` for a child and a bare `registrationId`
 * for a servant, so the two are told apart by whether a slash is present.
 * Neither id ever contains one: both are generated by `campLineId`, which emits
 * `prefix-base36-base36`. `parsePersonKey` checks anyway, because a document
 * that has been edited in a console is not a document that promises anything.
 * ---------------------------------------------------------------------------
 */
export type CampPersonKey = string;

export function childKey(registrationId: string, childId: string): CampPersonKey {
  return `${registrationId}/${childId}`;
}

export function servantKey(registrationId: string): CampPersonKey {
  return registrationId;
}

export interface ParsedPersonKey {
  kind: 'child' | 'servant';
  registrationId: string;
  /** Empty for a servant. */
  childId: string;
}

export function parsePersonKey(key: unknown): ParsedPersonKey | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  const slash = trimmed.indexOf('/');
  if (slash === -1) return { kind: 'servant', registrationId: trimmed, childId: '' };

  const registrationId = trimmed.slice(0, slash);
  const childId = trimmed.slice(slash + 1);
  // A trailing slash, a leading one, or a second slash is not a key we wrote.
  if (!registrationId || !childId || childId.includes('/')) return null;
  return { kind: 'child', registrationId, childId };
}

/* ---------------------------------------------------------------------------
 * The document
 * ------------------------------------------------------------------------ */

/**
 * One subgroup: the unit a child actually belongs to and a servant actually
 * leads. "Blue 1", "Cherubim", whatever the camp calls them.
 */
/**
 * One subgroup: the unit a child actually belongs to and a servant actually
 * leads. "Blue 1", "Cherubim", whatever the camp calls them.
 *
 * ---------------------------------------------------------------------------
 * **A group has no colour of its own.** It wears its panel's, and that is a
 * reversal worth recording because the opposite was argued for here and built:
 * a colour each, on the reasoning that a wristband should say which of the
 * three 3rd-and-4th-grade groups a child is in.
 *
 * Tommy chose the other way — *"the entire grade or group of grades is 1
 * colour"* — and it is the camp's call to make, not the schema's. It is also
 * the simpler thing to run: twelve colours across nine panels is a colour that
 * means a grade, which a parent at the gate can be told; twelve colours across
 * twenty-seven groups is a colour that means nothing without a chart.
 *
 * So there is no field. A field that must always equal its parent's is a field
 * that will eventually disagree with it, and then two screens will draw the
 * same group in two colours.
 * ---------------------------------------------------------------------------
 */
export interface CampGroup {
  id: string;
  name: string;
  /** Children, in the order the administrator arranged them. */
  childKeys: CampPersonKey[];
  /** The servants who stay with this group. */
  servantKeys: CampPersonKey[];
  /**
   * Which of `servantKeys` leads this group. Empty when nobody does yet.
   *
   * A key into the list beside it rather than a separate placement, and that is
   * the whole design: a servant is in exactly one place in a week, and being
   * the leader is something about *the place they are in*, not a second place.
   * So "they can only lead one thing" needs no rule of its own — it falls out
   * of the invariant that was already there. `placeServant` clears this when
   * the leader is moved away, because a group whose leader is somewhere else is
   * a roster that lies.
   */
  leaderKey: CampPersonKey;
  note: string;
}

/**
 * A band of grades run together: "3rd & 4th", "Pre-K and Kindergarten".
 *
 * ---------------------------------------------------------------------------
 * The middle level, and the request's own shape: *"group grades together,
 * separate those grades into subgroups — for example 3 groups of 3rd and 4th
 * graders"*. Two levels rather than one because they answer different questions
 * and are decided at different times. Which grades run together is a decision
 * about the camp's shape, made once, before anybody has registered. Which of
 * the three groups a particular child is in is decided per child, in the week
 * before, and changed repeatedly.
 *
 * `grades` is not a rule and does not stop anybody. It drives the pool filter —
 * "show me the children this band is for" — and it is what makes the ordinary
 * case one click instead of forty drags. A child dragged into a group whose
 * band does not list their grade is placed, and flagged on the card, because
 * every camp has the eight-year-old who has to be with their cousin.
 * ---------------------------------------------------------------------------
 */
export interface CampBand {
  id: string;
  name: string;
  grades: CampGrade[];
  colour: CampColour;
  groups: CampGroup[];
  note: string;
}

/**
 * An activity, and the servants who run it.
 *
 * No timetable, deliberately — this records who is on sports and who is in the
 * kitchen, not which group is where at eleven o'clock. A rotation grid was
 * offered and not taken; if the camp ever runs a fixed rotation it is a
 * `slots` field on this interface and a second view, not a different shape.
 */
export interface CampStation {
  id: string;
  name: string;
  /**
   * Which half of the camp runs it.
   *
   * ---------------------------------------------------------------------------
   * Stations were camp-wide for one afternoon and it was wrong. They belong to
   * a section: elementary runs its own sports and middle school runs its own,
   * at different times, in different rooms, with different servants — and the
   * person arranging elementary should not be looking at, or able to break,
   * middle school's kitchen rota.
   *
   * Stored rather than derived, because unlike a child's section there is
   * nothing to derive it from. A station is a name somebody typed.
   * ---------------------------------------------------------------------------
   */
  section: CampSection;
  colour: CampColour;
  /** "The hall", "Field 2". Free text; the parish's rooms have no ids. */
  location: string;
  servantKeys: CampPersonKey[];
  /** Which of `servantKeys` runs it. Same rule as `CampGroup.leaderKey`. */
  leaderKey: CampPersonKey;
  note: string;
}

export interface CampAllocation extends AuditFields {
  /** The ministry. `firestore.rules` reads this to decide the grant, exactly as
      it does on a registration. */
  programId: string;
  /** The season this arrangement belongs to. One allocation per season — see
      `allocationDocId`. */
  season: string;

  /**
   * The grade bands, and the groups inside them. **One set for the whole camp.**
   *
   * ---------------------------------------------------------------------------
   * This was `weeks: CampWeekBoard[]` until 2 Sep 2026 and the change is the
   * single largest simplification in the rebuild. The argument for per-week
   * boards was real — different children come different weeks, and a servant
   * who can do the first week and not the second is the ordinary case — but the
   * cost was paid on every screen: two boards to arrange, a `linked` flag, a
   * structure-comparison function, a sync that pushed names and colours across
   * while leaving placements alone, and a rule about which edits detached a
   * week. Tommy scrapped it: *"so complicated for such a simple task."*
   *
   * What replaces it costs nothing, because the fact the weeks were expressing
   * is **already recorded somewhere better**. Every child and every servant
   * carries `days` — `w1-mon`, `w2-wed` — on their registration. A child who
   * comes only in week two is in their group all summer and simply is not there
   * on week one's register; the attendance screen reads the days and never asks
   * this document. So a group is what it always was in the camp's own head:
   * "Mariam is in 3rd grade, Blue."
   *
   * What is genuinely lost is a camp that runs *different groups* in week two —
   * and that camp writes the second week's names over the first week's, which
   * is a morning's work once a year against a fortnight of confusion every day.
   * ---------------------------------------------------------------------------
   */
  bands: CampBand[];

  /** The activities and the servants who run them. Camp-wide, like the bands. */
  stations: CampStation[];
  /**
   * Set when the season has been rolled over, and the board becomes read-only.
   *
   * "Clear all for next year" does not delete anything: it stamps this, and
   * rolls `config/camp.season` forward so the live board opens empty on a new
   * document. Last summer stays exactly as it was left, openable from the year
   * list, because the question "who was Marina with last year" is asked every
   * June and a deleted board cannot answer it.
   */
  archivedAt: unknown | null;
  archivedBy: string | null;
  note: string;
}

export type CampAllocationDraft = Omit<CampAllocation, keyof AuditFields>;

/**
 * The document id, from the program and the season.
 *
 * ---------------------------------------------------------------------------
 * A derived id rather than a random one, because there must be exactly one
 * allocation per season and a random id cannot express that. With
 * `addDoc` two administrators opening the screen at the same moment on a season
 * nobody has allocated yet produce two allocations, and neither of them ever
 * finds out — they each drag half the camp into a document the other cannot
 * see. A deterministic id makes that case a normal edit conflict instead: they
 * are both writing the same document, and the last save wins loudly rather than
 * the work forking silently.
 *
 * The separator is `__` rather than `/`, which would make it a subcollection
 * path, or `-`, which both ids already contain.
 * ---------------------------------------------------------------------------
 */
export function allocationDocId(programId: string, season: string): string {
  return `${programId}__${season}`;
}

export function allocationLineId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------------------------------------------------------------------------
 * Blanks
 * ------------------------------------------------------------------------ */

export function blankAllocation(programId: string, season: string): CampAllocationDraft {
  return {
    programId,
    season,
    bands: [],
    stations: [],
    archivedAt: null,
    archivedBy: null,
    note: '',
  };
}

export function blankGroup(name: string): CampGroup {
  return {
    id: allocationLineId('group'),
    name,
    childKeys: [],
    servantKeys: [],
    leaderKey: '',
    note: '',
  };
}

export function blankBand(name: string, grades: CampGrade[], colour: CampColour): CampBand {
  return { id: allocationLineId('band'), name, grades, colour, groups: [], note: '' };
}

export function blankStation(
  name: string,
  colour: CampColour,
  section: CampSection = 'elementary',
): CampStation {
  return {
    id: allocationLineId('station'),
    name,
    section,
    colour,
    location: '',
    servantKeys: [],
    leaderKey: '',
    note: '',
  };
}

/**
 * A readable name for a panel covering these grades: "3rd & 4th grade".
 *
 * Used only as the *suggested* name when a panel is created or merged. The camp
 * names its own panels and the name is stored, so renaming one never changes
 * which grades it covers — which is why the two are separate fields rather than
 * the name being computed on every render.
 */
export function suggestBandName(grades: readonly CampGrade[]): string {
  const ordered = [...grades].sort(
    (a, b) => CAMP_GRADES.indexOf(a) - CAMP_GRADES.indexOf(b),
  );
  if (ordered.length === 0) return 'New panel';
  // "3rd grade", not "Grade 3" — a panel heading is read as a phrase, and the
  // ordinal is how the camp says it out loud.
  if (ordered.length === 1) {
    const only = ordered[0]!;
    return only === 'k' ? 'Kindergarten' : `${ordinal(Number(only))} grade`;
  }

  const parts = ordered.map((grade) =>
    grade === 'k' ? 'Kindergarten' : ordinal(Number(grade)),
  );
  const last = parts.pop()!;
  const head = parts.join(', ');
  const numeric = ordered.every((grade) => grade !== 'k');
  return `${head} & ${last}${numeric ? ' grade' : ''}`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`;
}

/** A name the panel does not already use: the lowest free `Group N`.
 *
 * ---------------------------------------------------------------------------
 * Only ever a *suggestion*. The camp renames most groups within the hour —
 * "Blue 1", "Cherubim" — and the number exists to be unique and unsurprising
 * until it does. Which is exactly why counting matters: two groups both called
 * "Group 1" are told apart on the board only by position, and the attendance
 * register heads its sections `panel · group`, so a servant looking for their
 * own register finds two identical headings and cannot pick.
 *
 * The lowest *free* number rather than `groups.length + 1`, because a panel's
 * names and its length come apart the moment the camp touches either: a panel
 * holding only "Cherubim" is offered "Group 1", not "Group 2", and a panel that
 * has lost the second of its three is offered the gap back. Terminates because
 * `length + 1` candidates cannot all be taken by `length` names.
 * ---------------------------------------------------------------------------
 */
export function suggestGroupName(groups: readonly CampGroup[]): string {
  const taken = new Set(groups.map((group) => group.name.trim()));
  let n = 1;
  while (taken.has(`Group ${n}`)) n += 1;
  return `Group ${n}`;
}

/**
 * Renumber the default-named groups of a freshly merged panel.
 *
 * A merge concatenates two panels' groups, and two panels seeded from scratch
 * both start with a "Group 1" — so the merged panel gets two, which is the bug
 * this exists to stop. Walks in order and only ever touches a name still of the
 * form `Group N`: that is a number this file chose, and renumbering it is
 * bookkeeping. A name the camp typed is left exactly as it is even where it
 * collides, because two groups the camp deliberately called "Cherubim" are its
 * business, and inventing a replacement loses more than the duplicate costs.
 */
function renumberDefaultNames(groups: readonly CampGroup[]): CampGroup[] {
  const kept: CampGroup[] = [];
  for (const group of groups) {
    const taken = kept.some((entry) => entry.name.trim() === group.name.trim());
    const isDefault = /^Group \d+$/.test(group.name.trim());
    kept.push(taken && isDefault ? { ...group, name: suggestGroupName(kept) } : group);
  }
  return kept;
}

/* ---------------------------------------------------------------------------
 * Panels
 * ------------------------------------------------------------------------ */

/**
 * Which half of the camp a set of grades belongs to.
 *
 * `null` when the grades straddle the two halves, or when there are none. The
 * screen refuses to build such a panel — the two halves are two views of one
 * board and a panel belonging to both belongs to neither. It is still a state
 * the document can be in, because a document edited in a console can say
 * anything, so every reader has to answer `null` for it rather than assume.
 */
export function panelSection(grades: readonly CampGrade[]): CampSection | null {
  const found = new Set<CampSection>();
  for (const grade of grades) {
    const section = campSectionForGrade(grade);
    if (section) found.add(section);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/**
 * Whether somebody should be offered in a panel covering these grades.
 *
 * The two kinds are asked different questions and that asymmetry is the whole
 * point. A child has a grade, so the answer is exact. A servant has only the
 * half of the camp they volunteered for, so the answer is "yes, along with
 * every other elementary servant" — six panels offer the same person, and the
 * one-person-one-place invariant is what stops that being a problem: placing
 * them in 3rd grade takes them out of the other five lists at once.
 */
export function eligibleForPanel(
  person: Pick<CampPerson, 'kind' | 'grade' | 'sections'>,
  grades: readonly CampGrade[],
): boolean {
  if (person.kind === 'child') return person.grade != null && grades.includes(person.grade);
  return grades.some((grade) => {
    const section = campSectionForGrade(grade);
    return section != null && person.sections.includes(section);
  });
}

/**
 * The nine panels a season opens with: K to 5th, then 6th to 8th.
 *
 * One grade each, deliberately, and merging is the camp's job rather than
 * ours. Guessing the pairings — K&1, 2&3 — reads as a decision the parish made
 * and did not; a camp that runs 3rd and 4th together says so by merging them,
 * and a camp that does not never has to undo anything.
 */
export function starterPanels(): { name: string; grades: CampGrade[] }[] {
  return CAMP_SECTIONS.flatMap((section) =>
    campGradesForSection(section).map((grade) => ({
      name: suggestBandName([grade]),
      grades: [grade],
    })),
  );
}

/* ---------------------------------------------------------------------------
 * Moving people about
 * ------------------------------------------------------------------------ */

/**
 * Where a person can be put down.
 *
 * `null` is the pool — dragging somebody back out to the available list. It is
 * a real destination rather than a separate `remove` function, because the
 * screen treats the pool as one more drop target and one code path for every
 * drop is what keeps "a person is in exactly one place" true by construction.
 */
export type CampDropTarget =
  | { kind: 'group'; bandId: string; groupId: string }
  | { kind: 'station'; stationId: string }
  | null;

/**
 * Move a child into a group, or back to the pool.
 *
 * Removes the key from every group first, unconditionally, then inserts. That
 * order is the whole point: a drag from group A to group B and a drag onto the
 * group a child is already in both go through here, and the second one must be
 * a reorder rather than a duplicate.
 *
 * `index` is where in the destination's list to put them — the drop position.
 * Out-of-range values append, which is what a drop on the empty space below the
 * last card means.
 *
 * Returns a new draft. Nothing here mutates: the screen holds the allocation in
 * React state and an in-place edit of a nested array is a render that does not
 * happen.
 */
export function placeChild(
  board: CampAllocationDraft,
  key: CampPersonKey,
  target: CampDropTarget,
  index = Number.MAX_SAFE_INTEGER,
): CampAllocationDraft {
  // A child has no business on a station: stations hold the servants who run
  // them. Refusing here rather than at the drop site means every caller gets it
  // right, including a keyboard "move to…" menu written later.
  if (target?.kind === 'station') return board;

  const bands = board.bands.map((band) => ({
    ...band,
    groups: band.groups.map((group) => {
      const without = group.childKeys.filter((existing) => existing !== key);
      if (target?.kind !== 'group' || target.groupId !== group.id) {
        // Identity preserved when nothing was removed, so the groups this drag
        // did not touch do not re-render.
        return without.length === group.childKeys.length ? group : { ...group, childKeys: without };
      }
      if (without.length >= MAX_PLACEMENTS_PER_GROUP) return { ...group, childKeys: without };
      const at = Math.max(0, Math.min(index, without.length));
      return { ...group, childKeys: [...without.slice(0, at), key, ...without.slice(at)] };
    }),
  }));

  return { ...board, bands };
}

/**
 * Move a servant into a group, onto a station, or back to the pool.
 *
 * Groups and stations are swept together in one pass, which is what enforces
 * "a servant is in at most one place" across both kinds of destination. A
 * servant dragged from the sports station onto group two leaves the station in
 * the same operation, and the available list is correct without anybody having
 * had to remember a second step.
 */
export function placeServant(
  board: CampAllocationDraft,
  key: CampPersonKey,
  target: CampDropTarget,
  index = Number.MAX_SAFE_INTEGER,
): CampAllocationDraft {
  /*
   * Leaving a place gives up leading it.
   *
   * Without this, dragging the leader of Group 1 onto the sports station leaves
   * `leaderKey` pointing at somebody who is no longer in the group — and
   * `leaderKey` is a key, so nothing about the group looks wrong until the
   * spreadsheet prints a leader who is on a field. Cleared on the way out, in
   * the same pass that removes them, so the two cannot drift apart.
   */
  const shed = (place: { servantKeys: CampPersonKey[]; leaderKey: CampPersonKey }) =>
    place.leaderKey === key ? '' : place.leaderKey;

  const bands = board.bands.map((band) => ({
    ...band,
    groups: band.groups.map((group) => {
      const without = group.servantKeys.filter((existing) => existing !== key);
      if (target?.kind !== 'group' || target.groupId !== group.id) {
        return without.length === group.servantKeys.length
          ? group
          : { ...group, servantKeys: without, leaderKey: shed(group) };
      }
      if (without.length >= MAX_PLACEMENTS_PER_GROUP) {
        return { ...group, servantKeys: without, leaderKey: shed(group) };
      }
      const at = Math.max(0, Math.min(index, without.length));
      return { ...group, servantKeys: [...without.slice(0, at), key, ...without.slice(at)] };
    }),
  }));

  const stations = board.stations.map((station) => {
    const without = station.servantKeys.filter((existing) => existing !== key);
    if (target?.kind !== 'station' || target.stationId !== station.id) {
      return without.length === station.servantKeys.length
        ? station
        : { ...station, servantKeys: without, leaderKey: shed(station) };
    }
    if (without.length >= MAX_PLACEMENTS_PER_GROUP) {
      return { ...station, servantKeys: without, leaderKey: shed(station) };
    }
    const at = Math.max(0, Math.min(index, without.length));
    return { ...station, servantKeys: [...without.slice(0, at), key, ...without.slice(at)] };
  });

  return { ...board, bands, stations };
}

/**
 * Make a servant the leader of the place they are already in, or take it back.
 *
 * Refuses a key that is not in that place's `servantKeys`. There is no such
 * thing as leading a group you are not in, and allowing it would produce the
 * exact state `placeServant` goes out of its way to prevent.
 *
 * Nothing needs to check whether they lead something else, and that is the
 * point of storing it this way: a servant is in one place per week, so they can
 * be leading at most one thing, and "group leader or station leader, not both"
 * is a consequence rather than a rule anybody has to enforce.
 */
export function setLeader(
  board: CampAllocationDraft,
  target: CampDropTarget,
  key: CampPersonKey,
): CampAllocationDraft {
  if (!target) return board;

  if (target.kind === 'group') {
    return {
      ...board,
      bands: board.bands.map((band) =>
        band.id !== target.bandId
          ? band
          : {
              ...band,
              groups: band.groups.map((group) => {
                if (group.id !== target.groupId) return group;
                if (key !== '' && !group.servantKeys.includes(key)) return group;
                // Clicking the current leader takes the mark off.
                return { ...group, leaderKey: group.leaderKey === key ? '' : key };
              }),
            },
      ),
    };
  }

  return {
    ...board,
    stations: board.stations.map((station) => {
      if (station.id !== target.stationId) return station;
      if (key !== '' && !station.servantKeys.includes(key)) return station;
      return { ...station, leaderKey: station.leaderKey === key ? '' : key };
    }),
  };
}

/** Every placement in the allocation, for the `MAX_PLACEMENTS` guard. The cap
    is on the document, because that is what Firestore limits. */
export function countPlacements(draft: CampAllocationDraft): number {
  let total = 0;
  for (const band of draft.bands) {
    for (const group of band.groups) total += group.childKeys.length + group.servantKeys.length;
  }
  for (const station of draft.stations) total += station.servantKeys.length;
  return total;
}

/* ---------------------------------------------------------------------------
 * Resolving an allocation against the season's registrations
 * ------------------------------------------------------------------------ */

/** A child or a servant, flattened out of the registrations for the screen. */
export interface CampPerson {
  key: CampPersonKey;
  kind: 'child' | 'servant';
  registrationId: string;
  name: string;
  /** Children only. Null on a servant. */
  grade: CampGrade | null;
  /**
   * Whole years old, or null when no birth date was recorded.
   *
   * Computed here rather than on the chip so that the board, the export and any
   * later screen agree — and so the *date* the age was taken against is a
   * single decision. `campPeople` takes it as an argument for that reason: an
   * archived 2027 board asked in 2029 should say how old somebody was that
   * summer, not how old they are now.
   */
  age: number | null;
  shirtSize: string;
  /** Day keys, from the registration. */
  days: string[];
  /** Children only: what the kitchen and the first-aid box need. */
  allergies: string;
  medicalNotes: string;
  /** Servants only: what they were given, else what they asked for. */
  roles: string[];
  /**
   * Servants only. Empty on a child, whose section is read off `grade`.
   *
   * This is what makes a servant available in a *grade* panel at all. A servant
   * never picks a grade — the registration form asks which half of the camp
   * they want, and nothing finer — so "who can I put in 3rd grade" resolves to
   * "every elementary servant who is not already somewhere". A servant who
   * ticked both halves is offered in all nine panels; one who ticked neither is
   * offered in none, and the panel says so rather than hiding them.
   */
  sections: CampSection[];
  /** Servants only: safeguarding paperwork done. */
  cleared: boolean;
  /** Servants only: "mornings only", "can drive on the Friday". The day grid
      cannot say either, and both change who can lead a group. */
  availability: string;
  /** Who to ring — the guardian on a child, the servant themself on a servant. */
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  emergencyName: string;
  emergencyPhone: string;
  /** True when the registration is `withdrawn`. Placed and withdrawn is a state
      the screen has to show rather than quietly resolve. */
  withdrawn: boolean;
}

/** Every person in a season, flattened, in the order the registrations were
    sorted in. Registrations that are `draft` are included — a child registered
    at a desk five minutes ago has to be allocatable. */
export function campPeople(
  registrations: readonly (CampRegistration & { id: string })[],
  /** The day ages are taken against. Pass the season's own summer when reading
      an archived board; defaults to today, which is right for the live one. */
  on: Date = new Date(),
): CampPerson[] {
  const people: CampPerson[] = [];

  for (const registration of registrations) {
    if (registration.kind === 'servant') {
      const servant = registration.servant;
      people.push({
        key: servantKey(registration.id),
        kind: 'servant',
        registrationId: registration.id,
        name: registration.contact.name || 'Unnamed servant',
        grade: null,
        age: campAge(servant?.dateOfBirth ?? '', on),
        shirtSize: servant?.shirtSize ?? '',
        days: servant?.days ?? [],
        allergies: '',
        medicalNotes: '',
        // Assigned wins when there is one; otherwise show what they asked for,
        // which is the only thing anybody knows about them before allocation.
        roles:
          servant && servant.assignedRoles.length > 0
            ? servant.assignedRoles
            : (servant?.desiredRoles ?? []),
        cleared: servant?.cleared ?? false,
        availability: servant?.availability ?? '',
        sections: servant?.sections ?? [],
        contactName: registration.contact.name,
        contactPhone: registration.contact.phone,
        contactEmail: registration.contact.email,
        emergencyName: registration.emergency.name,
        emergencyPhone: registration.emergency.phone,
        withdrawn: registration.status === 'withdrawn',
      });
      continue;
    }

    for (const child of registration.children) {
      people.push({
        key: childKey(registration.id, child.id),
        kind: 'child',
        registrationId: registration.id,
        name: fullName(child),
        grade: child.grade,
        age: campAge(child.dateOfBirth, on),
        shirtSize: child.shirtSize,
        days: child.days,
        allergies: child.allergies,
        medicalNotes: child.medicalNotes,
        roles: [],
        cleared: false,
        availability: '',
        sections: [],
        contactName: registration.contact.name,
        contactPhone: registration.contact.phone,
        contactEmail: registration.contact.email,
        emergencyName: registration.emergency.name,
        emergencyPhone: registration.emergency.phone,
        withdrawn: registration.status === 'withdrawn',
      });
    }
  }

  return people;
}

function fullName(child: CampChild): string {
  const name = `${child.firstName} ${child.lastName}`.trim();
  return name || 'Unnamed child';
}

/**
 * A key that is placed somewhere but matches nobody in the season.
 *
 * A registration deleted after its children were allocated, or an allocation
 * left over from a season whose registrations have been cleared out. Reported
 * rather than swept up automatically: silently dropping placements on read
 * would mean an allocation quietly loses a group's worth of children the first
 * time somebody opens it with a slow network and a half-loaded registration
 * list. The screen offers to clear them; nothing does it unasked.
 */
export interface DanglingPlacement {
  key: CampPersonKey;
  where: string;
}

export interface ResolvedAllocation {
  /** Every person in the season, by key. */
  byKey: Map<CampPersonKey, CampPerson>;
  /** Where each placed person is, by key — the reverse index the screen needs
      to answer "is this one already somewhere" without walking every group. */
  placement: Map<CampPersonKey, CampDropTarget>;
  /** Children in no group, in registration order. */
  freeChildren: CampPerson[];
  /** Servants in no group and on no station. */
  freeServants: CampPerson[];
  /** Placed keys matching nobody. */
  dangling: DanglingPlacement[];
  /** Placed in a group whose band does not list their grade. Not an error —
      see `CampBand.grades` — but the card says so. */
  offBand: CampPersonKey[];
}

export function resolveAllocation(
  board: CampAllocationDraft,
  people: readonly CampPerson[],
): ResolvedAllocation {
  const byKey = new Map<CampPersonKey, CampPerson>();
  for (const person of people) byKey.set(person.key, person);

  const placement = new Map<CampPersonKey, CampDropTarget>();
  const dangling: DanglingPlacement[] = [];
  const offBand: CampPersonKey[] = [];

  for (const band of board.bands) {
    const grades = new Set(band.grades);
    for (const group of band.groups) {
      const where = `${band.name} · ${group.name}`;
      const target: CampDropTarget = { kind: 'group', bandId: band.id, groupId: group.id };

      for (const key of group.childKeys) {
        const person = byKey.get(key);
        if (!person) {
          dangling.push({ key, where });
          continue;
        }
        placement.set(key, target);
        if (grades.size > 0 && person.grade && !grades.has(person.grade)) offBand.push(key);
      }
      for (const key of group.servantKeys) {
        if (!byKey.has(key)) dangling.push({ key, where });
        else placement.set(key, target);
      }
    }
  }

  for (const station of board.stations) {
    const target: CampDropTarget = { kind: 'station', stationId: station.id };
    for (const key of station.servantKeys) {
      if (!byKey.has(key)) dangling.push({ key, where: station.name });
      else placement.set(key, target);
    }
  }

  const freeChildren: CampPerson[] = [];
  const freeServants: CampPerson[] = [];
  for (const person of people) {
    if (placement.has(person.key)) continue;
    if (person.kind === 'child') freeChildren.push(person);
    else freeServants.push(person);
  }

  return { byKey, placement, freeChildren, freeServants, dangling, offBand };
}

/** Drop every placement that matches nobody. Only ever called from a button the
    administrator pressed, having been told how many there are. */
export function dropDangling(
  board: CampAllocationDraft,
  people: readonly CampPerson[],
): CampAllocationDraft {
  const known = new Set(people.map((person) => person.key));
  const keep = (key: CampPersonKey) => known.has(key);
  // A leader who matched nobody stops being one, for the same reason
  // `placeServant` sheds the mark: a name on a spreadsheet with no registration
  // behind it is worse than a group with no leader named.
  const lead = (key: CampPersonKey) => (known.has(key) ? key : '');

  return {
    ...board,
    bands: board.bands.map((band) => ({
      ...band,
      groups: band.groups.map((group) => ({
        ...group,
        childKeys: group.childKeys.filter(keep),
        servantKeys: group.servantKeys.filter(keep),
        leaderKey: lead(group.leaderKey),
      })),
    })),
    stations: board.stations.map((station) => ({
      ...station,
      servantKeys: station.servantKeys.filter(keep),
      leaderKey: lead(station.leaderKey),
    })),
  };
}

/**
 * Deal a band's unplaced children evenly across its groups.
 *
 * ---------------------------------------------------------------------------
 * The one automatic placement on the screen, and it is deliberately the dumbest
 * one that is useful: take the children of this band's grades who are in no
 * group, and deal them round-robin into the band's groups, smallest first.
 *
 * Not balanced by anything cleverer — not by age, not by keeping siblings
 * together, not by separating the two who cannot sit near each other. All three
 * of those are real considerations and none of them is in this data; a camp
 * director knows them and a round-robin does not pretend to. What this saves is
 * the forty drags before the six that matter, and it only ever moves children
 * who are in no group at all, so it can never undo a decision somebody made.
 * ---------------------------------------------------------------------------
 */
export function dealBand(
  board: CampAllocationDraft,
  bandId: string,
  people: readonly CampPerson[],
): CampAllocationDraft {
  const band = board.bands.find((entry) => entry.id === bandId);
  if (!band || band.groups.length === 0) return board;

  const resolved = resolveAllocation(board, people);
  const grades = new Set(band.grades);
  const waiting = resolved.freeChildren.filter(
    (person) => !person.withdrawn && (grades.size === 0 || (person.grade && grades.has(person.grade))),
  );
  if (waiting.length === 0) return board;

  // A working copy of just this band's lists. Dealing into `draft` one child at
  // a time through `placeChild` would be correct and would rebuild every band
  // in the allocation once per child.
  const buckets = band.groups.map((group) => [...group.childKeys]);

  for (const person of waiting) {
    let smallest = 0;
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index]!.length < buckets[smallest]!.length) smallest = index;
    }
    if (buckets[smallest]!.length >= MAX_PLACEMENTS_PER_GROUP) break;
    buckets[smallest]!.push(person.key);
  }

  return {
    ...board,
    bands: board.bands.map((entry) =>
      entry.id !== bandId
        ? entry
        : {
            ...entry,
            groups: entry.groups.map((group, index) => ({ ...group, childKeys: buckets[index]! })),
          },
    ),
  };
}

/* ---------------------------------------------------------------------------
 * Writing the arrangement back onto the registrations
 * ------------------------------------------------------------------------ */

export interface GroupNameUpdate {
  registrationId: string;
  childId: string;
  /** The group this child is in now — `"3rd & 4th · Blue 1"`. Empty when they
      are in none. */
  groupName: string;
}

/**
 * Which registrations need their children's `groupName` corrected.
 *
 * ---------------------------------------------------------------------------
 * The allocation is the record; `CampChild.groupName` is a copy, and this is
 * the only thing that writes it.
 *
 * Keeping the copy at all is a deliberate cost. It exists because `groupName`
 * is already read by the registration screen and by whatever the camp prints
 * from a single registration — a family looking up which group their child is
 * in should not need this screen to be open. What makes a copy safe is that it
 * is written in exactly one direction, from here, by an explicit action, and
 * that this function computes the *difference* rather than rewriting every
 * registration: a season with two hundred children produces a handful of writes
 * after a small change, not two hundred.
 *
 * Returns one entry per child whose stored name disagrees, including the ones
 * that should be cleared. The caller groups them by registration, because a
 * registration is the document.
 * ---------------------------------------------------------------------------
 */
export function groupNameUpdates(
  draft: CampAllocationDraft,
  registrations: readonly (CampRegistration & { id: string })[],
): GroupNameUpdate[] {
  /*
   * One label per child: "3rd & 4th · Blue 1".
   *
   * This was a per-week sentence — "W1 3rd grade · Group 1; W2 3rd grade ·
   * Group 2" — assembled because `groupName` is one string and the board was
   * two. With one set of groups for the whole camp the two fit one-to-one
   * again, and a parent reading their registration gets a name rather than a
   * sentence they have to parse.
   */
  const wanted = new Map<CampPersonKey, string>();
  for (const band of draft.bands) {
    for (const group of band.groups) {
      const label = `${band.name} · ${group.name}`.slice(0, MAX_ALLOCATION_LINE * 2);
      for (const key of group.childKeys) wanted.set(key, label);
    }
  }

  const updates: GroupNameUpdate[] = [];
  for (const registration of registrations) {
    if (registration.kind !== 'family') continue;
    for (const child of registration.children) {
      const name = wanted.get(childKey(registration.id, child.id)) ?? '';
      if (name === child.groupName) continue;
      updates.push({ registrationId: registration.id, childId: child.id, groupName: name });
    }
  }
  return updates;
}

/* ---------------------------------------------------------------------------
 * Reading a stored document
 * ------------------------------------------------------------------------ */

/**
 * Coerce anything out of Firestore into an allocation.
 *
 * Tolerant in the same way `parseCampRegistration` is: nothing throws, a
 * malformed band becomes an empty one rather than taking the screen down, and
 * duplicate keys are dropped on the way in. That last one is the important
 * defence — the "one placement each" invariant is enforced by `placeChild` and
 * `placeServant`, and a document edited in a console has been through neither.
 */
export function parseCampAllocation(raw: unknown): CampAllocation {
  const doc = asRecord(raw);

  /*
   * One `seen` set for the whole document.
   *
   * It is what makes "one placement each" true of a document nobody's screen
   * wrote: a key present in two groups keeps its first placement and is dropped
   * from the second, so a hand-edited document resolves to a child in one group
   * rather than one the board draws twice and the export counts twice.
   *
   * This was deliberately **per week** while the board was per week, because a
   * servant serving both weeks was two legitimate placements and a
   * document-wide set silently ate the second. With one arrangement for the
   * whole camp that case no longer exists — a servant is in one place, full
   * stop — and the wider set is the correct one again.
   *
   * Children and servants share it because their key spaces cannot collide: a
   * child's key contains a slash and a servant's does not.
   */
  const seen = new Set<CampPersonKey>();

  /*
   * A document written while the camp was arranged per week.
   *
   * Its bands and stations are inside `weeks[]`, and **week one is the
   * arrangement** — that is what the sync meant: every linked week held the
   * same panels, the same groups and the same names, differing only in who was
   * placed where. Reading week one therefore recovers the shape somebody spent
   * an afternoon on, and the later weeks' placements are the only thing lost.
   * Discarding the lot instead would open the June screen empty with all of it
   * still sitting in Firestore.
   */
  const weeks = list(doc['weeks']);
  const legacy = weeks.length > 0 ? asRecord(weeks[0]) : null;
  const bandsRaw = doc['bands'] ?? legacy?.['bands'];
  const stationsRaw = doc['stations'] ?? legacy?.['stations'];

  return {
    programId: str(doc['programId']) || 'summercamp',
    season: str(doc['season']),
    bands: list(bandsRaw)
      .slice(0, MAX_BANDS)
      .map((entry) => parseBand(entry, seen)),
    stations: list(stationsRaw)
      .slice(0, MAX_STATIONS)
      .map((entry) => parseStation(entry, seen)),
    archivedAt: doc['archivedAt'] ?? null,
    archivedBy: nullableStr(doc['archivedBy']),
    note: text(doc['note']),
    createdAt: (doc['createdAt'] ?? null) as CampAllocation['createdAt'],
    updatedAt: (doc['updatedAt'] ?? null) as CampAllocation['updatedAt'],
    updatedBy: nullableStr(doc['updatedBy']),
  };
}

function parseBand(raw: unknown, seen: Set<CampPersonKey>): CampBand {
  const doc = asRecord(raw);
  return {
    id: str(doc['id']) || allocationLineId('band'),
    name: str(doc['name']) || 'Band',
    grades: gradeList(doc['grades']),
    colour: isCampColour(doc['colour']) ? doc['colour'] : 'blue',
    groups: list(doc['groups'])
      .slice(0, MAX_GROUPS_PER_BAND)
      .map((entry) => parseGroup(entry, seen)),
    note: text(doc['note']),
  };
}

function parseGroup(raw: unknown, seen: Set<CampPersonKey>): CampGroup {
  const doc = asRecord(raw);
  const servantKeys = keyList(doc['servantKeys'], 'servant', seen);
  return {
    id: str(doc['id']) || allocationLineId('group'),
    name: str(doc['name']) || 'Group',
    childKeys: keyList(doc['childKeys'], 'child', seen),
    servantKeys,
    leaderKey: leaderOf(doc['leaderKey'], servantKeys),
    note: text(doc['note']),
  };
}

function parseStation(raw: unknown, seen: Set<CampPersonKey>): CampStation {
  const doc = asRecord(raw);
  const servantKeys = keyList(doc['servantKeys'], 'servant', seen);
  return {
    id: str(doc['id']) || allocationLineId('station'),
    name: str(doc['name']) || 'Station',
    // Elementary for a station stored before stations had a section. It is the
    // larger half of the camp and the one more likely to be right; either way
    // the station is visible and can be moved, which "drop it" would not be.
    section: isCampSection(doc['section']) ? doc['section'] : 'elementary',
    colour: isCampColour(doc['colour']) ? doc['colour'] : 'teal',
    location: str(doc['location']),
    servantKeys,
    leaderKey: leaderOf(doc['leaderKey'], servantKeys),
    note: text(doc['note']),
  };
}

/**
 * A stored leader, kept only if they survived the same parse that built the
 * list beside them.
 *
 * The dedupe above can drop a servant who appears twice in one week, and a
 * `leaderKey` pointing at somebody no longer in `servantKeys` is exactly the
 * state `placeServant` and `dropDangling` both go out of their way to prevent.
 * Enforced on the way in as well, because a hand-edited document has been
 * through neither of them.
 */
function leaderOf(value: unknown, servantKeys: readonly CampPersonKey[]): CampPersonKey {
  const key = str(value);
  return key !== '' && servantKeys.includes(key) ? key : '';
}

/* ---- coercion helpers -------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_ALLOCATION_LINE) : '';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, MAX_ALLOCATION_NOTE) : '';
}

function nullableStr(value: unknown): string | null {
  const out = typeof value === 'string' ? value.trim() : '';
  return out || null;
}

/** Known grades only, deduped, in the canonical order rather than the stored
    one — so two bands covering the same grades read identically. */
function gradeList(value: unknown): CampGrade[] {
  const found = new Set<CampGrade>();
  for (const entry of list(value)) if (isCampGrade(entry)) found.add(entry);
  return CAMP_GRADES.filter((grade) => found.has(grade));
}

/** Well-formed keys of the right kind, first occurrence wins. */
function keyList(
  value: unknown,
  kind: 'child' | 'servant',
  seen: Set<CampPersonKey>,
): CampPersonKey[] {
  const out: CampPersonKey[] = [];
  for (const entry of list(value)) {
    if (out.length >= MAX_PLACEMENTS_PER_GROUP) break;
    const parsed = parsePersonKey(entry);
    if (!parsed || parsed.kind !== kind) continue;
    const key = entry as CampPersonKey;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
