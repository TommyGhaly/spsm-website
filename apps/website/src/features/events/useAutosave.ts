'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Write a value a moment after it stops changing, and say so.
 *
 * The events editor has no Save button for content. That was chosen — typing is
 * the save — and it only works if two things are true: a write can never be lost
 * by navigating away, and the person can always tell which of the two states
 * they are in. Both are this hook's job, which is why the status is as much of
 * its output as the writing is.
 *
 * ## Why the comparison is a serialisation
 *
 * `value` is a form state object rebuilt on every keystroke, so referential
 * equality says "changed" always. The alternative — a dirty flag set by every
 * `set()` call — is a flag that has to be cleared correctly in six places and
 * is wrong the first time somebody forgets one. Serialising is a few
 * microseconds on an object this size and cannot drift out of step with the
 * value it describes.
 *
 * ## What happens when a write is in flight
 *
 * Keystrokes during a save are not dropped and do not queue up a write each:
 * `dirtyDuringSave` records that the value moved on, and one further write is
 * scheduled when the current one lands. Firestore writes are idempotent here —
 * each one sends the whole pending edit — so the last one wins and the
 * intermediate ones are worth nothing.
 *
 * ## Leaving the page
 *
 * `pagehide` flushes. It fires on a real navigation *and* when a phone's browser
 * is backgrounded, which `beforeunload` does not — and on iOS `beforeunload` is
 * not fired at all. The write it starts may not finish, which is why the editor
 * still warns about unsaved work rather than relying on this.
 */

export type AutosaveState =
  /** Everything typed has been written. */
  | { kind: 'clean' }
  /** Typed, waiting for the pause. */
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /**
   * There is a change, and it cannot be written yet — the form does not
   * currently describe a saveable event. Said out loud rather than looking
   * clean, because "your typing is safe" is the promise this hook makes.
   */
  | { kind: 'held'; why: string }
  | { kind: 'error'; message: string };

export interface Autosave<T> {
  state: AutosaveState;
  /** True when there is anything not yet written. For the unload warning. */
  dirty: boolean;
  /** Write now and wait for it. */
  flush: () => Promise<void>;
  /**
   * Declare this value already written, without writing it.
   *
   * The initial read needs it. This hook seeds "what has been written" from the
   * value it is first handed, which for an event page is built from the *baked*
   * copy in the exported HTML — possibly days old. The editor then replaces the
   * form with what Firestore actually holds, and unless this hook is told, it
   * sees a form that differs from its record, concludes somebody typed, and
   * writes back exactly what it just read.
   *
   * It was added for publishing, which had the same shape of problem and no
   * longer exists. This is the caller that remains, and it is the load-bearing
   * one: without it every edit session opens by writing.
   *
   * Cancels the timer as well as recording the value, which is the half that is
   * easy to forget and is the actual bug.
   */
  markSaved: (value: T) => void;
}

export function useAutosave<T>({
  value,
  save,
  enabled,
  /**
   * Null when the value cannot be written, with the reason. The events editor
   * returns one while the date field is empty mid-retype.
   */
  hold = null,
  delay = 900,
}: {
  value: T;
  save: (value: T) => Promise<void>;
  enabled: boolean;
  hold?: string | null;
  delay?: number;
}): Autosave<T> {
  const [state, setState] = useState<AutosaveState>({ kind: 'clean' });

  /** The serialisation of the last value successfully written. */
  const written = useRef<string>(JSON.stringify(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const dirtyDuringSave = useRef(false);

  /* Kept in refs so `flush` and the unload handler are stable and always see the
     current value rather than the one captured when they were created. */
  const latest = useRef(value);
  latest.current = value;
  const saveRef = useRef(save);
  saveRef.current = save;
  const holdRef = useRef(hold);
  holdRef.current = hold;

  const [dirty, setDirty] = useState(false);

  const write = useCallback(async () => {
    const snapshot = latest.current;
    const serialised = JSON.stringify(snapshot);
    if (serialised === written.current) return;

    const held = holdRef.current;
    if (held) {
      setState({ kind: 'held', why: held });
      return;
    }

    if (saving.current) {
      dirtyDuringSave.current = true;
      return;
    }

    saving.current = true;
    setState({ kind: 'saving' });
    try {
      await saveRef.current(snapshot);
      /*
       * The serialisation of the value that was *sent*, not of the current one.
       * Recording the current value would mark keystrokes made during the write
       * as already saved.
       */
      written.current = serialised;
      setState({ kind: 'saved', at: Date.now() });
      setDirty(JSON.stringify(latest.current) !== written.current);
    } catch (error) {
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not save. Your changes are still on this screen.',
      });
    } finally {
      saving.current = false;
      if (dirtyDuringSave.current) {
        dirtyDuringSave.current = false;
        void write();
      }
    }
  }, []);

  /* The debounce. */
  useEffect(() => {
    if (!enabled) return;

    const serialised = JSON.stringify(value);
    if (serialised === written.current) {
      setDirty(false);
      // Deliberately does not clear a `saved` state: the "Saved" line should
      // stay readable for a moment after the write, and this effect re-runs on
      // every render including the one that set it.
      setState((was) => (was.kind === 'pending' || was.kind === 'held' ? { kind: 'clean' } : was));
      return;
    }

    setDirty(true);
    setState(hold ? { kind: 'held', why: hold } : { kind: 'pending' });

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void write(), delay);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enabled, hold, delay, write]);

  /* Leaving, or being backgrounded. */
  useEffect(() => {
    if (!enabled) return;
    function onLeave() {
      if (timer.current) clearTimeout(timer.current);
      void write();
    }
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      /*
       * And on unmount, which is the ordinary case: pressing Done unmounts the
       * editor, and a pause shorter than the debounce would otherwise lose the
       * last thing typed.
       */
      onLeave();
    };
  }, [enabled, write]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await write();
  }, [write]);

  const markSaved = useCallback((saved: T) => {
    if (timer.current) clearTimeout(timer.current);
    written.current = JSON.stringify(saved);
    dirtyDuringSave.current = false;
    setDirty(false);
    setState({ kind: 'clean' });
  }, []);

  return { state, dirty, flush, markSaved };
}
