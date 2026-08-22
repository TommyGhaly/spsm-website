'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /**
   * The element that was pressed to make the current selection, when there was
   * one — what the properties panel positions itself beside.
   *
   * ## Why this is tracked here rather than passed in
   *
   * The panel used to be a 272px strip across the foot of the window, so it did
   * not need to know: it was always in the same place. It is a panel beside the
   * thing it describes now, which means something has to know where that thing
   * is — and the alternative was a `data-` attribute or an anchor prop on every
   * selectable element in four files, threaded through the same components this
   * context exists to keep editing concerns out of.
   *
   * So: the last element pressed before the selection changed. That is not a
   * heuristic standing in for the real answer, it *is* the answer — selection in
   * this editor happens by clicking the thing, so the thing clicked is the thing
   * selected. It is null when the selection was set by something other than a
   * press, which is the case the panel has a fallback for.
   */
  anchor: HTMLElement | null;
  setOn: (next: boolean) => void;
  select: (next: Selection) => void;
  /** Whether this exact thing is the current selection. */
  isSelected: (next: Selection) => boolean;
}

const OFF: EditModeValue = {
  on: false,
  allowed: false,
  selection: { kind: 'page' },
  anchor: null,
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  /*
   * The last element pressed. Captured in the capture phase, so it is recorded
   * before any handler on the way up can call `select` — which is the whole
   * ordering this depends on. `pointerdown` rather than `click` for the same
   * reason: it happens first.
   */
  const pressed = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!on) return;
    function onPointerDown(event: PointerEvent) {
      pressed.current = event.target instanceof HTMLElement ? event.target : null;
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [on]);

  const select = useCallback((next: Selection) => {
    setSelection(next);
    setAnchor(pressed.current);
    /*
     * Cleared straight after being read, so a selection set later by something
     * that was *not* a press — a keyboard shortcut, a write completing — does not
     * inherit the anchor of whatever was last clicked, which could be anywhere
     * on the page or no longer in the document at all.
     */
    pressed.current = null;
  }, []);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    // Leaving edit mode drops the selection, so re-entering does not open the
    // panel on a picture somebody was looking at ten minutes ago.
    if (!next) {
      setSelection({ kind: 'page' });
      setAnchor(null);
    }
  }, []);

  const value = useMemo<EditModeValue>(
    () => ({
      // `allowed` gates everything rather than being checked at each call site.
      // This is not a security boundary — `firestore.rules` is — but a single
      // gate means a control cannot be drawn for somebody the rules will refuse.
      on: allowed && on,
      allowed,
      selection,
      anchor,
      setOn,
      select,
      isSelected: (next) => sameSelection(selection, next),
    }),
    [allowed, on, selection, anchor, setOn, select],
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
