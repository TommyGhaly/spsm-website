'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_CHILD_LABEL, type DocOf, type Program, type ProgramEvent } from '@spsm/shared';
import { dayKey, fromDayKey, PARISH_TIME_ZONE } from '@/lib/dates';
import { RichText } from '@/components/RichText';
import { SaveFooter } from '@/components/SaveFooter';
import { useHeldEdits } from './editMode';
import {
  deleteProgram,
  deleteProgramEvent,
  updateProgram,
  updateProgramEvent,
} from './adminData';

/**
 * The details of one level of the tree — its name, its words, its dates, whether
 * anyone can see it.
 *
 * Deliberately plain: labelled fields and nothing else. The one exception is the
 * Description, which grew Italic / Bold / Heading / List / Link buttons — and for
 * the same reason the rest of the panel has none. The person using this is a
 * parish volunteer on a laptop a few times a year, so every affordance that has to
 * be *learned* is one that gets asked about on the phone; that argument cuts
 * against a rich text editor and *for* the buttons, because the alternative here
 * was learning that one asterisk is italic and two are bold. That field renders
 * through `components/Prose`, so the markdown was always live — the only question
 * was whether anybody had to type it. See `components/RichText`.
 *
 * ## There is no Save button, and that is a change
 *
 * These were forms: type, press Save, wait, read an error. Everything else in the
 * properties column has always been live — press "Sideways rail" and the section
 * rearranges behind the panel — and two forms in the middle of it that needed
 * submitting were the one place the rule broke. Worse, they had a *Cancel*, which
 * in a panel where every other control is already committed means nothing at all.
 *
 * The reason it was a form is gone rather than argued away. It was also the
 * create form, and a create genuinely is a commit: there is no document to write
 * a field to until you press something. Creating happens in the side menu now —
 * you type a name and it exists, at every level including a ministry — so what is
 * left here only ever *edits*, and an edit has somewhere to go the moment it is
 * made.
 *
 * The one thing that went with the create form is worth naming: it showed the
 * slug it was about to mint, under the name, because that becomes the public URL
 * and is permanent. That is not lost — it is stated *under the name field here*,
 * permanently, which is more use than a preview somebody sees once.
 *
 * Text commits on blur and on Enter, not per keystroke: a write per character is a
 * write per character. Switches and dates commit on the change, because there is
 * no half-typed state to protect.
 *
 * ## What is still not here
 *
 * **The slug.** It is the document id and the URL, so changing it is not an edit
 * but a move, and a move silently breaks every link the parish has already put in
 * a bulletin. Renaming leaves it alone, deliberately.
 *
 * **The order.** Position among siblings is the arrows in the side menu, where
 * you can see the result. A number box asking somebody to type `3` to mean
 * "third" is data entry pretending to be a puzzle.
 *
 * Two conventions run through all of it:
 *
 *  - **Nothing is destructive without a second step.** Removing asks, and says
 *    what happens to the photographs.
 *  - **Errors are the rules' errors, translated.** A refusal here is nearly
 *    always `permission-denied` from a grant the person does not hold, and
 *    saying that plainly is more use than "could not save".
 */

/**
 * A labelled on/off switch.
 *
 * A native checkbox underneath, visually hidden but still the thing that is
 * focused, toggled and announced — so keyboard, screen reader and form
 * semantics are the browser's rather than reimplemented. The track and thumb are
 * decoration painted from `:checked`.
 *
 * Worth the markup because these two flags are consequential and a bare
 * checkbox understates them: one decides whether the parish can see a page at
 * all, the other whether strangers can upload files to it. A switch reads as a
 * state you are setting rather than a box you are ticking.
 */
function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch${checked ? ' is-on' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint && <span className="switch__hint">{hint}</span>}
      </span>
    </label>
  );
}

/** Turns a Firestore refusal into something the parish office can act on. */
function explain(error: unknown, what: string): string {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (
    (typeof code === 'string' && code.includes('permission-denied')) ||
    /permission[_-]denied/i.test(message)
  ) {
    return `You do not have permission to ${what}. Ministry editing is granted per ministry — being staff is not enough on its own.`;
  }

  /*
   * The document has been deleted underneath this panel.
   *
   * A real report, not a hypothetical: two people had /events open, one removed a
   * ministry, and the other's toggle produced
   *
   *   NOT_FOUND: no entity to update: app: "dev~spsm-database"
   *   path < Element { type: "programs" name: "probe-ministry" } >
   *
   * — a Datastore internal, naming a slug the reader had never typed. It is also
   * the ordinary consequence of a stale tab, because this page holds its list in
   * state and only re-reads when something it did succeeds.
   *
   * Both codes are matched. The client SDK raises `not-found`; the emulator's
   * REST layer says `NOT_FOUND` in the message and sometimes carries no code at
   * all.
   */
  if (
    (typeof code === 'string' && code.includes('not-found')) ||
    /NOT_FOUND|no entity to update/i.test(message)
  ) {
    return 'This ministry is not there any more — somebody has removed it since this page was loaded. Reload to see the current list.';
  }

  return message || `Could not ${what}.`;
}

/* -------------------------------------------------------------------------- */

/**
 * A ministry's own details.
 *
 * Fewer fields than a level's, and the two missing ones are missing for a reason:
 * a ministry has no dates (it is standing, not an occurrence) and no submission
 * window of its own (photographs are sent to a gathering, which is what has a
 * queue).
 *
 * Held and saved with one Save, like every editor on the site: the fields used
 * to write as each one lost focus. While anything is unsaved, choosing another
 * ministry or pressing Done is refused — see `useHeldEdits`.
 */
export function ProgramDetails({
  program,
  onChanged,
  onRemoved,
}: {
  program: DocOf<Program>;
  /** Re-read. A name or a description shows on the page behind the panel. */
  onChanged: () => void;
  /** The thing being edited no longer exists; the page has to go somewhere. */
  onRemoved: () => void;
}) {
  const savedValues = {
    name: program.name,
    description: program.description,
    childLabel: program.childLabel ?? '',
    published: program.published,
  };
  const [draft, setDraft] = useState(savedValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Another ministry, or the saved values coming back changed: start from them.
  const savedKey = JSON.stringify(savedValues);
  useEffect(() => {
    setDraft(JSON.parse(savedKey) as typeof savedValues);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [program.id, savedKey]);

  const dirty = JSON.stringify(draft) !== savedKey;
  useHeldEdits(dirty, program.name);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((was) => ({ ...was, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProgram(
        program.id,
        {
          ...(draft.name.trim() !== program.name ? { name: draft.name.trim() } : {}),
          ...(draft.description !== program.description ? { description: draft.description } : {}),
          // Empty means "no opinion", which reaches the document as null.
          ...(draft.childLabel !== (program.childLabel ?? '') ? { childLabel: draft.childLabel.trim() || null } : {}),
          ...(draft.published !== program.published ? { published: draft.published } : {}),
        },
        null,
      );
      onChanged();
    } catch (caught) {
      console.error('[programs] could not save:', caught);
      setError(explain(caught, 'save this ministry'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inspector__body">
      <label className="inspector__field">
        <span>Name</span>
        <input type="text" value={draft.name} disabled={busy} onChange={(e) => set('name', e.target.value)} />
        <span className="inspector__note">Its address stays /events/{program.slug}.</span>
      </label>

      <div className="inspector__field">
        <RichText
          label="Description"
          value={draft.description}
          onChange={(description) => set('description', description)}
          placeholder="What this ministry is, when it meets, how somebody joins."
          ariaLabel="Description"
        />
      </div>

      <label className="inspector__field">
        <span>What its groups are called</span>
        <input
          type="text"
          value={draft.childLabel}
          disabled={busy}
          placeholder={DEFAULT_CHILD_LABEL}
          onChange={(e) => set('childLabel', e.target.value)}
        />
        <span className="inspector__note">For example &ldquo;Years&rdquo; or &ldquo;Weeks&rdquo;. Leave empty for &ldquo;{DEFAULT_CHILD_LABEL}&rdquo;.</span>
      </label>

      <Toggle
        checked={draft.published}
        disabled={busy}
        onChange={(published) => set('published', published)}
        label="Visible to everyone"
        hint={draft.published ? 'Anyone can see it on the Events page.' : 'Only editors can see it.'}
      />

      <Remove
        what="ministry"
        confirming={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onKeep={() => setConfirmDelete(false)}
        busy={busy}
        note="Its gatherings have to be removed first. The photographs are kept — any ministry can take them in from “Not in any ministry”."
        onRemove={() =>
          void (async () => {
            setBusy(true);
            try {
              await deleteProgram(program.id);
              onRemoved();
            } catch (caught) {
              setError(explain(caught, 'remove this ministry'));
              setConfirmDelete(false);
            } finally {
              setBusy(false);
            }
          })()
        }
      />

      <SaveFooter
        dirty={dirty}
        saving={busy}
        problem={draft.name.trim() === '' ? 'A name is needed to save' : null}
        error={error}
        onDiscard={() => setDraft(JSON.parse(savedKey) as typeof savedValues)}
        onSave={() => void save()}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One level's details — a camp, a week, a day, a part of a day.
 *
 * The same component at every depth, because the document is the same at every
 * depth. Nothing here reads how deep it is.
 */
export function LevelDetails({
  programId,
  node,
  onChanged,
  onRemoved,
}: {
  programId: string;
  node: DocOf<ProgramEvent>;
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const timeZone = node.timeZone || PARISH_TIME_ZONE;
  /*
   * Held and saved with one Save, like every editor on the site. Dates are held
   * as the civil day an `<input type="date">` speaks ("2026-07-22"), read with
   * `dayKey` and written back with `fromDayKey` — the same round trip the old
   * per-field writes used.
   */
  const savedValues = {
    title: node.title,
    description: node.description,
    dated: node.startAt !== null || node.endAt !== null,
    from: dayKey(node.startAt, timeZone) ?? '',
    to: dayKey(node.endAt, timeZone) ?? '',
    childLabel: node.childLabel ?? '',
    published: node.published,
  };
  const savedKey = JSON.stringify(savedValues);
  const [draft, setDraft] = useState(savedValues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setDraft(JSON.parse(savedKey) as typeof savedValues);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, savedKey]);

  const dirty = JSON.stringify(draft) !== savedKey;
  useHeldEdits(dirty, node.title || 'this page');
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((was) => ({ ...was, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const start = draft.dated ? fromDayKey(draft.from) : null;
      const end = draft.dated ? fromDayKey(draft.to) : null;
      await updateProgramEvent(
        node.id,
        {
          ...(draft.title.trim() !== node.title ? { title: draft.title.trim() } : {}),
          ...(draft.description !== node.description ? { description: draft.description } : {}),
          ...(draft.dated !== savedValues.dated || draft.from !== savedValues.from ? { startAt: start } : {}),
          ...(draft.dated !== savedValues.dated || draft.to !== savedValues.to ? { endAt: end } : {}),
          ...(draft.childLabel !== (node.childLabel ?? '') ? { childLabel: draft.childLabel.trim() || null } : {}),
          ...(draft.published !== node.published ? { published: draft.published } : {}),
        },
        null,
      );
      onChanged();
    } catch (caught) {
      console.error('[programs] could not save:', caught);
      setError(explain(caught, 'save this'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inspector__body">
      <label className="inspector__field">
        <span>Name</span>
        <input type="text" value={draft.title} disabled={busy} onChange={(e) => set('title', e.target.value)} />
      </label>

      <div className="inspector__field">
        <RichText
          label="Description"
          value={draft.description}
          onChange={(description) => set('description', description)}
          placeholder="What this was. Shown above the photographs."
          ariaLabel="Description"
        />
      </div>

      <Toggle
        checked={draft.dated}
        disabled={busy}
        label="It has a date"
        hint="Off for a day of a camp or a standing class."
        onChange={(on) => set('dated', on)}
      />

      {draft.dated && (
        <div className="inspector__dates">
          <label className="inspector__field inspector__field--inline">
            <span>From</span>
            <input type="date" value={draft.from} disabled={busy} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="inspector__field inspector__field--inline">
            <span>To</span>
            <input type="date" value={draft.to} disabled={busy} onChange={(e) => set('to', e.target.value)} />
          </label>
        </div>
      )}

      <label className="inspector__field">
        <span>What its groups are called</span>
        <input
          type="text"
          value={draft.childLabel}
          disabled={busy}
          placeholder={DEFAULT_CHILD_LABEL}
          onChange={(e) => set('childLabel', e.target.value)}
        />
        <span className="inspector__note">For example &ldquo;Weeks&rdquo; inside a year, &ldquo;Days&rdquo; inside a week.</span>
      </label>

      <Toggle
        checked={draft.published}
        disabled={busy}
        onChange={(published) => set('published', published)}
        label="Visible to everyone"
        hint={draft.published ? 'Anyone can open this and everything inside it.' : 'Only editors can see it.'}
      />

      <Remove
        what="level"
        confirming={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onKeep={() => setConfirmDelete(false)}
        busy={busy}
        note="The photographs filed here are kept — they move up to the ministry. Anything inside this has to be removed first."
        onRemove={() =>
          void (async () => {
            setBusy(true);
            try {
              await deleteProgramEvent(node.id, programId);
              onRemoved();
            } catch (caught) {
              setError(explain(caught, 'remove this'));
              setConfirmDelete(false);
            } finally {
              setBusy(false);
            }
          })()
        }
      />

      <SaveFooter
        dirty={dirty}
        saving={busy}
        problem={draft.title.trim() === '' ? 'A name is needed to save' : null}
        error={error}
        onDiscard={() => setDraft(JSON.parse(savedKey) as typeof savedValues)}
        onSave={() => void save()}
      />
    </div>
  );
}

function Remove({
  what,
  note,
  confirming,
  onAsk,
  onKeep,
  onRemove,
  busy,
}: {
  what: string;
  note: string;
  confirming: boolean;
  onAsk: () => void;
  onKeep: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  if (!confirming) {
    return (
      <p className="inspector__destroy">
        <button type="button" className="button button--quiet button--small" onClick={onAsk}>
          Remove this {what}
        </button>
      </p>
    );
  }

  return (
    <div className="inspector__destroy">
      <p className="inspector__note">{note}</p>
      <p>
        <button
          type="button"
          className="button button--danger button--small"
          disabled={busy}
          onClick={onRemove}
        >
          Really remove
        </button>{' '}
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={onKeep}
        >
          Keep it
        </button>
      </p>
    </div>
  );
}
