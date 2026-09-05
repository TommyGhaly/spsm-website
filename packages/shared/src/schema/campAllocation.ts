import type { AuditFields } from './common.js';
import {
  CAMP_GRADES,
  CAMP_SECTIONS,
  campDesiredRoles,
  campDesiredRolesFor,
  campGradesForSection,
  campAge,
  campSectionForGrade,
  isCampCrewWish,
  parseCampDayKey,
  CAMP_WEEKDAYS,
  DEFAULT_CAMP_WEEKS,
  isCampGrade,
  isCampSection,
  MAX_CAMP_WEEKS,
  type CampChild,
  type CampGenderField,
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
 * How a band with no colour yet is drawn.
 *
 * ---------------------------------------------------------------------------
 * A band starts with **no** colour — *"don't assign a color automatically they
 * will be assigned after"*. That is not a nicety: the camp hands colours out
 * once it knows which groups exist and which wristbands it has, and a board
 * that has already guessed twelve of them makes an arbitrary guess look like a
 * decision somebody made. Worse, the colour is what a parent is told at the
 * gate; one invented by `nextCampColour` on a Tuesday and changed on the Friday
 * is a wristband that means two different things.
 *
 * So `CampBand.colour` is nullable, and this is the grey everything draws in
 * until it is not. It is deliberately **not** in `CAMP_COLOURS`: it has no
 * `value`, so it cannot be stored, cannot be picked out of the swatch list, and
 * cannot be mistaken for a thirteenth colour. The absence of a colour is a
 * state, not a colour.
 * ---------------------------------------------------------------------------
 */
export const CAMP_UNCOLOURED = {
  label: 'No color yet',
  hex: '#8A7F7B',
  ink: '#FFFFFF',
} as const satisfies { label: string; hex: string; ink: string };

/**
 * A stored colour as something drawable, the unset case included.
 *
 * Every reader of a band's colour goes through here rather than calling
 * `campColour` and handling `null` itself, because the one that forgets does
 * not crash — it draws an uncoloured band in `CAMP_COLOURS[0]`, which is red,
 * which is a real colour the camp may have given to somebody else.
 */
export function campColourOf(value: CampColour | null): {
  label: string;
  hex: string;
  ink: string;
} {
  return value === null ? CAMP_UNCOLOURED : campColour(value);
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
  /**
   * The band's colour, or `null` until the camp has chosen one.
   *
   * Nullable on purpose — see `CAMP_UNCOLOURED`. Read it through
   * `campColourOf`, never `campColour`.
   */
  colour: CampColour | null;
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

/**
 * One week of camp, arranged.
 *
 * Everything that can be dragged lives inside a week: the bands, their groups,
 * and the stations. Nothing above this level holds a placement, which is what
 * makes "a person is in one place" a per-week statement — a servant on sports
 * in week one and with a crew in week two is two placements and both are right.
 */
export interface CampWeekBoard {
  /** 1-based, matching `CampDayKey`'s `w1-mon`. */
  week: number;
  bands: CampBand[];
  stations: CampStation[];
}

export interface CampAllocation extends AuditFields {
  /** The ministry. `firestore.rules` reads this to decide the grant, exactly as
      it does on a registration. */
  programId: string;
  /** The season this arrangement belongs to. One allocation per season — see
      `allocationDocId`. */
  season: string;

  /**
   * One board per week of camp: the grade bands, their groups, and the
   * stations.
   *
   * ---------------------------------------------------------------------------
   * **Back to per week, on 2 Sep 2026, deliberately and for the third time.**
   *
   * This field existed, was deleted the same day in favour of one arrangement
   * for the whole camp, and is back because Tommy asked for exactly the thing
   * the flat shape cannot express: *"the groups should be divided by weeks…
   * genuine separation per week but have the ability to match the configuration
   * of the grades, meaning if I merge grade 1 and 2 I can sync it to do the same
   * in week 2."*
   *
   * Both halves of that sentence matter, and the second is what makes this
   * different from the version that was scrapped:
   *
   *   - **Separation is total.** Week two's bands, groups, stations and
   *     placements are its own. A child can be in Blue in week one and Green in
   *     week two, and a servant can be on sports one week and with a crew the
   *     next, which is what the camp actually does.
   *   - **The sync is a button, not a rule.** What went before had a `linked`
   *     flag per week, an automatic `syncWeekStructure`, shared ids across
   *     linked weeks, and a rule about which kinds of edit silently detached a
   *     week from the others. *That* was the complexity that was thrown out, and
   *     none of it is here. `copyWeekStructure` is a thing somebody presses,
   *     once, when they have finished arranging the grades; afterwards the two
   *     weeks have no relationship at all.
   *
   * A week with no board has never been arranged. Boards are created on demand
   * (`weekBoardOf`) rather than seeded for `config/camp.weeks`, so shortening
   * the camp does not have to delete anything and lengthening it does not have
   * to backfill.
   * ---------------------------------------------------------------------------
   */
  weeks: CampWeekBoard[];
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
    weeks: [],
    archivedAt: null,
    archivedBy: null,
    note: '',
  };
}

/** An empty board for one week. Made on demand — see `CampAllocation.weeks`. */
export function blankWeekBoard(week: number): CampWeekBoard {
  return { week, bands: [], stations: [] };
}

/**
 * One week's board, or an empty one.
 *
 * Never null, and that is the point: every caller wants "what is arranged in
 * week two", and the answer for a week nobody has touched is "nothing", not an
 * absence to be handled. The returned board is not in the document until
 * something is put in it, so reading a week does not dirty the draft.
 */
export function weekBoardOf(
  draft: Pick<CampAllocationDraft, 'weeks'>,
  week: number,
): CampWeekBoard {
  return draft.weeks.find((entry) => entry.week === week) ?? blankWeekBoard(week);
}

/**
 * Change one week's board, creating it if this is the first thing in it.
 *
 * Every mutating function in this file goes through here, so "a week is created
 * by being used" is true in one place rather than in fifteen. Weeks stay in
 * order, because the export and the year list both walk them.
 */
export function editWeekBoard(
  draft: CampAllocationDraft,
  week: number,
  change: (board: CampWeekBoard) => CampWeekBoard,
): CampAllocationDraft {
  const existing = draft.weeks.find((entry) => entry.week === week);
  const next = change(existing ?? blankWeekBoard(week));
  const weeks = existing
    ? draft.weeks.map((entry) => (entry.week === week ? next : entry))
    : [...draft.weeks, next].sort((a, b) => a.week - b.week);
  return { ...draft, weeks };
}

/** Which weeks have been arranged at all, in order. */
export function arrangedWeeks(draft: Pick<CampAllocationDraft, 'weeks'>): number[] {
  return draft.weeks
    .filter((board) => board.bands.length > 0 || board.stations.length > 0)
    .map((board) => board.week)
    .sort((a, b) => a - b);
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

/**
 * A band with no colour, unless the caller insists on one.
 *
 * The default is `null` rather than the next free hue: colours are handed out
 * after the groups exist, not while they are being made. See `CAMP_UNCOLOURED`.
 */
export function blankBand(
  name: string,
  grades: CampGrade[],
  colour: CampColour | null = null,
): CampBand {
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
 * Bands, per half of the camp
 * ------------------------------------------------------------------------ */

/** How many people a band holds, children and servants together. */
export function bandPlacementCount(band: CampBand): number {
  return band.groups.reduce(
    (sum, group) => sum + group.childKeys.length + group.servantKeys.length,
    0,
  );
}

/**
 * Whether a band's grades straddle the two halves of the camp, or are missing.
 *
 * Not something the screen can make — the grade boxes only ever offer the half
 * you are looking at — but something a document can already say, so every
 * reader has to have an answer for it. `bandsInSection` shows such a band in
 * both halves and the card says so.
 */
export function bandStraddles(band: CampBand): boolean {
  return panelSection(band.grades) === null;
}

/**
 * The bands one half of the camp shows, in grade order.
 *
 * ---------------------------------------------------------------------------
 * The board is two screens now — elementary and middle school, swiped between —
 * so this is what decides which of them a band appears on.
 *
 * A band is shown by every half it has a grade in. For the ordinary band that
 * is exactly one half. For one that straddles them, it is both, and that is the
 * deliberate choice: showing it under "the half of its first grade" hides it
 * from the person looking at the other one, who is the person most likely to
 * notice it is wrong. A band with no grades at all shows under elementary,
 * because it has to be somewhere and that is the larger half.
 *
 * Ordered by their lowest grade rather than by their position in the document,
 * because the strip they fill reads as a row of grades: K, 1, "2nd & 3rd", 4. A
 * band edited elsewhere in the document should not shove the row about.
 * ---------------------------------------------------------------------------
 */
export function bandsInSection(
  bands: readonly CampBand[],
  section: CampSection,
): CampBand[] {
  const mine = new Set(campGradesForSection(section));
  return bands
    .filter(
      (band) =>
        band.grades.some((grade) => mine.has(grade)) ||
        (section === 'elementary' && band.grades.length === 0),
    )
    .map((band) => ({
      band,
      // The trailing `Infinity` is what sorts a band with no grades last
      // instead of `Math.min()` of nothing doing it by accident.
      rank: Math.min(
        ...band.grades.map((grade) => CAMP_GRADES.indexOf(grade)),
        Number.POSITIVE_INFINITY,
      ),
    }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.band);
}

/**
 * The grades of one half that no band covers yet, in order.
 *
 * The board shows **every** grade of the half it is on, whether or not a band
 * exists for it — *"all of the grades should be there"*. These are the ones
 * drawn as an outline, waiting to be made.
 */
export function uncoveredGrades(
  bands: readonly CampBand[],
  section: CampSection,
): CampGrade[] {
  const covered = new Set(bands.flatMap((band) => band.grades));
  return campGradesForSection(section).filter((grade) => !covered.has(grade));
}

/** The band covering a grade, or null. First match wins, as everywhere else in
    this file: a grade in two bands is a document nobody's screen wrote. */
export function bandForGrade(
  bands: readonly CampBand[],
  grade: CampGrade,
): CampBand | null {
  return bands.find((band) => band.grades.includes(grade)) ?? null;
}

/**
 * Put a set of grades on one band, taking them off every other.
 *
 * ---------------------------------------------------------------------------
 * This is how grades are **grouped together**: open 3rd grade's band, tick 4th,
 * and the two run as one. Which means the interesting half of the work is not
 * the band being edited — it is the band that just lost a grade.
 *
 * Three things happen, and all three are needed for the strip above to stay
 * honest:
 *
 *   1. The target band takes `grades`, in canonical order.
 *   2. Every other band loses those grades. A grade in two bands offers the
 *      same children in two places, which is the one state the pool filter
 *      cannot make sense of.
 *   3. A band left with no grades **and nobody in it** is deleted, because it
 *      is now a card with no reason to exist and no way to name itself. One
 *      with people in it is kept: deleting it would tip a group's worth of
 *      children back onto the waiting list as a side effect of a tick, which is
 *      not a thing a checkbox may do. It stays, gradeless, and the strip draws
 *      it as such.
 *
 * The name follows the grades exactly as far as it was ours to begin with —
 * `suggestBandName` of the *old* grades is what tells "3rd grade" (ours, may be
 * replaced) from "The Cherubim" (theirs, never touched).
 * ---------------------------------------------------------------------------
 */
export function setBandGrades(
  draft: CampAllocationDraft,
  week: number,
  bandId: string,
  grades: readonly CampGrade[],
): CampAllocationDraft {
  return editWeekBoard(draft, week, (board) => {
  if (!board.bands.some((band) => band.id === bandId)) return board;

  const wanted = new Set(grades);
  const ordered = CAMP_GRADES.filter((grade) => wanted.has(grade));

  const renamed = (band: CampBand, next: CampGrade[]): CampBand => ({
    ...band,
    grades: next,
    name: band.name === suggestBandName(band.grades) ? suggestBandName(next) : band.name,
  });

  return {
    ...board,
    bands: board.bands
      .map((band) => {
        if (band.id === bandId) return renamed(band, ordered);
        const kept = band.grades.filter((grade) => !wanted.has(grade));
        return kept.length === band.grades.length ? band : renamed(band, kept);
      })
      .filter(
        (band) =>
          band.id === bandId || band.grades.length > 0 || bandPlacementCount(band) > 0,
      ),
  };
  });
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
  draft: CampAllocationDraft,
  week: number,
  key: CampPersonKey,
  target: CampDropTarget,
  index = Number.MAX_SAFE_INTEGER,
): CampAllocationDraft {
  // A child has no business on a station: stations hold the servants who run
  // them. Refusing here rather than at the drop site means every caller gets it
  // right, including a keyboard "move to…" menu written later.
  if (target?.kind === 'station') return draft;

  return editWeekBoard(draft, week, (board) => {
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
  });
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
  draft: CampAllocationDraft,
  week: number,
  key: CampPersonKey,
  target: CampDropTarget,
  index = Number.MAX_SAFE_INTEGER,
): CampAllocationDraft {
  return editWeekBoard(draft, week, (board) => {
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
  });
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
  draft: CampAllocationDraft,
  week: number,
  target: CampDropTarget,
  key: CampPersonKey,
): CampAllocationDraft {
  if (!target) return draft;

  return editWeekBoard(draft, week, (board) => {
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
  });
}

/** Every placement in the allocation, for the `MAX_PLACEMENTS` guard. The cap
    is on the document, because that is what Firestore limits. */
export function countPlacements(draft: CampAllocationDraft): number {
  let total = 0;
  for (const board of draft.weeks) {
    for (const band of board.bands) {
      for (const group of band.groups) total += group.childKeys.length + group.servantKeys.length;
    }
    for (const station of board.stations) total += station.servantKeys.length;
  }
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
   * Male or female, on a child and on a servant alike, or empty when the
   * registration never said.
   *
   * The one fact on this type that both kinds carry and both kinds are counted
   * on. A crew's balance is two numbers — the children in it and the servants
   * on it — and asking the question of only one of them would answer half of
   * it. Read the empty case as unanswered, never as a default: see
   * `CampGenderSplit`.
   */
  gender: CampGenderField;
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
   * Servants only: what they asked for, keyed `w1_elementary` — the raw map off
   * the registration.
   *
   * The *raw* map rather than a flattened list, because the board now asks the
   * question one week and one half at a time: "did this person get what they
   * asked for **in week two, in middle school**". `roles` above answers a
   * different and blunter question and cannot be narrowed after the fact. Read
   * it with `campDesiredRolesFor`.
   */
  desiredRolesByWeek: Record<string, string[]>;
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
        gender: servant?.gender ?? '',
        age: campAge(servant?.dateOfBirth ?? '', on),
        shirtSize: servant?.shirtSize ?? '',
        days: servant?.days ?? [],
        allergies: '',
        medicalNotes: '',
        // What they asked for, and only that. There was an `assignedRoles`
        // field that won over this one; it is gone — what a servant is *given*
        // is which group or station they are standing in on this board, and a
        // second free-text list beside it could only disagree with it.
        roles: campDesiredRoles(servant),
        desiredRolesByWeek: servant?.desiredRolesByWeek ?? {},
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
        gender: child.gender,
        age: campAge(child.dateOfBirth, on),
        shirtSize: child.shirtSize,
        days: child.days,
        allergies: child.allergies,
        medicalNotes: child.medicalNotes,
        roles: [],
        desiredRolesByWeek: {},
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
  draft: Pick<CampAllocationDraft, 'weeks'>,
  week: number,
  people: readonly CampPerson[],
): ResolvedAllocation {
  const board = weekBoardOf(draft, week);
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
    weeks: board.weeks.map((entry) => ({
      ...entry,
      bands: entry.bands.map((band) => ({
        ...band,
        groups: band.groups.map((group) => ({
          ...group,
          childKeys: group.childKeys.filter(keep),
          servantKeys: group.servantKeys.filter(keep),
          leaderKey: lead(group.leaderKey),
        })),
      })),
      stations: entry.stations.map((station) => ({
        ...station,
        servantKeys: station.servantKeys.filter(keep),
        leaderKey: lead(station.leaderKey),
      })),
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
  draft: CampAllocationDraft,
  week: number,
  bandId: string,
  people: readonly CampPerson[],
): CampAllocationDraft {
  const board = weekBoardOf(draft, week);
  const band = board.bands.find((entry) => entry.id === bandId);
  if (!band || band.groups.length === 0) return draft;

  const resolved = resolveAllocation(draft, week, people);
  const grades = new Set(band.grades);
  const waiting = resolved.freeChildren.filter(
    (person) =>
      !person.withdrawn &&
      // Only the children who are actually coming that week. Dealing a child
      // who is registered for none of week two's days into a week two group is
      // a name on a register that will never be ticked.
      campComesInWeek(person, week) &&
      (grades.size === 0 || (person.grade && grades.has(person.grade))),
  );
  if (waiting.length === 0) return draft;

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

  return editWeekBoard(draft, week, (current) => ({
    ...current,
    bands: current.bands.map((entry) =>
      entry.id !== bandId
        ? entry
        : {
            ...entry,
            groups: entry.groups.map((group, index) => ({ ...group, childKeys: buckets[index]! })),
          },
    ),
  }));
}

/* ---------------------------------------------------------------------------
 * Who is allowed where
 * ------------------------------------------------------------------------ */

/**
 * Whether a person may be placed on a target at all.
 *
 * ---------------------------------------------------------------------------
 * *"Only students in the correct grade should be allowed in groups within that
 * grade."* A band's `grades` is not a label on the card, it is the definition
 * of the crew: 2nd & 3rd grade means the children in it are 2nd and 3rd
 * graders. Nothing enforced that — every placement went through `placeChild`,
 * which puts a key in a list and asks no questions — so a 5th grader could be
 * dropped into Kindergarten and the only thing that would ever notice was the
 * register on the Monday.
 *
 * The three rules:
 *
 *   - **A child may only go in a group whose band covers their grade.** A child
 *     with no grade recorded may go nowhere: an unfinished registration is a
 *     thing to fix, not a child to file under a guess.
 *   - **A child may never go on a station.** Stations are the camp's jobs.
 *   - **A servant may go anywhere.** They are allocated by half and by what
 *     they asked for, never by grade — see `CampPerson.sections`.
 *
 * A `null` target is the waiting list, which always takes anybody: taking
 * somebody out of a place they should not have been in must never be refused.
 *
 * `dealBand` has always filtered by grade, so the automatic path was already
 * right and only the manual one was not. This is the rule both now share.
 * ---------------------------------------------------------------------------
 */
export function campCanPlace(
  person: Pick<CampPerson, 'kind' | 'grade'>,
  board: CampWeekBoard,
  target: CampDropTarget,
): boolean {
  // Out of wherever they were, back to the list. Never refused.
  if (target === null) return true;
  if (person.kind === 'servant') return true;
  if (target.kind === 'station') return false;

  const band = board.bands.find((entry) => entry.id === target.bandId);
  if (!band) return false;
  return person.grade !== null && band.grades.includes(person.grade);
}

/**
 * Run two groups of one band together as one crew.
 *
 * ---------------------------------------------------------------------------
 * *"After merging two grades I want the ability to merge groups within it."*
 * Merging grades widens who is allowed in; it does not join the crews, so a
 * merged 3rd & 4th grade opens with 3rd's two groups and 4th's two groups still
 * standing apart. This is the second, smaller join: take those four and make
 * them three.
 *
 * The rules mirror `mergeBands`, one level down:
 *
 *   - **The target survives.** Its id, so anything watching it stays put; its
 *     name, unless the name was ours to begin with (`Group 2` and friends), in
 *     which case it is renumbered with the rest.
 *   - **The target's leader survives.** Two crews have two leaders and only one
 *     can lead the joined one; the one you dropped *onto* is the crew you kept,
 *     so its leader is the one who keeps leading. The other stays in the group
 *     as an ordinary servant rather than being turned out.
 *   - **Both must be in the same band.** A group is defined by the grades of the
 *     band around it — see `campCanPlace` — so joining across bands would put
 *     children in a crew their grade is not allowed in. Merge the grades first.
 *   - **Nobody is dropped for being over the cap.** `MAX_PLACEMENTS_PER_GROUP`
 *     guards what a person can be *added* to; silently losing a child to a
 *     limit in the middle of a merge is the one outcome worse than a group of
 *     eighty-one.
 * ---------------------------------------------------------------------------
 */
export function mergeGroups(
  draft: CampAllocationDraft,
  week: number,
  bandId: string,
  intoId: string,
  fromId: string,
): CampAllocationDraft {
  if (intoId === fromId) return draft;

  return editWeekBoard(draft, week, (board) => {
    const band = board.bands.find((entry) => entry.id === bandId);
    if (!band) return board;
    const into = band.groups.find((entry) => entry.id === intoId);
    const from = band.groups.find((entry) => entry.id === fromId);
    if (!into || !from) return board;

    const joined: CampGroup = {
      ...into,
      childKeys: [...into.childKeys, ...from.childKeys.filter((key) => !into.childKeys.includes(key))],
      servantKeys: [
        ...into.servantKeys,
        ...from.servantKeys.filter((key) => !into.servantKeys.includes(key)),
      ],
      // The crew you dropped onto is the one you kept, so its leader keeps
      // leading. The other's leader stays in the group, just not in front of it.
      leaderKey: into.leaderKey,
      note: [into.note, from.note].map((entry) => entry.trim()).filter(Boolean).join(' · '),
    };

    return {
      ...board,
      bands: board.bands.map((entry) =>
        entry.id !== bandId
          ? entry
          : {
              ...entry,
              groups: renumberDefaultNames(
                entry.groups.filter((group) => group.id !== fromId).map((group) =>
                  group.id === intoId ? joined : group,
                ),
              ),
            },
      ),
    };
  });
}

/**
 * Which band a group belongs to, on one week's board.
 *
 * The screen drags a group by its own id and has to find its band to know
 * whether the two ends of a merge are allowed to meet.
 */
export function bandOfGroup(board: CampWeekBoard, groupId: string): CampBand | null {
  return board.bands.find((band) => band.groups.some((group) => group.id === groupId)) ?? null;
}

/**
 * Every child sitting in a group whose band does not cover their grade.
 *
 * Placements made before `campCanPlace` existed are still in the documents, and
 * a rule that is only enforced going forward leaves the boards that are already
 * wrong looking right. The screen marks these where they stand rather than
 * moving anybody: which group a child *should* be in is the camp's decision.
 */
export function campMisplacedChildren(
  board: CampWeekBoard,
  byKey: ReadonlyMap<CampPersonKey, CampPerson>,
): Set<CampPersonKey> {
  const wrong = new Set<CampPersonKey>();
  for (const band of board.bands) {
    for (const group of band.groups) {
      for (const key of group.childKeys) {
        const person = byKey.get(key);
        if (!person || person.kind !== 'child') continue;
        if (person.grade === null || !band.grades.includes(person.grade)) wrong.add(key);
      }
    }
  }
  return wrong;
}

/* ---------------------------------------------------------------------------
 * Who is here this week
 * ------------------------------------------------------------------------ */

/** How many days of one week somebody is registered for. */
export function campDaysInWeek(person: Pick<CampPerson, 'days'>, week: number): number {
  let count = 0;
  for (const key of person.days) {
    const parsed = parseCampDayKey(key);
    if (parsed && parsed.week === week) count += 1;
  }
  return count;
}

/**
 * Whether somebody is at camp at all in a given week.
 *
 * **Nobody registered for no days is excluded by this.** A registration with an
 * empty `days` is an unfinished registration, not a person who is coming to
 * nothing, and hiding them from every week's board is how they stay unfinished.
 * They are offered everywhere and the chip says "no days".
 */
export function campComesInWeek(person: Pick<CampPerson, 'days'>, week: number): boolean {
  return person.days.length === 0 || campDaysInWeek(person, week) > 0;
}

/* ---------------------------------------------------------------------------
 * How much of a week a servant is actually there for
 * ------------------------------------------------------------------------ */

/**
 * The six readings a servant's week can have, worst to best.
 *
 * `unknown` is not a bad reading, it is *no* reading: a registration with an
 * empty `days` has not been finished, and colouring it red would say something
 * about the person that only says something about the form.
 */
export const CAMP_RELIABILITY_LEVELS = ['unknown', 'none', 'low', 'some', 'high', 'full'] as const;

export type CampReliabilityLevel = (typeof CAMP_RELIABILITY_LEVELS)[number];

export interface CampReliability {
  level: CampReliabilityLevel;
  /** Days of *this* week they are registered for. */
  days: number;
  /** Days in a camp week — five, and stated so the ratio is readable. */
  of: number;
  /** "5 of 5 days", "not this week". Short enough for a chip. */
  label: string;
  /** The whole reading as a sentence, for a `title`. */
  detail: string;
  /** They typed something into "availability" — "mornings only", "can drive
      Friday". The day grid cannot say either. */
  noteFlag: boolean;
}

/**
 * How reliable a servant is **for one week**, as a level a chip can wear.
 *
 * ---------------------------------------------------------------------------
 * The board's hardest trade is which servant goes on which crew, and the thing
 * that decides it is not who they are — it is **how much of that week they are
 * there for**. Two days of somebody is not half a servant: a crew whose leader
 * is present on Monday and Tuesday has no leader on Wednesday, and a board that
 * draws that person the same as a five-day one hides the only fact that makes
 * the placement wrong.
 *
 * So the level is read off the day count alone, out of the five weekdays a camp
 * week has:
 *
 *   - **full** — every day of the week.
 *   - **high** — four of five. One day short is a gap somebody covers.
 *   - **some** — two or three. Half a week; a crew needs a second adult.
 *   - **low** — one day. A visitor, in practice.
 *   - **none** — registered, but for no day of *this* week. Loud, because a
 *     person placed here is a name on a roster who will not be in the room.
 *   - **unknown** — no days on the registration at all. Grey, not red: that is
 *     an unfinished form, and saying "unreliable" about it is a lie about a
 *     person.
 *
 * **The availability note is a flag, not a level.** "Mornings only" is a
 * *shape* of availability, not an amount of it, and folding free text into a
 * five-point scale would mean guessing what the sentence said. A safeguarding
 * flag used to sit beside it and is gone with the field it read — see
 * `CampServantDetails`.
 *
 * Children have no reading. It is not a judgement anybody should make about a
 * nine-year-old, and it would not change where they are placed.
 * ---------------------------------------------------------------------------
 */
export function campReliability(
  person: Pick<CampPerson, 'kind' | 'days' | 'availability' | 'withdrawn'>,
  week: number,
): CampReliability | null {
  if (person.kind !== 'servant') return null;

  const of = CAMP_WEEKDAYS.length;
  const days = campDaysInWeek(person, week);
  const noteFlag = person.availability.trim() !== '';

  const level: CampReliabilityLevel =
    person.days.length === 0
      ? 'unknown'
      : days === 0
        ? 'none'
        : days >= of
          ? 'full'
          : days >= of - 1
            ? 'high'
            : days >= 2
              ? 'some'
              : 'low';

  const label =
    level === 'unknown' ? 'days not given' : level === 'none' ? 'not this week' : `${days}/${of} days`;

  const said =
    level === 'unknown'
      ? 'No days on this registration yet, so there is nothing to go on.'
      : level === 'none'
        ? `Registered for the camp, but for no day of week ${week}.`
        : level === 'full'
          ? `Here all ${of} days of week ${week}.`
          : `Here ${days} of the ${of} days of week ${week}.`;

  const detail = [
    said,
    noteFlag ? `Availability: ${person.availability.trim()}` : '',
    person.withdrawn ? 'This registration is withdrawn.' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return { level, days, of, label, detail, noteFlag };
}

/* ---------------------------------------------------------------------------
 * Satisfaction and coverage
 * ------------------------------------------------------------------------ */

/**
 * Whether a servant asked for the place they are standing in.
 *
 * ---------------------------------------------------------------------------
 * The camp's wish list is *"just stations and crew leaders"* — see
 * `CAMP_CREW_ROLE` — so there are exactly two questions:
 *
 *   - **On a station:** did they name this station? Matched on the station's
 *     name, case- and space-insensitively, because that is what the servant saw
 *     on the form: the camp puts its own stations on the sign-up, so "Sports"
 *     in a wish and "Sports" on the board are the same string somebody typed
 *     once. It is not exact-only — `"sports "` and `"Sports"` are one wish, and
 *     a camp that renames "Sports" to "Sports & games" mid-season loses the
 *     match, which is the honest outcome: it is a different station now.
 *   - **In a group:** did they ask for a crew? Leading is not a separate wish;
 *     `leaderKey` is a mark on the placement, so a crew wish is met by being in
 *     a crew whether or not they run it.
 *
 * A servant who asked for **nothing** that week is neither satisfied nor
 * dissatisfied — `null`, not `false`. Counting them as unhappy would make every
 * meter on the board read badly for the ordinary case of somebody who did not
 * fill that part of the form in, which is the fastest way to make a metric
 * ignored.
 * ---------------------------------------------------------------------------
 */
export function campWishMet(
  person: Pick<CampPerson, 'kind' | 'desiredRolesByWeek'>,
  where: { kind: 'group' } | { kind: 'station'; name: string },
  week: number,
  section: CampSection,
): boolean | null {
  if (person.kind !== 'servant') return null;
  const wishes = campDesiredRolesFor(person, week, section);
  if (wishes.length === 0) return null;
  if (where.kind === 'group') return wishes.some(isCampCrewWish);
  const wanted = normaliseRole(where.name);
  if (wanted === '') return null;
  return wishes.some((wish) => normaliseRole(wish) === wanted);
}

function normaliseRole(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A count of people, split male and female, with the unanswered kept apart.
 *
 * ---------------------------------------------------------------------------
 * Three numbers rather than two, and `unknown` is the one that earns its place.
 *
 * Folding the unanswered into either side would produce a ratio that is wrong
 * by exactly as much as the camp does not know, and it would be wrong silently
 * — a crew reading "6 boys · 2 girls" when four of those eight were never asked
 * is worse than no reading at all, because somebody will staff against it.
 * Counted separately, the same crew says "3 boys · 1 girl · 4 not given", which
 * is both the balance *and* the reason to go and find out.
 *
 * `male + female + unknown` always equals the headcount it was taken from, so a
 * screen can print any of the four numbers without reconciling them.
 * ---------------------------------------------------------------------------
 */
export interface CampGenderSplit {
  male: number;
  female: number;
  /** Registered before the question existed, or left blank. */
  unknown: number;
}

export const NO_GENDER_SPLIT: CampGenderSplit = { male: 0, female: 0, unknown: 0 };

/** True when there is nobody at all to say anything about. */
export function campSplitEmpty(split: CampGenderSplit): boolean {
  return split.male + split.female + split.unknown === 0;
}

/** How a group or a station is doing on the two questions the board asks. */
export interface CampPlaceMetrics {
  /** Children in it who are coming that week. */
  children: number;
  /** Servants in it who are coming that week. */
  servants: number;
  /**
   * The same two headcounts, split male and female.
   *
   * Carried on the metrics rather than recounted by the card, so that the split
   * and the total can never disagree: both are taken in one pass over the same
   * keys, against the same week, skipping the same withdrawn people. A card
   * that counted its own boys off `group.childKeys` would include the child who
   * is only there in week two, and the numbers beside each other would not add
   * up.
   */
  childGender: CampGenderSplit;
  servantGender: CampGenderSplit;
  /** Servants who asked for something this week, and got it. */
  satisfied: number;
  /** Servants who asked for something this week at all — the denominator. */
  wishing: number;
  /**
   * Children per servant, or null when there are no servants.
   *
   * Null rather than Infinity: the difference between "eleven children and one
   * servant" and "eleven children and nobody" is the whole point, and a number
   * cannot carry it.
   */
  ratio: number | null;
}

/**
 * Coverage, as an even spread rather than a target.
 *
 * ---------------------------------------------------------------------------
 * Tommy chose this over a configured children-per-servant ratio, and it is the
 * better answer for a parish camp: the camp gets the servants it gets, and the
 * useful question in the week before is not "are we at 6:1" — the answer is
 * whatever it is and nobody can conjure another twelve teenagers — but **"is
 * one crew carrying twice what the others are"**, which is a thing that can be
 * fixed in ten seconds by dragging somebody.
 *
 * So the baseline is the half's own ratio for that week, and a group is
 * measured against its neighbours. Which means a half that is uniformly thin
 * reads as fine, and that is correct: there is nothing on this screen that
 * would fix it.
 *
 * `none` is not relative and is always shown: children with nobody watching
 * them is not a spread problem.
 * ---------------------------------------------------------------------------
 */
export type CampCoverage = 'empty' | 'none' | 'thin' | 'ok' | 'rich';

export interface CampCoverageReading {
  level: CampCoverage;
  /** How many more servants would bring it level with the rest of the half.
      Zero unless `level` is `thin` or `none`. */
  short: number;
}

/** The ratios either side of the half's own average that stop being "ok". */
const THIN_AT = 1.35;
const RICH_AT = 0.65;

export function campCoverage(
  place: Pick<CampPlaceMetrics, 'children' | 'servants'>,
  /** Children per servant across the whole half, that week. Null when the half
      has no servants placed at all, in which case nothing is comparable. */
  baseline: number | null,
): CampCoverageReading {
  if (place.children === 0) return { level: 'empty', short: 0 };
  if (place.servants === 0) {
    // With no baseline to work from, one is still the honest ask: somebody has
    // to be with them.
    const want = baseline && baseline > 0 ? Math.ceil(place.children / baseline) : 1;
    return { level: 'none', short: Math.max(1, want) };
  }
  if (baseline === null || baseline <= 0) return { level: 'ok', short: 0 };

  const ratio = place.children / place.servants;
  if (ratio > baseline * THIN_AT) {
    return { level: 'thin', short: Math.max(1, Math.ceil(place.children / baseline) - place.servants) };
  }
  if (ratio < baseline * RICH_AT) return { level: 'rich', short: 0 };
  return { level: 'ok', short: 0 };
}

/**
 * The half's children-per-servant for one week, across its groups only.
 *
 * Stations are left out on purpose. A servant on the kitchen is not watching
 * children, so counting them would make a half look better covered the more
 * people it takes *off* the crews — which is backwards.
 */
export function campSectionBaseline(places: readonly CampPlaceMetrics[]): number | null {
  let children = 0;
  let servants = 0;
  for (const place of places) {
    children += place.children;
    servants += place.servants;
  }
  return servants > 0 ? children / servants : null;
}

/** Measure one group, for one week. */
export function campGroupMetrics(
  group: Pick<CampGroup, 'childKeys' | 'servantKeys'>,
  byKey: ReadonlyMap<CampPersonKey, CampPerson>,
  week: number,
  section: CampSection,
): CampPlaceMetrics {
  return measure(group.childKeys, group.servantKeys, byKey, week, section, { kind: 'group' });
}

/** Measure one station, for one week. */
export function campStationMetrics(
  station: Pick<CampStation, 'name' | 'servantKeys'>,
  byKey: ReadonlyMap<CampPersonKey, CampPerson>,
  week: number,
  section: CampSection,
): CampPlaceMetrics {
  return measure([], station.servantKeys, byKey, week, section, {
    kind: 'station',
    name: station.name,
  });
}

function measure(
  childKeys: readonly CampPersonKey[],
  servantKeys: readonly CampPersonKey[],
  byKey: ReadonlyMap<CampPersonKey, CampPerson>,
  week: number,
  section: CampSection,
  where: { kind: 'group' } | { kind: 'station'; name: string },
): CampPlaceMetrics {
  let children = 0;
  const childGender: CampGenderSplit = { male: 0, female: 0, unknown: 0 };
  for (const key of childKeys) {
    const person = byKey.get(key);
    // A withdrawn child still shows on the board — they have to, or nobody
    // notices — but they are not somebody who needs covering.
    if (!person || person.withdrawn || !campComesInWeek(person, week)) continue;
    children += 1;
    tally(childGender, person.gender);
  }

  let servants = 0;
  let satisfied = 0;
  let wishing = 0;
  const servantGender: CampGenderSplit = { male: 0, female: 0, unknown: 0 };
  for (const key of servantKeys) {
    const person = byKey.get(key);
    if (!person || person.withdrawn || !campComesInWeek(person, week)) continue;
    servants += 1;
    tally(servantGender, person.gender);
    const met = campWishMet(person, where, week, section);
    if (met === null) continue;
    wishing += 1;
    if (met) satisfied += 1;
  }

  return {
    children,
    servants,
    childGender,
    servantGender,
    satisfied,
    wishing,
    ratio: servants > 0 ? children / servants : null,
  };
}

/** Add one person to a split. An unreadable or absent answer is its own bucket
    and never a default — see `CampGenderSplit`. */
function tally(split: CampGenderSplit, gender: CampGenderField): void {
  if (gender === 'male') split.male += 1;
  else if (gender === 'female') split.female += 1;
  else split.unknown += 1;
}

/**
 * The same split, over any list of people, for one week.
 *
 * What the two rails and the half's own heading count: everybody in the list
 * who is actually at camp that week, withdrawals left out on the same terms
 * `measure` leaves them out, so the number under a rail and the numbers on the
 * cards below it are taken the same way.
 */
export function campGenderSplit(
  people: readonly CampPerson[],
  week: number,
): CampGenderSplit {
  const split: CampGenderSplit = { male: 0, female: 0, unknown: 0 };
  for (const person of people) {
    if (person.withdrawn || !campComesInWeek(person, week)) continue;
    tally(split, person.gender);
  }
  return split;
}

/* ---------------------------------------------------------------------------
 * Merging and splitting grades
 * ------------------------------------------------------------------------ */

/**
 * Put a band in the document if it is not there yet.
 *
 * ---------------------------------------------------------------------------
 * The screen draws **every grade of the half**, band or no band, so most of
 * what is on it is a card for a grade nobody has arranged. Those cards are not
 * in the document — seeding nine bands into a draft the moment somebody opens
 * the page is an unsaved change nobody asked for.
 *
 * So the screen builds them, and every action that touches one passes it
 * through here first. A band that is already stored is returned untouched, by
 * identity, so this is safe to call on every edit.
 * ---------------------------------------------------------------------------
 */
export function ensureBand(
  draft: CampAllocationDraft,
  week: number,
  band: CampBand,
): CampAllocationDraft {
  const board = weekBoardOf(draft, week);
  if (board.bands.some((entry) => entry.id === band.id)) return draft;
  if (board.bands.length >= MAX_BANDS) return draft;
  return editWeekBoard(draft, week, (current) => ({
    ...current,
    bands: [...current.bands, band],
  }));
}

/**
 * Run two bands' grades together as one.
 *
 * ---------------------------------------------------------------------------
 * *"It is too difficult to merge grades."* It was: you opened a band's settings
 * panel and ticked a grade in a row of checkboxes, having first worked out
 * which band held it. This is the operation somebody actually wants — **take
 * 3rd grade and 4th grade and run them together** — as one call.
 *
 * The target keeps its own id, so whatever is open stays open. It takes the
 * other's grades and its groups, in that order, and the other band is deleted.
 * Nobody is unplaced: a child in "4th grade · Group 1" is still in a group of
 * that name, now inside the merged band.
 *
 * Two groups both called "Group 1" is the one thing merging can produce that
 * nothing else can, and it is not cosmetic — the attendance register heads its
 * sections `band · group`, so two identical headings are two registers a
 * servant cannot tell apart. `renumberDefaultNames` renames only names of the
 * form `Group N`, which are numbers this file chose; a name the camp typed is
 * left exactly as it is, even where it collides, because two groups
 * deliberately called "Cherubim" are the camp's business.
 * ---------------------------------------------------------------------------
 */
export function mergeBands(
  draft: CampAllocationDraft,
  week: number,
  intoId: string,
  fromId: string,
): CampAllocationDraft {
  if (intoId === fromId) return draft;

  return editWeekBoard(draft, week, (board) => {
    const into = board.bands.find((band) => band.id === intoId);
    const from = board.bands.find((band) => band.id === fromId);
    if (!into || !from) return board;

    const grades = CAMP_GRADES.filter(
      (grade) => into.grades.includes(grade) || from.grades.includes(grade),
    );

    return {
      ...board,
      bands: board.bands
        .filter((band) => band.id !== fromId)
        .map((band) =>
          band.id !== intoId
            ? band
            : {
                ...band,
                grades,
                // The suggested name follows the grades as far as it was ours;
                // a name the camp typed survives a merge, as it survives
                // everything else.
                name:
                  band.name === suggestBandName(band.grades)
                    ? suggestBandName(grades)
                    : band.name,
                // The target's colour wins. Neither is more right, and asking
                // would be a dialog in the middle of a drag.
                groups: renumberDefaultNames([...band.groups, ...from.groups]).slice(
                  0,
                  MAX_GROUPS_PER_BAND,
                ),
              },
        ),
    };
  });
}

/**
 * Take a merged band apart, one band per grade.
 *
 * ---------------------------------------------------------------------------
 * The undo for `mergeBands`, and it cannot be a clean one, because a merged
 * band's groups are mixed on purpose — "Blue 1" holds 3rd and 4th graders and
 * that is the whole point of merging.
 *
 * So: each grade gets a band, each band gets the merged band's group *names*,
 * and every child goes into the band of **their own grade**, in the group of
 * the same name they were already in. A 3rd grader in "Blue 1" ends up in "3rd
 * grade · Blue 1". That is the closest thing to "what it was before" that the
 * data can support, and it moves nobody between groups they can tell apart.
 *
 * **Servants go back to the waiting list**, and that is the honest answer
 * rather than a guess: a servant has no grade, so nothing in the document says
 * which half of a split crew they belong to. The screen says so before it does
 * it. A child whose grade the band does not cover — the eight-year-old placed
 * with their cousin — goes back to the list for the same reason.
 * ---------------------------------------------------------------------------
 */
export function splitBand(
  draft: CampAllocationDraft,
  week: number,
  bandId: string,
  people: readonly CampPerson[],
): CampAllocationDraft {
  const board = weekBoardOf(draft, week);
  const band = board.bands.find((entry) => entry.id === bandId);
  if (!band || band.grades.length < 2) return draft;

  const gradeOf = new Map<CampPersonKey, CampGrade | null>(
    people.map((person) => [person.key, person.grade]),
  );

  const made = band.grades.map((grade) => ({
    grade,
    band: {
      ...blankBand(suggestBandName([grade]), [grade], band.colour),
      groups: band.groups.map((group) => blankGroup(group.name)),
    },
  }));

  for (const [index, group] of band.groups.entries()) {
    for (const key of group.childKeys) {
      const home = made.find((entry) => entry.grade === gradeOf.get(key));
      home?.band.groups[index]?.childKeys.push(key);
    }
  }

  return editWeekBoard(draft, week, (current) => ({
    ...current,
    bands: current.bands
      .flatMap((entry) => (entry.id === bandId ? made.map((made) => made.band) : [entry]))
      .slice(0, MAX_BANDS),
  }));
}

/* ---------------------------------------------------------------------------
 * Stations, which are the camp's roles
 * ------------------------------------------------------------------------ */

/**
 * The stations one half runs in one week: the camp's own role list, minus the
 * crew.
 *
 * ---------------------------------------------------------------------------
 * Tommy, 2 Sep 2026: *"the stations are all of the roles other than crew
 * leader."* Which makes a station not a thing anybody creates on the board at
 * all — it is a **name from `config/camp.weekRoles`**, the same list the sign-up
 * form offers, minus the one wish that means "put me with children".
 *
 * That is what makes the satisfaction meter mean something. A servant who ticked
 * "Sports" on the form and a station called "Sports" on the board are now the
 * same string by construction rather than by somebody having typed it twice,
 * so `campWishMet` cannot silently stop matching because a station was named
 * "Sports & games".
 *
 * It also deletes three controls the board used to carry: no "add a station",
 * no name field, no delete. A station the camp does not run is a role it takes
 * off its own list, in the camp's settings, where the form reads it from too.
 * ---------------------------------------------------------------------------
 */
export function campStationRoles(options: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of options) {
    const name = role.trim();
    if (name === '' || isCampCrewWish(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * The stored station for a role in a half, or null.
 *
 * Matched on the **name**, case-insensitively, not on an id: the role list is
 * the source of truth and a station is only a place to keep who is on it. A
 * role renamed in the settings therefore reads as a new station with nobody on
 * it, and the old one's servants come back to the waiting list — which is the
 * honest outcome, because a renamed role is a different job.
 */
export function stationForRole(
  board: Pick<CampWeekBoard, 'stations'>,
  role: string,
  section: CampSection,
): CampStation | null {
  const wanted = role.trim().toLowerCase();
  return (
    board.stations.find(
      (station) => station.section === section && station.name.trim().toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * Put a station in the document for a role that has none yet.
 *
 * The same lazy shape as `ensureBand`: the board draws a card for every role
 * whether or not anybody is on it, and the document only grows one when
 * somebody is placed. `colour` is taken from the role's position in the list so
 * it is stable — the export bands its rows by it, and a colour that moved when
 * somebody was dragged would reshuffle the spreadsheet.
 */
export function ensureStation(
  draft: CampAllocationDraft,
  week: number,
  role: string,
  section: CampSection,
  colour: CampColour,
): CampAllocationDraft {
  const board = weekBoardOf(draft, week);
  if (stationForRole(board, role, section)) return draft;
  if (board.stations.length >= MAX_STATIONS) return draft;
  return editWeekBoard(draft, week, (current) => ({
    ...current,
    stations: [...current.stations, blankStation(role.trim(), colour, section)],
  }));
}

/** A stable colour for the nth station in a half's role list. */
export function campRoleColour(index: number, section: CampSection): CampColour {
  // Middle school starts halfway round the wheel, so the two halves of the camp
  // do not hand out the same four colours to their first four stations.
  const offset = section === 'middle-school' ? Math.floor(CAMP_COLOURS.length / 2) : 0;
  return CAMP_COLOURS[(index + offset) % CAMP_COLOURS.length]!.value;
}

/* ---------------------------------------------------------------------------
 * Copying a week's shape onto another
 * ------------------------------------------------------------------------ */

/**
 * Give one week the same grade grouping as another, without moving anybody.
 *
 * ---------------------------------------------------------------------------
 * *"Genuine separation per week, but have the ability to match the
 * configuration of the grades — meaning if I merge grade 1 and 2 I can sync it
 * to do the same in week 2."*
 *
 * A **button, pressed once**, and after it the two weeks have no relationship.
 * That is the entire difference between this and `syncWeekStructure`, which was
 * scrapped: that one linked weeks permanently, shared ids between them, and had
 * a rule about which edits silently broke the link. Nobody could predict it.
 * This copies, and stops.
 *
 * What it does, in order:
 *
 *   1. Bands in the target that cover **exactly the same grades** as a source
 *      band are kept, with their people, and take the source's name and colour.
 *      That is the case that matters: week two already has 1st and 2nd apart,
 *      week one merged them, and the merged band inherits both weeks' children.
 *   2. Source bands with no counterpart are added, empty, with the source's
 *      group *names* and nobody in them.
 *   3. Target bands with no counterpart are **kept if anybody is in them** and
 *      dropped if not. A copy may not tip children onto the waiting list; a
 *      band left over from the copy is visible and can be emptied by hand.
 *
 * Stations are copied by name for the same reason and under the same rule.
 * Nobody is ever moved between weeks: a week's placements are its own.
 * ---------------------------------------------------------------------------
 */
export function copyWeekStructure(
  draft: CampAllocationDraft,
  from: number,
  to: number,
): CampAllocationDraft {
  if (from === to) return draft;
  const source = weekBoardOf(draft, from);
  if (source.bands.length === 0 && source.stations.length === 0) return draft;

  return editWeekBoard(draft, to, (target) => {
    const spare = new Set(target.bands.map((band) => band.id));

    const bands = source.bands.map((template) => {
      const match = target.bands.find(
        (band) => spare.has(band.id) && sameGrades(band.grades, template.grades),
      );
      if (!match) {
        return {
          ...blankBand(template.name, [...template.grades], template.colour),
          // The names, not the people: a week's groups are its own, and an id
          // shared across weeks is what made the old sync impossible to reason
          // about.
          groups: template.groups.map((group) => blankGroup(group.name)),
        };
      }
      spare.delete(match.id);
      return {
        ...match,
        name: template.name,
        grades: [...template.grades],
        colour: template.colour,
        // Groups the target already has stay exactly as they are, people and
        // all. Any the source has beyond them are added empty.
        groups: [
          ...match.groups,
          ...template.groups.slice(match.groups.length).map((group) => blankGroup(group.name)),
        ],
      };
    });

    // Whatever the copy did not account for, kept only if somebody is in it.
    for (const band of target.bands) {
      if (spare.has(band.id) && bandPlacementCount(band) > 0) bands.push(band);
    }

    const spareStations = new Set(target.stations.map((station) => station.id));
    const stations = source.stations.map((template) => {
      const match = target.stations.find(
        (station) =>
          spareStations.has(station.id) &&
          normaliseRole(station.name) === normaliseRole(template.name) &&
          station.section === template.section,
      );
      if (!match) {
        return {
          ...blankStation(template.name, template.colour, template.section),
          location: template.location,
        };
      }
      spareStations.delete(match.id);
      return { ...match, name: template.name, colour: template.colour, location: template.location };
    });
    for (const station of target.stations) {
      if (spareStations.has(station.id) && station.servantKeys.length > 0) stations.push(station);
    }

    return { ...target, bands: bands.slice(0, MAX_BANDS), stations: stations.slice(0, MAX_STATIONS) };
  });
}

function sameGrades(a: readonly CampGrade[], b: readonly CampGrade[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((grade) => set.has(grade));
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
   * One label per child, and it is a sentence again: "W1 3rd & 4th · Blue 1;
   * W2 3rd & 4th · Green 2".
   *
   * `groupName` is one string and the board is one per week, so the two do not
   * fit one-to-one. Naming only one week would be a copy that is wrong for the
   * other; naming neither would empty a field the registration screen shows. A
   * child in the same group both weeks gets the short form, which is the common
   * case and reads exactly as it did when the board was flat.
   */
  const byChild = new Map<CampPersonKey, { week: number; label: string }[]>();
  for (const board of [...draft.weeks].sort((a, b) => a.week - b.week)) {
    for (const band of board.bands) {
      for (const group of band.groups) {
        const label = `${band.name} · ${group.name}`;
        for (const key of group.childKeys) {
          const rows = byChild.get(key) ?? [];
          rows.push({ week: board.week, label });
          byChild.set(key, rows);
        }
      }
    }
  }

  const wanted = new Map<CampPersonKey, string>();
  for (const [key, rows] of byChild) {
    const same = rows.every((row) => row.label === rows[0]!.label);
    const text = same
      ? rows[0]!.label
      : rows.map((row) => `W${row.week} ${row.label}`).join('; ');
    wanted.set(key, text.slice(0, MAX_ALLOCATION_LINE * 2));
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
   * One `seen` set **per week**, not per document.
   *
   * It is what makes "one placement each" true of a document nobody's screen
   * wrote: a key present in two groups keeps its first placement and is dropped
   * from the second, so a hand-edited document resolves to a child in one group
   * rather than one the board draws twice and the export counts twice.
   *
   * Per week, because with the board divided by weeks again a servant on sports
   * in week one and with a crew in week two is **two legitimate placements** and
   * a document-wide set would silently eat the second. This was per-document
   * for the one day the camp had a single flat arrangement; getting it wrong in
   * either direction is invisible until somebody is missing off a roster.
   *
   * Children and servants share a week's set because their key spaces cannot
   * collide: a child's key contains a slash and a servant's does not.
   */

  const stored = list(doc['weeks']);
  const boards: CampWeekBoard[] = [];

  if (stored.length > 0 && stored.some((entry) => asRecord(entry)['bands'] !== undefined)) {
    /*
     * Already per week — either the shape written from 2 Sep 2026 onwards, or
     * the older one that carried a `linked` flag beside these fields. The flag
     * is dropped on read and never written back: weeks are copied on demand
     * now, never linked. See `copyWeekStructure`.
     */
    for (const entry of stored.slice(0, MAX_CAMP_WEEKS)) {
      const board = asRecord(entry);
      const seen = new Set<CampPersonKey>();
      boards.push({
        week: weekNumber(board['week'], boards.length + 1),
        bands: list(board['bands']).slice(0, MAX_BANDS).map((band) => parseBand(band, seen)),
        stations: list(board['stations'])
          .slice(0, MAX_STATIONS)
          .map((station) => parseStation(station, seen)),
      });
    }
  } else if (doc['bands'] !== undefined || doc['stations'] !== undefined) {
    /*
     * The flat shape, written for one day: `bands` and `stations` at the top
     * with no weeks at all.
     *
     * It becomes **week one**, and only week one. Copying it into every week
     * would invent placements nobody made — the flat board said "Mariam is in
     * Blue all summer", which is a claim about a camp that was not divided, and
     * asserting it of week two as well would put children on a register they
     * were never assigned to. Week two opens empty with the copy button on it,
     * which is a decision somebody makes rather than one we make for them.
     */
    const seen = new Set<CampPersonKey>();
    const stations = list(doc['stations']).slice(0, MAX_STATIONS);
    boards.push({
      week: 1,
      bands: list(doc['bands']).slice(0, MAX_BANDS).map((band) => parseBand(band, seen)),
      // A flat-shape station carried `weeks: number[]`; one that did not run in
      // week one has nowhere to go and is dropped rather than moved, because
      // moving it would put its servants in a week they were not rostered for.
      stations: stations
        .filter((station) => {
          const weeks = weekNumbers(asRecord(station)['weeks']);
          return weeks.length === 0 || weeks.includes(1);
        })
        .map((station) => parseStation(station, seen)),
    });
  }

  return {
    programId: str(doc['programId']) || 'summercamp',
    season: str(doc['season']),
    weeks: dedupeWeeks(boards),
    archivedAt: doc['archivedAt'] ?? null,
    archivedBy: nullableStr(doc['archivedBy']),
    note: text(doc['note']),
    createdAt: (doc['createdAt'] ?? null) as CampAllocation['createdAt'],
    updatedAt: (doc['updatedAt'] ?? null) as CampAllocation['updatedAt'],
    updatedBy: nullableStr(doc['updatedBy']),
  };
}

/** A whole week number inside the camp's bounds, or the position it arrived in. */
function weekNumber(value: unknown, fallback: number): number {
  const week = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (Number.isInteger(week) && week >= 1 && week <= MAX_CAMP_WEEKS) return week;
  return Math.min(Math.max(fallback, 1), MAX_CAMP_WEEKS);
}

/** One board per week, first occurrence wins, in week order. A document with
    two boards claiming week two is a document nobody's screen wrote. */
function dedupeWeeks(boards: readonly CampWeekBoard[]): CampWeekBoard[] {
  const byWeek = new Map<number, CampWeekBoard>();
  for (const board of boards) if (!byWeek.has(board.week)) byWeek.set(board.week, board);
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

function parseBand(raw: unknown, seen: Set<CampPersonKey>): CampBand {
  const doc = asRecord(raw);
  return {
    id: str(doc['id']) || allocationLineId('band'),
    name: str(doc['name']) || 'Band',
    grades: gradeList(doc['grades']),
    // `null` rather than a fallback hue for a band stored without one, which is
    // now the ordinary case: a band is made uncoloured and coloured later.
    colour: isCampColour(doc['colour']) ? doc['colour'] : null,
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

/** Whole week numbers inside the camp's bounds, deduped and in order. */
function weekNumbers(value: unknown): number[] {
  const found = new Set<number>();
  for (const entry of list(value)) {
    const week = typeof entry === 'number' ? Math.round(entry) : Number.NaN;
    if (Number.isInteger(week) && week >= 1 && week <= MAX_CAMP_WEEKS) found.add(week);
  }
  return [...found].sort((a, b) => a - b);
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
