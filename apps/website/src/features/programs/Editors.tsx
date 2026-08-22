'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_CHILD_LABEL, type DocOf, type Program, type ProgramEvent } from '@spsm/shared';
import { dayKey, fromDayKey, PARISH_TIME_ZONE } from '@/lib/dates';
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
 * Deliberately plain: labelled fields and nothing else. No rich text editor,
 * because the person using this is a parish volunteer on a laptop a few times a
 * year, and every affordance that has to be *learned* is one that gets asked
 * about on the phone.
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

/**
 * A text field that writes when you leave it.
 *
 * Extracted because there are four of them and the behaviour is fiddly in the
 * same way each time: hold the keystrokes locally, commit on blur or Enter, and
 * **re-seed when the subject changes** — otherwise clicking from one level to the
 * next shows the first one's name over the second one's page.
 */
function LiveText({
  label,
  value,
  onCommit,
  rows,
  placeholder,
  note,
  busy = false,
  allowEmpty = false,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  /** Present for a textarea, absent for a single-line input. */
  rows?: number;
  placeholder?: string;
  note?: string;
  busy?: boolean;
  /**
   * Whether clearing the field is a real answer.
   *
   * False for a name, where empty would leave a level with nothing to click on.
   * True for a field whose empty state *means* something — "use the default" —
   * and where the guard below otherwise makes the value impossible to unset:
   * it can be typed in and never taken out again.
   */
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = rows === undefined ? draft.trim() : draft;
    if (next === value) return;
    // An empty name would leave a level with nothing to click on in the menu, so
    // it is refused by putting the old one back rather than by an error message
    // about a field somebody has already left.
    if (rows === undefined && next === '' && !allowEmpty) {
      setDraft(value);
      return;
    }
    onCommit(next);
  };

  return (
    <label className="inspector__field">
      <span>{label}</span>
      {rows === undefined ? (
        <input
          type="text"
          value={draft}
          disabled={busy}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(key) => {
            if (key.key === 'Enter') {
              key.preventDefault();
              (key.target as HTMLInputElement).blur();
            }
            if (key.key === 'Escape') setDraft(value);
          }}
        />
      ) : (
        <textarea
          rows={rows}
          value={draft}
          disabled={busy}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      )}
      {note && <span className="inspector__note">{note}</span>}
    </label>
  );
}

/**
 * A civil date, in and out of an `<input type="date">`.
 *
 * The dates were **absent from this panel entirely** until now, and the note
 * explaining why was honest about the cost: "the form does not read the existing
 * dates back into its state — Firestore hands them over in several shapes and
 * parsing them into `<input type=date>` is a job of its own — so writing the
 * form's `null` would silently erase a date somebody set. Better to leave the
 * field alone than to quietly destroy it."
 *
 * Which meant nothing on the site could set a date, on a collection that **sorts
 * by date** and prints one on every card. A week created in the editor was
 * undated for ever.
 *
 * Both halves of that are one line each, in the end:
 *
 * - **Reading**, `dayKey` — already written for the calendar, already handles
 *   every shape Firestore returns, and already renders the parish's civil date
 *   rather than the browser's.
 * - **Writing**, noon UTC. `new Date('2026-07-22')` parses as *midnight UTC*,
 *   which in the parish's zone is eight in the evening on the 21st — so the
 *   obvious version stores the day before the one that was typed, and only for
 *   the western half of the world. Noon keeps the civil date intact for any zone
 *   within eleven hours of UTC, which is all of them that matter and comfortably
 *   more than the one the parish is fixed to.
 */
function DateField({
  label,
  value,
  timeZone,
  onCommit,
  busy = false,
}: {
  label: string;
  value: ProgramEvent['startAt'];
  timeZone: string;
  onCommit: (next: Date | null) => void;
  busy?: boolean;
}) {
  const current = dayKey(value, timeZone) ?? '';

  return (
    <label className="inspector__field inspector__field--inline">
      <span>{label}</span>
      <input
        type="date"
        value={current}
        disabled={busy}
        // `fromDayKey` is exactly `dayKey` backwards, and it lives beside it in
        // lib/dates so the round trip cannot drift. Clearing the field is a real
        // choice — "this has no fixed date" — and reaches the document as null.
        onChange={(change) => onCommit(fromDayKey(change.target.value))}
      />
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function write(what: string, run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (caught) {
      console.error('[programs] could not save:', caught);
      setError(explain(caught, what));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inspector__body">
      <LiveText
        label="Name"
        value={program.name}
        busy={busy}
        onCommit={(name) => void write('rename this ministry', () => updateProgram(program.id, { name }, null))}
        note={`Its address stays /events/${program.slug} — changing that would break links the parish has shared.`}
      />

      <LiveText
        label="Description"
        rows={4}
        value={program.description}
        busy={busy}
        placeholder="What this ministry is, when it meets, how somebody joins."
        onCommit={(description) =>
          void write('edit this ministry', () => updateProgram(program.id, { description }, null))
        }
      />

      {/*
        What this ministry's parts are called. Shows on the side menu, on the
        heading over the cards, and in "Add a …" — see `childLabelOf`.
      */}
      <LiveText
        label="Its parts are called"
        value={program.childLabel ?? ''}
        busy={busy}
        placeholder={DEFAULT_CHILD_LABEL}
        allowEmpty
        onCommit={(childLabel) =>
          void write('rename the parts of this ministry', () =>
            // Empty means "no opinion", which has to reach the document as null
            // rather than as an empty string the fallback would then have to
            // second-guess.
            updateProgram(program.id, { childLabel: childLabel.trim() || null }, null),
          )
        }
        note={`Plural, as it appears over a list — "${DEFAULT_CHILD_LABEL}", "Years", "Weeks". Leave it empty for "${DEFAULT_CHILD_LABEL}".`}
      />

      <Toggle
        checked={program.published}
        disabled={busy}
        onChange={(published) =>
          void write('publish this ministry', () => updateProgram(program.id, { published }, null))
        }
        label="Visible to everyone"
        hint={
          program.published
            ? 'Anyone can see this ministry on the Events page.'
            : 'Only you can see it. Nothing is published until you turn this on.'
        }
      />

      {error && <p className="inline-editor__error">{error}</p>}

      <Remove
        what="ministry"
        confirming={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onKeep={() => setConfirmDelete(false)}
        busy={busy}
        note="Its gatherings have to be removed first."
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function write(what: string, patch: Parameters<typeof updateProgramEvent>[1]) {
    setBusy(true);
    setError(null);
    try {
      await updateProgramEvent(node.id, patch, null);
      onChanged();
    } catch (caught) {
      console.error('[programs] could not save:', caught);
      setError(explain(caught, what));
    } finally {
      setBusy(false);
    }
  }

  const timeZone = node.timeZone || PARISH_TIME_ZONE;

  return (
    <div className="inspector__body">
      <LiveText
        label="Name"
        value={node.title}
        busy={busy}
        onCommit={(title) => void write('rename this', { title })}
        note="Its address does not change with its name — links the parish has shared keep working."
      />

      <LiveText
        label="Description"
        rows={3}
        value={node.description}
        busy={busy}
        placeholder="What this was. Shown above the photographs."
        onCommit={(description) => void write('edit this', { description })}
      />

      {/*
        Dates, which nothing on the site could set until now.

        They are not decoration: undated levels sort *after* dated ones and the
        span prints on the card. A week with no dates is a week that shows up in
        an arbitrary place in its year with no clue when it was.

        Both optional. "Day 1" of a camp genuinely has no useful date of its own —
        it is ordered by hand, which is what `order` is for — and a standing class
        has none either.
      */}
      <div className="inspector__dates">
        <DateField
          label="From"
          value={node.startAt}
          timeZone={timeZone}
          busy={busy}
          onCommit={(startAt) => void write('set the date', { startAt })}
        />
        <DateField
          label="To"
          value={node.endAt}
          timeZone={timeZone}
          busy={busy}
          onCommit={(endAt) => void write('set the date', { endAt })}
        />
      </div>
      <p className="inspector__note">
        Leave both empty for something with no fixed date — a day of a camp, or a
        standing class. Undated levels sort after dated ones, in the order you put
        them in.
      </p>

      {/*
        What the parts *inside this one* are called — the weeks of a year, the
        days of a week. Set here rather than inherited from the ministry because
        that is exactly where one word stops fitting: the parts of Summercamp are
        years, and the parts of a year are not.
      */}
      <LiveText
        label="Its parts are called"
        value={node.childLabel ?? ''}
        busy={busy}
        placeholder={DEFAULT_CHILD_LABEL}
        allowEmpty
        onCommit={(childLabel) =>
          void write('rename the parts of this', { childLabel: childLabel.trim() || null })
        }
        note={`Plural — "Weeks", "Days", "${DEFAULT_CHILD_LABEL}". Leave it empty for "${DEFAULT_CHILD_LABEL}".`}
      />

      <Toggle
        checked={node.published}
        disabled={busy}
        onChange={(published) => void write('publish this', { published })}
        label="Visible to everyone"
        hint={
          node.published
            ? 'Anyone can open this and everything inside it.'
            : 'Only you can see it while you set it up.'
        }
      />

      {/* The flag that decides whether the public upload form renders at all,
          and which the rules re-check on every single submission. */}
      <Toggle
        checked={node.submissionsOpen}
        disabled={busy}
        onChange={(submissionsOpen) => void write('change who may send photographs', { submissionsOpen })}
        label="Accepting photographs"
        hint={
          node.submissionsOpen
            ? 'Parishioners see an upload form here. Everything they send waits for your approval.'
            : 'The upload form is hidden. Photographs already approved stay where they are.'
        }
      />

      {error && <p className="inline-editor__error">{error}</p>}

      <Remove
        what="level"
        confirming={confirmDelete}
        onAsk={() => setConfirmDelete(true)}
        onKeep={() => setConfirmDelete(false)}
        busy={busy}
        note="The photographs filed here are not deleted — they stay in the parish's storage and can be re-filed. Anything nested inside this has to be removed first."
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
    </div>
  );
}

/**
 * The one destructive control, behind one question.
 *
 * Shared between the two above because the shape of the interaction is the thing
 * worth being consistent about: a quiet link, then a question that says what is
 * lost, then a red button. The note is *always* on screen before the red button
 * is — an administrator should never have to remember what a delete takes with
 * it.
 */
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
