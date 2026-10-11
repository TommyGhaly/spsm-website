'use client';

/**
 * The one way an editor saves: "Unsaved changes — Discard / Save changes".
 *
 * ---------------------------------------------------------------------------
 * Every admin editor on the site holds what is typed and writes it only when
 * this Save is pressed — the bookstore panel, the events page, an event, the
 * About pages and the forms builder. Tommy chose it over autosave and over
 * per-field buttons after clothing sizes were ticked and never saved because
 * the bookstore had two ways of saving at once. One button, in the same place
 * with the same words everywhere, is the fix for that whole class of mistake.
 *
 * Always drawn, so where to save is never a question: "All changes saved" when
 * there is nothing to do. `problem` names whatever blocks the save in words
 * ("Type a sale price below $15.00"), never just a disabled button.
 *
 * This is the panel version, sticky at the foot of an editing column or drawer.
 * The event editor, which is the page itself, says the same words in its own
 * bar along the foot of the window — see `features/events/EditorBar.tsx`.
 * ---------------------------------------------------------------------------
 */
import type { ReactNode } from 'react';

export function SaveFooter({
  dirty,
  saving,
  problem = null,
  error = null,
  onDiscard,
  onSave,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  /** Why Save cannot be pressed yet, or null. */
  problem?: string | null;
  /** The last save failed, and why. */
  error?: string | null;
  onDiscard: () => void;
  onSave: () => void;
  /** Extra controls after Save. */
  children?: ReactNode;
}) {
  const state = saving
    ? 'Saving…'
    : error
      ? error
      : !dirty
        ? 'All changes saved'
        : (problem ?? 'Unsaved changes');

  const tone = error ? ' is-bad' : dirty ? ' is-dirty' : '';

  return (
    <div className={`edit-foot edit-foot--panel${tone}`}>
      <span className="edit-foot__state" role="status">
        {state}
      </span>
      <div className="edit-foot__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={!dirty || saving}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!dirty || saving || Boolean(problem)}
          onClick={onSave}
        >
          Save changes
        </button>
        {children}
      </div>
    </div>
  );
}
