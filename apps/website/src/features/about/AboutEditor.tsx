'use client';

import { useEffect, useState } from 'react';
import type { AboutSlug } from '@spsm/shared';
import { EditColumn } from '@/components/EditColumn';
import { Icon } from '@/components/Icon';
import { BodyEditingClass, useEditMode } from '@/features/programs/editMode';
import { SaveFooter } from '@/components/SaveFooter';
import { AboutPanel, bandTitle } from './AboutPanel';
import { readAboutOverride, saveAboutOverride } from './admin';
import type { AboutCopy } from './context';
import type { AboutDraft } from './useAboutDraft';

/**
 * The editing column, and everything that keeps it in step with Firestore.
 *
 * ---------------------------------------------------------------------------
 * ## One column on the right, and a click to fill it
 *
 * `components/EditColumn` — the same column the galleries and the bookstore are
 * edited in, with the page narrowed to fit beside it. Its contents are
 * `AboutPanel`, which shows whatever has been clicked; the page itself gets
 * nothing added to it but the ability to be clicked (see `Editable`).
 *
 * Settled after two rounds: inline fields, then this column, then *"only edit
 * the text where it is its not that many customizations lets keep it simple"*,
 * then *"no keep the side column"*. Both survive — the column stays, and what
 * it holds is only the words and the photograph. The long version is in
 * `AboutPanel`.
 *
 * ## One Save, like every editor on the site
 *
 * What is typed is held until Save changes at the foot of the column, and
 * Discard puts the page back as it was saved. This replaced autosave when Tommy
 * asked for every admin editor to save the way the bookstore panel does. Done is
 * refused while anything is unsaved, and the browser warns before the tab is
 * closed.
 *
 * The draft is seeded from what Firestore holds *now*, not from the copy baked
 * into this page's HTML — which may be days old — and that read is what counts
 * as saved.
 *
 * Undo and redo stay, and work on the held draft: they step through what has
 * been typed since the page opened, saved or not, and Save writes wherever the
 * draft has got to.
 * ---------------------------------------------------------------------------
 */
export function AboutEditor({ page, editor }: { page: AboutSlug; editor: AboutDraft }) {
  const edit = useEditMode();
  const [failed, setFailed] = useState<string | null>(null);
  const { draft, load, clear, undo, redo, canUndo, canRedo } = editor;
  const loading = draft === null;

  /* What is written, to compare the draft against and to put back on Discard. */
  const [saved, setSaved] = useState<AboutCopy | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  async function saveNow() {
    if (!dirty || saving || draft === null) return;
    const value = draft;
    setSaving(true);
    setSaveError(null);
    try {
      await saveAboutOverride(page, { slug: page, slots: value.slots, sections: value.sections });
      setSaved(value);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  // Closing the tab with changes held would lose them without a word.
  useEffect(() => {
    if (!dirty) return;
    function warn(unload: BeforeUnloadEvent) {
      unload.preventDefault();
      unload.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /*
   * The read that seeds the draft.
   *
   * ---------------------------------------------------------------------------
   * **No "have I run already?" ref here, and that is deliberate — one cost an
   * hour.** This had a `seeded` ref *and* the `live` cleanup flag below, and in
   * development the two cancelled each other exactly: StrictMode mounts, runs
   * the effect, unmounts and remounts. The first run set the ref and started the
   * read; the unmount set `live = false`, so its result was thrown away; the
   * second run saw the ref and returned early. Nothing ever loaded, nothing
   * errored, and the symptom was the section panel simply never appearing.
   *
   * So the cleanup flag is the only guard. StrictMode therefore does two reads
   * in development and one in production, which is the right trade: a duplicate
   * `getDoc` of one document costs nothing, and a draft that never arrives costs
   * the whole editor.
   * ---------------------------------------------------------------------------
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const fresh = await readAboutOverride(page);
        if (!live) return;
        const copy: AboutCopy = { slots: fresh.slots, sections: fresh.sections };
        load(copy);
        // What was just read is, by definition, already saved.
        setSaved(copy);
      } catch (error) {
        if (!live) return;
        setFailed(
          error instanceof Error
            ? error.message
            : 'Could not read this page’s wording. Nothing has been changed.',
        );
      }
    })();
    return () => {
      live = false;
    };
    /*
     * `load` is deliberately not a dependency. It is
     * recreated on renders this effect's own state change causes, so listing
     * them would re-read the document on every keystroke.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function done() {
    if (dirty) {
      setSaveError('Save or discard your changes before leaving.');
      return;
    }
    clear();
    edit.setOn(false);
  }

  /*
   * ⌘Z and ⌘⇧Z, ctrl+z and ctrl+y — and taken over from the browser even while
   * the caret is in a field.
   *
   * That is the part worth arguing for. Every box here is a controlled React
   * input, so its native undo stack restores text the component immediately
   * overwrites from state; leaving ⌘Z to the browser inside a field means ⌘Z
   * appearing not to work, which is worse than it doing something slightly
   * different from a plain textarea. And half of what there is to undo — a
   * photograph, a revert, a removed section — was never in a field's stack at
   * all.
   *
   * Bound while edit mode is on and nowhere else, so a reader on /about is
   * unaffected. Not registered until the draft has loaded: undoing into a null
   * draft is not a state, and the keys are dead for the half-second the read
   * takes rather than doing something arbitrary.
   */
  useEffect(() => {
    if (loading) return;

    function onKeyDown(event: KeyboardEvent) {
      const chord = event.metaKey || event.ctrlKey;
      if (!chord || event.altKey) return;
      const key = event.key.toLowerCase();

      // ⌘S is Save, rather than the browser saving the page as a file.
      if (key === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      // ctrl+y is redo on Windows, and costs one line to honour.
      if (key === 'y' && !event.shiftKey) {
        event.preventDefault();
        redo();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // `saveNow` reads the draft it closes over, so it is re-bound with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, undo, redo, draft, saved, saving]);

  const heading = bandTitle(page, edit.selection);

  return (
    <>
      {/*
        `body.is-editing`, which is what makes room for the column. Owned by
        whatever owns the mode rather than by `EditColumn`, because it has to
        survive that component unmounting and be removed on navigation — see the
        note in `EditColumn`.
      */}
      <BodyEditingClass />

      <EditColumn
        on
        kind={heading.kind}
        title={heading.title}
        saving={saving}
        /* Absent when the page is already what is selected — there is nowhere up
           to go, and a control that does nothing is worse than none. */
        onBack={edit.selection.kind === 'page' ? undefined : () => edit.select({ kind: 'page' })}
        backLabel="Back to the whole page"
        onDone={done}
        actions={
          <>
            {/*
              Disabled rather than hidden at the ends of the stack. A control
              that vanishes when there is nothing to undo makes the row change
              width as you work, and the first press slides Done under the
              cursor.
            */}
            <button
              type="button"
              className="ab-step"
              onClick={undo}
              disabled={!canUndo || loading}
              /* The shortcut in the tooltip, because that is how this gets used
                 once somebody knows it is there. */
              title="Undo (⌘Z)"
              aria-label="Undo the last change"
            >
              <Icon name="undo" size={15} />
            </button>
            <button
              type="button"
              className="ab-step"
              onClick={redo}
              disabled={!canRedo || loading}
              title="Redo (⌘⇧Z)"
              aria-label="Redo the change that was undone"
            >
              <Icon name="redo" size={15} />
            </button>
          </>
        }
      >
        {/*
          `.inspector__body` is the column's own padded, self-scrolling
          container, and leaving it out was a real fault rather than a cosmetic
          one: `.inspector__content` has no padding at all, so every field sat
          hard against the column's left edge. The galleries and the shop both
          wrap their contents in this; nothing here needed inventing.
        */}
        <div className="inspector__body">
          {failed ? (
            <div className="notice notice--alarm" role="alert">
              <p>{failed}</p>
            </div>
          ) : loading || draft === null ? (
            <p className="inspector__hint">Reading this page’s wording…</p>
          ) : (
            <AboutPanel page={page} draft={draft} editor={editor} />
          )}

          {!failed && !loading && (
            <SaveFooter
              dirty={dirty}
              saving={saving}
              error={saveError}
              onDiscard={() => {
                if (saved) load(saved);
                setSaveError(null);
                // A section added since the last save is gone; the panel must not point at it.
                if (edit.selection.kind === 'level') edit.select({ kind: 'page' });
              }}
              onSave={() => void saveNow()}
            />
          )}
        </div>
      </EditColumn>
    </>
  );
}
