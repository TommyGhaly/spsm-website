import type { AboutCopy } from './context';

/**
 * Undo and redo for the About-pages editor.
 *
 * ---------------------------------------------------------------------------
 * ## Why the editor needs its own, and cannot borrow the browser's
 *
 * Every field in this editor is a **controlled** React input: its value comes
 * from the draft, and every keystroke round-trips through state. The browser
 * keeps a native undo stack per field, and against a controlled input that
 * stack is worse than useless — it restores text the component immediately
 * overwrites from state, so ⌘Z either does nothing or leaves the field and the
 * page disagreeing.
 *
 * It is also the wrong *scope*. Half of what somebody does here is not typing:
 * choosing a photograph, reverting a slot to its hand-written words, adding a
 * section, moving one up, removing one. None of that is in any field's native
 * stack, and all of it is exactly what a person wants back after a misclick —
 * especially removing a section, which is otherwise unrecoverable because there
 * is no publish step to abandon.
 *
 * So the history is over the **whole draft**, and ⌘Z is taken over while edit
 * mode is on. See `AboutEditor` for the key handling.
 *
 * ## Snapshots, not a command log
 *
 * A step is a whole `AboutCopy`. Undoing is moving a pointer, not replaying
 * inverse operations — there is no inverse of "chose this photograph" that does
 * not amount to storing the previous one anyway.
 *
 * The size that buys: a draft is a map of short strings and at most 24 small
 * sections, and the cap below bounds the stack. Two hundred snapshots of the
 * largest page this could hold is still far less than one of its photographs.
 *
 * ## Coalescing, which is the part that makes it usable
 *
 * Without it, ⌘Z after typing a sentence steps back one **letter** at a time,
 * and the feature is a joke. Consecutive changes carrying the same `tag` within
 * `COALESCE_MS` replace the top of the stack rather than pushing a new step, so
 * a run of typing in one field is one undo.
 *
 * The tag is what draws the boundaries, and it is deliberately fine-grained:
 * `text:<slot>` per slot, so moving to a different paragraph starts a new step
 * even mid-sentence. Anything that is not typing — a picture, a revert, any
 * section edit — carries a tag of its own and is never coalesced, because those
 * are single deliberate acts and each deserves its own step.
 * ---------------------------------------------------------------------------
 */

/** How long a run of typing in one field stays one undo step. */
export const COALESCE_MS = 700;

/**
 * How many steps back it is possible to go.
 *
 * Generous rather than tuned. The thing a cap has to prevent is a session that
 * grows without bound, and the thing it must not do is lose the removal of a
 * section somebody made a few minutes ago — which is the one edit here with no
 * other way back.
 */
export const HISTORY_LIMIT = 200;

export interface HistoryStep {
  copy: AboutCopy;
  /** What kind of change produced this state. See the note on coalescing. */
  tag: string;
  /** When it was recorded. Only ever compared against the next change's time. */
  at: number;
}

export interface History {
  past: HistoryStep[];
  present: HistoryStep;
  future: HistoryStep[];
}

/** The history a freshly opened editor starts with: one state, nothing to undo. */
export function startHistory(copy: AboutCopy, at = Date.now()): History {
  return { past: [], present: { copy, tag: 'load', at }, future: [] };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * Record a change.
 *
 * Returns the same object when nothing moved, so a caller storing this in React
 * state does not re-render on a keystroke that changed nothing — which happens
 * on every arrow key and every click inside a textarea.
 */
export function record(
  history: History,
  copy: AboutCopy,
  tag: string,
  at = Date.now(),
): History {
  if (same(history.present.copy, copy)) return history;

  const step: HistoryStep = { copy, tag, at };

  /*
   * The coalescing case. `present` is replaced and nothing is pushed, so the
   * step already on `past` remains the state ⌘Z goes back to — which is the
   * state before this run of typing started, not the previous letter.
   *
   * `tag` must match *and* the gap must be short. A pause is a boundary
   * somebody can feel, and it is the only way to get more than one undo step
   * out of a long stretch of writing in one box.
   */
  if (
    history.present.tag === tag &&
    coalescable(tag) &&
    at - history.present.at <= COALESCE_MS
  ) {
    return { past: history.past, present: step, future: [] };
  }

  const past = [...history.past, history.present];
  return {
    // Oldest first, so the cap drops the oldest step rather than the newest.
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    present: step,
    /*
     * Any new edit abandons the redo branch. The alternative is a tree, and a
     * tree needs a way to show somebody which branch they are on — which is a
     * lot of interface for a parish volunteer fixing a paragraph.
     */
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}

/** Only typing coalesces. Everything else is one deliberate act, one step. */
function coalescable(tag: string): boolean {
  return tag.startsWith('text:');
}

/**
 * Whether two drafts are the same.
 *
 * A serialisation: the draft
 * is rebuilt on every keystroke so referential equality always says "changed",
 * and a dirty flag maintained by hand is wrong the first time somebody forgets
 * to set it. Key order is stable here because every writer builds these objects
 * by spreading the previous one.
 */
function same(a: AboutCopy, b: AboutCopy): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}
