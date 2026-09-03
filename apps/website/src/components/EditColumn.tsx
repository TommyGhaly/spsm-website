'use client';

/**
 * The editing column, down the right, with the page narrowed to fit beside it.
 *
 * ---------------------------------------------------------------------------
 * **This is the events gallery's `Inspector`, lifted out of that feature so the
 * bookstore can use the same one.** Nothing about its shape is new; the history
 * of how it got that shape is in `features/programs/Inspector.tsx`, which is now
 * a thin wrapper around this, and is worth reading before changing anything
 * here — it was a 22rem column, then a band across the foot, then a panel beside
 * whatever you clicked, and the reasons those failed are recorded there.
 *
 * It moved because Tommy asked for the shop to be edited the same way: *"I want
 * the editing products to function similar to editing the pictures in events
 * where it all shows up on the side when selecting a specific product."* Two
 * columns that looked alike and drifted apart would be worse than one, and this
 * component was already generic in everything except where it read its state
 * from — a gallery-specific context. That is now props.
 *
 * ## What a caller has to supply, and why each is not assumed here
 *
 * `onDone` and `onBack` rather than a shared selection: the two features model
 * selection differently and always will. A gallery selects a section, a
 * photograph or a level within an arbitrarily deep tree; the shop selects one of
 * a flat list of books, or the shop itself. Pushing a union of those into a
 * common context would make every future kind of editable page widen it again.
 *
 * `body.is-editing` is the caller's job too — see `BodyEditingClass` in
 * `features/programs/editMode.tsx` and `ShopEditingClass` in the bookstore. It
 * has to be added by whatever owns the mode, because it must survive this
 * component unmounting and be removed on navigation.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { usePanelWidth } from '@/features/programs/usePanelWidth';

export function EditColumn({
  /** False renders nothing at all — not a hidden column, no column. */
  on,
  /** What is selected, in words. "Day 2", "Photograph", "The Holy Pascha". */
  title,
  /** The kind of thing, so the column changing contents does not read as a fault. */
  kind,
  saving = false,
  /**
   * "Back to the whole page", or its equivalent. Absent when the thing already
   * selected *is* the page — the column does not close, so this is how you stop
   * looking at one item's settings.
   */
  onBack,
  backLabel = 'Back to the whole page',
  /** Leaves edit mode entirely. The only way out, so it is never conditional. */
  onDone,
  /**
   * Controls that belong with Done rather than with the properties below it.
   *
   * Undo and redo, for the one caller that keeps a history. In the header
   * because that is where "Saved" and Done already are: those three answer the
   * same question — what has happened to my work — and somebody who has just
   * made a mistake looks in the corner they look at to check it saved.
   *
   * Not in the scrolling body, which is the alternative and is worse: a long
   * section's properties scroll, and an undo button that scrolls out of reach is
   * one people use the keyboard for or not at all.
   */
  actions,
  /**
   * Whatever is inside this level — the albums, the weeks, the days.
   *
   * Folded into the column rather than floating in a corner: it is how you get
   * from one thing to edit to the next, and navigation in one corner with
   * properties in another meant looking in two places to do one job.
   */
  aside,
  children,
}: {
  on: boolean;
  title: string;
  kind: string;
  saving?: boolean | undefined;
  onBack?: (() => void) | undefined;
  backLabel?: string | undefined;
  onDone: () => void;
  actions?: ReactNode | undefined;
  aside?: ReactNode | undefined;
  children: ReactNode;
}) {
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

          The shop is the exception and says so itself: it *does* have a Save, at
          the foot of the page, because its edits are held rather than autosaved.
          It passes `saving` from that bar so the two never disagree.
        */}
        <span className="inspector__state">{saving ? 'Saving…' : 'Saved'}</span>

        {/*
          Done, directly under the saved indicator, at Tommy's direction: *"put the
          done editing pill under the saved indicator for simplicity."*

          It was a floating toggle pinned to the opposite corner, which made two
          fixed controls for one mode. Reading "Saved" and then pressing Done is
          one movement; reading "Saved" here and hunting for a pill in the far
          corner is two.
        */}
        <button type="button" className="inspector-col__done" onClick={onDone}>
          Done editing
        </button>

        {actions && <div className="inspector-col__actions">{actions}</div>}
      </header>

      {onBack && (
        <button type="button" className="inspector-col__up" onClick={onBack}>
          <Icon name="back" size={13} />
          <span>{backLabel}</span>
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
