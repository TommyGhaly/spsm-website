'use client';

/**
 * One bar at the foot of the window: whether your typing has landed, and Done.
 *
 * ## What it used to carry, and why almost none of it is left
 *
 * This had a publish-state pill, a "· unpublished changes" marker, a Publish
 * changes button that appeared and disappeared, a blocker line explaining why
 * that button was disabled, and a menu holding Unpublish and "Throw away my
 * changes". All of it existed to serve one mechanism — edits accumulating in a
 * pending copy until somebody promoted them — and Tommy's verdict on that
 * mechanism was *"get rid of the publishing logic it should just autosave much
 * less confusing."*
 *
 * With no publish step there is no state to report and no action to offer. An
 * event exists, what you type is what it says, and the only question a bar can
 * usefully answer is whether the last keystroke reached Firestore.
 *
 * ## It still owns the whole edge, and still owns Done
 *
 * That part is unchanged and worth keeping written down: `EditToggle` is rendered
 * only on the read-only page. Two fixed pills 46px apart in the same corner —
 * a Save bar at `z-index: 110` and the generic toggle at 120 — is what this bar
 * was created to replace, and it would come straight back the day somebody adds
 * the floating toggle to the editing branch again.
 */

import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import type { AutosaveState } from './useAutosave';

/** How the autosave state reads to a person. */
function statusOf(state: AutosaveState): { text: string; tone: string } | null {
  switch (state.kind) {
    case 'saving':
    case 'pending':
      // Both are "Saving…" deliberately. The difference between "waiting for you
      // to stop typing" and "writing" is this component's business, not the
      // reader's, and two words for it invite the question of which is which.
      return { text: 'Saving…', tone: 'ee-bar__status' };
    case 'saved':
      return { text: 'Saved', tone: 'ee-bar__status ee-bar__status--ok' };
    case 'held':
      return { text: state.why, tone: 'ee-bar__status ee-bar__status--warn' };
    case 'error':
      return { text: state.message, tone: 'ee-bar__status ee-bar__status--bad' };
    case 'clean':
      return null;
  }
}

export function EditorBar({
  autosave,
  /**
   * What the event has not got round to yet — no summary, no description.
   *
   * Said once, quietly, and never in red. These used to block a Publish button;
   * with the event live from the moment it is created, an unwritten description
   * is the ordinary state of a new one for as long as it takes to write, and
   * nagging about the ordinary state is how a bar becomes wallpaper.
   */
  missing,
  busy,
  onDelete,
  onDone,
}: {
  autosave: AutosaveState;
  missing: string[];
  busy: boolean;
  onDelete: () => void;
  onDone: () => void;
}) {
  const status = statusOf(autosave);

  return (
    <div className="ee-bar">
      {/*
        `role="status"`, so a screen reader hears "Saved" without being
        interrupted mid-word on every keystroke — polite, not assertive.
      */}
      <p className={status?.tone ?? 'ee-bar__status'} role="status">
        {status?.text ?? ''}
      </p>

      <div className="ee-bar__actions">
        {/*
          One item behind the ellipsis, and it stays an ellipsis rather than
          becoming a Delete button in the bar. A bin beside Done, both the same
          size, is a bin somebody presses by accident on the way out.
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
                  {/*
                    Worth saying outright now that unpublishing is gone: this is
                    the only way to take an event off the website, so the undo
                    window is the whole safety net.
                  */}
                  <small>
                    Takes it off the website. You will have a few seconds to undo it.
                  </small>
                </span>
              </button>
            </div>
          )}
        >
          <span aria-hidden="true">···</span>
        </Popover>

        <button
          type="button"
          className="button ee-bar__done"
          disabled={busy}
          onClick={onDone}
        >
          Done
        </button>
      </div>

      {missing.length > 0 && (
        <p className="ee-bar__missing">
          {/* One sentence rather than a list. Two items is the most there can
              be, and a two-line bar for two short phrases is a bar taller than
              the thing it is about. */}
          Still to write: {missing.join(' and ')}.
        </p>
      )}
    </div>
  );
}
