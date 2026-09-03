'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AboutImage, AboutSection } from '@spsm/shared';
import type { AboutCopy, AboutSlotOps } from './context';
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  record,
  redo as historyRedo,
  startHistory,
  undo as historyUndo,
  type History,
} from './history';

/**
 * The draft being edited, everything that writes to it, and its history.
 *
 * ---------------------------------------------------------------------------
 * ## Why this is a hook and not state in `AboutOverlay`
 *
 * It was state in `AboutOverlay`, and adding undo would have meant a sixth and
 * seventh prop threaded from there through `AboutEditor` to the bar. The draft,
 * the writers and the history are one thing — every writer has to record a step,
 * and undo has to be the only other way the draft moves — so they belong in one
 * module where that invariant is visible.
 *
 * `AboutOverlay` still owns *where* it lives, because the context it publishes
 * is what the slots read.
 *
 * ## Every writer goes through `apply`, and that is the invariant
 *
 * `apply` is the only thing that touches the history, and nothing sets the
 * draft except `apply`, `load` and the two history moves. So a new kind of edit
 * cannot be added without a step being recorded for it — the failure mode this
 * shape exists to prevent is an edit that is invisible to ⌘Z, which is
 * indistinguishable from undo being broken.
 *
 * ## Functional updates throughout
 *
 * Not a style preference. A quick run of presses — reverting three slots, or a
 * keystroke arriving while a picture choice is still in React's queue —
 * collapses to a single change when the updater closes over a stale draft.
 * That has bitten this codebase before.
 * ---------------------------------------------------------------------------
 */
export interface AboutDraft {
  draft: AboutCopy | null;
  /** Null unless edit mode is on. What the slots use to know they are editable. */
  ops: AboutSlotOps | null;
  /** Seed from a fresh Firestore read. Resets the history — see `load`. */
  load: (copy: AboutCopy) => void;
  /** Drop the draft on the way out of edit mode. */
  clear: () => void;
  /** The appended-sections list's writer. */
  editSections: (change: (was: AboutSection[]) => AboutSection[], tag: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useAboutDraft(enabled: boolean): AboutDraft {
  const [draft, setDraft] = useState<AboutCopy | null>(null);
  /*
   * The history is a ref with a counter beside it rather than plain state.
   *
   * Every writer needs to read the current history *and* the current draft and
   * write both, and doing that with two pieces of state means two functional
   * updates that cannot see each other. A ref is the single source, and `tick`
   * exists only so that `canUndo` / `canRedo` re-render the bar when they
   * change.
   */
  const history = useRef<History | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback((copy: AboutCopy) => {
    /*
     * A fresh read starts a fresh history, deliberately. Undoing past the point
     * where this session opened would mean writing back a state the *document*
     * never held — possibly overwriting somebody else's edit with words from
     * this browser's baked HTML. The floor of the stack is what Firestore held
     * when Edit was pressed.
     */
    history.current = startHistory(copy);
    setDraft(copy);
    setTick((n) => n + 1);
  }, []);

  const clear = useCallback(() => {
    history.current = null;
    setDraft(null);
    setTick((n) => n + 1);
  }, []);

  /** The one path by which an edit reaches the draft. */
  const apply = useCallback((change: (was: AboutCopy) => AboutCopy, tag: string) => {
    setDraft((was) => {
      if (was === null) return was;
      const next = change(was);
      const current = history.current;
      if (current) {
        const recorded = record(current, next, tag);
        // `record` returns the same object when nothing moved, so a keystroke
        // that changed nothing does not bump the counter.
        if (recorded !== current) {
          history.current = recorded;
          setTick((n) => n + 1);
        }
      }
      return next;
    });
  }, []);

  const editSections = useCallback(
    (change: (was: AboutSection[]) => AboutSection[], tag: string) => {
      apply(
        (was) => ({
          ...was,
          // `order` is renumbered by tens from array position on every change,
          // so a move never has to touch its neighbours by hand.
          sections: change([...was.sections]).map((section, index) => ({
            ...section,
            order: (index + 1) * 10,
          })),
        }),
        tag,
      );
    },
    [apply],
  );

  const ops = useMemo<AboutSlotOps | null>(() => {
    if (!enabled) return null;
    return {
      setText: (slot, text) =>
        apply(
          (was) => ({
            ...was,
            slots: { ...was.slots, [slot]: { ...was.slots[slot], text } },
          }),
          // Per slot, so moving to another paragraph starts a new undo step even
          // in the middle of a sentence.
          `text:${slot}`,
        ),
      setImage: (slot, image: AboutImage | null) =>
        apply((was) => {
          const next = { ...was.slots };
          if (image === null) {
            // Dropping the picture must not drop a rewritten heading in the
            // same slot, and must not leave an empty object behind either.
            const { image: _gone, ...rest } = next[slot] ?? {};
            if (rest.text === undefined) delete next[slot];
            else next[slot] = rest;
          } else {
            next[slot] = { ...next[slot], image };
          }
          return { ...was, slots: next };
        }, `image:${slot}`),
      revert: (slot) =>
        apply((was) => {
          const next = { ...was.slots };
          delete next[slot];
          return { ...was, slots: next };
        }, `revert:${slot}`),
    };
  }, [enabled, apply]);

  const move = useCallback((step: (was: History) => History) => {
    const current = history.current;
    if (!current) return;
    const next = step(current);
    if (next === current) return;
    history.current = next;
    setDraft(next.present.copy);
    setTick((n) => n + 1);
  }, []);

  const undo = useCallback(() => move(historyUndo), [move]);
  const redo = useCallback(() => move(historyRedo), [move]);

  return {
    draft,
    ops,
    load,
    clear,
    editSections,
    undo,
    redo,
    canUndo: history.current !== null && historyCanUndo(history.current),
    canRedo: history.current !== null && historyCanRedo(history.current),
  };
}
