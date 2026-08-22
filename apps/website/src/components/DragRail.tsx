'use client';

import type { ReactNode } from 'react';
import { useDragRail } from './useDragRail';

/**
 * A sideways strip with no scrollbar, that drifts on its own and is pulled by
 * hand. The site's one implementation of the pattern — the ministries on
 * `/events`, the shelf on the homepage, the clergy, the shop's browse strips.
 *
 * Usage: give it the row itself as a single child.
 *
 * ```tsx
 * <DragRail className="rail--programs">
 *   <ul className="program-rail">…</ul>
 * </DragRail>
 * ```
 *
 * ## What a caller has to know
 *
 * **The child is rendered more than once.** That is what makes the loop
 * seamless. The copies after the first are `aria-hidden`, and everything
 * focusable inside them is taken out of the tab order by `useDragRail` — so a
 * screen reader reads the set once and Tab visits each link once, while a
 * *click* on any tile on screen works exactly as it looks like it should.
 *
 * The copies used to be `inert` instead, which was a bug and a bad one: `inert`
 * kills pointer events too, so roughly half the tiles a reader could see did
 * nothing when pressed and showed an Edit button that could not be clicked.
 * Nothing needed that protection — every handler in these rows is keyed by item
 * id or index, which is identical in every copy, so a duplicate behaves the same
 * as the original in every case that matters. It navigates to the same page, it
 * opens the same editor, it reorders to the same position.
 *
 * Anything with an `id` inside will produce duplicate ids; none of these rows
 * carry one. And the child must be cheap enough to render two or three times,
 * which for a row of tiles it is.
 *
 * **The child must carry its own trailing gap.** One copy's width is what the
 * loop subtracts, so the space between the last tile of one copy and the first
 * tile of the next has to be *inside* the measured copy: `padding-right` equal
 * to the row's `gap`. Without it every tile is spaced correctly except the pair
 * at the seam, which is the kind of fault that gets lived with rather than
 * noticed.
 *
 * **The child must not scroll.** This element is the scroll container; a nested
 * `overflow-x` inside it produces two of them.
 *
 * ## No pause control
 *
 * There was one — a small button in the corner, which is what WCAG 2.2.2 asks
 * for on anything that moves for more than five seconds — and it came off at
 * Tommy's direction. What is left in its place: a machine set to reduce motion
 * gets no drift at all, and touching the rail in any way stops it for as long as
 * a hand is on it. Neither is the same as a control that stops it for good, so
 * this is a known gap rather than a solved problem.
 *
 * See `useDragRail` for the motion, and `.rail` in globals.css for the layout.
 */
export function DragRail({
  children,
  className,
  frozen = false,
  speed,
  drift = true,
  loop = false,
  axis = 'x',
  reverse = false,
}: {
  children: ReactNode;
  /** Modifier(s) on the wrapper — `rail--programs`, `rail--bleed`, and so on. */
  className?: string;
  /** Stop the drift for as long as something else owns the page. */
  frozen?: boolean;
  speed?: number;
  /** False for a strip that should drag but never move by itself. */
  drift?: boolean;
  /**
   * True for a rail whose turning is the point, so a set too short to overflow
   * repeats itself rather than sitting still. See `useDragRail`'s `loop`.
   */
  loop?: boolean;
  /**
   * `'y'` for a tall frame with a column drifting upward inside it. The frame's
   * height comes from CSS — give the wrapper a class that sets it — because a
   * vertical rail with no height is a rail with nothing to scroll.
   *
   * A vertical rail claims neither the wheel nor touch; see `useDragRail`.
   */
  axis?: 'x' | 'y';
  /** Run the drift the other way along the axis. See `useDragRail`. */
  reverse?: boolean;
}) {
  const rail = useDragRail({
    frozen,
    ...(speed === undefined ? {} : { speed }),
    drift,
    loop,
    axis,
    reverse,
  });

  return (
    <div className={`rail-wrap${className ? ` ${className}` : ''}`}>
      <div
        ref={rail.ref}
        className={
          'rail' +
          (axis === 'y' ? ' rail--y' : '') +
          (rail.overflowing ? ' rail--grabbable' : '') +
          (rail.dragging ? ' is-dragging' : '') +
          // Only a looping rail gets its ends faded: on a set that fits, faded
          // ends are not "there is more this way", they are low contrast.
          (rail.copies > 1 ? ' rail--endless' : '')
        }
      >
        <div className="rail__track" ref={rail.trackRef}>
          {Array.from({ length: rail.copies }, (_, copy) => (
            <div key={copy} className="rail__copy" aria-hidden={copy > 0 || undefined}>
              {children}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
