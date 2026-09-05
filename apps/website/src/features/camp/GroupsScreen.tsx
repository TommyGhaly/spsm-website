'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMP_COLOURS,
  CAMP_GENDERS,
  CAMP_GRADES,
  CAMP_SECTIONS,
  MAX_BANDS,
  MAX_GROUPS_PER_BAND,
  arrangedWeeks,
  bandForGrade,
  bandsInSection,
  blankBand,
  blankGroup,
  campColourOf,
  campComesInWeek,
  campCoverage,
  campDaysInWeek,
  campDesiredRolesFor,
  campGenderLabel,
  campGenderPlural,
  campGenderShort,
  campGenderSplit,
  campSplitEmpty,
  campWeekdayLabel,
  campWeekRoleKey,
  parseCampDayKey,
  shirtSizeLabel,
  campGradeLabel,
  campGradeShort,
  campGradesForSection,
  campGroupMetrics,
  campReliability,
  campRoleColour,
  campCanPlace,
  campMisplacedChildren,
  campSectionBaseline,
  campSectionForGrade,
  campSectionLabel,
  campStationMetrics,
  campStationRoles,
  campWeekRangeLabel,
  campWeekRoleOptions,
  copyWeekStructure,
  dealBand,
  dropDangling,
  ensureBand,
  ensureStation,
  bandOfGroup,
  mergeBands,
  mergeGroups,
  nextCampColour,
  placeChild,
  placeServant,
  setLeader,
  splitBand,
  stationForRole,
  suggestBandName,
  suggestGroupName,
  weekBoardOf,
  type CampAllocationDraft,
  type CampBand,
  type CampColour,
  type CampConfig,
  type CampCoverageReading,
  type CampGenderSplit,
  type CampGrade,
  type CampDropTarget,
  type CampGroup,
  type CampPerson,
  type CampPersonKey,
  type CampPlaceMetrics,
  type CampReliability,
  type CampSection,
  type CampStation,
  type CampWeekBoard,
  type ResolvedAllocation,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { CampError, CampLoading, CampShell } from './CampShell';
import { downloadAllocationWorkbook } from './exportWorkbook';
import { ExportSheet } from './ExportSheet';
import { useCampAdmin } from './useCampAdmin';
import { useGroups, type GroupsState } from './useGroups';

/**
 * The groups board, at /admin/camp/groups.
 *
 * ---------------------------------------------------------------------------
 * **Every grade open, the two waiting lists pinned on the left, one week at a
 * time.**
 *
 * The sixth design, and the three things it changes are all things Tommy named:
 *
 * **The two lists are on the left.** They were on the right, on the theory that
 * dragging right-to-left into a column you are reading is the shorter movement.
 * It is not what the page felt like: the lists are where you *start*, and a
 * source pinned to the right of its destinations reads backwards.
 *
 * **Merging is something you pick up and carry.** It used to mean opening a
 * band's settings and ticking a grade in a row of nine checkboxes, having first
 * worked out which band held it — *"it is too difficult to merge grades."* Then
 * it was a **Merge with…** select on each card, which was correct and still
 * nothing like the way anybody describes the job. Every grade card now carries
 * a **Merge** grip: drag it onto another grade and the two run together, the
 * card you dropped on being the one that survives. A merged card carries
 * **Split**. The select is not gone, it has moved inside **Rename** as the
 * keyboard's way to do the same thing — see `MergeGrip`.
 *
 * **Stations are the camp's roles.** *"The stations are all of the roles other
 * than crew leader."* So the board no longer has an "add a station" button, a
 * name field or a delete: it draws one card per role in
 * `config/camp.weekRoles` for that week and half, minus the crew wish, and a
 * card becomes a stored station the moment somebody is dropped on it. The names
 * the satisfaction meter matches on are now the same strings the sign-up form
 * offered, by construction — see `campStationRoles`.
 *
 * ## What was already right and stays
 *
 * Every grade of the half is open down the page rather than behind a picker, in
 * grade order, with its groups under its name. The two halves are swiped
 * between. The board is one arrangement per week (`CampAllocation.weeks`) and
 * the one thing that crosses weeks is the **Same grades as week N** button.
 * Coverage is an even spread rather than a target, and satisfaction counts only
 * the servants who asked for something.
 *
 * ## Cards that are not in the document yet
 *
 * Most of what is on this page is a card for a grade nobody has arranged and a
 * station nobody has staffed. Neither is stored — seeding nine bands into a
 * draft the moment somebody opens the page is an unsaved change nobody asked
 * for — so both are built here and passed through `ensureBand` / `ensureStation`
 * by every action that touches them.
 *
 * ## Placing without dragging
 *
 * Every chip can be dragged, and every chip can also be **tapped to pick up**
 * and then dropped by tapping a group. HTML5 drag and drop does not exist on a
 * touchscreen, and this screen gets opened on an iPad at a table. One code path
 * — `place` — serves both, so the two cannot drift. The merge grip works the
 * same two ways for the same reason.
 *
 * ## Saying that the drag is working
 *
 * Four things, because a drag with no feedback is a gesture somebody performs
 * twice. Every card that would accept what is in the air is quietly lit
 * (`is-target`); the one card under the cursor goes loud (`is-over`); a label
 * follows the cursor saying what is in your hand (`.camp-ghost`, drawn by the
 * board itself — see `useBoardDrag`); and a bar at the foot of the window names
 * it too, because on a board eight grades tall the chip you picked up is off
 * screen by the time you have scrolled to where it is going.
 *
 * A person and a grade must not be able to land on each other's targets, so
 * every zone writes the cargo it takes into its own `data-camp-zone` and the
 * hit test walks up until it finds one that matches. A card that would refuse a
 * drop writes no attribute at all, which means the set of lit cards and the set
 * of cards that accept a drop are one set rather than two that have to agree.
 *
 * ## Colour
 *
 * A grade's colour is its own, chosen by the camp, and still **not** assigned
 * automatically — see `CAMP_UNCOLOURED` for why a guessed wristband colour is
 * worse than none. What is new is `paintEveryBand`, which is that decision made
 * deliberately in one press, and that a chosen colour now washes the whole card
 * rather than living in a 4px rule.
 *
 * A servant's chip is coloured by something else entirely: how much of the week
 * on screen they are actually there for — `campReliability`. That is the fact
 * the hardest placement on this board is traded on, and until now the chip drew
 * it as "3d" in grey.
 * ---------------------------------------------------------------------------
 */

/* ---------------------------------------------------------------------------
 * What the board is carrying
 * ------------------------------------------------------------------------ */

/**
 * The card a grade nobody has arranged is drawn as.
 *
 * Built here rather than inline in `SectionPane`, because a merge dropped onto
 * one of these has to be able to name the same card by id from
 * `GroupsScreen` — two builders would be two ids for one grade.
 *
 * The id is stable (`grade-3`) so React keeps the card across renders and
 * `ensureBand` can recognise it once it has been stored. It carries **no**
 * colour: a grade starts uncoloured on purpose — see `CAMP_UNCOLOURED`.
 */
function blankGradeCard(grade: CampGrade): CampBand {
  return {
    id: `grade-${grade}`,
    name: suggestBandName([grade]),
    grades: [grade],
    colour: null,
    groups: [],
    note: '',
  };
}

/**
 * Why every drag source on this board is a `<div role="button">` and not a
 * `<button>`.
 *
 * ---------------------------------------------------------------------------
 * It was because **Chrome will not start a drag from a
 * `<button draggable="true">`** — a form control swallows the mousedown for its
 * own activation behaviour, so the press that should have begun a drag began a
 * click instead, and on this board a click on a chip opens that person's card.
 *
 * That reason is gone: the board drags on pointer events now (`useBoardDrag`)
 * and `pointerdown` fires on a `<button>` like anything else. The divs stay
 * because they work and because `pressed` already gives them Enter and Space,
 * which is the only thing a real button was buying — but a new drag source has
 * no reason to copy the shape, and anything that becomes one has to keep
 * `pressed` if it does.
 * ---------------------------------------------------------------------------
 */
function pressed(run: () => void) {
  return (event: React.KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Space scrolls the page and Enter submits, neither of which is wanted from
    // a control that is only pretending to be a button.
    event.preventDefault();
    event.stopPropagation();
    run();
  };
}

/** Monday to Friday. A chip only prints a day count when it is fewer than
    this, so the ordinary case says nothing at all. */
const CAMP_WEEKDAYS_IN_WEEK = 5;

/** A grade card's element id, so the strip above can scroll to it. One place,
    because a mismatch here is a jump that silently does nothing. */
function bandDomId(bandId: string): string {
  return `camp-grade-${bandId}`;
}

type CampCargo = 'person' | 'band' | 'group';

/**
 * One drop zone, as a value: what it takes, and what it is.
 *
 * ---------------------------------------------------------------------------
 * Stringified into `data-camp-zone` on the element, because a pointer drag has
 * no `dataTransfer` and no `dragover` to ask a card whether it would take
 * something — the only thing under the cursor is a DOM node, so the DOM node
 * has to say. `cargo` is written first in every one of these so the reading is
 * "would this take what is in the air", which is the question
 * `zoneAt` walks the tree asking.
 *
 * A station is addressed by its **role**, not by an id: most of the stations on
 * this board have never been stored, and the one you are dropping on may not
 * exist until the drop creates it. See `StationCard`.
 * ---------------------------------------------------------------------------
 */
type CampDropZone =
  | { cargo: 'person'; kind: 'group'; bandId: string; groupId: string }
  | { cargo: 'person'; kind: 'station'; role: string; section: CampSection }
  | { cargo: 'person'; kind: 'pool'; of: 'child' | 'servant'; section: CampSection }
  | { cargo: 'band'; bandId: string }
  | { cargo: 'group'; groupId: string };

const ZONE_ATTR = 'data-camp-zone';

/** A zone's address as one string: its DOM attribute and its identity in
    `carry.over` are the same value, so the lit card and the card that takes the
    drop cannot be two different cards. */
function zoneKey(zone: CampDropZone): string {
  return JSON.stringify(zone);
}

/**
 * Every drop zone on screen that would take what is in the air, by key.
 *
 * ---------------------------------------------------------------------------
 * A pointer drag ends on the *source* element — that is what pointer capture
 * means — so the card under the cursor never sees the release and cannot run
 * its own drop handler. `useDropZone` leaves the handler here on the way past
 * and `useBoardDrag` looks it up once, at the release.
 *
 * A module-level map rather than a context, because there is exactly one of
 * this board on screen and every key in it is unique across both halves — a
 * band id, a group id, or a role and a half. The entry is a **ref**, not the
 * function, so a card whose handler closes over a fresh render is not a card
 * that has to re-register on every one.
 * ---------------------------------------------------------------------------
 */
const ZONES = new Map<string, { current: (id: string) => void }>();

/**
 * Everything the board is holding, by either means, in one object.
 *
 * Tapping and dragging are two ways to do one thing and both have to light the
 * same targets, so they are read through the same shape. `person`/`band` are
 * *tap* pickups, which survive until they are put down; `dragging` lives only
 * for the length of a native drag. `id` is what is in the air either way, so a
 * card can grey out the thing that has left it.
 */
interface Carry {
  /** A person tapped and not yet put down. */
  person: CampPersonKey | null;
  /** A grade tapped and not yet merged. */
  band: string | null;
  /** A crew tapped and not yet run together with another. */
  group: string | null;
  /** What a pointer drag is carrying right now. */
  dragging: CampCargo | null;
  /** The id in the air, by either means. */
  id: string | null;
  /** The `zoneKey` under the cursor, or null. One value for the whole board:
      there is one pointer, so exactly one card can be the one being dropped on,
      and holding that per card is how two cards come to be lit at once. */
  over: string | null;
}

const NOTHING: Carry = {
  person: null,
  band: null,
  group: null,
  dragging: null,
  id: null,
  over: null,
};

/** True while a person is in the air — by tap or by drag. */
function carryingPerson(carry: Carry): boolean {
  return carry.person !== null || carry.dragging === 'person';
}

/** True while a grade is in the air. */
function carryingBand(carry: Carry): boolean {
  return carry.band !== null || carry.dragging === 'band';
}

/** True while a crew is in the air. */
function carryingGroup(carry: Carry): boolean {
  return carry.group !== null || carry.dragging === 'group';
}

/**
 * One drop zone: whether it is lit, and how it says so to the pointer.
 *
 * ---------------------------------------------------------------------------
 * `enabled` is the whole of it. A zone that would take what is in the air
 * writes its key into the DOM, and one that would not writes nothing — so
 * `zoneAt` cannot find a card that is not lit, and the "will take this"
 * styling and the set of cards that actually accept a drop are the same set by
 * construction rather than by agreement.
 *
 * That is the part the old HTML5 version had to work for: there, `enabled` was
 * React state read inside `dragover`, and the first `dragenter` could arrive
 * before the render that set it. Here the lift and the first reading of what is
 * under the cursor are two different pointer moves, so the attribute is always
 * already there.
 * ---------------------------------------------------------------------------
 */
function useDropZone({
  zone,
  enabled,
  readOnly,
  carry,
  onDropped,
}: {
  zone: CampDropZone;
  enabled: boolean;
  /** The season is frozen. Nothing lands, whatever is in the air. */
  readOnly?: boolean;
  carry: Carry;
  onDropped: (id: string) => void;
}) {
  const key = zoneKey(zone);

  /* The handler is left in `ZONES` behind a ref, so a card re-rendering forty
     times during a drag re-registers nothing — see `ZONES`. Assigning during
     render is safe here because it is the same value the next commit would
     write, and nothing reads it until a pointer is released. */
  const handler = useRef(onDropped);
  handler.current = onDropped;

  useEffect(() => {
    if (readOnly) return undefined;
    ZONES.set(key, handler);
    return () => {
      // Only if it is still ours: two cards briefly sharing a key across a
      // re-key would otherwise have the survivor delete itself.
      if (ZONES.get(key) === handler) ZONES.delete(key);
    };
  }, [key, readOnly]);

  return {
    over: enabled && carry.over === key,
    dropProps: enabled ? { [ZONE_ATTR]: key } : {},
  };
}

/** How far the pointer travels before a press becomes a drag. Small, because
    the gesture is deliberate; not zero, because a click must survive a hand
    that is not perfectly still. */
const DRAG_THRESHOLD = 4;

/**
 * How near an edge the pointer has to be for the board to start moving under
 * it, and how fast it then moves. A native drag did this for nothing.
 *
 * Narrow on purpose. At 90px the band swallowed a crew card sitting at the foot
 * of the window: aiming at it started the page creeping instead, and the drop
 * landed on whatever had slid under the cursor by then. A card's last two rows
 * have to be droppable.
 */
const DRAG_EDGE = 56;
const DRAG_EDGE_STEP = 18;

/** What a drag source hands back: the one handler that starts a drag. */
type CampGrab = (
  cargo: CampCargo,
  id: string,
) => { onPointerDown: (event: React.PointerEvent) => void };

/**
 * The custom properties a copied chip or grip reads out of the air around it.
 *
 * A clone is lifted out of the tree that was giving it these — a crew card
 * hands its grade's colour down to the chips inside it, and the reliability
 * ramp is set on the row itself — so they are read off the source once and
 * written onto the copy. Named rather than enumerated: `getComputedStyle` only
 * lists custom properties in recent Chrome, and a list that silently works in
 * one browser is worse than a short one that works everywhere.
 */
const CARRIED_VARS = ['--camp-colour', '--camp-ink', '--camp-rel', '--camp-side'] as const;

/** The first thing behind `el` that actually paints, so the copy is not a chip
    floating on whatever it happens to be over. */
function backdropOf(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const paint = getComputedStyle(node).backgroundColor;
    // Anything but "no paint at all". `rgba(…, 0)` is the transparent default
    // every one of these rows and cards has.
    if (paint && paint !== 'transparent' && !/,\s*0\s*\)$/.test(paint)) return paint;
    node = node.parentElement;
  }
  return 'var(--color-paper-raised, #fdf7f4)';
}

/**
 * A copy of what has just been picked up.
 *
 * ---------------------------------------------------------------------------
 * The board draws its own drag image — there is no `dataTransfer` to hand one
 * to — and the first version drew a name on an oxblood pill. That is a label
 * *about* the thing you are carrying rather than the thing itself: you pick up
 * a row that says a name, an age, a sex and what they asked to do, and what
 * follows your hand is four words in a colour the board does not otherwise use
 * for people.
 *
 * So it is a clone. Of the **row**, not of the handle inside it, because a
 * chip's look lives on the `<li>`: the reliability ramp, the grade's colour,
 * the strikethrough on somebody withdrawn. It keeps its own width and it keeps
 * the offset it was grabbed at, so the copy sits under the hand exactly where
 * the original was — the row is peeled off the list rather than replaced by a
 * token for it.
 * ---------------------------------------------------------------------------
 */
function copyOf(
  from: HTMLElement,
  atX: number,
  atY: number,
): { node: HTMLElement; dx: number; dy: number } {
  const source = (from.closest('.camp-person') as HTMLElement | null) ?? from;
  const rect = source.getBoundingClientRect();
  const read = getComputedStyle(source);

  const clone = source.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  // The original is about to go faint; the copy is the one you are looking at.
  clone.classList.remove('is-lifted');
  // Nothing in here is operable. The box around it is `aria-hidden`, and a
  // focusable node inside one of those is reachable by tab and unreachable by
  // anything that would say what it is — so the copy gives up its tab stops.
  // `[tabindex]` on the clone **and** inside it: a grip is the copied element
  // itself, so a query for descendants alone would miss the only one there is.
  clone.removeAttribute(ZONE_ATTR);
  for (const el of [clone, ...clone.querySelectorAll('[tabindex], [id]')]) {
    el.removeAttribute('tabindex');
    el.removeAttribute('id');
  }

  // A chip is `.camp-people .camp-person` — a descendant selector, so the row
  // needs its list around it or it loses its layout on the way out.
  let node = clone;
  if (clone.classList.contains('camp-person')) {
    const list = document.createElement('ul');
    list.className = 'camp-people';
    list.appendChild(clone);
    node = list;
  }

  node.style.width = `${rect.width}px`;
  node.style.background = backdropOf(source);
  for (const name of CARRIED_VARS) {
    const value = read.getPropertyValue(name);
    if (value) node.style.setProperty(name, value);
  }

  return { node, dx: rect.left - atX, dy: rect.top - atY };
}

/**
 * The board's drag, on pointer events.
 *
 * ---------------------------------------------------------------------------
 * **Why this is not HTML5 drag and drop any more.**
 *
 * It was, and the reported symptom was that a servant in the rail would not
 * lift at all — no ghost, no faded chip, nothing — while the same servant
 * dragged out of a crew was fine, and so was a child in the same list. Every
 * measurable thing about the three was identical: the same markup down to the
 * attribute, the same computed `-webkit-user-drag`, `user-select`,
 * `pointer-events` and `touch-action`, and the same `overflow` / `position` /
 * `mask` / `transform` on every ancestor up to `<html>`. Driven by hand the
 * placement logic did the right thing end to end. Whatever was refusing to
 * start that drag was inside the browser's own heuristics, where there is
 * nothing to fix.
 *
 * So the gesture no longer asks the browser's permission. `pointerdown`,
 * a threshold, `setPointerCapture`, and the board draws its own ghost. There is
 * no `dragstart` to be declined, no `dataTransfer`, and no `dragover` whose
 * `preventDefault` decides whether a drop is allowed — the zone under the
 * cursor is found by hit-testing the DOM, which cannot fail to fire.
 *
 * **Touch is deliberately left alone.** HTML5 drag never worked there either,
 * and claiming the gesture would mean `touch-action: none` on every chip —
 * which would stop the two short rail lists scrolling, and scrolling them is
 * how you reach the name you want. Tap-to-pick-up is the touch path, it is
 * unchanged, and it goes through the same `place`.
 *
 * The pointer position lives in a ref and the ghost is moved by hand. Sixty
 * renders a second of a board eight grades tall is not affordable, and none of
 * them would change anything but one `transform`.
 * ---------------------------------------------------------------------------
 */
function useBoardDrag({
  readOnly,
  onLift,
  onHover,
}: {
  readOnly: boolean;
  /** A drag started, or ended. Mirrors what `carry` should say. */
  onLift: (cargo: CampCargo | null, id: string | null) => void;
  /** The zone under the cursor changed. Only called when it actually has. */
  onHover: (key: string | null) => void;
}) {
  /** The drag in flight. Never state — see the note above. */
  const live = useRef<{
    pointerId: number;
    cargo: CampCargo;
    id: string;
    from: HTMLElement;
    startX: number;
    startY: number;
    x: number;
    y: number;
    /** Where the copy sits relative to the cursor: the offset the thing was
        grabbed at, so it stays under the hand where it was picked up. */
    dx: number;
    dy: number;
    /** Past the threshold. Before that this is only a press. */
    lifted: boolean;
    over: string | null;
  } | null>(null);

  const ghost = useRef<HTMLDivElement | null>(null);
  /** The copy made at the moment of the lift, waiting for the box to put it
      in. See `copyOf`. */
  const copy = useRef<HTMLElement | null>(null);
  /** Set once when the drag starts and cleared once when it ends: the only two
      renders a whole drag costs. */
  const [held, setHeld] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const edge = useRef<number | null>(null);

  /* The callers, behind a ref, so the listeners below can be built once. */
  const say = useRef({ readOnly, onLift, onHover });
  say.current = { readOnly, onLift, onHover };

  const control = useMemo(() => {
    function moveGhost(x: number, y: number, dx: number, dy: number) {
      const el = ghost.current;
      if (el) el.style.transform = `translate3d(${x + dx}px, ${y + dy}px, 0)`;
    }

    /**
     * The zone under a point that would take this cargo.
     *
     * Walks up from the deepest element rather than reading one attribute,
     * because the cursor is nearly always over a chip or a heading inside a
     * card. The walk stops at the first zone whose cargo matches, which is what
     * makes a crew card win a person and the grade card around it win a grade —
     * the same job `stopPropagation` used to do on `drop`.
     */
    function zoneAt(x: number, y: number, cargo: CampCargo): string | null {
      let node: Element | null = document.elementFromPoint(x, y);
      while (node) {
        const key = node.getAttribute(ZONE_ATTR);
        if (key !== null) {
          try {
            if ((JSON.parse(key) as CampDropZone).cargo === cargo) return key;
          } catch {
            // Not ours. Nothing else writes this attribute, but a parse that
            // throws must not take the whole drag down with it.
          }
        }
        node = node.parentElement;
      }
      return null;
    }

    /** The nearest thing under the pointer that scrolls, if anything does. */
    function scrollerAt(x: number, y: number): HTMLElement | null {
      let node: Element | null = document.elementFromPoint(x, y);
      while (node instanceof HTMLElement) {
        const flow = getComputedStyle(node).overflowY;
        if ((flow === 'auto' || flow === 'scroll') && node.scrollHeight > node.clientHeight) {
          return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    /*
     * The board moves under a pointer held near an edge.
     *
     * The rail's two lists first, because they are short scrollers and the name
     * you want is usually the one just past the end of one; the window after
     * that, because the grade you are carrying somebody to is four thousand
     * pixels down. Re-reads the zone as it goes: the pointer can be perfectly
     * still while the card under it changes.
     */
    function creep() {
      const now = live.current;
      if (!now || !now.lifted) return;
      const { x, y } = now;

      const box = scrollerAt(x, y);
      let moved = false;
      if (box) {
        const rect = box.getBoundingClientRect();
        if (y < rect.top + DRAG_EDGE && box.scrollTop > 0) {
          box.scrollTop -= DRAG_EDGE_STEP;
          moved = true;
        } else if (
          y > rect.bottom - DRAG_EDGE &&
          box.scrollTop + box.clientHeight < box.scrollHeight
        ) {
          box.scrollTop += DRAG_EDGE_STEP;
          moved = true;
        }
      }
      if (!moved) {
        if (y < DRAG_EDGE) window.scrollBy(0, -DRAG_EDGE_STEP);
        else if (y > window.innerHeight - DRAG_EDGE) window.scrollBy(0, DRAG_EDGE_STEP);
        else return;
      }

      const key = zoneAt(x, y, now.cargo);
      if (key !== now.over) {
        now.over = key;
        say.current.onHover(key);
      }
    }

    /**
     * Eat the click that ends a drag.
     *
     * A pointer drag is a real press and release, so the browser follows it
     * with a click on the source — and on this board a click on a chip opens
     * that person's card. Capture phase and once, then taken off in a task of
     * its own in case the release produced no click at all (dropping outside
     * the window does not).
     */
    function swallowClick() {
      const kill = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      document.addEventListener('click', kill, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', kill, true), 0);
    }

    function stop() {
      const now = live.current;
      live.current = null;
      if (now) {
        try {
          now.from.releasePointerCapture(now.pointerId);
        } catch {
          // The pointer is already gone, or the element is. Nothing to release.
        }
      }
      if (edge.current !== null) {
        window.clearInterval(edge.current);
        edge.current = null;
      }
      document.body.classList.remove('is-camp-dragging');
      copy.current = null;
      setHeld(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      return now;
    }

    function onMove(event: PointerEvent) {
      const now = live.current;
      if (!now || event.pointerId !== now.pointerId) return;
      now.x = event.clientX;
      now.y = event.clientY;

      if (!now.lifted) {
        if (
          Math.abs(now.x - now.startX) < DRAG_THRESHOLD &&
          Math.abs(now.y - now.startY) < DRAG_THRESHOLD
        ) {
          return;
        }
        now.lifted = true;
        try {
          // Capture, so a drag that runs off the card — or off the window and
          // back — is still this drag rather than being abandoned mid-air.
          now.from.setPointerCapture(now.pointerId);
        } catch {
          // Not fatal: without capture the window listeners still see the move
          // and the release, they just stop at the window's edge.
        }
        document.body.classList.add('is-camp-dragging');
        // Copied from where it still sits, before the lift fades it.
        const made = copyOf(now.from, now.startX, now.startY);
        copy.current = made.node;
        now.dx = made.dx;
        now.dy = made.dy;
        setHeld({ x: now.x, y: now.y, dx: made.dx, dy: made.dy });
        say.current.onLift(now.cargo, now.id);
        // An interval and not `requestAnimationFrame`: rAF never fires in the
        // Browser pane, so the creep would be untestable there. Note that a
        // *hidden* page throttles this to about three ticks a second — a crawl
        // in a background tab is Chrome, not this.
        edge.current = window.setInterval(creep, 16);
        // The zones do not declare themselves until that lift has rendered, so
        // the first reading of what is under the cursor waits for the next
        // move. There is always a next move: this one crossed a threshold.
        return;
      }

      moveGhost(now.x, now.y, now.dx, now.dy);
      const key = zoneAt(now.x, now.y, now.cargo);
      if (key !== now.over) {
        now.over = key;
        say.current.onHover(key);
      }
    }

    function onUp(event: PointerEvent) {
      const now = live.current;
      if (!now || event.pointerId !== now.pointerId) return;
      const { cargo, id, lifted } = now;
      // Read the zone from the release rather than trusting the last move: by
      // now the DOM is settled, and this is the position the hand chose.
      const key = lifted ? zoneAt(event.clientX, event.clientY, cargo) : null;
      stop();
      // A press that never became a drag is a click. Leave it alone — somebody
      // tapping a chip is asking for that person's card.
      if (!lifted) return;
      swallowClick();
      // Put it down first, then act, so a handler that forgets to clear the
      // board cannot leave something in the air.
      say.current.onLift(null, null);
      const zone = key === null ? undefined : ZONES.get(key);
      if (zone) zone.current(id);
    }

    function onCancel() {
      const was = live.current?.lifted ?? false;
      stop();
      if (was) say.current.onLift(null, null);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      onCancel();
    }

    const grab: CampGrab = (cargo, id) => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (say.current.readOnly) return;
        // Touch keeps the board exactly as it was; see the note above.
        if (event.pointerType === 'touch') return;
        if (event.button !== 0) return;
        // Not `preventDefault`: the press still has to focus the control and
        // still has to be able to end as a click.
        live.current = {
          pointerId: event.pointerId,
          cargo,
          id,
          from: event.currentTarget as HTMLElement,
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          dx: 0,
          dy: 0,
          lifted: false,
          over: null,
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey);
      },
    });

    return { grab, stop };
  }, []);

  // A board unmounted mid-drag would otherwise leave its listeners, its edge
  // timer and `is-camp-dragging` on the document behind it.
  useEffect(() => () => void control.stop(), [control]);

  /** The box the copy goes in. A callback ref rather than an effect, because
      the copy exists before the box does and this is the moment it appears. */
  const fill = useCallback((node: HTMLDivElement | null) => {
    ghost.current = node;
    if (node && copy.current) node.replaceChildren(copy.current);
  }, []);

  return {
    grab: control.grab,
    ghost:
      held === null ? null : (
        <div
          ref={fill}
          className="camp-ghost"
          aria-hidden="true"
          style={{ transform: `translate3d(${held.x + held.dx}px, ${held.y + held.dy}px, 0)` }}
        />
      ),
  };
}

export function GroupsScreen() {
  const session = useCampAdmin();
  const { canEdit, config, uid } = session;
  const state = useGroups(config.programId, config.season, uid, canEdit);
  const { draft, resolved, people, edit, readOnly, week, setWeek } = state;
  const { canUndo, canRedo, undo, redo } = state;

  /** Which half of the camp is on screen. */
  const [section, setSection] = useState<CampSection>('elementary');
  /** What the board is holding, by tap or by drag. See `Carry`. */
  const [carry, setCarry] = useState<Carry>(NOTHING);
  /** Whose card is open. See `PersonCard`. */
  const [showing, setShowing] = useState<CampPersonKey | null>(null);
  /** Which band's name and colour are open. One at a time, across both halves. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Whether the export dialog is open. See `ExportSheet`. */
  const [exporting, setExporting] = useState(false);
  const [names, setNames] = useState<string | null>(null);

  /** Tap-pick-up a person. Picking one up puts down whatever else was held —
      two things in the air at once is a state with no meaning. */
  const holdPerson = useCallback((key: CampPersonKey | null) => {
    setCarry((current) =>
      key === null || current.person === key
        ? NOTHING
        : { ...NOTHING, person: key, id: key },
    );
  }, []);

  /** Tap-pick-up a grade, to merge it into another. */
  const holdBand = useCallback((id: string | null) => {
    setCarry((current) =>
      id === null || current.band === id ? NOTHING : { ...NOTHING, band: id, id },
    );
  }, []);

  /** Tap-pick-up a crew, to run it together with another of its own grade. */
  const holdGroup = useCallback((id: string | null) => {
    setCarry((current) =>
      id === null || current.group === id ? NOTHING : { ...NOTHING, group: id, id },
    );
  }, []);

  /**
   * A drag started, or ended.
   *
   * Dragging the very thing the board is already holding **keeps** the hold, so
   * a drag abandoned mid-air leaves the board exactly as it found it. Dragging
   * anything else puts the old one down: two things in the air at once is a
   * state with no meaning — and, concretely, a crew card is a drop zone for
   * both a person and another crew, so a tap-held child plus a dragged crew
   * would have had one card claiming to take both.
   */
  const lift = useCallback((what: CampCargo | null, id: string | null) => {
    setCarry((current) => {
      if (what === null) {
        return {
          ...current,
          dragging: null,
          over: null,
          id: current.person ?? current.band ?? current.group,
        };
      }
      const same =
        (what === 'person' && current.person === id) ||
        (what === 'band' && current.band === id) ||
        (what === 'group' && current.group === id);
      return same
        ? { ...current, dragging: what, over: null, id }
        : { ...NOTHING, dragging: what, over: null, id };
    });
  }, []);

  /** The card under the cursor changed. Compared before it is written, so a
      drag across one card is one render and not sixty. */
  const hover = useCallback((key: string | null) => {
    setCarry((current) => (current.over === key ? current : { ...current, over: key }));
  }, []);

  const { grab, ghost } = useBoardDrag({ readOnly, onLift: lift, onHover: hover });

  /*
   * ⌘Z and ⇧⌘Z, the way every other board does it.
   *
   * On `window` rather than on the board, because the gesture is made with the
   * hands nowhere near it — the mouse is over a grade card, and neither that
   * nor the page has focus. Skipped while a text field has focus, so renaming
   * a grade and taking back the typing does not silently take back the drag
   * before it instead.
   */
  useEffect(() => {
    if (readOnly) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, undo, redo]);

  function place(key: CampPersonKey, target: CampDropTarget) {
    const person = resolved?.byKey.get(key);
    if (!person) return;
    /*
     * The grade rule, enforced in the one place every placement goes through.
     *
     * The cards that would refuse a drop are also not lit and do not call
     * `preventDefault`, so this should be unreachable by pointer — but "should
     * be unreachable by pointer" is not an invariant, and a 5th grader in a
     * Kindergarten crew is only noticed on the Monday morning. See
     * `campCanPlace`.
     */
    if (draft && !campCanPlace(person, weekBoardOf(draft, week), target)) {
      setCarry(NOTHING);
      return;
    }
    edit((current) =>
      person.kind === 'child'
        ? placeChild(current, week, key, target)
        : placeServant(current, week, key, target),
    );
    setCarry(NOTHING);
  }

  /**
   * Run one grade into another.
   *
   * `intoId` is the card that was **dropped on** and it is the one that
   * survives — see `mergeBands`. That is the natural reading of the gesture:
   * you carry 4th grade over to 3rd and let go, and what you are left with is
   * 3rd grade, bigger.
   */
  function merge(fromId: string, intoId: string) {
    if (fromId === intoId) return;
    const from = bandCard(fromId);
    const into = bandCard(intoId);
    if (!from || !into) return;
    edit((current) =>
      mergeBands(
        ensureBand(ensureBand(current, week, into), week, from),
        week,
        into.id,
        from.id,
      ),
    );
    setCarry(NOTHING);
  }

  /**
   * Run two crews of one grade together.
   *
   * Both ends must be in the same band, because a group is defined by the
   * grades of the band around it — see `campCanPlace`. Joining across bands
   * would put children in a crew their grade is not allowed in, so the answer
   * to "can I merge 3rd's Group 1 into 4th's?" is *merge the grades first*.
   */
  function mergeCrews(fromId: string, intoId: string) {
    if (fromId === intoId || !draft) return;
    const board = weekBoardOf(draft, week);
    const band = bandOfGroup(board, intoId);
    if (!band || bandOfGroup(board, fromId)?.id !== band.id) {
      setCarry(NOTHING);
      return;
    }
    edit((current) => mergeGroups(current, week, band.id, intoId, fromId));
    setCarry(NOTHING);
  }

  /**
   * A card by id, whether or not the draft has ever seen it.
   *
   * Most cards on this page are grades nobody has arranged, built for the
   * screen and not stored — see `SectionPane`. A merge has to be able to name
   * one of those as either end, so the lookup falls back to building the same
   * card `SectionPane` would have drawn.
   */
  function bandCard(id: string): CampBand | null {
    const stored = draft ? weekBoardOf(draft, week).bands.find((band) => band.id === id) : null;
    if (stored) return stored;
    const grade = CAMP_GRADES.find((entry) => `grade-${entry}` === id);
    return grade ? blankGradeCard(grade) : null;
  }

  const swipe = useSwipe(section, setSection);

  if (!canEdit || state.loading) {
    return (
      <CampShell session={session} tab="groups" title="Summer camp">
        {state.error ? <CampError error={state.error} /> : <CampLoading what="the camp" />}
      </CampShell>
    );
  }

  return (
    <CampShell
      session={session}
      tab="groups"
      title="Summer camp"
      actions={
        <>
          {/*
            Take the last move back.
            ------------------------------------------------------------------
            The board is arranged by dragging, and a drag has no natural
            opposite: a child dropped on the wrong crew has to be found again
            in a list of forty and dragged somewhere else, and a merge that
            was a mistake dissolved two grades on the way. So the pair sits
            beside Save, which is the other thing this bar is for, and both
            are icon-and-word rather than icon alone — see `Icon`.
          */}
          {!readOnly ? (
            <span className="camp-history">
              <button
                type="button"
                className="button button--quiet camp-history__btn"
                disabled={!canUndo}
                title="Take the last move back (⌘Z)"
                onClick={undo}
              >
                <Icon name="undo" size={16} />
                Undo
              </button>
              <button
                type="button"
                className="button button--quiet camp-history__btn"
                disabled={!canRedo}
                title="Put it back (⇧⌘Z)"
                onClick={redo}
              >
                <Icon name="redo" size={16} />
                Redo
              </button>
            </span>
          ) : null}

          {/*
            Where Save used to be.
            ------------------------------------------------------------------
            Every move writes itself about a second later — see `AUTOSAVE_MS` —
            so there is nothing here to press in the ordinary case, and a
            button that is disabled all evening is a button people learn to
            distrust. What is left is the sentence saying which of the three
            states the board is in, and a real button in the one state where a
            person has to decide: the write failed and nothing is retrying it.
          */}
          {!readOnly ? <SaveState state={state} /> : null}
        </>
      }
    >
      {state.error ? <CampError error={state.error} /> : null}

      {state.conflictWith ? (
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <div className="notice notice--warn">
              <h2>Somebody else has saved this</h2>
              <p>
                Somebody saved a different arrangement on another device in the same second as
                your last move, so the two boards have gone apart. They cannot be merged
                without inventing an arrangement neither of you made, so nothing has been
                touched here — and nothing more is being saved automatically until this is
                settled.
              </p>
              <p>
                <button type="button" className="button" onClick={state.takeTheirs}>
                  Take theirs and lose my changes
                </button>{' '}
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() => void state.keepMine()}
                >
                  Keep mine and overwrite
                </button>
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {readOnly ? (
        <section className="band camp-band">
          <div className="wrap camp-wrap">
            <p className="note">
              Summer {config.season} is frozen, so nothing here can be moved. Reopen it on{' '}
              <a href="/admin/camp">the camp screen</a>.
            </p>
          </div>
        </section>
      ) : null}

      <section className="band camp-band">
        <div className="wrap camp-wrap camp-topBar">
          <SectionSwitch
            section={section}
            onSection={setSection}
            counts={{
              elementary: sectionHeadcount(people, 'elementary', week),
              'middle-school': sectionHeadcount(people, 'middle-school', week),
            }}
          />

          <WeekSwitch
            week={week}
            weeks={config.weeks}
            weekStarts={config.weekStarts}
            onWeek={setWeek}
            arranged={draft ? arrangedWeeks(draft) : []}
            readOnly={readOnly}
            onCopy={(from) => edit((current) => copyWeekStructure(current, from, week))}
          />
        </div>
      </section>

      <div
        className={`camp-swipe${carry.id ? ' is-carrying' : ''}`}
        ref={swipe.ref}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchEnd}
      >
        <div
          className={`camp-swipe__track${swipe.dragging ? ' is-dragging' : ''}`}
          style={{
            transform: `translateX(calc(${-CAMP_SECTIONS.indexOf(section) * 100}% + ${swipe.offset}px))`,
          }}
        >
          {CAMP_SECTIONS.map((entry) => (
            <div
              key={entry}
              className="camp-swipe__pane"
              /* The half you cannot see is also not tabbable. Without this the
                 keyboard walks straight off the board into the other half's
                 chips, which is a hundred stops to nowhere. */
              inert={entry !== section}
            >
              <SectionPane
                section={entry}
                week={week}
                config={config}
                draft={draft}
                resolved={resolved}
                people={people}
                editingId={editingId}
                onEditing={setEditingId}
                carry={carry}
                onOpen={setShowing}
                onHoldPerson={holdPerson}
                onHoldBand={holdBand}
                onHoldGroup={holdGroup}
                grab={grab}
                onPlace={place}
                onMerge={merge}
                onMergeCrews={mergeCrews}
                onEdit={edit}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      </div>

      <section className="band camp-band">
        <div className="wrap camp-wrap camp-tools">
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setExporting(true)}
          >
            Download .xlsx
          </button>

          <button
            type="button"
            className="button button--quiet"
            disabled={readOnly}
            onClick={() => {
              void state.publishNames().then((written) => {
                setNames(
                  written === 0
                    ? 'Every registration already says the right group.'
                    : `Wrote the group onto ${written} registration${written === 1 ? '' : 's'}.`,
                );
              });
            }}
          >
            Write groups onto registrations
          </button>

          {resolved && resolved.dangling.length > 0 && !readOnly ? (
            <button
              type="button"
              className="camp-danger"
              onClick={() => edit((current) => dropDangling(current, people))}
            >
              Clear {resolved.dangling.length} placement
              {resolved.dangling.length === 1 ? '' : 's'} matching nobody
            </button>
          ) : null}

          {/*
            "Colour every grade" was here and is not any more.
            ------------------------------------------------------------------
            It is the same one press, offered from `GradeStrip` at the top of
            the board instead — and only while there is a grade without a
            colour, so it stops being offered once the decision is made. At the
            foot of a page nine grades tall, under three other tools, it was a
            control that made the board colourful and that nobody ever scrolled
            far enough to find. `paintEveryBand` is unchanged.
          */}

          {names ? <p className="note">{names}</p> : null}
        </div>
      </section>

      {/*
        What is in the air, said out loud.
        ------------------------------------------------------------------
        A picked-up chip changes colour, but on a board eight grades tall the
        chip is usually off screen by the time you have scrolled to where it is
        going — and then nothing anywhere says the tap worked. This bar is
        fixed to the bottom of the window and names what is being carried and
        what to do with it, and it is the same bar for a tap and for a drag.
      */}
      {showing && resolved?.byKey.get(showing) ? (
        <PersonCard
          person={resolved.byKey.get(showing)!}
          week={week}
          config={config}
          held={carry.person === showing}
          readOnly={readOnly}
          onPickUp={() => {
            holdPerson(showing);
            setShowing(null);
          }}
          onClose={() => setShowing(null)}
        />
      ) : null}

      {exporting ? (
        <ExportSheet
          config={config}
          season={config.season}
          onClose={() => setExporting(false)}
          onPick={(weeks, sections) => {
            setExporting(false);
            if (!draft) return;
            downloadAllocationWorkbook({
              allocation: draft,
              registrations: state.registrations,
              generatedBy: uid ?? '',
              weeks,
              sections,
            });
          }}
        />
      ) : null}

      {carry.id ? (
        <div className="camp-carry" role="status">
          <span className="camp-carry__dot" aria-hidden="true" />
          <span className="camp-carry__what">
            {carryingBand(carry)
              ? `Carrying ${bandCard(carry.id)?.name ?? 'a grade'}`
              : `Carrying ${resolved?.byKey.get(carry.id)?.name ?? 'somebody'}`}
          </span>
          <span className="camp-carry__how">
            {carryingBand(carry)
              ? 'Drop it on another grade to run the two together'
              : 'Drop them on a group or a station · the lists take them back out'}
          </span>
          {carry.dragging === null ? (
            <button
              type="button"
              className="camp-carry__put"
              onClick={() => setCarry(NOTHING)}
            >
              Put down
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        What is under the cursor while a drag is in flight.

        The board draws this itself now — a pointer drag has no drag image, and
        without one the only sign that the press worked is a chip going faint
        somewhere you have already scrolled away from. See `useBoardDrag`.
      */}
      {ghost}
    </CampShell>
  );
}

/**
 * Give every uncoloured grade a colour, in one edit.
 *
 * ---------------------------------------------------------------------------
 * A grade is created with **no** colour, and that stays true: the camp hands
 * colours out once it knows which groups exist and which wristbands it has, and
 * a board that has already guessed is a guess that looks like a decision. See
 * `CAMP_UNCOLOURED`.
 *
 * What this is, is that decision made deliberately and all at once — one press,
 * rather than fourteen trips through a swatch row. It skips anything already
 * coloured, so pressing it twice never renames a wristband, and it works off
 * `nextCampColour` so the twelve are handed out before any is repeated.
 * ---------------------------------------------------------------------------
 */
function paintEveryBand(draft: CampAllocationDraft, week: number): CampAllocationDraft {
  let next = draft;
  // Every grade of the week, stored or not: an unarranged grade is the common
  // case on a fresh board and is exactly what somebody pressing this wants
  // coloured.
  for (const grade of CAMP_GRADES) {
    const card = bandForGrade(weekBoardOf(next, week).bands, grade) ?? blankGradeCard(grade);
    next = ensureBand(next, week, card);
  }

  const board = weekBoardOf(next, week);
  const taken = board.bands
    .map((band) => band.colour)
    .filter((colour): colour is CampColour => colour !== null);

  const painted = board.bands.map((band) => {
    if (band.colour !== null) return band;
    const colour = nextCampColour(taken);
    taken.push(colour);
    return { ...band, colour };
  });

  return editWeek(next, week, (entry) => ({ ...entry, bands: painted }));
}

/* ---------------------------------------------------------------------------
 * The two switches at the top
 * ------------------------------------------------------------------------ */

/**
 * Elementary or middle school.
 *
 * A sliding switch rather than the register's two-line tabs, because here the
 * two halves really are two *screens* that move under the control — the thumb
 * tracks what the board just did. The grade range is on each side so nobody has
 * to remember where 6th grade lives.
 */
/**
 * Saving, saved, or stopped.
 *
 * Three states and no more, because a running commentary on a background write
 * is noise: "Saving…" while one is in the air, the time of the last one when
 * the board is clean, and the failure said out loud with the retry beside it.
 * The unsaved-but-not-yet-writing second in between deliberately shows the
 * same thing as saving — the distinction is real but nobody is served by being
 * told their move is queued.
 */
function SaveState({ state }: { state: GroupsState }) {
  if (state.stalled) {
    return (
      <span className="camp-saveState is-stalled">
        <span>{state.conflictWith ? 'Not saved' : 'This move did not save'}</span>
        {state.conflictWith ? null : (
          <button
            type="button"
            className="button button--quiet"
            disabled={state.saving}
            onClick={() => void state.save()}
          >
            {state.saving ? 'Saving…' : 'Try again'}
          </button>
        )}
      </span>
    );
  }

  if (state.dirty || state.saving) {
    return <span className="camp-saveState">Saving…</span>;
  }

  return (
    <span className="camp-saveState">
      {state.savedAt === null ? 'Saved' : `Saved ${clockLabel(state.savedAt)}`}
    </span>
  );
}

/** "5:04 pm", in the reader's own locale. Only ever a time — the board is not
    open across days, and a date here would be a longer answer to a smaller
    question. */
function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function SectionSwitch({
  section,
  onSection,
  counts,
}: {
  section: CampSection;
  onSection: (section: CampSection) => void;
  counts: Record<CampSection, number>;
}) {
  return (
    <div
      className="camp-sectionSwitch"
      role="tablist"
      aria-label="Which half of the camp"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onSection(event.key === 'ArrowLeft' ? 'elementary' : 'middle-school');
      }}
    >
      {CAMP_SECTIONS.map((entry) => (
        <button
          key={entry}
          type="button"
          role="tab"
          aria-selected={entry === section}
          tabIndex={entry === section ? 0 : -1}
          className={`camp-sectionBtn${entry === section ? ' is-on' : ''}`}
          onClick={() => onSection(entry)}
        >
          <strong>{campSectionLabel(entry)}</strong>
          <em>
            {gradeRangeLabel(entry)} · {counts[entry]} this week
          </em>
        </button>
      ))}
      {/* The travelling part. Two halves, so its width is 50% and its offset is
          the index — no measuring, and it cannot disagree with the tabs. */}
      <span
        className="camp-sectionSwitch__thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${CAMP_SECTIONS.indexOf(section) * 100}%)` }}
      />
    </div>
  );
}

/**
 * Which week is being arranged, and the one thing that crosses between them.
 *
 * The copy is offered only from a week that has something in it, and only onto
 * a different one — an enabled button that would do nothing is worse than no
 * button. It is a press rather than a link: after it the two weeks have no
 * relationship, which is the whole difference between this and the automatic
 * week-sync that was scrapped. See `copyWeekStructure`.
 */
function WeekSwitch({
  week,
  weeks,
  weekStarts,
  onWeek,
  arranged,
  readOnly,
  onCopy,
}: {
  week: number;
  weeks: number;
  weekStarts: readonly string[];
  onWeek: (week: number) => void;
  arranged: readonly number[];
  readOnly: boolean;
  onCopy: (from: number) => void;
}) {
  const elsewhere = arranged.filter((entry) => entry !== week);

  return (
    <div className="camp-weekBar">
      <div className="camp-weeks" role="tablist" aria-label="Which week of camp">
        {Array.from({ length: weeks }, (_unused, index) => index + 1).map((entry) => {
          const range = campWeekRangeLabel(weekStarts, entry);
          return (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={entry === week}
              className={`camp-weekPill${entry === week ? ' is-on' : ''}`}
              onClick={() => onWeek(entry)}
            >
              Week {entry}
              {range === `Week ${entry}` ? null : <em>{range}</em>}
            </button>
          );
        })}
      </div>

      {!readOnly && elsewhere.length > 0 ? (
        <div className="camp-weekBar__copy">
          {elsewhere.map((from) => (
            <button
              key={from}
              type="button"
              className="button button--quiet"
              title={`Give week ${week} the same grade grouping and group names as week ${from}. Nobody is moved.`}
              onClick={() => {
                if (
                  window.confirm(
                    `Give week ${week} week ${from}'s grade grouping and group names?\n\n` +
                      `Nobody moves between weeks, and nobody already placed in week ${week} is ` +
                      `taken out of their group.`,
                  )
                ) {
                  onCopy(from);
                }
              }}
            >
              Same grades as week {from}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** "K–5", "6–8". */
function gradeRangeLabel(section: CampSection): string {
  const grades = campGradesForSection(section);
  const first = grades[0];
  const last = grades[grades.length - 1];
  if (!first || !last) return '';
  return first === last ? campGradeShort(first) : `${campGradeShort(first)}–${campGradeShort(last)}`;
}

/**
 * The horizontal drag that moves between the two halves.
 *
 * ---------------------------------------------------------------------------
 * Three guards, and each one is a bug that happened without it.
 *
 *   - A touch beginning on anything operable — a chip, a name field, a select —
 *     is not a swipe. Without this, picking a child up moves the board.
 *   - The gesture only *becomes* a swipe once it has gone 12px horizontally and
 *     is clearly more horizontal than vertical. Vertical wins ties, because the
 *     board is taller than the window and scrolling is the commoner intent.
 *   - The container carries `touch-action: pan-y`, so the browser never tries
 *     to pan horizontally alongside us. Nothing here calls `preventDefault`;
 *     React's touch listeners are passive and it would not take.
 * ---------------------------------------------------------------------------
 */
function useSwipe(section: CampSection, onSection: (section: CampSection) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number; on: boolean; offset: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  return {
    ref,
    offset,
    dragging,
    onTouchStart(event: React.TouchEvent) {
      const touch = event.touches[0];
      if (!touch) return;
      const from = event.target as HTMLElement | null;
      // `[role="button"]` alongside `button`: the chips and the merge grips are
      // divs, so the element-name half of this selector does not reach them.
      // `[draggable="true"]` is gone with the HTML5 drag it was written for —
      // nothing on this board carries the attribute any more, and the role is
      // what every drag source has in common.
      if (from?.closest('button, [role="button"], input, textarea, select, a')) {
        drag.current = null;
        return;
      }
      drag.current = { x: touch.clientX, y: touch.clientY, on: false, offset: 0 };
    },
    onTouchMove(event: React.TouchEvent) {
      const start = drag.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      const moveX = touch.clientX - start.x;
      const moveY = touch.clientY - start.y;
      if (!start.on) {
        if (Math.abs(moveX) < 12) return;
        if (Math.abs(moveX) < Math.abs(moveY) * 1.5) {
          drag.current = null;
          return;
        }
        start.on = true;
        setDragging(true);
      }
      /*
       * Held back at the ends rather than stopped dead. A quarter of the pull
       * is how a swipe says "there is nothing that way" without feeling broken.
       */
      const index = CAMP_SECTIONS.indexOf(section);
      const past = (moveX > 0 && index === 0) || (moveX < 0 && index === CAMP_SECTIONS.length - 1);
      start.offset = past ? moveX * 0.25 : moveX;
      setOffset(start.offset);
    },
    onTouchEnd() {
      const start = drag.current;
      drag.current = null;
      setDragging(false);
      setOffset(0);
      if (!start?.on) return;
      const width = ref.current?.clientWidth ?? 0;
      // Whichever is the smaller commitment: a fifth of the board, or 96px. On
      // a phone the fraction is the fair test; on a wide laptop it is absurd.
      const enough = Math.abs(start.offset) > Math.min(96, width * 0.2 || 96);
      if (!enough) return;
      const index = CAMP_SECTIONS.indexOf(section);
      const next = CAMP_SECTIONS[index + (start.offset < 0 ? 1 : -1)];
      if (next) onSection(next);
    },
  };
}

/* ---------------------------------------------------------------------------
 * One half of the camp, for one week
 * ------------------------------------------------------------------------ */

type GroupEdit = (change: (current: CampAllocationDraft) => CampAllocationDraft) => void;

/** Shared so an unresolved board does not make a new Map on every render. */
const EMPTY_PEOPLE: ReadonlyMap<CampPersonKey, CampPerson> = new Map();

function SectionPane({
  section,
  week,
  config,
  draft,
  resolved,
  people,
  editingId,
  onEditing,
  carry,
  onOpen,
  onHoldPerson,
  onHoldBand,
  onHoldGroup,
  grab,
  onPlace,
  onMerge,
  onMergeCrews,
  onEdit,
  readOnly,
}: {
  section: CampSection;
  week: number;
  config: CampConfig;
  draft: CampAllocationDraft | null;
  resolved: ResolvedAllocation | null;
  people: readonly CampPerson[];
  editingId: string | null;
  onEditing: (id: string | null) => void;
  carry: Carry;
  onOpen: (key: CampPersonKey) => void;
  onHoldPerson: (key: CampPersonKey | null) => void;
  onHoldBand: (id: string | null) => void;
  onHoldGroup: (id: string | null) => void;
  grab: CampGrab;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onMerge: (fromId: string, intoId: string) => void;
  onMergeCrews: (fromId: string, intoId: string) => void;
  onEdit: GroupEdit;
  readOnly: boolean;
}) {
  const board = draft ? weekBoardOf(draft, week) : null;
  const stored = useMemo(() => board?.bands ?? [], [board]);
  const byKey = resolved?.byKey ?? EMPTY_PEOPLE;

  /**
   * One group singled out, so the children's list shows only who could go in
   * it.
   *
   * ---------------------------------------------------------------------------
   * *"I want to be able to toggle a group and only the kids that could be in
   * that group show up — if it's 2nd and 3rd, only 2 and 3 kids should be in
   * the panel."* Filling one crew is the unit of work on this board, and doing
   * it against a list of every child in the half means reading past five grades
   * to find the two that are allowed.
   *
   * It is the **grade**, not a group inside it. It was on the group card first
   * and that was wrong: the grade is what decides who is allowed, the grade is
   * what you point at when you say "I'm doing 2nd and 3rd now", and a toggle
   * per group put four identical buttons on a card whose own heading already
   * named the grades.
   *
   * Held as a `CampGrade` and not as the card's id, so it survives the board
   * being rearranged under it. Merge 3rd into 4th while 3rd is the one showing
   * and the card holding 3rd is now "3rd & 4th grade" — the filter widens to
   * both, which is what just happened to the crew. A card id would have been
   * dissolved by the merge and the list would have silently gone back to
   * everybody.
   * ---------------------------------------------------------------------------
   */
  const [only, setOnly] = useState<CampGrade | null>(null);

  /**
   * Every grade of this half as a card, in grade order.
   *
   * A grade with no band gets one built here — see `ensureBand` for why it is
   * not written into the draft until somebody does something with it. The
   * result is that the page always shows the shape of the half, and every card
   * on it behaves the same way whether or not it has been saved.
   */
  const cards = useMemo(() => {
    const out: CampBand[] = [];
    const drawn = new Set<string>();
    for (const grade of campGradesForSection(section)) {
      const found = bandForGrade(stored, grade);
      if (!found) {
        out.push(blankGradeCard(grade));
        continue;
      }
      if (drawn.has(found.id)) continue;
      drawn.add(found.id);
      out.push(found);
    }
    // A stored band with no grade in this half — a legacy one that straddles
    // both — still has to be reachable from somewhere.
    for (const band of bandsInSection(stored, section)) {
      if (!drawn.has(band.id)) out.push(band);
    }
    return out;
  }, [stored, section]);

  /**
   * Every group in this half, measured, plus the half's own baseline.
   *
   * The baseline is computed across the half's **groups only** — see
   * `campSectionBaseline` — and once, here, rather than inside each card: a
   * card working out its own baseline would be comparing itself against a
   * different denominator from the card beside it.
   */
  const { metrics, baseline } = useMemo(() => {
    const found = new Map<string, CampPlaceMetrics>();
    for (const band of cards) {
      for (const group of band.groups) {
        found.set(group.id, campGroupMetrics(group, byKey, week, section));
      }
    }
    return { metrics: found, baseline: campSectionBaseline([...found.values()]) };
  }, [cards, byKey, week, section]);

  /**
   * The person in the air, so a card can decide whether it would take them.
   *
   * A card that lights up and then refuses the drop is worse than one that
   * never lit: the refusal happens after the gesture, when the hand has already
   * committed. Every target works this out before it draws itself.
   */
  const carried = carry.id ? (byKey.get(carry.id) ?? null) : null;

  /** Placements made before the grade rule existed. See `campMisplacedChildren`. */
  const misplaced = useMemo(
    () => (board ? campMisplacedChildren(board, byKey) : new Set<CampPersonKey>()),
    [board, byKey],
  );

  /**
   * The singled-out group, if it still exists.
   *
   * Resolved every render rather than trusted: the week can change under it,
   * the group can be deleted, and the band it belonged to can be merged away.
   * A filter pointing at nothing would silently show an empty list.
   */
  const focused = useMemo(
    () => (only === null ? null : (cards.find((entry) => entry.grades.includes(only)) ?? null)),
    [only, cards],
  );

  /**
   * What colour each grade of this half is wearing, so the children's list can
   * wear it too.
   *
   * A child's chip used to say their grade as a bare "3" in grey. The grade
   * *has* a colour on this board — it is the whole point of the colour — and a
   * waiting list of forty names is exactly where "which grade is this one"
   * gets asked. Built from `cards`, so a merged grade hands the same colour to
   * every grade in it, which is correct: they are one crew now.
   */
  const gradeColours = useMemo(() => {
    const found = new Map<CampGrade, CampColour | null>();
    for (const band of cards) {
      for (const grade of band.grades) found.set(grade, band.colour);
    }
    return found;
  }, [cards]);

  /** Which card a grade belongs to, so a free child can be counted against it. */
  const cardOfGrade = useMemo(() => {
    const found = new Map<CampGrade, string>();
    for (const band of cards) {
      for (const grade of band.grades) found.set(grade, band.id);
    }
    return found;
  }, [cards]);

  /**
   * How many children each grade still has waiting, this week.
   *
   * ---------------------------------------------------------------------------
   * The number that says whether a grade is finished, which is the one thing
   * this board could never answer about itself. It was eight cards tall with no
   * mark on any of them: the only way to know 4th grade was done was to count
   * its crews against the rail, and the rail is one list of the whole half.
   *
   * Counted off `resolved.freeChildren` — the same list the rail draws from —
   * so "3 left" here and the three names over there are the same three
   * children. Narrowed to this half and this week for the same reason
   * everything else on the board is.
   * ---------------------------------------------------------------------------
   */
  const waiting = useMemo(() => {
    const out = new Map<string, number>();
    for (const band of cards) out.set(band.id, 0);
    if (!resolved) return out;
    for (const person of resolved.freeChildren) {
      if (person.grade === null || !campComesInWeek(person, week)) continue;
      const id = cardOfGrade.get(person.grade);
      if (id === undefined) continue;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }, [cards, cardOfGrade, resolved, week]);

  /**
   * Which grades are folded shut.
   *
   * ---------------------------------------------------------------------------
   * *"Add the ability to collapse grades for merging purposes."* Merging is a
   * drag from one grade's grip onto another grade's card, and on a board nine
   * grades tall with every crew open the two are never on screen together — you
   * pick 2nd grade up, scroll four thousand pixels, and by then the thing in
   * your hand is off screen. Folded, every grade of the half is a single strip
   * and the drag is two inches.
   *
   * The whole `<section>` stays the merge target while it is folded, because
   * the drop zone is on the section and not on the crews inside it. That is
   * what makes this work at all rather than being a way to hide things.
   *
   * Held by band id and not by grade: folding is about the card in front of you,
   * and a card dissolved by a merge should take its fold state with it.
   * ---------------------------------------------------------------------------
   */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());

  /*
   * Functional updates throughout — a run of clicks faster than a render
   * otherwise collapses to one. See [[spsm-batched-clicks-need-functional-updates]].
   */
  const fold = useCallback((id: string, on: boolean) => {
    setFolded((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const allFolded = cards.length > 0 && cards.every((band) => folded.has(band.id));

  const foldAll = useCallback(
    (on: boolean) => setFolded(on ? new Set(cards.map((band) => band.id)) : new Set()),
    [cards],
  );

  /** Jump to a grade, opening it first — landing on a folded card shows nothing
      and reads as a broken link. */
  const jumpTo = useCallback(
    (id: string) => {
      fold(id, false);
      /*
       * After the fold has painted, or the card is still its old height and the
       * scroll lands short of it.
       *
       * A timeout rather than `requestAnimationFrame`: rAF never fires in the
       * preview pane, so a jump written that way is a jump nobody can verify.
       * See [[preview-pane-has-no-animation-frames]].
       */
      window.setTimeout(() => {
        document
          .getElementById(bandDomId(id))
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    },
    [fold],
  );

  /** The waiting lists: this half's people, coming this week, placed nowhere. */
  const pool = useMemo(() => {
    if (!resolved) {
      return { kids: [] as CampPerson[], servants: [] as CampPerson[], away: 0 };
    }
    // Narrowed to the singled-out group's grades when there is one — but always
    // intersected with this half's, because a band merged across both halves
    // must not put a 7th grader in the elementary list.
    const inHalf = campGradesForSection(section);
    const grades = new Set(
      focused ? inHalf.filter((grade) => focused.grades.includes(grade)) : inHalf,
    );
    let away = 0;

    const kids = resolved.freeChildren.filter((person) => {
      if (person.grade === null || !grades.has(person.grade)) return false;
      if (!campComesInWeek(person, week)) {
        away += 1;
        return false;
      }
      return true;
    });

    const servants = resolved.freeServants.filter((person) => {
      // A servant who ticked neither half is offered in both: a volunteer
      // nobody can place is worse than one offered twice.
      if (person.sections.length > 0 && !person.sections.includes(section)) return false;
      if (!campComesInWeek(person, week)) {
        away += 1;
        return false;
      }
      return true;
    });

    return { kids, servants, away };
  }, [resolved, section, week, focused]);

  if (!draft || !board) return null;

  return (
    <section className="band camp-band">
      <div className="wrap camp-wrap">
        <div className="camp-board">
          {/*
            The two lists first in the DOM as well as on the left, so a keyboard
            and a screen reader meet them in the same order the eye does: the
            people to place, then the places.
          */}
          <aside className="camp-panels">
            <Panel
              title="Children"
              kind="child"
              people={pool.kids}
              week={week}
              section={section}
              gradeColours={gradeColours}
              onOpen={onOpen}
              narrowedTo={
                focused
                  ? {
                      label: suggestBandName(focused.grades),
                      onClear: () => setOnly(null),
                    }
                  : null
              }
              carry={carry}
              readOnly={readOnly}
              onHold={onHoldPerson}
              grab={grab}
              onDropHere={(key) => onPlace(key, null)}
              empty={
                focused
                  ? `Every ${suggestBandName(focused.grades).toLowerCase()} child has a group in week ${week}.`
                  : `Every child in this half has a group in week ${week}.`
              }
            />
            <Panel
              title="Servants"
              kind="servant"
              people={pool.servants}
              week={week}
              section={section}
              onOpen={onOpen}
              carry={carry}
              readOnly={readOnly}
              onHold={onHoldPerson}
              grab={grab}
              onDropHere={(key) => onPlace(key, null)}
              empty={`Every servant in this half has a place in week ${week}.`}
            />
            {pool.away > 0 ? (
              <p className="camp-panels__note note">
                {pool.away} more {pool.away === 1 ? 'person is' : 'people are'} registered for this
                half but for no day of week {week}, so they are not offered here.
              </p>
            ) : null}
          </aside>

          <div className="camp-column">
            <GradeStrip
              cards={cards}
              waiting={waiting}
              metrics={metrics}
              folded={folded}
              allFolded={allFolded}
              onJump={jumpTo}
              onFoldAll={foldAll}
              uncoloured={cards.filter((band) => band.colour === null).length}
              /* `paintEveryBand` colours both halves in one edit — see
                 [[spsm-camp-grade-colour-is-one-press]] — which is why the
                 label says "the grades" and not "these grades". */
              onColour={() => onEdit((current) => paintEveryBand(current, week))}
              readOnly={readOnly}
            />

            {cards.map((band) => (
              <BandPanel
                key={band.id}
                band={band}
                siblings={cards}
                waiting={waiting.get(band.id) ?? 0}
                folded={folded.has(band.id)}
                onFold={(on) => fold(band.id, on)}
                section={section}
                week={week}
                resolved={resolved}
                metrics={metrics}
                baseline={baseline}
                carry={carry}
                carried={carried}
                misplaced={misplaced}
                onOpen={onOpen}
                only={focused?.id === band.id}
                onOnly={() =>
                  setOnly((current) =>
                    // Toggling the card that is already showing turns it off;
                    // any other card takes over. The grade stored is the first
                    // of the card's own, which is the one it is named for.
                    current !== null && band.grades.includes(current)
                      ? null
                      : (band.grades[0] ?? null),
                  )
                }
                readOnly={readOnly}
                editing={editingId === band.id}
                onEditing={(on) => onEditing(on ? band.id : null)}
                onHold={onHoldPerson}
                onHoldBand={onHoldBand}
                onHoldGroup={onHoldGroup}
                grab={grab}
                onPlace={onPlace}
                onMerge={onMerge}
                onMergeCrews={onMergeCrews}
                onEdit={onEdit}
                people={people}
                full={stored.length >= MAX_BANDS}
              />
            ))}

            <StationsPanel
              section={section}
              week={week}
              board={board}
              roles={campStationRoles(campWeekRoleOptions(config, week, section))}
              byKey={byKey}
              carry={carry}
              carried={carried}
              onOpen={onOpen}
              readOnly={readOnly}
              onHold={onHoldPerson}
              grab={grab}
              onPlace={onPlace}
              onEdit={onEdit}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * The map across the top
 * ------------------------------------------------------------------------ */

/** "K", "3rd", "1st–2nd", "3rd–5th". What a strip chip calls a grade card. */
function gradeRun(grades: readonly CampGrade[]): string {
  const say = (grade: CampGrade) => (grade === 'k' ? 'K' : `${grade}${ordinal(Number(grade))}`);
  if (grades.length === 0) return '—';
  const first = grades[0]!;
  const last = grades[grades.length - 1]!;
  return grades.length === 1 ? say(first) : `${say(first)}–${say(last)}`;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/**
 * Every grade of the half as one chip: its colour, its grades, and whether it
 * is finished.
 *
 * ---------------------------------------------------------------------------
 * The board is nine grades tall and had no map. You could not tell from
 * anywhere on it which grades were done, which had nobody serving, or where
 * 6th grade was — you scrolled until you found it, and if you were looking for
 * the grade with children still waiting you scrolled the lot.
 *
 * So: a strip that stays with you, one chip per grade, each wearing that
 * grade's own wristband colour and saying the one thing that decides whether
 * you need to go there — how many children of that grade are still in the
 * rail. `done` is not a stored state and could not be: it is "nobody of this
 * grade is waiting and this grade has crews", recomputed every render from the
 * same list the rail draws.
 *
 * Clicking one opens it and scrolls to it. It deliberately does **not** filter:
 * the grade's own name is the filter and has been since the day a separate
 * button for it turned out to be invisible twice running — see
 * `.camp-panel__pick`. Two controls for one job on one screen is how the second
 * one stops being pressed.
 * ---------------------------------------------------------------------------
 */
function GradeStrip({
  cards,
  waiting,
  metrics,
  folded,
  allFolded,
  onJump,
  onFoldAll,
  uncoloured,
  onColour,
  readOnly,
}: {
  cards: readonly CampBand[];
  waiting: ReadonlyMap<string, number>;
  metrics: ReadonlyMap<string, CampPlaceMetrics>;
  folded: ReadonlySet<string>;
  allFolded: boolean;
  onJump: (bandId: string) => void;
  onFoldAll: (on: boolean) => void;
  /** This half has grades with no wristband colour yet. */
  uncoloured: number;
  onColour: () => void;
  readOnly: boolean;
}) {
  return (
    <div className="camp-map">
      <div className="camp-map__row">
        {cards.map((band) => {
          const colour = campColourOf(band.colour);
          const left = waiting.get(band.id) ?? 0;
          const placed = band.groups.reduce(
            (sum, group) => sum + (metrics.get(group.id)?.children ?? 0),
            0,
          );
          const done = left === 0 && placed > 0;
          const empty = left === 0 && placed === 0;

          return (
            <button
              key={band.id}
              type="button"
              className={`camp-map__grade${done ? ' is-done' : ''}${
                left > 0 ? ' is-left' : ''
              }${empty ? ' is-empty' : ''}${folded.has(band.id) ? ' is-folded' : ''}`}
              style={
                {
                  '--camp-colour': colour.hex,
                  '--camp-ink': colour.ink,
                } as React.CSSProperties
              }
              title={
                empty
                  ? `${band.name} — no children of this grade are at camp this week`
                  : done
                    ? `${band.name} — every child of this grade is in a crew`
                    : `${band.name} — ${left} still in the waiting list`
              }
              onClick={() => onJump(band.id)}
            >
              <span className="camp-map__grades">
                {/*
                  Ordinals, not bare digits. `1+2` is a sum; `1st–2nd` is two
                  grades run together, which is what it is. Only the ends are
                  printed for a run of three or more — a chip is not the place
                  to list them.
                */}
                {gradeRun(band.grades)}
              </span>
              <span className="camp-map__state">
                {empty ? 'nobody' : done ? 'all placed' : `${left} to place`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="camp-map__tools">
        {/*
          The offer to colour the board, where the board is.
          --------------------------------------------------------------------
          A grade is created with no colour and nothing guesses one — the colour
          is the wristband a child is handed at the gate, and one invented on a
          Tuesday means two things by Friday. That rule stands. What was wrong
          is that the one press that makes the decision sat at the very foot of
          a page nine grades tall, under three other tools, so a board that
          could be colourful stayed grey because nobody ever scrolled to it.

          So the offer comes to the top, and only while there is something to
          offer: once every grade has a colour this disappears for the season.
        */}
        {!readOnly && uncoloured > 0 ? (
          <button
            type="button"
            className="camp-map__paint"
            title="Hand every grade of the camp a wristband color. Grades that already have one keep it."
            onClick={onColour}
          >
            Color the grades
          </button>
        ) : null}

        <button
          type="button"
          className="camp-map__fold"
          onClick={() => onFoldAll(!allFolded)}
          title={
            allFolded
              ? 'Open every grade again'
              : 'Fold every grade to a single strip — the quickest way to drag one onto another'
          }
        >
          {allFolded ? 'Open all' : 'Fold all'}
        </button>
      </div>
    </div>
  );
}

/** How many children of a half are at camp in a given week. */
function sectionHeadcount(
  people: readonly CampPerson[],
  section: CampSection,
  week: number,
): number {
  return people.filter(
    (person) =>
      person.kind === 'child' &&
      !person.withdrawn &&
      person.grade !== null &&
      campSectionForGrade(person.grade) === section &&
      campComesInWeek(person, week),
  ).length;
}

/* ---------------------------------------------------------------------------
 * One grade, open
 * ------------------------------------------------------------------------ */

function BandPanel({
  band,
  siblings,
  waiting,
  folded,
  onFold,
  section,
  week,
  resolved,
  metrics,
  baseline,
  carry,
  carried,
  misplaced,
  onOpen,
  only,
  onOnly,
  readOnly,
  editing,
  onEditing,
  onHold,
  onHoldBand,
  onHoldGroup,
  grab,
  onPlace,
  onMerge,
  onMergeCrews,
  onEdit,
  people,
  full,
}: {
  band: CampBand;
  siblings: readonly CampBand[];
  /** Children of this grade still in the rail, this week. Zero with crews on
      the card is what "done" means — see `GradeStrip`. */
  waiting: number;
  /** Folded shut: the header only, still a merge target. */
  folded: boolean;
  onFold: (on: boolean) => void;
  section: CampSection;
  week: number;
  resolved: ResolvedAllocation | null;
  metrics: ReadonlyMap<string, CampPlaceMetrics>;
  baseline: number | null;
  carry: Carry;
  /** Who is in the air, so a group can say whether it would take them. */
  carried: CampPerson | null;
  /** Children already sitting in a group of the wrong grade. */
  misplaced: ReadonlySet<CampPersonKey>;
  onOpen: (key: CampPersonKey) => void;
  /** The children's list is currently narrowed to this grade. */
  only: boolean;
  onOnly: () => void;
  readOnly: boolean;
  editing: boolean;
  onEditing: (on: boolean) => void;
  onHold: (key: CampPersonKey | null) => void;
  onHoldBand: (id: string | null) => void;
  onHoldGroup: (id: string | null) => void;
  grab: CampGrab;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onMerge: (fromId: string, intoId: string) => void;
  onMergeCrews: (fromId: string, intoId: string) => void;
  onEdit: GroupEdit;
  people: readonly CampPerson[];
  full: boolean;
}) {
  const colour = campColourOf(band.colour);
  const style = { '--camp-colour': colour.hex, '--camp-ink': colour.ink } as React.CSSProperties;

  /** This card is in the air, carried by tap or by drag. */
  const lifted = carryingBand(carry) && carry.id === band.id;
  /** Something else is in the air and could land here. */
  const canTake = !readOnly && carryingBand(carry) && carry.id !== band.id;

  const zone = useDropZone({
    zone: { cargo: 'band', bandId: band.id },
    enabled: canTake,
    readOnly,
    carry,
    onDropped: (fromId) => onMerge(fromId, band.id),
  });

  /** Every edit puts the card in the document first — see `ensureBand`. */
  const patch = (change: (current: CampBand) => CampBand) =>
    onEdit((current) =>
      editBand(ensureBand(current, week, band), week, band.id, change),
    );

  const total = band.groups.reduce(
    (sum, group) => {
      const found = metrics.get(group.id);
      return {
        children: sum.children + (found?.children ?? 0),
        servants: sum.servants + (found?.servants ?? 0),
      };
    },
    { children: 0, servants: 0 },
  );

  const merged = band.grades.length > 1;

  /**
   * Finished: this grade has crews and nobody of it is left in the rail.
   *
   * Not a stored flag and it must not become one. A grade is done because of
   * where its children are, and a tick somebody set by hand would keep saying
   * so after a new registration was taken on the Monday morning.
   */
  const done = waiting === 0 && total.children > 0;

  /**
   * Would this grade's crews take whoever is in the air?
   *
   * A servant, always. A child, only if this band covers their grade — see
   * `campCanPlace`, which is the same rule `place` enforces when the drop
   * lands. Worked out here rather than in each `GroupCard` so that every group
   * of one grade cannot disagree with the others.
   */
  const takesCarried =
    carried !== null &&
    (carried.kind === 'servant' ||
      (carried.grade !== null && band.grades.includes(carried.grade)));

  return (
    <section
      id={bandDomId(band.id)}
      className={`camp-panel${lifted ? ' is-lifted' : ''}${canTake ? ' is-mergeTarget' : ''}${
        zone.over ? ' is-over' : ''
      }${only ? ' is-only' : ''}${folded ? ' is-folded' : ''}${done ? ' is-done' : ''}`}
      style={style}
      {...zone.dropProps}
      onClick={() => {
        // Tap-to-merge, the touchscreen half of the same gesture. HTML5 drag
        // and drop does not exist on an iPad, and this board is opened on one
        // at a table.
        if (canTake && carry.band !== null) onMerge(carry.band, band.id);
      }}
    >
      {/*
        Said on the card itself rather than only in the bar at the bottom of the
        window: while you are dragging, the card under the pointer is where you
        are looking, and "what happens if I let go here" has to be answerable
        without looking anywhere else.

        A real button, not a caption, and that is what carries the keyboard.
        Merging used to have a `<select>` in this card's settings panel as its
        keyboard path; the panel is a strip for a name and a colour now, and a
        second copy of the merge did not belong in it. So: focus the header
        grip, press it, and every other grade grows a button that says what it
        would do. Same call as the drop — `onMerge` — so the three ways in
        cannot drift.
      */}
      {canTake ? (
        <button
          type="button"
          className="camp-panel__take"
          onClick={(event) => {
            event.stopPropagation();
            if (carry.band !== null) onMerge(carry.band, band.id);
          }}
        >
          Run it together with {band.name}
        </button>
      ) : null}

      <header className="camp-panel__head">
        {/*
          Fold, on the panel itself and ahead of everything else on it.
          ----------------------------------------------------------------------
          It was a labelled button in the row of actions at the far end of the
          header, beside Merge and Deal evenly — which made it read as a fourth
          thing you might do *to* this grade rather than as the panel's own
          disclosure. *"Make the folding within the panel itself."*

          So it sits where a disclosure goes: first, before the name, turning to
          point at what pressing it will do, and full height so it reads as the
          panel's own edge rather than a control floating in it. **Fold all**
          and **Open all** stay on the strip at the top, which is the
          discoverable path and the one that folds the whole half in one press.
        */}
        <button
          type="button"
          className={`camp-panel__fold${folded ? ' is-on' : ''}`}
          aria-expanded={!folded}
          aria-label={folded ? `Open ${band.name}` : `Fold ${band.name}`}
          title={
            folded
              ? `Open ${band.name} again`
              : `Fold ${band.name} to a single strip. It still takes a grade dropped on it, which is the quick way to run two together.`
          }
          onClick={(event) => {
            event.stopPropagation();
            onFold(!folded);
          }}
        >
          <Icon name="chevron" />
        </button>

        <div className="camp-panel__title">
          {/*
            Renaming happens *in* the heading, not in a field under it.
            Showing both was the name printed twice, three lines apart, which is
            the thing that made this read as a generated settings page.
          */}
          {editing && !readOnly ? (
            <input
              className="camp-panel__rename"
              value={band.name}
              autoFocus
              aria-label="What this grade is called"
              onChange={(event) =>
                patch((current) => ({ ...current, name: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Escape') onEditing(false);
              }}
            />
          ) : (
            /*
              The grade's own name is how you pick it.
              ----------------------------------------------------------------
              *"I want to click the grade."* It was a small **Only this grade**
              button fourth in a row of four in the corner of the header —
              present, findable if you were told, and not what anybody reaches
              for. The thing you point at when you say "kindergarten now" is the
              word "Kindergarten", so that is the control, with a dot in front
              of it like the radio it behaves as: one grade at a time, click it
              again to go back to everybody.

              The heading stays an `h3` and the button lives inside it — a
              `button` may not contain heading content, and the outline of this
              page is not something a filter should rearrange.
            */
            <h3>
              <button
                type="button"
                className="camp-panel__pick"
                aria-pressed={only}
                title={
                  only
                    ? `Showing only ${suggestBandName(band.grades).toLowerCase()} children. Click to show every child of this half again.`
                    : `Show only ${suggestBandName(band.grades).toLowerCase()} children in the list`
                }
                onClick={(event) => {
                  /*
                   * While a grade is in the air this card is a merge target,
                   * and the name is the biggest thing on it — so the click has
                   * to mean "drop it here", not "filter by this". Let it
                   * through to the panel rather than swallowing it.
                   */
                  if (canTake) return;
                  event.stopPropagation();
                  onOnly();
                }}
              >
                <span className="camp-panel__dot" aria-hidden="true" />
                {band.name}
              </button>
            </h3>
          )}
          {/*
            Which grades this card actually holds, whatever it has been called.
            ------------------------------------------------------------------
            *"I want it to show which grades are merged even if I change the
            name."* The name is free text and normally says it — "3rd & 4th
            grade" — but the moment somebody renames a merged card to "Lions"
            the only record of what it covers is a `grades` array nothing draws.
            These are that array, always, in the card's own colour: they are the
            thing `campCanPlace` enforces, so they are the thing the card has to
            admit to.
          */}
          {/*
            Only on a merged card, which is the only card it says anything on.
            ------------------------------------------------------------------
            It exists because a merged grade can be renamed to "Lions" and then
            nothing on screen admits what it actually covers. On a single-grade
            card that argument does not apply: "K grade" sat directly under a
            heading reading "Kindergarten", so every one of the nine cards
            carried a line that repeated its own title.
          */}
          {merged ? (
            <p className="camp-panel__grades">
              {band.grades.map((grade) => (
                <span key={grade} className="camp-panel__grade" title={campGradeLabel(grade)}>
                  {campGradeShort(grade)}
                </span>
              ))}
              <em>grades run together</em>
            </p>
          ) : null}

          <p className="camp-panel__count">
            {band.groups.length === 0
              ? 'No groups yet'
              : `${band.groups.length} group${band.groups.length === 1 ? '' : 's'} · ${
                  total.children
                } ${total.children === 1 ? 'child' : 'children'} · ${total.servants} serving`}

            {/*
              Where this grade stands, in the one number that decides whether
              you have to come back to it. "Done" is earned, not set — see
              `done` above.
            */}
            {done ? (
              <span className="camp-panel__state camp-panel__state--done">
                <Icon name="check" />
                done
              </span>
            ) : waiting > 0 ? (
              <span className="camp-panel__state camp-panel__state--left">
                {waiting} still waiting
              </span>
            ) : null}

            {only ? <span className="camp-panel__showing">showing in the list</span> : null}
          </p>
        </div>

        <div className="camp-panel__actions">
          {!readOnly ? (
            <>
            {/*
              Merging, as a thing you pick up and carry. See `MergeGrip`.
            */}
            <MergeGrip
              band={band}
              held={carry.band === band.id}
              disabled={full && band.groups.length === 0}
              onHold={onHoldBand}
              grab={grab}
            />

            {merged ? (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  if (
                    window.confirm(
                      `Split ${band.name} back into ${band.grades.length} grades?\n\n` +
                        `Each child goes to their own grade, into the group of the same name. ` +
                        `Servants go back to the list — nothing here says which grade they ` +
                        `belong to.`,
                    )
                  ) {
                    onEdit((current) => splitBand(current, week, band.id, people));
                    onEditing(false);
                  }
                }}
              >
                Split
              </button>
            ) : null}

            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                onEdit((current) =>
                  dealBand(ensureBand(current, week, band), week, band.id, people),
                )
              }
              disabled={band.groups.length === 0}
              title="Deal the children who are in no group evenly across this grade's groups"
            >
              Deal evenly
            </button>

            {/*
              The button says what people come to it for.
              ----------------------------------------------------------------
              It said **Rename**, and renaming a grade is something almost
              nobody ever does — the names are "Kindergarten" through "8th
              grade" and they are already right. What is behind that button and
              *is* wanted often is the colour: the wristband this grade wears,
              which is the legend the whole rest of the board is drawn in.

              The name is still editable, in the heading, while this is open —
              see `.camp-panel__rename`. One press now offers the thing usually
              wanted without hiding the thing occasionally wanted.
            */}
            <button
              type="button"
              className="button button--quiet"
              aria-expanded={editing}
              title="Choose this grade's wristband color. Its name can be typed over in the heading while this is open."
              onClick={() => onEditing(!editing)}
            >
              {editing ? 'Done' : 'Color'}
            </button>
            </>
          ) : null}
        </div>
      </header>

      {editing && !readOnly && !folded ? (
        <BandSettings
          band={band}
          siblings={siblings}
          onPatch={patch}
          onDelete={() => {
            onEditing(false);
            onEdit((current) =>
              editWeek(current, week, (entry) => ({
                ...entry,
                bands: entry.bands.filter((item) => item.id !== band.id),
              })),
            );
          }}
        />
      ) : null}

      {/*
        Folded, the crews are not rendered at all rather than hidden with CSS.
        A folded grade is a strip you are dragging another grade onto, and forty
        chips still in the tree behind it are forty more drop zones the browser
        has to hit-test on every `dragover`.

        The `<section>` around this keeps its own drop zone either way, which is
        the point: fold everything, then drag one grade onto another without
        scrolling. See `folded` in `SectionPane`.
      */}
      {/*
        Not `hidden`, which loses: `.camp-groups` is `display: grid`, and an
        author rule beats the user agent's `[hidden] { display: none }`. The
        crews simply are not rendered.
      */}
      {folded ? null : (
      <div className="camp-groups">
        {band.groups.map((group) => (
          <GroupCard
            key={group.id}
            bandId={band.id}
            group={group}
            week={week}
            section={section}
            metrics={metrics.get(group.id) ?? null}
            baseline={baseline}
            resolved={resolved}
            carry={carry}
            takes={takesCarried}
            /*
             * Whether a child's grade is worth printing on their chip.
             *
             * On a card of one grade it is not: every row of a Kindergarten
             * crew said "K", ten times, under a heading that already said it.
             * A band that has been merged — 3rd and 4th run together — is the
             * case where it does say something, and that is the only case this
             * is true in. A child in the wrong crew gets it back regardless;
             * see `GroupCard`.
             */
            manyGrades={band.grades.length > 1}
            misplaced={misplaced}
            onOpen={onOpen}
            siblings={band.groups}
            readOnly={readOnly}
            onHold={onHold}
            onHoldGroup={onHoldGroup}
            grab={grab}
            onMergeCrews={onMergeCrews}
            onPlace={onPlace}
            onPatch={patch}
            onLeader={(key) =>
              onEdit((current) =>
                setLeader(current, week, { kind: 'group', bandId: band.id, groupId: group.id }, key),
              )
            }
          />
        ))}

        {!readOnly && band.groups.length < MAX_GROUPS_PER_BAND ? (
          <button
            type="button"
            className="camp-addGroup"
            onClick={() =>
              patch((current) => ({
                ...current,
                groups: [...current.groups, blankGroup(suggestGroupName(current.groups))],
              }))
            }
          >
            {band.groups.length === 0 ? '+ Make a group' : '+ Add a group'}
          </button>
        ) : null}
      </div>
      )}
    </section>
  );
}

/** One week's board, changed. */
function editWeek(
  draft: CampAllocationDraft,
  week: number,
  change: (board: CampWeekBoard) => CampWeekBoard,
): CampAllocationDraft {
  const existing = draft.weeks.find((entry) => entry.week === week);
  const next = change(weekBoardOf(draft, week));
  return {
    ...draft,
    weeks: existing
      ? draft.weeks.map((entry) => (entry.week === week ? next : entry))
      : [...draft.weeks, next].sort((a, b) => a.week - b.week),
  };
}

/** One band inside one week, changed. */
function editBand(
  draft: CampAllocationDraft,
  week: number,
  bandId: string,
  change: (band: CampBand) => CampBand,
): CampAllocationDraft {
  return editWeek(draft, week, (board) => ({
    ...board,
    bands: board.bands.map((band) => (band.id === bandId ? change(band) : band)),
  }));
}

/**
 * Merging, as something you pick up and carry onto another grade.
 *
 * ---------------------------------------------------------------------------
 * *"Make the merge more of a dragging feature."* It was a `<select>` of the
 * other grades: correct, and nothing like the way anybody describes the job —
 * **take 4th grade over to 3rd and run them together**. So the header carries a
 * grip instead. Drag it onto another grade's panel and the two merge; the panel
 * you dropped on is the one that survives, which is the same way round as the
 * gesture reads.
 *
 * It is also **tappable**, for the reason every chip on this board is: HTML5
 * drag and drop does not exist on a touchscreen and this page gets opened on an
 * iPad at a table. Tap the grip, tap a grade, done — one code path, `onMerge`,
 * serves both, so the two cannot drift.
 *
 * The `<select>` is not gone, it has moved: it is inside **Rename**, as the
 * keyboard's way to do this. A gesture with no keyboard equivalent is a feature
 * some people simply do not have.
 * ---------------------------------------------------------------------------
 */
function MergeGrip({
  band,
  held,
  disabled,
  onHold,
  grab,
}: {
  band: CampBand;
  held: boolean;
  disabled: boolean;
  onHold: (id: string | null) => void;
  grab: CampGrab;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`camp-grip${held ? ' is-held' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-disabled={disabled}
      aria-pressed={held}
      onKeyDown={pressed(() => {
        if (!disabled) onHold(held ? null : band.id);
      })}
      title={`Drag ${band.name} onto another grade to run the two together, or tap to pick it up`}
      {...(disabled ? {} : grab('band', band.id))}
      onClick={(event) => {
        event.stopPropagation();
        // `disabled` is a form-control attribute and a div has none, so the
        // refusal has to be written out. `aria-disabled` says the same thing to
        // a screen reader.
        if (disabled) return;
        onHold(held ? null : band.id);
      }}
    >
      <Icon name="grip" />
      {held ? 'Drop on a grade' : 'Merge'}
    </div>
  );
}

/**
 * Rename: the name, the twelve colours, and a way out. One strip.
 *
 * ---------------------------------------------------------------------------
 * This was a form — a small-caps label over a text field, a small-caps label
 * over thirteen named pills, two paragraphs explaining the policy, and an
 * underlined danger link at the bottom. Four stacked blocks to change a word
 * and a colour.
 *
 * It is a strip now, and the name is not in it: pressing **Rename** turns the
 * card's own `h3` into the field — same serif, same size, same colour — so
 * renaming is typing over the name rather than filling in a field about it. A
 * field under the heading meant the name printed twice, three lines apart,
 * which is most of what made this read as a generated settings page.
 *
 * What is left is the colours, as discs, and a way out. Nothing here explains
 * itself: the policy the paragraphs used to state — a grade starts with no
 * colour and keeps none until the camp decides — is enforced by there being no
 * default, not by a sentence saying so.
 *
 * **There is no merging here.** It lives on the header grip, on the target card
 * and nowhere else; a copy of it in a settings panel is the arrangement this
 * replaced.
 * ---------------------------------------------------------------------------
 */
function BandSettings({
  band,
  siblings,
  onPatch,
  onDelete,
}: {
  band: CampBand;
  siblings: readonly CampBand[];
  onPatch: (change: (current: CampBand) => CampBand) => void;
  onDelete: () => void;
}) {
  return (
    <div className="camp-bandEdit">
      <Swatches
        value={band.colour}
        siblings={siblings.filter((entry) => entry.id !== band.id)}
        onPick={(colour) => onPatch((current) => ({ ...current, colour }))}
      />

      {band.groups.length > 0 ? (
        <button
          type="button"
          className="camp-bandEdit__delete"
          onClick={() => {
            if (
              window.confirm(
                `Delete every group in ${band.name} this week? Everybody in them goes back to ` +
                  `the list. The other weeks are untouched, and nothing about anybody's ` +
                  `registration changes.`,
              )
            ) {
              onDelete();
            }
          }}
        >
          Delete this grade&rsquo;s groups
        </button>
      ) : null}
    </div>
  );
}

/**
 * The twelve colours, as discs, and one for none.
 *
 * ---------------------------------------------------------------------------
 * They were named pills — a dot and the word "Lime" in a bordered capsule,
 * thirteen of them wrapping over two rows. That is the circle said twice, and
 * it made the colour the smallest thing in a control whose entire subject is
 * the colour. The name is still there, in the `title` and the accessible label,
 * where it costs nothing and is read by whoever needs it.
 *
 * **A colour another grade has is marked, not disabled.** Two grades sharing
 * one is the camp's business — there is no thirteenth colour to offer a
 * fourteenth band — so the disc carries a small ring and says whose it is,
 * rather than being greyed into something that looks broken when clicked.
 *
 * "None" is a disc too, with a stroke through it, because the absence of a
 * colour is a state on the same scale as the twelve and not a different kind of
 * control. See `CAMP_UNCOLOURED`.
 * ---------------------------------------------------------------------------
 */
function Swatches({
  value,
  siblings,
  onPick,
}: {
  value: CampColour | null;
  siblings: readonly CampBand[];
  onPick: (colour: CampColour | null) => void;
}) {
  /** Which grade already wears each colour, so the disc can say so by name. */
  const spoken = new Map<CampColour, string>();
  for (const band of siblings) {
    if (band.colour !== null && !spoken.has(band.colour)) spoken.set(band.colour, band.name);
  }

  return (
    <div className="camp-swatches" role="group" aria-label="What color this grade wears">
      {CAMP_COLOURS.map((colour) => {
        const held = spoken.get(colour.value);
        const on = value === colour.value;
        return (
          <button
            key={colour.value}
            type="button"
            className={`camp-swatch${on ? ' is-on' : ''}${held && !on ? ' is-spoken' : ''}`}
            style={{ '--camp-colour': colour.hex, '--camp-ink': colour.ink } as React.CSSProperties}
            aria-pressed={on}
            aria-label={held ? `${colour.label} — ${held} has it` : colour.label}
            title={held ? `${colour.label} — ${held} has it` : colour.label}
            onClick={() => onPick(colour.value)}
          />
        );
      })}

      <button
        type="button"
        className={`camp-swatch camp-swatch--none${value === null ? ' is-on' : ''}`}
        aria-pressed={value === null}
        aria-label="No color yet"
        title="No color yet"
        onClick={() => onPick(null)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The two meters
 * ------------------------------------------------------------------------ */

/**
 * Coverage and satisfaction, as two small chips on a card.
 *
 * Words rather than bars, and the reason is that both numbers are *small*: a
 * crew has five servants, not five hundred, and "2 of 3 got their pick" is a
 * sentence somebody can act on where 67% is a decoration. Coverage says how
 * many more people would bring the crew level with the rest of its half — see
 * `campCoverage` for why that is relative and not a target.
 */
/* ---------------------------------------------------------------------------
 * Male and female, counted
 * ------------------------------------------------------------------------ */

/**
 * A split, as a short run of figures: `12B 8G 2?`.
 *
 * ---------------------------------------------------------------------------
 * **Type, not boxes.** The first version of this drew three tinted rectangles,
 * and it landed on a screen that was already made of them — a grade badge, a
 * day count, an allergy flag, a reliability reading, a row of preference tags.
 * Adding three more per crew and three per rail turned every card into a wall
 * of small beige rounded corners, which is exactly what a screen looks like
 * when nothing on it is more important than anything else.
 *
 * So this is set as text: tabular figures, the letter after each one lighter
 * than the number it labels, sitting inside the sentence that already says how
 * many people there are. Nothing is boxed and nothing is coloured — which is
 * also the honest answer to a board where all twelve hues are wristbands (see
 * `CAMP_COLOURS`). The one exception is the unanswered count, which is in the
 * accent, because it is the only part of this anybody can act on.
 *
 * **A zero is still drawn.** "8B 0G" is the single most useful thing this can
 * say, and a tally that hid its empty half would read as a crew with eight
 * children rather than a crew with no girls.
 * ---------------------------------------------------------------------------
 */
function Split({
  split,
  kind,
  of,
  words = false,
}: {
  split: CampGenderSplit;
  kind: 'child' | 'servant';
  /** What is being counted, for the hover text: "in this crew", "waiting". */
  of: string;
  /**
   * Say "6 boys, 3 girls" instead of "6B 3G".
   *
   * On wherever there is room for it, which is now most places. `6B` is four
   * characters and a puzzle; the letters only earn their keep on a chip, where
   * a word cannot fit beside a name. Everything with a whole line to itself
   * gets the words.
   */
  words?: boolean;
}) {
  // Nobody at all: the count this sits beside already says zero.
  if (campSplitEmpty(split)) return null;

  const said = (gender: 'male' | 'female') =>
    `${split[gender]} ${campGenderPlural(gender, kind, split[gender])}`;

  return (
    <span className={`camp-split${words ? ' camp-split--words' : ''}`}>
      {CAMP_GENDERS.map((gender) => (
        <span
          key={gender}
          className={`camp-split__part camp-split__part--${gender}`}
          title={`${split[gender]} ${campGenderPlural(gender, kind, split[gender])} ${of}`}
        >
          {words ? (
            said(gender)
          ) : (
            <>
              {split[gender]}
              <em>{campGenderShort(gender, kind)}</em>
            </>
          )}
        </span>
      ))}
      {split.unknown > 0 ? (
        <span
          className="camp-split__part camp-split__part--unknown"
          title={
            `${split.unknown} ${of} ${split.unknown === 1 ? 'was' : 'were'} registered without ` +
            'saying. Open their registration to fill it in.'
          }
        >
          {words ? (
            `${split.unknown} not said`
          ) : (
            <>
              {split.unknown}
              <em>?</em>
            </>
          )}
        </span>
      ) : null}
    </span>
  );
}

function Meters({
  metrics,
  coverage,
  kind,
}: {
  metrics: CampPlaceMetrics;
  coverage: CampCoverageReading | null;
  kind: 'group' | 'station';
}) {
  /*
   * Only what somebody has to do something about.
   *
   * -------------------------------------------------------------------------
   * There were two pills on every crew, and on a well-run board both of them
   * said everything was fine: "covered", and "3/3 got their pick". A card that
   * reports its own success on every render is a card whose meters stop being
   * read, and then the one that says "no servants" is in the same grey oval in
   * the same place and gets missed with them.
   *
   * So `ok` draws nothing, and satisfaction only speaks when somebody did not
   * get what they asked for. A crew with no pills on it is a crew with nothing
   * wrong, which is a thing you can see from across the board without reading a
   * word.
   * -------------------------------------------------------------------------
   */
  const short =
    coverage && (coverage.level === 'none' || coverage.level === 'thin' || coverage.level === 'rich')
      ? coverage
      : null;

  const missed = metrics.wishing > 0 && metrics.satisfied < metrics.wishing;

  if (!short && !missed) return null;

  return (
    <div className="camp-meters">
      {short ? (
        <span className={`camp-meter camp-meter--${short.level}`}>
          {short.level === 'none'
            ? `nobody serving — needs ${short.short}`
            : short.level === 'thin'
              ? `needs ${short.short} more serving`
              : 'more than its share'}
        </span>
      ) : null}

      {/* "1/3" was read as a date and as a fraction and as a score. */}
      {missed ? (
        <span
          className={`camp-meter camp-meter--${metrics.satisfied === 0 ? 'unhappy' : 'partly'}`}
          title={
            kind === 'station'
              ? 'Servants here who asked for this station, out of those who asked for anything this week'
              : 'Servants here who asked to be a crew leader, out of those who asked for anything this week'
          }
        >
          {metrics.satisfied} of {metrics.wishing} got the job they asked for
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * A group
 * ------------------------------------------------------------------------ */

function GroupCard({
  bandId,
  group,
  week,
  section,
  metrics,
  baseline,
  resolved,
  carry,
  takes,
  manyGrades,
  misplaced,
  onOpen,
  siblings,
  readOnly,
  onHold,
  onHoldGroup,
  grab,
  onMergeCrews,
  onPlace,
  onPatch,
  onLeader,
}: {
  bandId: string;
  group: CampGroup;
  week: number;
  section: CampSection;
  metrics: CampPlaceMetrics | null;
  baseline: number | null;
  resolved: ResolvedAllocation | null;
  carry: Carry;
  /** This grade would accept whoever is in the air. See `campCanPlace`. */
  takes: boolean;
  /** This band covers more than one grade, so a child's own grade is worth
      printing on their chip. On a single-grade card it is the card's heading
      repeated once per child. */
  manyGrades: boolean;
  misplaced: ReadonlySet<CampPersonKey>;
  onOpen: (key: CampPersonKey) => void;
  /** The other crews of this grade — the only ones this can be run in with. */
  siblings: readonly CampGroup[];
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  onHoldGroup: (id: string | null) => void;
  grab: CampGrab;
  onMergeCrews: (fromId: string, intoId: string) => void;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onPatch: (change: (current: CampBand) => CampBand) => void;
  onLeader: (key: CampPersonKey) => void;
}) {
  const target: CampDropTarget = { kind: 'group', bandId, groupId: group.id };
  const canTake = !readOnly && carryingPerson(carry) && takes;
  /*
   * `enabled` decides the lighting and whether `dragover` allows a drop;
   * `readOnly` alone decides whether an arriving drop is honoured. The
   * difference matters: `takes` is React state set by `dragstart`, so gating the
   * *drop* on it would throw away one that landed before that render committed.
   * `place` re-checks with `campCanPlace`, which needs no render — so a wrong
   * drop is refused there rather than by a stale flag here.
   */
  const zone = useDropZone({
    zone: { cargo: 'person', kind: 'group', bandId, groupId: group.id },
    enabled: canTake,
    readOnly,
    carry,
    onDropped: (key) => onPlace(key, target),
  });

  /*
   * The second, smaller merge: two crews of one grade run together.
   *
   * Only offered when this grade has another crew to run in with, and only
   * within the grade — a group is defined by the grades of the band around it,
   * so joining across bands would put children in a crew their grade is not
   * allowed in. See `mergeGroups`.
   */
  const liftedCrew = carryingGroup(carry) && carry.id === group.id;
  const takesCrew =
    !readOnly && carryingGroup(carry) && carry.id !== group.id &&
    siblings.some((entry) => entry.id === carry.id);
  const crewZone = useDropZone({
    zone: { cargo: 'group', groupId: group.id },
    enabled: takesCrew,
    readOnly: !takesCrew,
    carry,
    onDropped: (fromId) => onMergeCrews(fromId, group.id),
  });
  const children = group.childKeys
    .map((key) => resolved?.byKey.get(key))
    .filter(Boolean) as CampPerson[];
  const servants = group.servantKeys
    .map((key) => resolved?.byKey.get(key))
    .filter(Boolean) as CampPerson[];

  return (
    <section
      className={`camp-group${canTake || takesCrew ? ' is-target' : ''}${
        zone.over || crewZone.over ? ' is-over' : ''
      }${liftedCrew ? ' is-lifted' : ''}`}
      /*
       * Two zones on one card, and one attribute to write them in.
       *
       * Safe because they can never both be lit: `canTake` needs a person in
       * the air and `takesCrew` needs a crew, and `lift` puts down whatever
       * else was held rather than letting the board hold two things — which is
       * exactly the case this would otherwise get wrong. The spread order says
       * so out loud: at most one of the two contributes anything.
       */
      {...zone.dropProps}
      {...crewZone.dropProps}
      onClick={(event) => {
        if (carry.person && !readOnly && takes) {
          // A group sits inside a grade panel, which is a merge target. Without
          // this the same tap would also try to merge whatever is held.
          event.stopPropagation();
          onPlace(carry.person, target);
          return;
        }
        if (takesCrew && carry.group !== null) {
          event.stopPropagation();
          onMergeCrews(carry.group, group.id);
        }
      }}
    >
      {takesCrew ? (
        <p className="camp-group__take">Run it together with {group.name}</p>
      ) : null}
      <header className="camp-group__head">
        {/*
          The name on its own line, with the counts under it. Side by side they
          shared 15rem with a text field, and "4 · 1 serving" was clipped by the
          card's own edge — which read as two cards overlapping.
        */}
        <div className="camp-group__nameRow">
          <input
            className="camp-group__name"
            value={group.name}
            readOnly={readOnly}
            aria-label="Group name"
            onChange={(event) =>
              onPatch((current) => ({
                ...current,
                groups: current.groups.map((entry) =>
                  entry.id === group.id ? { ...entry, name: event.target.value } : entry,
                ),
              }))
            }
          />

          {/* Only when there is another crew of this grade to run in with. A
              grip that can be picked up and put nowhere is a control that
              teaches somebody the gesture does not work. */}
          {!readOnly && siblings.length > 1 ? (
            <div
              role="button"
              tabIndex={0}
              className={`camp-grip camp-grip--crew${carry.group === group.id ? ' is-held' : ''}`}
              aria-pressed={carry.group === group.id}
              onKeyDown={pressed(() =>
                onHoldGroup(carry.group === group.id ? null : group.id),
              )}
              title={`Drag ${group.name} onto another crew of this grade to run the two together, or tap to pick it up`}
              {...grab('group', group.id)}
              onClick={(event) => {
                event.stopPropagation();
                onHoldGroup(carry.group === group.id ? null : group.id);
              }}
            >
              <Icon name="grip" />
              {carry.group === group.id ? 'Drop on a crew' : 'Merge'}
            </div>
          ) : null}
        </div>
        {/*
          The crew's headcount and its balance, in one sentence.
          --------------------------------------------------------------------
          The split had a line of its own underneath, which made four stacked
          rows of metadata before the card got to a single person. It belongs
          *against the number it decomposes* anyway: "5 children 4B 1G" is one
          fact read once, where "5 children" above "4B 1G" is the same fact
          twice with a gap in the middle.

          Both tallies are taken off `metrics`, so they count exactly who the
          counts beside them count — this week, withdrawals out.
        */}
        <p className="camp-group__count">
          <span className="camp-group__side">
            {metrics?.children ?? children.length}{' '}
            {(metrics?.children ?? children.length) === 1 ? 'child' : 'children'}
            {metrics ? (
              <Split split={metrics.childGender} kind="child" of="in this crew" words />
            ) : null}
          </span>
          <span className="camp-group__side">
            {metrics?.servants ?? servants.length} serving
            {metrics ? (
              <Split split={metrics.servantGender} kind="servant" of="serving this crew" words />
            ) : null}
          </span>
        </p>

        {metrics ? (
          <Meters metrics={metrics} coverage={campCoverage(metrics, baseline)} kind="group" />
        ) : null}

      </header>

      {/*
        Servants and children in two named sections, not one list.
        ----------------------------------------------------------------------
        They were run together and told apart by the colour down the side of
        each row — which is a legend somebody has to hold in their head, and
        which the reliability colours were already using for something else. A
        crew is read as "who is running this, and who is in it"; the card should
        say those two things in that order and in words.

        Each section is shown once there is anybody in it, and the servants'
        heading is shown even when empty on a crew that has children, because a
        crew with nobody serving is the single most useful thing this card can
        say.
      */}
      {servants.length > 0 || children.length > 0 ? (
        <div className="camp-group__parts">
          <section className="camp-group__part camp-group__part--servants">
            <h5>
              Serving <span>{servants.length}</span>
            </h5>
            {servants.length === 0 ? (
              <p className="camp-group__none">Nobody serving this crew yet</p>
            ) : (
              <ul className="camp-people">
                {servants.map((person) => (
                  <Chip
                    key={person.key}
                    person={person}
                    week={week}
                    section={section}
                    carry={carry}
                    onOpen={onOpen}
                    readOnly={readOnly}
                    onHold={onHold}
                    grab={grab}
                    leader={group.leaderKey === person.key}
                    onLeader={() => onLeader(person.key)}
                  />
                ))}
              </ul>
            )}
          </section>

          {children.length > 0 ? (
            <section className="camp-group__part camp-group__part--children">
              <h5>
                Children <span>{children.length}</span>
              </h5>
              <ul className="camp-people">
                {children.map((person) => (
                  <Chip
                    key={person.key}
                    person={person}
                    week={week}
                    section={section}
                    carry={carry}
                    onOpen={onOpen}
                    // Back on for a child sitting in a crew that is not theirs:
                    // "wrong grade" is not much use without saying which.
                    showGrade={manyGrades || misplaced.has(person.key)}
                    wrongGrade={misplaced.has(person.key)}
                    readOnly={readOnly}
                    onHold={onHold}
                    grab={grab}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="camp-group__empty">{canTake ? 'Drop them here' : 'Drag somebody in'}</p>
      )}

      {!readOnly ? (
        <button
          type="button"
          className="camp-group__delete"
          onClick={(event) => {
            event.stopPropagation();
            if (
              children.length + servants.length > 0 &&
              !window.confirm(`Delete ${group.name}? Everybody in it goes back to the list.`)
            ) {
              return;
            }
            onPatch((current) => ({
              ...current,
              groups: current.groups.filter((entry) => entry.id !== group.id),
            }));
          }}
        >
          Delete group
        </button>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * The stations of one half — which are the camp's roles
 * ------------------------------------------------------------------------ */

/**
 * One card per role the camp offers this week in this half, minus the crew.
 *
 * ---------------------------------------------------------------------------
 * *"The stations are all of the roles other than crew leader."* So there is
 * nothing to create here and nothing to name: the list comes from
 * `config/camp.weekRoles`, which is the same list the sign-up form put in front
 * of the servant, and `campStationRoles` takes the crew wish out of it.
 *
 * That is what makes the satisfaction meter trustworthy. The string on this
 * card and the string the servant ticked are the same string by construction,
 * so a station cannot quietly stop matching because somebody renamed it.
 *
 * A card is not a stored station until somebody is dropped on it —
 * `ensureStation`. An empty card is a job nobody is doing yet, which is the
 * single most useful thing this section shows.
 *
 * To change what is on this list, change the camp's roles in its settings. The
 * hint says so, because otherwise the first question is "how do I add one".
 * ---------------------------------------------------------------------------
 */
function StationsPanel({
  section,
  week,
  board,
  roles,
  byKey,
  carry,
  carried,
  onOpen,
  readOnly,
  onHold,
  grab,
  onPlace,
  onEdit,
}: {
  section: CampSection;
  week: number;
  board: CampWeekBoard;
  roles: readonly string[];
  byKey: ReadonlyMap<CampPersonKey, CampPerson>;
  carry: Carry;
  carried: CampPerson | null;
  onOpen: (key: CampPersonKey) => void;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  grab: CampGrab;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onEdit: GroupEdit;
}) {
  const staffed = roles.filter((role) => stationForRole(board, role, section) !== null).length;

  return (
    <section className="camp-panel camp-panel--stations">
      <header className="camp-panel__head">
        <div className="camp-panel__title">
          <h3>Stations</h3>
          <p className="camp-panel__count">
            {staffed} of {roles.length} being run · week {week}
          </p>
        </div>
      </header>

      <div className="camp-groups">
        {roles.map((role, index) => (
          <StationCard
            key={role}
            role={role}
            colour={campRoleColour(index, section)}
            station={stationForRole(board, role, section)}
            week={week}
            section={section}
            byKey={byKey}
            carry={carry}
            carried={carried}
            onOpen={onOpen}
            readOnly={readOnly}
            onHold={onHold}
            grab={grab}
            onPlace={onPlace}
            onEdit={onEdit}
          />
        ))}
      </div>

      <p className="camp-panel__hint note">
        These are the camp&rsquo;s roles for {campSectionLabel(section).toLowerCase()} in week{' '}
        {week}, minus the crew. To add or remove one, change the roles on{' '}
        <a href="/admin/camp">the camp screen</a> — the sign-up form offers the same list, so the
        two cannot drift.
      </p>
    </section>
  );
}

function StationCard({
  role,
  colour,
  station,
  week,
  section,
  byKey,
  carry,
  carried,
  onOpen,
  readOnly,
  onHold,
  grab,
  onPlace,
  onEdit,
}: {
  role: string;
  colour: CampColour;
  station: CampStation | null;
  week: number;
  section: CampSection;
  byKey: ReadonlyMap<CampPersonKey, CampPerson>;
  carry: Carry;
  carried: CampPerson | null;
  onOpen: (key: CampPersonKey) => void;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  grab: CampGrab;
  onPlace: (key: CampPersonKey, target: CampDropTarget) => void;
  onEdit: GroupEdit;
}) {
  const drawn = campColourOf(colour);
  const style = { '--camp-colour': drawn.hex, '--camp-ink': drawn.ink } as React.CSSProperties;
  const servants = station
    ? (station.servantKeys.map((key) => byKey.get(key)).filter(Boolean) as CampPerson[])
    : [];
  const metrics = campStationMetrics(
    { name: role, servantKeys: station?.servantKeys ?? [] },
    byKey,
    week,
    section,
  );

  /**
   * Dropping onto a card the document has never seen.
   *
   * The station is created and the person placed in **one** edit, because two
   * would be two entries in the undo history for one drag — and because
   * `placeServant` needs the station to exist before it can find it.
   */
  function drop(key: CampPersonKey) {
    if (readOnly) return;
    if (byKey.get(key)?.kind !== 'servant') return;
    onEdit((current) => {
      const withStation = ensureStation(current, week, role, section, colour);
      const made = stationForRole(weekBoardOf(withStation, week), role, section);
      if (!made) return current;
      return placeServant(withStation, week, key, { kind: 'station', stationId: made.id });
    });
    onHold(null);
  }

  /* Stations are the camp's jobs, so only a servant lands on one. A child
     dropped here used to go into `servantKeys` and appear on the station's
     roster as staff. See `campCanPlace`. */
  const takes = carried?.kind === 'servant';
  const canTake = !readOnly && carryingPerson(carry) && takes;
  /* `drop` refuses a child itself, off `byKey`, so the drop needs no flushed
     render to be correct. See `GroupCard`'s zone for the same argument. */
  const zone = useDropZone({
    zone: { cargo: 'person', kind: 'station', role, section },
    enabled: canTake,
    readOnly,
    carry,
    onDropped: drop,
  });

  return (
    <section
      className={`camp-group camp-group--station${canTake ? ' is-target' : ''}${
        zone.over ? ' is-over' : ''
      }${station ? '' : ' is-unstaffed'}`}
      style={style}
      {...zone.dropProps}
      onClick={(event) => {
        if (carry.person && !readOnly && takes) {
          event.stopPropagation();
          drop(carry.person);
        }
      }}
    >
      <header className="camp-group__head">
        <h4 className="camp-group__role">{role}</h4>
        {/*
          Servants only — no child is ever on a station, `drop` refuses them.
          Worth showing even so: the crews are staffed out of the same pool, so
          a station holding six of the half's eight women is where the missing
          cover on a girls' crew actually went.
        */}
        <p className="camp-group__count">
          <span className="camp-group__side">
            {metrics.servants} {metrics.servants === 1 ? 'servant' : 'servants'}
            <Split split={metrics.servantGender} kind="servant" of={`on ${role}`} words />
          </span>
        </p>
        <Meters metrics={metrics} coverage={null} kind="station" />
      </header>

      {station ? (
        <input
          className="input input--narrow camp-station__where"
          value={station.location}
          readOnly={readOnly}
          placeholder="Where — the hall, field 2"
          aria-label={`Where ${role} happens`}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            onEdit((current) =>
              editWeek(current, week, (entry) => ({
                ...entry,
                stations: entry.stations.map((item) =>
                  item.id === station.id ? { ...item, location: event.target.value } : item,
                ),
              })),
            )
          }
        />
      ) : null}

      <ul className="camp-people">
        {servants.map((person) => (
          <Chip
            key={person.key}
            person={person}
            week={week}
            section={section}
            carry={carry}
            onOpen={onOpen}
            readOnly={readOnly}
            onHold={onHold}
            grab={grab}
            leader={station?.leaderKey === person.key}
            onLeader={() =>
              station &&
              onEdit((current) =>
                setLeader(current, week, { kind: 'station', stationId: station.id }, person.key),
              )
            }
          />
        ))}
      </ul>

      {servants.length === 0 ? (
        <p className="camp-group__empty">
          {canTake ? 'Drop them on it' : 'Nobody is running this'}
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * The two side panels
 * ------------------------------------------------------------------------ */

/**
 * One waiting list: the children, or the servants.
 *
 * ---------------------------------------------------------------------------
 * Two of these, stacked, both always visible, and **on the left**. They were on
 * the right for one design, on the theory that dragging right-to-left into a
 * column you are reading is the shorter movement; it read backwards, because
 * these lists are where the work starts.
 *
 * Each carries what the decision needs and nothing else. A child: their grade,
 * and how many days of **this week** they come. A servant: the same day count,
 * and what they asked to do this week in this half. That last one is why the
 * panel takes a week and a section at all — a servant's wishes are per week and
 * per half, and showing the summer's union here would offer somebody for crafts
 * in a week they asked to be with a crew.
 *
 * The panel is a drop target: dragging or tapping somebody onto it takes them
 * out of wherever they were. Everything you can *operate* inside it stops the
 * click, or opening the filter box would put down whoever you are holding.
 * ---------------------------------------------------------------------------
 */
function Panel({
  title,
  kind,
  people,
  week,
  section,
  gradeColours,
  onOpen,
  narrowedTo,
  carry,
  readOnly,
  onHold,
  grab,
  onDropHere,
  empty,
}: {
  title: string;
  kind: 'child' | 'servant';
  people: CampPerson[];
  week: number;
  section: CampSection;
  gradeColours?: ReadonlyMap<CampGrade, CampColour | null>;
  onOpen: (key: CampPersonKey) => void;
  /** Set while a group has been singled out on the board. See `SectionPane`. */
  narrowedTo?: { label: string; onClear: () => void } | null;
  carry: Carry;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  grab: CampGrab;
  onDropHere: (key: CampPersonKey) => void;
  empty: string;
}) {
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? people.filter((person) => person.name.toLowerCase().includes(needle))
    : people;

  const canTake = !readOnly && carryingPerson(carry);
  const zone = useDropZone({
    zone: { cargo: 'person', kind: 'pool', of: kind, section },
    enabled: canTake,
    readOnly,
    carry,
    onDropped: onDropHere,
  });

  return (
    <section
      className={`camp-side camp-side--${kind}${canTake ? ' is-target' : ''}${
        zone.over ? ' is-over' : ''
      }`}
      {...zone.dropProps}
      onClick={() => {
        if (carry.person && !readOnly) onDropHere(carry.person);
      }}
    >
      {/*
        A tinted bar rather than a heading floating on parchment. The two lists
        are told apart by the colour of the bar before the word is read, which
        matters because they are the only two things on this page that look
        alike and are never interchangeable.
      */}
      <div className="camp-side__head" onClick={(event) => event.stopPropagation()}>
        {/*
          The rail's heading, its balance, and the number still to place.
          --------------------------------------------------------------------
          All on one line. The split had a row of its own between the heading
          and the find box, which pushed three stacked bars above a list that is
          the entire point of the rail.

          It counts the *whole* list rather than what the find box has narrowed
          it to — the question is what the camp has left, and an answer that
          moved while somebody typed a name would be answering a different one.
        */}
        <h3>
          {title}
          <span className="camp-side__count">{people.length}</span>
        </h3>

        {/*
          What is still waiting, in words rather than in initials.
          --------------------------------------------------------------------
          On the heading line beside the title it had to be `11B 9G 6?`, which
          is three puzzles on the first line somebody reads. A line of its own
          costs one row and buys plain English — and it is the line that teaches
          the letters on the forty chips underneath it, which is why the two use
          the same three colours.

          It counts the *whole* list, not what the find box has narrowed it to:
          the question is what the camp has left, and an answer that moved while
          somebody typed a name would be answering a different one.
        */}
        <Split
          split={campGenderSplit(people, week)}
          kind={kind}
          of={kind === 'child' ? 'still waiting' : 'not placed yet'}
          words
        />

        {/*
          What the list has been narrowed to, and the way out of it.
          --------------------------------------------------------------------
          A list that is quietly showing a fifth of the children is a list
          somebody will conclude the other four fifths have gone missing from.
          The bar names the grades *and* the group that asked for them, and it
          is itself the button that clears it — one click back, in the place
          you are already looking.
        */}
        {narrowedTo ? (
          <button type="button" className="camp-side__narrow" onClick={narrowedTo.onClear}>
            <span>
              {narrowedTo.label} only <em>— tap to show everyone</em>
            </span>
            <Icon name="close" />
          </button>
        ) : null}

        {/* Shown once the list is long enough to need it — and *kept* shown
            while anything is typed, or the placement that takes the list under
            the threshold would hide the box with the filter still applied. */}
        {people.length > 8 || needle ? (
          <label className="camp-side__find">
            <Icon name="search" />
            <input
              type="search"
              value={find}
              placeholder="Find a name"
              aria-label={`Find a name among the ${title.toLowerCase()}`}
              onChange={(event) => setFind(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="camp-side__list">
        {shown.length === 0 ? (
          <p className="camp-side__empty">{needle ? `Nobody matches “${find.trim()}”.` : empty}</p>
        ) : (
          <ul className="camp-people">
            {shown.map((person) => (
              <Chip
                key={person.key}
                person={person}
                week={week}
                section={section}
                /*
                  `undefined`, not `null`, for somebody with no grade.
                  ------------------------------------------------------------
                  `null` means "this grade has no colour yet" and draws the grey
                  `CAMP_UNCOLOURED` badge, which is right for a child. A servant
                  has no grade at all, so that badge was a grey rectangle drawn
                  around their age for no reason — one more box on a screen that
                  had too many. `undefined` is the absence, and `Chip` reads the
                  two apart.
                */
                gradeColour={
                  person.grade === null ? undefined : (gradeColours?.get(person.grade) ?? null)
                }
                carry={carry}
                onOpen={onOpen}
                readOnly={readOnly}
                onHold={onHold}
                grab={grab}
              />
            ))}
          </ul>
        )}
      </div>

      {kind === 'servant' ? <ReliabilityKey /> : null}

      {canTake ? (
        <p className="camp-side__hint">
          Drop them on a group to put them in, or here to take them back out.
        </p>
      ) : null}
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * One person
 * ------------------------------------------------------------------------ */

/**
 * A chip: draggable, tappable, and carrying the week's own facts.
 *
 * A servant's chip shows **what they asked to do this week in this half** and
 * **how many days of this week they come**, which are the two things being
 * traded off when a crew is filled: three days of somebody who wanted crafts is
 * a different offer from five days of somebody who wanted a crew, and a board
 * that shows neither makes that trade blind.
 *
 * The leader star is a **sibling** of the chip's own button rather than nested
 * inside it: a control inside a `draggable` element sometimes starts a drag
 * instead of firing, which is the other face of pointer capture eating clicks.
 */
function Chip({
  person,
  week,
  section,
  gradeColour,
  showGrade = true,
  wrongGrade,
  carry,
  onOpen,
  readOnly,
  onHold,
  grab,
  leader,
  onLeader,
}: {
  person: CampPerson;
  week: number;
  section: CampSection;
  /**
   * The colour the child's grade is wearing on this board, in the waiting list
   * only. Null inside a group — the coloured card around it already says which
   * grade this is, and a chip repeating its container's colour is a chip with
   * nothing to say.
   */
  /*
   * `| undefined` spelled out, because `exactOptionalPropertyTypes` is on and
   * this prop carries three meanings, not two: a colour, `null` for "this grade
   * has no colour yet" (a grey badge), and `undefined` for "no grade at all" (no
   * badge). A caller has to be able to pass the third one explicitly.
   */
  gradeColour?: CampColour | null | undefined;
  /**
   * Whether to print the child's grade at all.
   *
   * False inside a crew of one grade, which is where it was ten identical
   * badges under a heading that had already said it. The sex letter takes the
   * badge's place there, which is the right trade: on a crew card the question
   * being asked of each row is who is in this crew, not what grade they are —
   * the card says the grade once, at the top.
   *
   * Ignored on a servant, who has no grade to print.
   */
  showGrade?: boolean;
  /**
   * This child is sitting in a group whose grade is not theirs.
   *
   * Only reachable on a board arranged before `campCanPlace` existed — the drop
   * is refused now. Marked where they stand rather than moved: which group a
   * child *should* be in is the camp's decision, not a migration's.
   */
  wrongGrade?: boolean;
  carry: Carry;
  onOpen: (key: CampPersonKey) => void;
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  grab: CampGrab;
  leader?: boolean;
  onLeader?: () => void;
}) {
  const held = carry.person === person.key;
  const lifted = carry.dragging === 'person' && carry.id === person.key;
  const days = campDaysInWeek(person, week);
  const wishes = person.kind === 'servant' ? campDesiredRolesFor(person, week, section) : [];
  /** Servants only, and only for the week on screen. See `campReliability`. */
  const reading = campReliability(person, week);

  /** A child in a waiting list wears their grade's colour; nobody else does. */
  const worn = gradeColour === undefined ? null : campColourOf(gradeColour);

  return (
    <li
      className={`camp-person${held ? ' is-held' : ''}${lifted ? ' is-lifted' : ''}${
        person.withdrawn ? ' is-out' : ''
      }${reading ? ` camp-person--${reading.level}` : ''}${worn ? ' camp-person--graded' : ''}`}
      style={
        worn ? ({ '--camp-colour': worn.hex, '--camp-ink': worn.ink } as React.CSSProperties) : undefined
      }
    >
      <div
        role="button"
        tabIndex={0}
        className="camp-person__grab"
        title={reading ? reading.detail : undefined}
        onKeyDown={pressed(() => onOpen(person.key))}
        {...grab('person', person.key)}
        /*
         * Click opens their card; drag moves them.
         * -------------------------------------------------------------------
         * *"If I click a servant it gives me their info."* A chip is a name and
         * five badges — everything else the camp knows about somebody was
         * nowhere on this screen, and the preferences in particular are per
         * week and per half, which no chip could ever hold.
         *
         * That takes the click away from tap-to-pick-up, which is how this
         * board works on the iPad it gets opened on, so the card carries a
         * **Pick up** button. One extra tap on touch; on a laptop the drag was
         * always the faster path anyway.
         */
        onClick={(event) => {
          event.stopPropagation();
          onOpen(person.key);
        }}
      >
        <span className="camp-person__name">{person.name || 'Unnamed'}</span>

        <span className="camp-person__meta">
          {/*
            A child's grade, as a badge in that grade's own colour. It was a
            bare "3" in grey beside a bare "5d" in grey — two numbers of equal
            weight, neither of which reads as a grade. A waiting list of forty
            names is exactly where "which grade is this one" gets asked, and the
            grade already has a colour on this board.
          */}
          {/*
            A child's grade, or a servant's age *said to be an age*.
            --------------------------------------------------------------
            It was a bare "25" beside a bare "5/5 days" — two numbers of equal
            weight, and the question it produced was "what are the numbers
            for". A grade badge is a grade because it is coloured like the
            grade; an age has to say so.
          */}
          <span className={`camp-person__who${worn ? ' camp-person__who--graded' : ''}`}>
            {person.kind === 'child' ? (
              showGrade ? (
                person.grade ? (
                  campGradeShort(person.grade)
                ) : (
                  '—'
                )
              ) : null
            ) : person.age !== null ? (
              <>
                {person.age}
                <em> yrs</em>
              </>
            ) : (
              'age not given'
            )}
          </span>

          {/*
            Boy or girl, as a coloured letter — never a badge.
            --------------------------------------------------------------
            The board runs two colour languages, and they are told apart by
            *form* rather than by hue, because hue alone could not do it:

              a **filled** or washed shape is always a wristband — a grade's
              colour, the thing a child is handed at the gate;
              **coloured text** is always the sex.

            Nothing on this screen is both. That is what makes a blue `B` beside
            an amber grade badge legible rather than a third language to learn:
            the badge is a grade because it is filled, the letter is a sex
            because it is not.

            Loud enough to count a crew down without reading a single name,
            which is the job — "this crew is four boys and a girl" has to be
            answerable while something is already in the air. The unrecorded
            case is the same element in a third colour: it is the only mark on a
            chip that is a *job*, and without it a card's tally could say "5 not
            given" with no way to find which five.
          */}
          <span
            className={`camp-person__sex camp-person__sex--${person.gender || 'unsaid'}`}
            title={
              person.gender
                ? campGenderLabel(person.gender, person.kind)
                : 'Not recorded — open their registration to say whether they are male or female'
            }
          >
            {campGenderShort(person.gender, person.kind)}
          </span>

          {/*
            How many days — and only when it is not all of them.
            --------------------------------------------------------------
            Every row on this board said `5d`, or `5/5 days`, because almost
            everybody comes to the whole week. A token repeated on forty rows
            carries no information and costs the same attention as one that
            does; taken together with the grade badge, the sex letter and the
            flags it was four marks per name and the name was the only one
            being read.

            So the full week is the silent default and only a *short* week is
            drawn — which is the thing that actually changes a decision, and now
            it is the one thing on the row that is loud. "No days at all" stays
            loudest of the three.

            A servant's still wears the reliability reading's colour, and the
            reading still colours their spine whether or not this draws, so
            nothing is lost from `campReliability` — only from the line.
          */}
          {reading ? (
            reading.level === 'full' ? null : (
              <span className={`camp-person__days camp-person__days--${reading.level}`}>
                {reading.level === 'unknown' || reading.level === 'none'
                  ? reading.label
                  : `${reading.days} of ${reading.of} days`}
              </span>
            )
          ) : person.days.length === 0 ? (
            <span className="camp-person__days is-none">no days</span>
          ) : days === 0 ? (
            <span className="camp-person__days is-none">not this week</span>
          ) : days >= CAMP_WEEKDAYS_IN_WEEK ? null : (
            <span className="camp-person__days">{days} of {CAMP_WEEKDAYS_IN_WEEK} days</span>
          )}

          {/*
            A child's flags stay on this line, because a child's line is short
            enough to hold them — grade, days, "allergy" and no more. A
            servant's are not: three badges beside a reading and an age left
            about six characters for the name, and a rail of "Anto…" and
            "Kiroll…" is a rail nobody can place anybody off. Theirs go on the
            foot line below. See `.camp-person__foot`.
          */}
          {person.kind === 'child' ? (
            <>
              {wrongGrade ? (
                <span
                  className="camp-person__flag camp-person__flag--wrong"
                  title={`This crew is not ${
                    person.grade ? campGradeLabel(person.grade) : 'their grade'
                  }. Drag them to their own grade.`}
                >
                  wrong grade
                </span>
              ) : null}
              {person.allergies.trim() ? (
                <span
                  className="camp-person__flag camp-person__flag--allergy"
                  title={person.allergies}
                >
                  allergy
                </span>
              ) : null}
              {person.withdrawn ? <span className="camp-person__flag">withdrawn</span> : null}
            </>
          ) : null}
        </span>

        {person.kind === 'servant' ? (
          <span className="camp-person__foot">
            {person.withdrawn ? <span className="camp-person__flag">withdrawn</span> : null}

            {/*
              What they asked for, labelled and as tags.
              ----------------------------------------------------------------
              The tags used to sit behind a badge reading "note", which is what
              the availability text was flagged as — and next to a list of jobs
              it read as the label for them. The word is **Prefers**, because
              that is what they are: `desiredRolesByWeek` for this week and this
              half. The availability sentence has moved to the person's card,
              where there is room to print it.
            */}
            <span className="camp-person__prefers">
              <em>Prefers</em>
              {wishes.length > 0 ? (
                wishes.map((wish) => (
                  <span key={wish} className="camp-person__wish">
                    {wish}
                  </span>
                ))
              ) : (
                <span className="camp-person__wish is-none">nothing in particular</span>
              )}
            </span>
          </span>
        ) : null}
      </div>

      {onLeader ? (
        <button
          type="button"
          className={`camp-person__lead${leader ? ' is-on' : ''}`}
          aria-label={leader ? 'Not the leader' : 'Make them the leader'}
          aria-pressed={leader}
          disabled={readOnly}
          onClick={(event) => {
            event.stopPropagation();
            onLeader();
          }}
        >
          ★
        </button>
      ) : null}
    </li>
  );
}

/* ---------------------------------------------------------------------------
 * One person, in full
 * ------------------------------------------------------------------------ */

/**
 * Everything the camp knows about somebody, on a card.
 *
 * ---------------------------------------------------------------------------
 * *"If I click a servant it gives me their info including all of their
 * preferences."* A chip is a name and five badges; the rest of the
 * registration — the days, the paperwork, the availability sentence, who to
 * ring — was on no screen this board could reach.
 *
 * **The preferences are the point, and they are per week and per half.** A
 * servant who asked to lead a crew in week one and to run crafts in week two,
 * elementary only, is three facts, and the chip can show at most one of them
 * (this week's, this half's). All of them are printed here, week by week, so
 * "what did they actually ask for" has an answer that does not depend on which
 * board is on screen. See `campWeekRoleKey`.
 *
 * A plain overlay rather than `<dialog>`: the preview pane never delivers a
 * dialog's `close` event, so a `<dialog>` here is a thing that cannot be
 * verified — see [[preview-pane-hidden-starves-events]].
 * ---------------------------------------------------------------------------
 */
function PersonCard({
  person,
  week,
  config,
  held,
  readOnly,
  onPickUp,
  onClose,
}: {
  person: CampPerson;
  week: number;
  config: CampConfig;
  held: boolean;
  readOnly: boolean;
  onPickUp: () => void;
  onClose: () => void;
}) {
  const reading = campReliability(person, week);
  const weeks = Array.from({ length: config.weeks }, (_unused, index) => index + 1);

  /**
   * Their days, grouped by week.
   *
   * The weekday only — `campDayLabel` prefixes "Week 1 · " to every one of
   * them, which under a "Week 1:" heading printed the week five times on one
   * line.
   */
  const days = weeks
    .map((entry) => ({
      week: entry,
      days: person.days
        .map(parseCampDayKey)
        .filter((parsed) => parsed?.week === entry)
        .map((parsed) => campWeekdayLabel(parsed!.day)),
    }))
    .filter((entry) => entry.days.length > 0);

  /** Every week-and-half they asked something for, in order. */
  const asked =
    person.kind === 'servant'
      ? weeks.flatMap((entry) =>
          CAMP_SECTIONS.map((half) => ({
            week: entry,
            half,
            roles: person.desiredRolesByWeek[campWeekRoleKey(entry, half)] ?? [],
          })).filter((row) => row.roles.length > 0),
        )
      : [];

  return (
    <div
      className="camp-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={person.name || 'Unnamed'}
      onClick={onClose}
    >
      <div className="camp-sheet__card" onClick={(event) => event.stopPropagation()}>
        <header className="camp-sheet__head">
          <div>
            <p className="camp-sheet__kind">
              {person.kind === 'servant'
                ? 'Servant'
                : person.grade
                  ? campGradeLabel(person.grade)
                  : 'Child'}
              {person.withdrawn ? ' · withdrawn' : ''}
            </p>
            <h2>{person.name || 'Unnamed'}</h2>
          </div>
          <button type="button" className="camp-sheet__close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        <dl className="camp-sheet__facts">
          {/* Spelled out here, where there is room for a word. The chip has to
              make do with one letter, and "M" is a letter somebody will
              eventually read as "middle school". */}
          <Fact term={person.kind === 'child' ? 'Boy or girl' : 'Male or female'}>
            {person.gender
              ? campGenderLabel(person.gender, person.kind)
              : 'Not recorded — it is on their registration'}
          </Fact>
          {person.kind === 'servant' && person.age !== null ? (
            <Fact term="Age">{person.age} years old</Fact>
          ) : null}
          {person.shirtSize ? (
            <Fact term="Shirt">{shirtSizeLabel(person.shirtSize as never)}</Fact>
          ) : null}

          {person.kind === 'servant' ? (
            <>
              {/* The reading only. Its `detail` repeats the availability and
                  the clearance, which have rows of their own below. */}
              <Fact term={`Week ${week}`}>{reading ? reading.label : '—'}</Fact>
              <Fact term="Half of camp">
                {person.sections.length === 0
                  ? 'Neither half chosen — they are offered in both'
                  : person.sections.map(campSectionLabel).join(' and ')}
              </Fact>
              {person.availability.trim() ? (
                <Fact term="Availability">{person.availability.trim()}</Fact>
              ) : null}
            </>
          ) : (
            <>
              {person.allergies.trim() ? (
                <Fact term="Allergies">{person.allergies.trim()}</Fact>
              ) : null}
              {person.medicalNotes.trim() ? (
                <Fact term="Medical">{person.medicalNotes.trim()}</Fact>
              ) : null}
            </>
          )}

          <Fact term="Days">
            {days.length === 0
              ? 'No days chosen yet'
              : days.map((entry) => `Week ${entry.week}: ${entry.days.join(', ')}`).join(' · ')}
          </Fact>

          <Fact term={person.kind === 'child' ? 'Guardian' : 'Contact'}>
            {[person.contactName, person.contactPhone, person.contactEmail]
              .filter((entry) => entry.trim())
              .join(' · ') || 'Not recorded'}
          </Fact>
          {person.emergencyName.trim() || person.emergencyPhone.trim() ? (
            <Fact term="In an emergency">
              {[person.emergencyName, person.emergencyPhone]
                .filter((entry) => entry.trim())
                .join(' · ')}
            </Fact>
          ) : null}
        </dl>

        {person.kind === 'servant' ? (
          <section className="camp-sheet__prefs">
            <h3>What they asked for</h3>
            {asked.length === 0 ? (
              <p className="note">
                Nothing — they left the preferences blank, which is neither a yes nor a no. The
                meters on this board do not count them either way.
              </p>
            ) : (
              <ul>
                {asked.map((row) => (
                  <li key={`${row.week}-${row.half}`}>
                    <strong>
                      Week {row.week} · {campSectionLabel(row.half)}
                    </strong>
                    <span className="camp-sheet__wants">
                      {row.roles.map((role) => (
                        <span key={role} className="camp-person__wish">
                          {role}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <footer className="camp-sheet__foot">
          {!readOnly ? (
            <button type="button" className="button" onClick={onPickUp}>
              {held ? 'Already picked up' : 'Pick up to move'}
            </button>
          ) : null}
          <a className="camp-sheet__link" href="/admin/camp/registrations">
            Open their registration
          </a>
        </footer>
      </div>
    </div>
  );
}

/** One labelled line on a person's card. */
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * What the colours on a servant's chip mean
 * ------------------------------------------------------------------------ */

/**
 * The reliability key, under the servants' list.
 *
 * A colour scale nobody has been told the meaning of is decoration, and this
 * one is carrying the fact the whole board is traded on — how much of the week
 * on screen a servant is actually there for. Six words each; it sits where the
 * coloured chips are, so it is read once and then never again.
 */
const RELIABILITY_KEY: readonly { level: CampReliability['level']; says: string }[] = [
  { level: 'full', says: 'all five days' },
  { level: 'high', says: 'four' },
  { level: 'some', says: 'two or three' },
  { level: 'low', says: 'one' },
  { level: 'none', says: 'not this week' },
  { level: 'unknown', says: 'no days given' },
];

function ReliabilityKey() {
  return (
    <details className="camp-key">
      <summary>What the colors mean</summary>
      <ul className="camp-key__list">
        {RELIABILITY_KEY.map((entry) => (
          <li key={entry.level} className={`camp-key__item camp-key__item--${entry.level}`}>
            <span className="camp-key__dot" aria-hidden="true" />
            {entry.says}
          </li>
        ))}
      </ul>
      <p className="camp-key__note">
        A servant&rsquo;s color is how many of the week&rsquo;s five days they are registered for, and
        nothing else. Clearance and an availability note are shown beside it as flags rather than
        folded in — a camp that has not started its paperwork would otherwise open this board with
        every chip red.
      </p>
    </details>
  );
}
