'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMP_COLOURS,
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
 * Three things, because a drag with no feedback is a gesture somebody performs
 * twice. Every card that would accept what is in the air is quietly lit
 * (`is-target`); the one card under the pointer goes loud (`is-over`, driven by
 * a depth counter in `useDropZone`, because `dragleave` also fires on crossing
 * onto a chip *inside* a card); and a bar at the foot of the window names what
 * is being carried, because on a board eight grades tall the chip you picked up
 * is off screen by the time you have scrolled to where it is going.
 *
 * Two MIME types, not one payload: a person and a grade must not be able to
 * land on each other's targets. `useDropZone` calls `preventDefault` only for
 * the kind it accepts, which is what actually makes the browser refuse a drop —
 * so what looks like a target is a target.
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
 * The two things a drag can carry, as two MIME types rather than one.
 *
 * ---------------------------------------------------------------------------
 * The board now has two kinds of drag on it — a **person** onto a group, and a
 * **grade** onto another grade to merge them — and they must not be able to
 * land on each other's targets. One `text/plain` payload cannot tell them
 * apart: dropping 4th grade onto a crew would have read as a person id that
 * matched nobody, silently doing nothing.
 *
 * A drop zone declares which of the two it accepts (`useDropZone`) and only
 * calls `preventDefault` for that one, which is what actually makes the browser
 * refuse the drop — and, because it also decides the "will take this" styling,
 * a card cannot look like a target for something it would throw away.
 *
 * `text/plain` is still set alongside, so a chip dragged out of the page
 * somewhere else is a name rather than nothing.
 * ---------------------------------------------------------------------------
 */
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

const PERSON_MIME = 'application/x-camp-person';
const BAND_MIME = 'application/x-camp-band';
const GROUP_MIME = 'application/x-camp-group';

type CampCargo = 'person' | 'band' | 'group';

/** The payload each kind of drag writes and each drop zone reads. */
const MIME: Record<CampCargo, string> = {
  person: PERSON_MIME,
  band: BAND_MIME,
  group: GROUP_MIME,
};

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
  /** What a native HTML5 drag is carrying right now. */
  dragging: CampCargo | null;
  /** The id in the air, by either means. */
  id: string | null;
}

const NOTHING: Carry = { person: null, band: null, group: null, dragging: null, id: null };

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
 * One drop zone: whether it is lit, whether the pointer is inside it, and the
 * four handlers that make it work.
 *
 * ---------------------------------------------------------------------------
 * `dragenter` and `dragleave` both fire when the pointer crosses a *child*
 * boundary, so a naive `onDragLeave={() => setOver(false)}` turns off the
 * highlight the moment the pointer reaches a chip inside the card — which is
 * most of the card. The depth counter is the fix, and it is why this is a hook
 * rather than two lines on each card.
 *
 * `enabled` gates `preventDefault`, and that single call is the whole of
 * whether the browser will allow a drop. So a card that does not accept what is
 * being dragged is not merely unstyled, it is genuinely not a target.
 * ---------------------------------------------------------------------------
 */
function useDropZone({
  enabled,
  readOnly,
  accept,
  onDropped,
}: {
  enabled: boolean;
  /** The season is frozen. Nothing lands, whatever is in the air. */
  readOnly?: boolean;
  accept: CampCargo;
  onDropped: (id: string) => void;
}) {
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const clear = useCallback(() => {
    depth.current = 0;
    setOver(false);
  }, []);

  return {
    over: over && enabled,
    dropProps: {
      /*
       * The counter is kept whether or not this zone accepts what is in the
       * air, and `enabled` is applied to the *reading* instead. Gating the
       * counter looked equivalent and was not: `dragstart` sets the state that
       * decides `enabled`, and the first `dragenter` can arrive before React
       * has re-rendered — so the opening enter was dropped, the counter started
       * one short, and the highlight then turned itself off the first time the
       * pointer left a chip inside the card.
       */
      onDragEnter: () => {
        depth.current += 1;
        setOver(true);
      },
      onDragLeave: () => {
        depth.current -= 1;
        if (depth.current <= 0) clear();
      },
      onDragOver: (event: React.DragEvent) => {
        if (!enabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      },
      /*
       * Gated on the **payload**, not on `enabled`.
       *
       * `enabled` is React state set by `dragstart`, and a drop that arrives
       * before that render has committed would be thrown away — which is the
       * same class of bug as the depth counter above. The MIME type is the
       * honest test and it needs no render: a grade drag carries no
       * `PERSON_MIME`, so a group card asking for one gets an empty string and
       * does nothing. `readOnly` is checked directly for the same reason.
       */
      onDrop: (event: React.DragEvent) => {
        clear();
        if (readOnly) return;
        const id = event.dataTransfer.getData(MIME[accept]);
        if (!id) return;
        event.preventDefault();
        // A group card sits inside a grade panel, and both are drop zones. The
        // inner one has to win, or every placement would also try to merge.
        event.stopPropagation();
        onDropped(id);
      },
    },
  };
}

/** The two payloads a drag start writes. Kept here so the two ends agree. */
function startDrag(event: React.DragEvent, accept: CampCargo, id: string, label: string) {
  event.dataTransfer.setData(MIME[accept], id);
  event.dataTransfer.setData('text/plain', label);
  event.dataTransfer.effectAllowed = 'move';
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

  /** A native drag started or ended. A drag never clears a tap pickup on
      start — `onDragEnd` restores it, so a drag that is abandoned mid-air
      leaves the board exactly as it found it. */
  const dragging = useCallback((what: CampCargo | null, id: string | null) => {
    setCarry((current) =>
      what === null
        ? { ...current, dragging: null, id: current.person ?? current.band ?? current.group }
        : { ...current, dragging: what, id },
    );
  }, []);

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
                onDragging={dragging}
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

          {!readOnly ? (
            <button
              type="button"
              className="button button--quiet"
              title="Give every grade of both halves a colour, in one go, skipping any that already has one"
              onClick={() => edit((current) => paintEveryBand(current, week))}
            >
              Colour every grade
            </button>
          ) : null}

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
      if (from?.closest('button, input, textarea, select, a, [draggable="true"]')) {
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
  onDragging,
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
              onDragging={onDragging}
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
              onDragging={onDragging}
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
            {cards.map((band) => (
              <BandPanel
                key={band.id}
                band={band}
                siblings={cards}
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
                onDragging={onDragging}
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
              onDragging={onDragging}
              onPlace={onPlace}
              onEdit={onEdit}
            />
          </div>
        </div>
      </div>
    </section>
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
  onDragging,
  onPlace,
  onMerge,
  onMergeCrews,
  onEdit,
  people,
  full,
}: {
  band: CampBand;
  siblings: readonly CampBand[];
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
    enabled: canTake,
    readOnly,
    accept: 'band',
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
      className={`camp-panel${lifted ? ' is-lifted' : ''}${canTake ? ' is-mergeTarget' : ''}${
        zone.over ? ' is-over' : ''
      }${only ? ' is-only' : ''}`}
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
          <p className="camp-panel__grades">
            {band.grades.map((grade) => (
              <span key={grade} className="camp-panel__grade" title={campGradeLabel(grade)}>
                {campGradeShort(grade)}
              </span>
            ))}
            <em>{band.grades.length === 1 ? 'grade' : 'grades run together'}</em>
          </p>

          <p className="camp-panel__count">
            {band.groups.length === 0
              ? 'No groups yet'
              : `${band.groups.length} group${band.groups.length === 1 ? '' : 's'} · ${
                  total.children
                } ${total.children === 1 ? 'child' : 'children'} · ${total.servants} serving`}
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
              onDragging={onDragging}
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

            <button
              type="button"
              className="button button--quiet"
              aria-expanded={editing}
              onClick={() => onEditing(!editing)}
            >
              {editing ? 'Done' : 'Rename'}
            </button>
            </>
          ) : null}
        </div>
      </header>

      {editing && !readOnly ? (
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
            misplaced={misplaced}
            onOpen={onOpen}
            siblings={band.groups}
            readOnly={readOnly}
            onHold={onHold}
            onHoldGroup={onHoldGroup}
            onDragging={onDragging}
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
  onDragging,
}: {
  band: CampBand;
  held: boolean;
  disabled: boolean;
  onHold: (id: string | null) => void;
  onDragging: (what: CampCargo | null, id: string | null) => void;
}) {
  return (
    <button
      type="button"
      className={`camp-grip${held ? ' is-held' : ''}`}
      draggable={!disabled}
      disabled={disabled}
      aria-pressed={held}
      title={`Drag ${band.name} onto another grade to run the two together, or tap to pick it up`}
      onDragStart={(event) => {
        startDrag(event, 'band', band.id, band.name);
        onDragging('band', band.id);
      }}
      onDragEnd={() => onDragging(null, null)}
      onClick={(event) => {
        event.stopPropagation();
        onHold(held ? null : band.id);
      }}
    >
      <Icon name="grip" />
      {held ? 'Drop on a grade' : 'Merge'}
    </button>
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
    <div className="camp-swatches" role="group" aria-label="What colour this grade wears">
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
        aria-label="No colour yet"
        title="No colour yet"
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
function Meters({
  metrics,
  coverage,
  kind,
}: {
  metrics: CampPlaceMetrics;
  coverage: CampCoverageReading | null;
  kind: 'group' | 'station';
}) {
  const wish =
    metrics.wishing > 0 ? (
      <span
        className={`camp-meter camp-meter--${
          metrics.satisfied === metrics.wishing
            ? 'happy'
            : metrics.satisfied === 0
              ? 'unhappy'
              : 'partly'
        }`}
        title={
          kind === 'station'
            ? 'Servants here who asked for this station, out of those who asked for anything this week'
            : 'Servants here who asked to be a crew leader, out of those who asked for anything this week'
        }
      >
        {metrics.satisfied}/{metrics.wishing} got their pick
      </span>
    ) : null;

  if (!wish && (!coverage || coverage.level === 'empty')) return null;

  return (
    <div className="camp-meters">
      {coverage && coverage.level !== 'empty' ? (
        <span className={`camp-meter camp-meter--${coverage.level}`}>
          {coverage.level === 'none'
            ? `no servants — needs ${coverage.short}`
            : coverage.level === 'thin'
              ? `thin — ${coverage.short} more`
              : coverage.level === 'rich'
                ? 'more than its share'
                : 'covered'}
        </span>
      ) : null}
      {wish}
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
  misplaced,
  onOpen,
  siblings,
  readOnly,
  onHold,
  onHoldGroup,
  onDragging,
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
  misplaced: ReadonlySet<CampPersonKey>;
  onOpen: (key: CampPersonKey) => void;
  /** The other crews of this grade — the only ones this can be run in with. */
  siblings: readonly CampGroup[];
  readOnly: boolean;
  onHold: (key: CampPersonKey | null) => void;
  onHoldGroup: (id: string | null) => void;
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
    enabled: canTake,
    readOnly,
    accept: 'person',
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
    enabled: takesCrew,
    readOnly: !takesCrew,
    accept: 'group',
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
      /* Two zones on one card, and each only reacts to its own MIME type — a
         person cannot land on the crew merge and a crew cannot land on the
         person list. `useDropZone` returns four handlers, so they are composed
         by hand rather than spread twice. */
      onDragEnter={(event) => {
        zone.dropProps.onDragEnter();
        crewZone.dropProps.onDragEnter();
        void event;
      }}
      onDragLeave={() => {
        zone.dropProps.onDragLeave();
        crewZone.dropProps.onDragLeave();
      }}
      onDragOver={(event) => {
        zone.dropProps.onDragOver(event);
        crewZone.dropProps.onDragOver(event);
      }}
      onDrop={(event) => {
        zone.dropProps.onDrop(event);
        crewZone.dropProps.onDrop(event);
      }}
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
            <button
              type="button"
              className={`camp-grip camp-grip--crew${carry.group === group.id ? ' is-held' : ''}`}
              draggable
              aria-pressed={carry.group === group.id}
              title={`Drag ${group.name} onto another crew of this grade to run the two together, or tap to pick it up`}
              onDragStart={(event) => {
                event.stopPropagation();
                startDrag(event, 'group', group.id, group.name);
                onDragging('group', group.id);
              }}
              onDragEnd={() => onDragging(null, null)}
              onClick={(event) => {
                event.stopPropagation();
                onHoldGroup(carry.group === group.id ? null : group.id);
              }}
            >
              <Icon name="grip" />
              {carry.group === group.id ? 'Drop on a crew' : 'Merge'}
            </button>
          ) : null}
        </div>
        <p className="camp-group__count">
          {metrics?.children ?? children.length}{' '}
          {(metrics?.children ?? children.length) === 1 ? 'child' : 'children'} ·{' '}
          {metrics?.servants ?? servants.length} serving
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
                    onDragging={onDragging}
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
                    wrongGrade={misplaced.has(person.key)}
                    readOnly={readOnly}
                    onHold={onHold}
                    onDragging={onDragging}
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
  onDragging,
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
            onDragging={onDragging}
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
  onDragging,
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
  const zone = useDropZone({ enabled: canTake, readOnly, accept: 'person', onDropped: drop });

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
        <p className="camp-group__count">
          {metrics.servants} {metrics.servants === 1 ? 'servant' : 'servants'}
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
            onDragging={onDragging}
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
  onDragging,
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
    enabled: canTake,
    readOnly,
    accept: 'person',
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
        <h3>
          {title}
          <span className="camp-side__count">{people.length}</span>
        </h3>

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
                gradeColour={
                  person.grade === null ? null : (gradeColours?.get(person.grade) ?? null)
                }
                carry={carry}
                onOpen={onOpen}
                readOnly={readOnly}
                onHold={onHold}
                onDragging={onDragging}
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
  wrongGrade,
  carry,
  onOpen,
  readOnly,
  onHold,
  onDragging,
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
  gradeColour?: CampColour | null;
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
  onDragging: (what: CampCargo | null, id: string | null) => void;
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
      <button
        type="button"
        className="camp-person__grab"
        draggable={!readOnly}
        title={reading ? reading.detail : undefined}
        onDragStart={(event) => {
          startDrag(event, 'person', person.key, person.name || 'Unnamed');
          onDragging('person', person.key);
        }}
        onDragEnd={() => onDragging(null, null)}
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
              person.grade ? (
                campGradeShort(person.grade)
              ) : (
                '—'
              )
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
            A servant's day count is the reliability reading — see
            `campReliability` — so it wears the reading's colour rather than the
            flat grey a child's does. A child has no reading: it is not a
            judgement anybody should make about a nine-year-old, and it would
            not change where they are placed.
          */}
          {reading ? (
            <span className={`camp-person__days camp-person__days--${reading.level}`}>
              {reading.label}
            </span>
          ) : (
            <span className={`camp-person__days${days === 0 ? ' is-none' : ''}`}>
              {person.days.length === 0 ? 'no days' : `${days}d`}
            </span>
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
      </button>

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
      <summary>What the colours mean</summary>
      <ul className="camp-key__list">
        {RELIABILITY_KEY.map((entry) => (
          <li key={entry.level} className={`camp-key__item camp-key__item--${entry.level}`}>
            <span className="camp-key__dot" aria-hidden="true" />
            {entry.says}
          </li>
        ))}
      </ul>
      <p className="camp-key__note">
        A servant&rsquo;s colour is how many of the week&rsquo;s five days they are registered for, and
        nothing else. Clearance and an availability note are shown beside it as flags rather than
        folded in — a camp that has not started its paperwork would otherwise open this board with
        every chip red.
      </p>
    </details>
  );
}
