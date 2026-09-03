'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  campPeople,
  countPlacements,
  groupNameUpdates,
  parseCampAllocation,
  resolveAllocation,
  type CampAllocationDraft,
  type ResolvedAllocation,
  type CampPerson,
  type CampRegistration,
} from '@spsm/shared';
import {
  AllocationConflict,
  applyGroupNames,
  subscribeAllocation,
  writeAllocation,
} from './allocationData';
import { subscribeRegistrations, type WithId } from './data';

/**
 * The groups screen's state: the arrangement, the people, and the saving.
 *
 * ---------------------------------------------------------------------------
 * Two listeners and one local draft.
 *
 * Both documents are held open for hours by more than one person — two laptops
 * at a table the week before camp is the ordinary case, not the exception — so
 * the arrangement and the registrations are both `onSnapshot`. A child
 * registered at the desk has to become draggable here without anybody being
 * told to refresh.
 *
 * The arrangement being edited is live too, now: every move is written back on
 * its own, about a second after the hand stops. Save is gone as a decision.
 *
 * ## Why this used to be a manual save, and what changed
 *
 * The old reasoning was cost — dragging is a hundred small changes over ten
 * minutes, and a write per drag is a hundred writes on a document somebody
 * else is also editing. What that bought was worse: two laptops at one table
 * the week before camp would drift apart for twenty minutes and then be told,
 * at the moment one of them saved, that the two boards could not be
 * reconciled. Tommy asked for autosave and cross-device sync, which is the
 * other side of the same trade: a small, constant write cost in exchange for
 * the two boards never being more than a second apart. The debounce is what
 * keeps the cost bounded — a drag, a rename and three "add group" inside the
 * same second are one write, not five. See `AUTOSAVE_MS`.
 *
 * ## The conflict is still real, and still never merged
 *
 * Two people moving inside the *same* debounce window is still a race, and a
 * whole-document write cannot merge it — see `writeAllocation`. That case
 * keeps the banner it always had: their version is held, offered, and never
 * taken silently. It is now about a one-second window rather than a
 * twenty-minute one, which is the whole difference.
 * ---------------------------------------------------------------------------
 */

export interface GroupsState {
  loading: boolean;
  error: string | null;
  draft: CampAllocationDraft | null;
  people: CampPerson[];
  registrations: WithId<CampRegistration>[];
  /**
   * The chosen week's arrangement, resolved.
   *
   * A week rather than the document, because the board is one arrangement per
   * week again: "who is unplaced" has a different answer in week two, and a
   * single resolution would have to pick one week and be wrong about the other.
   * The week lives here rather than in the screen so that the resolution and
   * the placements can never be computed against different ones.
   */
  week: number;
  setWeek: (week: number) => void;
  resolved: ResolvedAllocation | null;
  /** True from the first unwritten move until the write is acknowledged. */
  dirty: boolean;
  saving: boolean;
  /**
   * Set when the last automatic write failed, so nothing is being retried on a
   * timer. Cleared by the next move or by pressing save.
   */
  stalled: boolean;
  /** When the last write landed, for the "Saved" line. Null before the first. */
  savedAt: number | null;
  /** Set when somebody else saved while there was unsaved work here. */
  conflictWith: string | null;
  readOnly: boolean;
  edit: (change: (draft: CampAllocationDraft) => CampAllocationDraft) => void;
  /** Whether there is a move to take back / to put back. See `HISTORY`. */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Write now rather than waiting out the debounce. Retries a stall. */
  save: () => Promise<void>;
  /** Overwrite the version somebody else saved with this one. */
  keepMine: () => Promise<void>;
  takeTheirs: () => void;
  /** Write the group names back onto the children's registrations. */
  publishNames: () => Promise<number>;
}

/**
 * How many moves back the board remembers.
 *
 * A whole draft per step rather than a description of the change: the edits are
 * arbitrary transforms of the document — a merge dissolves two grades and
 * renames a third — and an inverse for each one is a second implementation of
 * every edit on the board, which is where undo goes wrong. Whole copies are
 * cheap here because the draft is the size of one camp's arrangement and it is
 * already rebuilt from scratch on every keystroke.
 *
 * Fifty is chosen against the gesture it exists for: a run of drags that turns
 * out to have been the wrong grade is ten or twenty moves, not two.
 */
const HISTORY = 50;

/**
 * How long the board waits after the last move before writing.
 *
 * Long enough that a run of related moves — dropping four children into a crew
 * one after another — is one write, and short enough that the other laptop at
 * the table sees it while the hand is still moving. Anything under about half a
 * second stops coalescing anything; much over two and the second screen starts
 * to feel stale.
 */
const AUTOSAVE_MS = 900;

/**
 * The draft, with what it was before.
 *
 * One state value rather than a draft plus two refs, because React runs a
 * state updater twice in development and a ref mutated inside one is applied
 * twice — see [[spsm-react-strictmode-doubles-updaters]]. Every transition
 * here is a pure function of the whole history, so the doubled run is
 * discarded harmlessly.
 */
interface History {
  past: CampAllocationDraft[];
  present: CampAllocationDraft | null;
  future: CampAllocationDraft[];
}

export function useGroups(programId: string, season: string, uid: string | null, on: boolean): GroupsState {
  const [history, setHistory] = useState<History>({ past: [], present: null, future: [] });
  const draft = history.present;

  /**
   * A draft arriving from anywhere but an edit: the first load, this laptop's
   * own save echoing back, or taking somebody else's version.
   *
   * `mine` is the difference between the last two. Somebody else's board
   * starts the history over — undoing across it would put back an arrangement
   * that was already overwritten on the server, which is not what anybody
   * means by the last move. Our own save is the same board we are already
   * looking at, so the moves that built it stay takeable back: "save, then
   * see it" is exactly when undo is wanted.
   */
  const setDraft = useCallback((next: CampAllocationDraft | null, mine = false) => {
    setHistory((current) =>
      mine ? { ...current, present: next } : { past: [], present: next, future: [] },
    );
  }, []);
  const [week, setWeek] = useState(1);
  const [registrations, setRegistrations] = useState<WithId<CampRegistration>[]>([]);
  const [loadedPeople, setLoadedPeople] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictWith, setConflictWith] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /**
   * How many moves have been made, ever.
   *
   * A write takes a few hundred milliseconds and the board is not frozen while
   * it runs, so a move made mid-write must not be cleared by the
   * acknowledgement of the write that went out before it. The save captures
   * this number and only reports itself clean if it has not moved. Without it,
   * the last drag of a fast run is the one that never reaches Firestore.
   */
  const moves = useRef(0);

  /** The stamp of the version this draft was taken from. See `writeAllocation`. */
  const readAt = useRef<number | null>(null);
  /** A remote version that arrived while there was unsaved work. */
  const held = useRef<{ draft: CampAllocationDraft; readAt: number | null } | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  /*
   * Read by the pagehide flush, which is registered once and must not be
   * re-registered on every keystroke: a listener torn down and rebuilt as the
   * draft changes is one that is missing at the moment the tab closes.
   */
  const savingRef = useRef(false);
  savingRef.current = saving;
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!on) return;
    return subscribeAllocation(
      programId,
      season,
      (update) => {
        const mine = uid !== null && update.updatedBy === uid;

        if (dirtyRef.current) {
          /*
           * Our own write echoing back while a later move is already waiting
           * to go out is not an arrival at all — it is the board we are
           * looking at, one move behind. Applying it would undo that move on
           * screen; holding it would raise the conflict banner against
           * ourselves, which is what autosave would otherwise do every second
           * of a long drag. So it is dropped, and only `readAt` is taken from
           * it, because the next write has to compare against the stamp our
           * last one actually wrote.
           */
          if (mine) {
            if (!update.pending) readAt.current = update.readAt;
            return;
          }
          /*
           * Somebody else's, held rather than applied.
           *
           * `readAt` is deliberately not moved: the next save must still
           * compare against the version this draft was taken from, or it would
           * overwrite the arrival it never showed anybody.
           */
          held.current = { draft: update.draft, readAt: update.readAt };
          if (update.updatedBy) setConflictWith(update.updatedBy);
          return;
        }
        setDraft(update.draft, mine);
        if (!update.pending) readAt.current = update.readAt;
      },
      (cause) => setError(cause.message),
    );
  }, [on, programId, season, uid, setDraft]);

  useEffect(() => {
    if (!on) return;
    return subscribeRegistrations(
      programId,
      season,
      (rows) => {
        setRegistrations(rows);
        setLoadedPeople(true);
      },
      (cause) => setError(cause.message),
    );
  }, [on, programId, season]);

  /** A frozen season is not written to, automatically or otherwise. */
  const readOnly = draft?.archivedAt != null;

  const people = useMemo(() => campPeople(registrations), [registrations]);
  const resolved = useMemo(
    () => (draft ? resolveAllocation(draft, week, people) : null),
    [draft, week, people],
  );

  const edit = useCallback(
    (change: (current: CampAllocationDraft) => CampAllocationDraft) => {
      /*
       * The updater re-reads the draft rather than closing over it.
       *
       * A fast run of clicks — three "add group" in a second, or a drag
       * finishing while another is starting — otherwise all apply to the same
       * stale copy and only the last one survives. Same lesson as
       * [[spsm-batched-clicks-need-functional-updates]].
       */
      setHistory((current) => {
        if (!current.present) return current;
        const next = change(current.present);
        // An edit that changed nothing — dropping a child back where they
        // already were — must not cost a step of the history.
        if (next === current.present) return current;
        return {
          past: [...current.past, current.present].slice(-HISTORY),
          present: next,
          // A new move abandons whatever was undone. Branching histories are
          // a tree, and a tree needs a way to see it.
          future: [],
        };
      });
      moves.current += 1;
      setDirty(true);
      // A move is also the signal to try again after a failed write.
      setStalled(false);
    },
    [],
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past[current.past.length - 1];
      if (previous === undefined || !current.present) return current;
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future].slice(0, HISTORY),
      };
    });
    /*
     * Still dirty, even undone all the way back to the saved arrangement.
     * Working out that the board now matches what is stored means comparing
     * two whole documents, and being told there is nothing to save when there
     * might be is the one wrong answer here. Saving the same arrangement twice
     * costs a write and changes nothing.
     */
    moves.current += 1;
    setDirty(true);
    setStalled(false);
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0];
      if (next === undefined || !current.present) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY),
        present: next,
        future: current.future.slice(1),
      };
    });
    moves.current += 1;
    setDirty(true);
    setStalled(false);
  }, []);

  const save = useCallback(async (options: { force?: boolean } = {}) => {
    if (!draft) return;
    /*
     * The arrangement as it is at the moment the write goes out, and the move
     * count that goes with it. Anything dropped after this line belongs to the
     * next write — see `moves`.
     */
    const at = moves.current;
    setSaving(true);
    setError(null);
    setStalled(false);
    try {
      const result = await writeAllocation(draft, uid, readAt.current, options);
      readAt.current = result.readAt;
      if (moves.current === at) setDirty(false);
      setSavedAt(Date.now());
      setConflictWith(null);
      if (options.force) held.current = null;
      /*
       * An arrival that landed mid-save is re-offered here, not applied.
       *
       * Whose version won cannot be known until the write returns the stamp it
       * wrote — see the note on `readAt` being withheld while there are pending
       * writes.
       */
      if (held.current) {
        setConflictWith((previous) => previous ?? 'somebody else');
      }
    } catch (cause) {
      if (cause instanceof AllocationConflict) {
        setConflictWith(cause.updatedBy ?? 'somebody else');
        /*
         * Stalled, not retried. A conflict is the one case where writing again
         * is the wrong move: the retry would be the overwrite the check exists
         * to prevent. The banner decides it.
         */
        setStalled(true);
      } else {
        setError((cause as Error)?.message ?? 'The save did not go through.');
        // Nothing on a timer after a failure. A network that is down stays
        // down, and a write every second against it is a spinner that never
        // stops and a bill that never does either.
        setStalled(true);
      }
    } finally {
      setSaving(false);
    }
  }, [draft, uid]);

  /**
   * The autosave itself: one debounced write per run of moves.
   *
   * Keyed on the draft as well as on `dirty`, so every move restarts the
   * clock — that is the whole debounce, and it needs no timer of its own to
   * clear. Held off while a write is in the air (the one running will notice
   * the newer move through `moves` and this effect re-runs when it settles),
   * while there is a conflict on screen (the banner owns that decision), and
   * after a failure (see `stalled`).
   */
  useEffect(() => {
    if (!on || readOnly || !dirty || saving || stalled || conflictWith) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [on, readOnly, dirty, saving, stalled, conflictWith, draft, save]);

  /**
   * The last move, when the tab goes away inside the debounce window.
   *
   * `pagehide` and a hidden `visibilitychange` rather than `beforeunload`:
   * closing a tab on iOS fires neither reliably except `pagehide`, and a
   * phone being locked mid-drag is an ordinary way for this board to end. The
   * write is fire-and-forget — there is no awaiting anything at this point —
   * which Firestore's own offline queue makes good on when the tab comes back.
   */
  useEffect(() => {
    if (!on || readOnly) return;
    function flush() {
      if (!dirtyRef.current || savingRef.current) return;
      void saveRef.current();
    }
    function onHidden() {
      if (document.visibilityState === 'hidden') flush();
    }
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [on, readOnly]);

  saveRef.current = save;

  /**
   * Overwrite theirs with what is on this screen.
   *
   * A forced write, and it has to be: the stamp on the server is now theirs,
   * so an ordinary save would throw the same conflict that raised the banner
   * and the button would do nothing at all — which is what it did before this.
   * `held` is dropped, because the version being kept is the one being
   * overwritten.
   */
  const keepMine = useCallback(async () => {
    await save({ force: true });
  }, [save]);

  const takeTheirs = useCallback(() => {
    const theirs = held.current;
    held.current = null;
    setConflictWith(null);
    if (!theirs) return;
    setDraft(theirs.draft);
    readAt.current = theirs.readAt;
    moves.current += 1;
    setDirty(false);
    setStalled(false);
  }, [setDraft]);

  const publishNames = useCallback(async () => {
    if (!draft) return 0;
    const updates = groupNameUpdates(draft, registrations);
    if (updates.length === 0) return 0;
    return applyGroupNames(updates, uid);
  }, [draft, registrations, uid]);

  return {
    loading: draft === null || !loadedPeople,
    error,
    draft,
    week,
    setWeek,
    people,
    registrations,
    resolved,
    dirty,
    saving,
    stalled,
    savedAt,
    conflictWith,
    readOnly,
    edit,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    save,
    keepMine,
    takeTheirs,
    publishNames,
  };
}

/** How many people are placed, for the header count. */
export function placedCount(draft: CampAllocationDraft | null): number {
  return draft ? countPlacements(draft) : 0;
}

/** Re-exported so the screen does not import the parser for one call. */
export { parseCampAllocation };
