'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { GALLERY_COLLAPSE_BELOW, packBlocks, type BlockSpot } from '@spsm/shared';

/**
 * Where one block goes, and how tall a band of rows it was given.
 *
 * The height comes back out because the caller has to write it into the style: an
 * item in a grid of fixed row units that does not say how many it spans gets one,
 * and a block eight hundred pixels tall would hang out of an eight-pixel row.
 */
export type BlockPlacement = BlockSpot & { rows: number };

/**
 * How tall one row of the packed grid is.
 *
 * The quantisation of the whole layout: a block's height is rounded up to a whole
 * number of these, so this is the most paper that can be left under one. Half a
 * rem — eight pixels at the ordinary type size — is fine enough not to be seen and
 * coarse enough that a page of four blocks is a few hundred rows rather than a few
 * thousand.
 *
 * In rem rather than pixels so it follows a reader who has set a larger type size,
 * along with everything else on the page that is measured against it.
 */
const ROW_UNIT_REM = 0.5;

/**
 * `useLayoutEffect`, except on the server, where it is `useEffect`.
 *
 * React warns about `useLayoutEffect` during server rendering, and rightly: there
 * is no layout to read there. Every page here is statically exported, so without
 * this the warning would print on every build.
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Where every block on a page goes, measured from what is actually on screen.
 *
 * ## Why this needs the browser at all
 *
 * `packBlocks` is pure and shared, and it wants each block's height in row units.
 * A photograph's height comes from its proportions, which are on the document — a
 * block's comes from what is inside it: how many rows its pictures pack into,
 * whether it has a heading, whether the editing bar is showing. Only layout knows.
 * So this measures, quantises, and hands the numbers to the packer.
 *
 * ## The heights are stable, which is what makes this safe
 *
 * A measure-then-place loop is only sound if placing does not change what was
 * measured. Two things make that true here, and both are load-bearing:
 *
 *  - **A block's width comes from its column span, which the packer does not
 *    change.** It decides *where* the four columns are, not how many.
 *  - **`align-items: start`**, so a block is its own height inside whatever row
 *    band it is given, rather than stretching to fill it.
 *
 * And the heights do not move as the page loads, which is why there is no visible
 * settling: the photograph canvas has fixed row heights and the wheels' tiles carry
 * their aspect ratio, so a block is as tall before its images arrive as after.
 *
 * ## Below the collapse it does nothing
 *
 * Under `GALLERY_COLLAPSE_BELOW` every block is full width — a third of a phone is
 * narrower than one legible photograph — so there is one column, nothing to pack,
 * and this returns null and lets the stylesheet stack them.
 *
 * @param container the element the blocks are children of.
 * @param columns   how many of the twelve each child takes, in DOM order. Its
 *                  length is what says how many children there are; a change to it
 *                  is what re-runs the measurement.
 * @returns one spot per child, or null while there is nothing to place — before
 *   the first measurement, and on a phone. The caller must draw the unpacked
 *   layout for null, and must not switch the container to fixed row units until it
 *   has spots for every child.
 */
export function useBlockPacking(
  container: React.RefObject<HTMLElement | null>,
  columns: readonly number[],
): BlockPlacement[] | null {
  const [spots, setSpots] = useState<BlockPlacement[] | null>(null);

  /*
   * The widths as a string, so the effect below depends on their *values* rather
   * than on the identity of an array the render rebuilds every time.
   */
  const shape = columns.join(',');

  const measure = useCallback(() => {
    const node = container.current;
    if (!node) return;

    /*
     * The same query the stylesheet asks, and asked the same way.
     *
     * Not `window.innerWidth`: it counts the scrollbar, and under device emulation
     * it reports the window rather than the layout viewport — 736 on a phone the
     * page is laying out at 375, which is how this first shipped with a packed
     * twelve-column arrangement crushed into a phone. `matchMedia` is what
     * `GalleryGrid` uses for the same decision, and it cannot disagree with the
     * media query it is a copy of.
     */
    if (window.matchMedia(`(max-width: ${GALLERY_COLLAPSE_BELOW - 1}px)`).matches) {
      setSpots((was) => (was === null ? was : null));
      return;
    }

    const children = [...node.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const widths = shape === '' ? [] : shape.split(',').map(Number);
    if (children.length === 0 || children.length !== widths.length) {
      setSpots((was) => (was === null ? was : null));
      return;
    }

    /*
     * The row unit, in pixels, and then handed *to* the stylesheet.
     *
     * This way round because of what a custom property gives back: `getComputedStyle`
     * returns `--blocks-row` as the token it was written as — `0.5rem`, which
     * `parseFloat` reads as **0.5** — so a stylesheet-owned unit means a page laid
     * out in half-pixel rows and a grid twenty times too tall. Reading
     * `grid-auto-rows` instead would give real pixels but only *after* it has been
     * set, which is after the first measurement.
     *
     * So the number lives here, in rem so it follows the reader's own type size,
     * and is written onto the element for `.blocks--packed` to use.
     */
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const unit = ROW_UNIT_REM * rem;
    node.style.setProperty('--blocks-row', `${unit}px`);

    /*
     * The space between blocks is the stylesheet's, and it *is* readable: a margin
     * is a standard property, so the browser hands back pixels. It sits on the
     * blocks rather than in `row-gap` for the reason `.blocks` gives — a row gap
     * would repeat between every one of a tall block's hundreds of rows.
     */
    const gap =
      parseFloat(getComputedStyle(children[0] as HTMLElement).marginBottom) || 0;

    const boxes = children.map((child, at) => ({
      columns: widths[at] as number,
      /*
       * The gap is inside the span rather than in `row-gap`, and that is what
       * keeps a block from reserving space it does not need. A `row-gap` applies
       * between *every* implicit row, so a two-hundred-unit block would carry a
       * hundred and ninety-nine of them; rolled into the height instead, the
       * error is at most one unit — four pixels of paper under a block, rather
       * than a whole row of it.
       */
      rows: Math.max(1, Math.ceil((child.getBoundingClientRect().height + gap) / unit)),
    }));

    const next: BlockPlacement[] = packBlocks(boxes).map((spot, at) => ({
      ...spot,
      rows: boxes[at]?.rows ?? 1,
    }));

    /*
     * Only when something actually moved. `setState` with a fresh array of equal
     * values would re-render, and a re-render that can trigger another measurement
     * is how a layout hook turns into a loop.
     */
    setSpots((was) =>
      was !== null &&
      was.length === next.length &&
      was.every(
        (one, at) =>
          one.col === next[at]?.col &&
          one.row === next[at]?.row &&
          one.rows === next[at]?.rows,
      )
        ? was
        : next,
    );
  }, [container, shape]);

  /*
   * `useLayoutEffect` in the browser: this runs between React's commit and the
   * paint, so the first frame anybody sees is already packed rather than flowing
   * and then jumping. On the server there is no layout to read, and calling the
   * layout variant there is a warning with no upside — the static shell renders
   * the unpacked page, which is what a reader without JavaScript keeps.
   *
   * **No dependency array, so every render re-measures.** It was `[measure]`, which
   * meant only a change of `shape` — and the render that matters most changes no
   * dep at all: leaving edit mode narrows nothing and renames nothing, it just
   * un-mounts every block's editing furniture and hands the page 22rem back. Left to
   * the `ResizeObserver` alone that recovery depends on a callback this project's
   * preview pane never delivers at all and a real browser delivers only once the
   * heights have settled, so the honest fix is to measure on the render that caused
   * the change rather than to wait to be told about it.
   *
   * It cannot loop: `measure` only calls `setSpots` when a column, row or span has
   * actually moved, so the re-render it triggers measures once more, finds nothing
   * and stops. Two passes, not a cycle.
   */
  useIsomorphicLayoutEffect(() => {
    measure();
  });

  /*
   * Every child, not just the container. A block gets taller when its editing bar
   * appears, when a picker opens under it, when somebody drags its width — none of
   * which changes the container's own size, so watching only the container would
   * leave the page packed for a layout it no longer has.
   *
   * ## No dependency array, and that is the fix rather than laziness
   *
   * This was `[container, measure]`, and `measure` only changes when `shape` does —
   * so neither dep moved when **edit mode was toggled**. Which matters because
   * toggling it replaces every child: `BlockFrame` mounts a bar, a handle and a
   * wrapper around each block, so the elements observed a moment ago are detached
   * and a detached element reports no resizes. The observer went on watching the old
   * ones, the container was the only live thing left in it, and every later height
   * change — a lazy photograph landing, a wheel finishing its own measurement, a
   * font settling — arrived at nothing.
   *
   * The result is the symptom Tommy reported after pressing Done: *"its shifted too
   * much and not refilling the space"*. Not a width problem — the widths were always
   * restored — but the **row spans**, which are computed from each block's measured
   * height. Left at the heights the blocks had while the page was 22rem narrower,
   * every block reserves far more rows than it needs, so the grid is offset and full
   * of paper. It is invisible in this project's preview pane for the exact reason it
   * is hard to catch anywhere: there, nothing reflows after the first measurement, so
   * the container's own resize is enough and the page packs correctly.
   *
   * Re-running per render is what keeps the observed set equal to the children that
   * actually exist. It costs one `ResizeObserver` and a handful of `observe` calls
   * per render on a page that renders when somebody clicks, and `measure` already
   * bails when nothing moved — so a redundant callback costs nothing either.
   */
  useEffect(() => {
    const node = container.current;
    if (!node || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  });

  /*
   * And the window itself, which is belt and braces on purpose.
   *
   * A `ResizeObserver` is delivered as part of the rendering loop, so a window that
   * is not painting does not deliver one — which is exactly the case that matters
   * here, because the width crossing 700px is the difference between a packed page
   * and a stacked one. A `resize` listener is not on that clock. On the ordinary
   * path both fire and the second one finds nothing to do; `measure` keeps the
   * previous answer when it has not changed, so a duplicate costs nothing.
   */
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return spots;
}
