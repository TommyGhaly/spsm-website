'use client';

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react';

/**
 * The properties panel: a list of what is on the page down one side, and the
 * controls for whichever one is open beside it.
 *
 * ## The measurement this exists because of
 *
 * The panel had **78 controls and 36 photograph tiles in a 435px-tall column that
 * scrolled 2,567px** — every property of the selected thing expanded at once, two
 * picture grids stacked on an 800px form. Tommy said it was confusing three
 * separate times.
 *
 * The fix that worked was not arranging them better. It was asking a different
 * question: the panel used to list *settings*, and settings multiply — every new
 * capability is another row for ever. It now lists **the things on the page**, and
 * one of them is open. A page cannot grow more rows than it has blocks.
 *
 * Closed, a row is a name and its current value, which is the part that makes the
 * short version *more* informative rather than merely smaller: "Photographs · 6
 * chosen", "Block 2 · sideways wheel, large", "This gathering · draft" states the
 * condition of the page in three lines.
 *
 * ## Master and detail, because the panel is now short and wide
 *
 * The panel moved from a 22rem column on the right to a third of the screen along
 * the bottom, at Tommy's direction. That changes what shape the list wants. Down a
 * tall column an accordion is right — the open body pushes the rows below it down
 * and there is room. Along a short wide strip it is wrong twice over: the rows
 * waste a full viewport of width saying three words each, and the open body gets
 * whatever vertical room is left after them, which for a picture grid is nothing.
 *
 * So the rows go in a narrow column at the left of the panel and the open row's
 * controls fill the rest. Both are visible at once, the controls get the full
 * height, and switching between two of them is a click with nothing moving.
 *
 * ## Which is why `Disclosure` does not render itself
 *
 * It is a declaration. `DisclosureGroup` reads its props and draws the parts in
 * two different places — the toggle in the list, the children in the detail pane —
 * which is not something a self-rendering component can do, because the two halves
 * are not siblings in the tree.
 *
 * The cost is that `<Disclosure>` is only meaningful as a direct child of a
 * `<DisclosureGroup>`, and anything else in there is drawn above the list. That is
 * a real constraint on callers and the reason it is written down here rather than
 * discovered.
 */

interface DisclosureGroupValue {
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
}

const DisclosureGroupContext = createContext<DisclosureGroupValue | null>(null);

/** The props a row declares. Read by the group, never rendered by the row. */
interface DisclosureProps {
  /** Stable, and unique within the group. Also what `defaultOpen` names. */
  id: string;
  label: string;
  /**
   * What this row currently holds, in as few words as possible — "6 chosen",
   * "sideways wheel, large", "draft".
   *
   * The row's reason for existing when closed. A list of bare names is a menu; a
   * list of names and values is a summary of the page.
   */
  value?: ReactNode;
  /** Drawn small above the controls. For a consequence worth stating. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * One row. Declares; does not draw.
 *
 * Returns `null` if it is ever rendered directly, which only happens outside a
 * group — where there is no list to put a toggle in and no pane to put the body
 * in, so drawing *something* would be a guess. A panel with one section should use
 * a plain `<div className="inspector__body">` instead, which is what the
 * single-section panels do.
 */
export function Disclosure(_props: DisclosureProps): null {
  return null;
}

/**
 * The set that opens one at a time.
 *
 * `defaultOpen` names the row to start on. Worth setting to whatever somebody who
 * has just selected this thing most likely wants — for a photograph that is its
 * caption, because it arrives from the approval queue without one and the caption
 * is also its alt text. For a *page* it is deliberately nothing: somebody who has
 * just pressed Edit has not said which part they came for, and opening a picture
 * grid on a page they meant to rename is a guess that costs a click either way.
 */
export function DisclosureGroup({
  defaultOpen = null,
  children,
}: {
  defaultOpen?: string | null;
  children: ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(defaultOpen);
  const bodyId = useId();

  /*
   * The rows, and anything else.
   *
   * "Anything else" is drawn above the list — the add-a-block buttons are the one
   * caller that uses it. Filtering rather than throwing, because a stray
   * `{condition && …}` yielding `false` is an ordinary thing to have in a list of
   * children and not worth an exception.
   */
  const rows: DisclosureProps[] = [];
  const rest: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement<DisclosureProps>(child) && child.type === Disclosure) {
      rows.push(child.props);
    } else if (child !== null && child !== undefined) {
      // `Children.toArray` already drops `null`, `undefined` and booleans, so this
      // is belt and braces rather than the filter doing real work.
      rest.push(child);
    }
  }

  const open = rows.find((row) => row.id === openKey) ?? null;

  return (
    <DisclosureGroupContext.Provider value={{ openKey, setOpenKey }}>
      <div className="disclosures">
        <div className="disclosures__list">
          {rows.map((row) => {
            const isOpen = row.id === openKey;
            return (
              <h3 className="disclosure__heading" key={row.id}>
                <button
                  type="button"
                  className={`disclosure__toggle${isOpen ? ' is-open' : ''}`}
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  // Pressing the open row closes it, which is how somebody gets
                  // back to a plain list of what is on the page.
                  onClick={() => setOpenKey(isOpen ? null : row.id)}
                >
                  <span className="disclosure__label">{row.label}</span>
                  {row.value !== undefined && (
                    <span className="disclosure__value">{row.value}</span>
                  )}
                  <span className="disclosure__chevron" aria-hidden="true" />
                </button>
              </h3>
            );
          })}

          {rest.length > 0 && <div className="disclosures__extra">{rest}</div>}
        </div>

        {/*
          The detail pane. Always present so the panel does not change width when
          a row opens — an empty one says what to do instead, which is the only
          place the panel can answer "how do I edit anything" for somebody who has
          just pressed Edit and been given a list.
        */}
        <div className="disclosures__body" id={bodyId}>
          {open ? (
            <>
              {open.hint && <p className="inspector__note">{open.hint}</p>}
              {open.children}
            </>
          ) : (
            <div className="disclosures__idle">
              <p>Pick something on the left, or work straight on the page:</p>
              <ul>
                <li>
                  <strong>Add pictures</strong> under a block to choose exactly what
                  it shows, from any part of this ministry.
                </li>
                <li>
                  <strong>Press the <span aria-hidden="true">×</span></strong> on any
                  picture to take it out of that block. Nothing is deleted.
                </li>
                <li>
                  <strong>Drag a block</strong> by the grip in its corner to move it
                  up or down, and <strong>press a shape</strong> there to make it a
                  grid, a sideways wheel or an upright one.
                </li>
                <li>
                  <strong>Drag a photograph</strong> to move it — anywhere on a grid,
                  or into a new position in a wheel.
                </li>
                <li>
                  <strong>Click a photograph</strong> to change its caption or its
                  crop.
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </DisclosureGroupContext.Provider>
  );
}

/**
 * "I am finished with this row" — for a control inside one that has its own Done.
 *
 * The pickers and the block designer each carry a Done button, from when they
 * expanded inline on the page and needed dismissing. Inside a disclosure that
 * button pointed at `edit.select({ kind: 'page' })`, which on a page that is
 * *already* the selection does nothing at all — a control that looks like it
 * closes something and does not.
 *
 * Rather than delete it: it closes the row. Falls back to a no-op outside a
 * group, where there is nothing to close.
 */
export function useDisclosureClose(): () => void {
  const group = useContext(DisclosureGroupContext);
  return useCallback(() => group?.setOpenKey(null), [group]);
}
