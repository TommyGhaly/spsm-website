'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * One editing mode for a whole gallery page, and one thing selected in it.
 *
 * ## What this replaced
 *
 * Ten controls scattered down the page and four panels that expanded inline. A
 * "Ministry tools" box between the photographs and the gatherings; "Arrange this
 * section" and "Move the pictures" under every subsection; "Edit" and "Cover" on
 * every gathering card; and a picture chooser that pushed a thousand pixels of
 * page out of the way when it opened. Each was reasonable on its own and the sum
 * was unusable — Tommy's words were "very confusing and busy" — and the reason is
 * structural rather than cosmetic: **every new thing an administrator could change
 * added a button next to the thing it changed.** That does not converge.
 *
 * So: nothing at all until you press Edit, and then *one* properties column on
 * the right, showing whatever is selected. Adding a new setting now costs a row in
 * a panel rather than a button on the page. The public page is untouched — with
 * edit mode off, an administrator sees exactly what a visitor sees, which is also
 * the only honest way to judge a change.
 *
 * ## Selection is by clicking the thing itself
 *
 * A section, a picture, a gathering. That is the "organic" part of the request:
 * the page is the interface, and the panel follows what you point at rather than
 * being a menu you navigate. `page` is the fallback — nothing selected means the
 * ministry or gathering as a whole, which is what somebody who has just pressed
 * Edit most likely wants.
 *
 * ## Why a context rather than props
 *
 * Selection is read by things that are four or five levels down — a figure inside
 * a strip inside a rail inside a section — and written by them too. Threading
 * `selected`/`onSelect` through `GallerySection`, `GalleryGrid`, `GalleryFigure`
 * and `GalleryCanvas` would put an editing concern in the signature of every
 * component that draws a photograph, including on the public page where there is
 * no editing at all.
 */

export type Selection =
  | { kind: 'page' }
  | { kind: 'section'; key: string }
  | { kind: 'media'; id: string }
  /**
   * One level inside the page being looked at — a gathering under a ministry, a
   * day under a week. One kind rather than one per depth, because the tree is
   * arbitrarily deep and a `gathering`/`group` pair could only ever name two of
   * its floors.
   */
  | { kind: 'level'; id: string }
  /** A ministry, selected from the rail on /events. */
  | { kind: 'program'; id: string };

interface EditModeValue {
  /** True only when an administrator has pressed Edit. */
  on: boolean;
  /** May this person edit at all? False hides the toggle entirely. */
  allowed: boolean;
  selection: Selection;
  setOn: (next: boolean) => void;
  select: (next: Selection) => void;
  /** Whether this exact thing is the current selection. */
  isSelected: (next: Selection) => boolean;
}

const OFF: EditModeValue = {
  on: false,
  allowed: false,
  selection: { kind: 'page' },
  setOn: () => undefined,
  select: () => undefined,
  isSelected: () => false,
};

const EditModeContext = createContext<EditModeValue>(OFF);

export function EditModeProvider({
  allowed,
  children,
}: {
  allowed: boolean;
  children: ReactNode;
}) {
  const [on, setOnState] = useState(false);
  const [selection, setSelection] = useState<Selection>({ kind: 'page' });

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    // Leaving edit mode drops the selection, so re-entering does not open the
    // panel on a picture somebody was looking at ten minutes ago.
    if (!next) setSelection({ kind: 'page' });
  }, []);

  const value = useMemo<EditModeValue>(
    () => ({
      // `allowed` gates everything rather than being checked at each call site.
      // This is not a security boundary — `firestore.rules` is — but a single
      // gate means a control cannot be drawn for somebody the rules will refuse.
      on: allowed && on,
      allowed,
      selection,
      setOn,
      select: setSelection,
      isSelected: (next) => sameSelection(selection, next),
    }),
    [allowed, on, selection, setOn],
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditModeValue {
  return useContext(EditModeContext);
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'section' && b.kind === 'section') return a.key === b.key;
  if (a.kind === 'media' && b.kind === 'media') return a.id === b.id;
  if (a.kind === 'level' && b.kind === 'level') return a.id === b.id;
  if (a.kind === 'program' && b.kind === 'program') return a.id === b.id;
  return true;
}

/**
 * The class that makes room for the properties column.
 *
 * On `document.body` rather than on a wrapper, and that is forced rather than
 * preferred: the column is `position: fixed` and the room for it is
 * `padding-right` on the page — but a full-bleed rail measures itself against the
 * *viewport*, so narrowing it needs a selector above the article. `body` is the
 * only element reliably above everything.
 */
export function BodyEditingClass() {
  const { on } = useEditMode();

  useEffect(() => {
    if (!on) return;
    document.body.classList.add('is-editing');
    // Removed on the way out *and* on unmount: navigating away from a gallery with
    // the panel open would otherwise leave every other page padded.
    return () => document.body.classList.remove('is-editing');
  }, [on]);

  return null;
}

/**
 * The one control that turns editing on.
 *
 * Fixed to the corner rather than in the page's flow, for two reasons. It must be
 * reachable from anywhere on a long gathering page — a control at the top is a
 * control you scroll back up for — and it must not take space or move anything
 * when it appears, because the page it sits over is the thing being judged.
 *
 * Renders nothing at all for a visitor. Not hidden with CSS: absent.
 */
export function EditToggle() {
  const { allowed, on, setOn } = useEditMode();
  if (!allowed) return null;

  return (
    <button
      type="button"
      className={`edit-toggle${on ? ' is-on' : ''}`}
      onClick={() => setOn(!on)}
      aria-pressed={on}
    >
      {on ? 'Done editing' : 'Edit this page'}
    </button>
  );
}
