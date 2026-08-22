'use client';

import type { ReactNode } from 'react';
import { useEditMode } from './editMode';

/**
 * The properties column.
 *
 * A frame, not a switchboard: it draws the chrome — the heading that says what is
 * selected, the save state, the scroll area — and the page above it decides what
 * goes inside, because only the page knows what a section or a photograph on *it*
 * means. Routing the selection to a panel here would mean this file importing
 * every editor and knowing about both page shapes.
 *
 * Rendered only while edit mode is on, and rendered *outside* the page's content
 * so it can be `position: fixed` without inheriting a transform or an
 * `overflow: hidden` from something in the article.
 *
 * **Docked along the bottom**, a third of the screen, at Tommy's direction — it
 * was a 22rem column on the right. The pickers gain the whole viewport's width
 * where they had three thumbnails across, and the page keeps its full width, which
 * matters because this section is mostly full-bleed rails and a narrowed rail hides
 * the part that runs off the edge. See `.inspector` in globals.css for the trade
 * that buys it.
 *
 * **The list of what is inside a level is no longer in here.** It sat at the top,
 * permanently, taking 40% of a tall column; it is a shelf in the corner of the page
 * now — see `SubgroupShelf`. A bottom panel has no room for two lists side by side,
 * and the one that had to give is the one that is navigation rather than properties.
 */
export function Inspector({
  /** What is selected, in words. "Day 2", "Photograph", "Summercamp". */
  title,
  /** The kind of thing, so the panel changing shape does not read as a fault. */
  kind,
  saving = false,
  children,
}: {
  title: string;
  kind: string;
  saving?: boolean;
  children: ReactNode;
}) {
  const { on } = useEditMode();
  if (!on) return null;

  return (
    <aside className="inspector" aria-label="Properties">
      <header className="inspector__head">
        {/*
          Flat, not nested. The kind, the title and the save state are one baseline
          row — a wrapper here made them a stacked block, which on a panel a third
          of the screen tall spent an eighth of the height saying two words.
        */}
        <p className="inspector__kind">{kind}</p>
        <h2>{title}</h2>
        {/*
          Always present, never conditional on a write being in flight. A status
          that only appears when something is happening makes its absence
          ambiguous — and with no Save button anywhere in this panel, "did that
          stick?" is the one question it has to answer at a glance.
        */}
        <span className="inspector__state">{saving ? 'Saving…' : 'Saved'}</span>
      </header>

      {/*
        The children lay themselves out: a `DisclosureGroup` is a two-column grid
        of list-and-controls that fills this row, and a single-section panel is a
        plain body that scrolls. Nothing between them, because a wrapper with its
        own scroll would give a panel two of them.
      */}
      <div className="inspector__content">{children}</div>
    </aside>
  );
}
