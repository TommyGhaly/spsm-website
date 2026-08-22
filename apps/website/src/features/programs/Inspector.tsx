'use client';

/**
 * The editing column, down the right, with the page narrowed to fit beside it.
 *
 * ## This is the third arrangement, and the first that keeps its promise
 *
 * It was a 22rem column, then a 272px band across the foot, then a panel that
 * appeared beside whatever you clicked. Tommy has asked for the column back —
 * *"instead of trying to create a pop up the edit settings show up on the right
 * side and the whole screen shrinks to fit in the rest of the space"* — and it is
 * worth doing again rather than inventing a fourth idea, because what made it fail
 * the first time was a bug rather than the shape.
 *
 * **The bug:** `.rail--bleed` is `width: 100vw; margin-inline: calc(50% - 50vw)`,
 * so a full-bleed rail measures itself against the *window*. `padding-right` on
 * the page did nothing to it, and the galleries are mostly full-bleed rails — so
 * the part of the gallery that ran under the panel was the part being judged. That
 * is what "the column took a third of the horizontal space" actually meant.
 *
 * It is fixed by making the gutter a value both sides can read: `--edit-gutter` on
 * `body`, set by `usePanelWidth`, subtracted inside that `calc`. The rails now end
 * where the panel begins, so nothing is hidden and the width is honest.
 *
 * ## Always there while editing, and never empty
 *
 * The band died of being permanently present and mostly full of help text, so an
 * always-present column has to earn its space every moment it is on screen. Two
 * things make that true: the page-wide selection shows the page's *own* settings
 * rather than instructions, and `aside` folds in the list of what is inside this
 * level — which used to be a separate floating shelf in the corner. One column,
 * where there was a panel, a shelf and a pill.
 *
 * ## Under 60rem it is a sheet
 *
 * A 288px column beside a 375px phone is two unusable halves. There the panel
 * comes up from the bottom over the page instead, and nothing is narrowed. See
 * `.inspector-col` in globals.css.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { useEditMode } from './editMode';
import { usePanelWidth } from './usePanelWidth';

export function Inspector({
  /** What is selected, in words. "Day 2", "Photograph", "Summercamp". */
  title,
  /** The kind of thing, so the column changing contents does not read as a fault. */
  kind,
  saving = false,
  /**
   * Whatever is inside this level — the albums, the weeks, the days.
   *
   * Folded into the column at Tommy's direction, out of the floating shelf it used
   * to be. It belongs here: it is how you get from one thing to edit to the next,
   * and navigation in one corner with properties in another meant looking in two
   * places to do one job.
   */
  aside,
  children,
}: {
  title: string;
  kind: string;
  saving?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { on, selection, select, setOn } = useEditMode();
  const panel = usePanelWidth(on);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!on || !mounted) return null;

  /*
   * A portal on `document.body`, for the same reason the anchored version needed
   * one: this is `position: fixed`, and the article it would otherwise sit inside
   * has ancestors carrying `overflow` and transforms — either of which turns a
   * fixed element into an absolutely positioned one halfway down the page.
   */
  return createPortal(
    <aside
      className={`inspector-col${panel.dragging ? ' is-dragging' : ''}`}
      aria-label="Editing"
      style={{ width: panel.width }}
    >
      {/*
        The drag handle, on the panel's left edge.

        `role="separator"` with an orientation, because that is what it is — a
        resizer between two regions. The arrow keys do the same job in 16px steps,
        and that is not a nicety: a drag has no keyboard equivalent, so without them
        this is a panel somebody cannot make readable.
      */}
      <div
        className="inspector-col__grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Make the editing panel wider or narrower"
        tabIndex={0}
        onPointerDown={panel.onGrab}
        onKeyDown={(key) => {
          const step = key.key === 'ArrowLeft' ? 16 : key.key === 'ArrowRight' ? -16 : 0;
          if (step === 0) return;
          key.preventDefault();
          panel.onNudge(step);
        }}
      />

      <header className="inspector-col__head">
        <p className="inspector__kind">{kind}</p>
        <h2>{title}</h2>
        {/*
          Always present, never conditional on a write being in flight. A status
          that appears only when something is happening makes its absence
          ambiguous — and with no Save button anywhere in this column, "did that
          stick?" is the one question it has to answer at a glance.
        */}
        <span className="inspector__state">{saving ? 'Saving…' : 'Saved'}</span>

        {/*
          Done, directly under the saved indicator, at Tommy's direction: *"put the
          done editing pill under the saved indicator for simplicity."*
          
          It was the floating `EditToggle` pinned to the opposite corner, which
          made two fixed controls for one mode — the same arrangement that produced
          the overlapping pills the events bar was rebuilt to remove. Reading "Saved"
          and then pressing Done is one movement; reading "Saved" here and hunting
          for a pill in the far corner is two.
          
          `EditToggle` renders nothing while editing now, so this is the only way
          out and it is where the state is.
        */}
        <button type="button" className="inspector-col__done" onClick={() => setOn(false)}>
          Done editing
        </button>
      </header>

      {/*
        Back up to the page as a whole — not a close. The column does not close;
        it *is* the editing surface, and Done is what puts it away. This is how you
        stop looking at one photograph's settings, and it is absent when the page
        is already what is selected.
      */}
      {selection.kind !== 'page' && (
        <button
          type="button"
          className="inspector-col__up"
          onClick={() => select({ kind: 'page' })}
        >
          <Icon name="back" size={13} />
          <span>Back to the whole page</span>
        </button>
      )}

      <div className="inspector-col__body">
        <div className="inspector__content">{children}</div>
        {aside}
      </div>
    </aside>,
    document.body,
  );
}
