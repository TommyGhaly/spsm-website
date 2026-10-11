'use client';

/**
 * One bar at the foot of the window: what is unsaved, Discard, Save, and Done.
 *
 * ## The history, briefly
 *
 * This once carried a publish-state pill, a Publish button and a menu of ways to
 * throw changes away — a two-stage draft-and-publish model Tommy replaced with
 * autosave (*"get rid of the publishing logic it should just autosave much less
 * confusing"*). Autosave has since been replaced in turn, at his direction, by
 * the one Save every editor on the site now has: changes are held, and this bar
 * says so in the same words as `SaveFooter` — "Unsaved changes — Discard / Save
 * changes". There is still no draft and no publish step: Save writes the event,
 * and the event is what the page shows.
 *
 * ## It still owns the whole edge, and still owns Done
 *
 * `EditToggle` is rendered only on the read-only page. Two fixed pills in the
 * same corner is what this bar was created to replace.
 */

import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';

export function EditorBar({
  dirty,
  saving,
  problem,
  error,
  missing,
  busy,
  onSave,
  onDiscard,
  onDelete,
  onDone,
}: {
  dirty: boolean;
  saving: boolean;
  /** Why Save cannot be pressed yet, in words, or null. */
  problem: string | null;
  /** The last save failed — or Done was refused — and why. */
  error: string | null;
  /**
   * What the event has not got round to yet — no summary, no description.
   * Said once, quietly, and never in red: an unwritten description is the
   * ordinary state of a new event, and it does not block Save.
   */
  missing: string[];
  busy: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const status = saving
    ? { text: 'Saving…', tone: 'ee-bar__status' }
    : error
      ? { text: error, tone: 'ee-bar__status ee-bar__status--bad' }
      : !dirty
        ? { text: 'All changes saved', tone: 'ee-bar__status ee-bar__status--ok' }
        : { text: problem ?? 'Unsaved changes', tone: 'ee-bar__status ee-bar__status--bad' };

  return (
    <div className="ee-bar">
      <p className={status.tone} role="status">
        {status.text}
      </p>

      <div className="ee-bar__actions">
        <button
          type="button"
          className="button button--quiet button--small"
          disabled={!dirty || saving || busy}
          onClick={onDiscard}
        >
          Discard
        </button>
        <button
          type="button"
          className="button button--small"
          disabled={!dirty || saving || busy || Boolean(problem)}
          onClick={onSave}
        >
          Save changes
        </button>

        {/*
          Delete stays behind the ellipsis rather than becoming a button in the
          bar: a bin beside Done is a bin somebody presses on the way out.
        */}
        <Popover
          className="ee-bar__more"
          label="More actions for this event"
          align="end"
          panel={(close) => (
            <div className="ee-menu">
              <button
                type="button"
                className="ee-menu__danger"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                <Icon name="close" size={14} />
                <span>
                  <strong>Delete this event</strong>
                  <small>Takes it off the website. You will have a few seconds to undo it.</small>
                </span>
              </button>
            </div>
          )}
        >
          <span aria-hidden="true">···</span>
        </Popover>

        <button type="button" className="button button--quiet ee-bar__done" disabled={busy || saving} onClick={onDone}>
          Done
        </button>
      </div>

      {missing.length > 0 && (
        <p className="ee-bar__missing">Still to write: {missing.join(' and ')}.</p>
      )}
    </div>
  );
}
