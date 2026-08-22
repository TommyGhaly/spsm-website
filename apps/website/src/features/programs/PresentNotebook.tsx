'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocOf, GalleryMedia } from '@spsm/shared';
import { DragRail } from '@/components/DragRail';
import { PresentMedia, useReducedMotion } from './PresentParts';

/**
 * The notebook: a page of overlapping photographs sliding leftward, with
 * vertical wheels turning inside it.
 *
 * Tommy's description is the specification, so it is quoted rather than
 * paraphrased: *"an actual collage that slides left with overlapping pictures
 * with vertical scroll wheels that slide with the rest of the pictures just as
 * if I am reading someone's notebook"* — and then, on seeing the first version:
 * *"I just want it to be more full, I don't want it to be a single line of
 * pictures to follow, I want it to really take up the screen."*
 *
 * Both sentences are requirements, and the second is the harder of the two. See
 * "Why a pile is a region" for what changed and why the obvious version got it
 * wrong.
 *
 * Two motions at once, which is the idea:
 *
 * - **The page** drifts left, endlessly. That is a `DragRail axis="x"` — the same
 *   rail as every strip on the site, so the loop, the sub-pixel accumulation, the
 *   tab-away clamp, the drag and the reduced-motion opt-out are the ones already
 *   in use rather than a second implementation of each.
 * - **The wheels** are columns of photographs inside that page, turning
 *   vertically as they travel. They are *not* nested rails; see below.
 *
 * ## Why a pile is a region, not a row
 *
 * The first version laid each pile out with flexbox: two or three prints in a
 * row, cascading down and to the right by a fixed drop. It read as *one line of
 * photographs crossing the screen* — which is exactly what it was, and it left
 * the corners of the wall bare at every scroll position. Flexbox was the wrong
 * tool and not by a little: a row places things along one axis, and a notebook
 * page is a two-dimensional arrangement.
 *
 * So a pile is now a **full-height region with its prints placed absolutely** —
 * `top` down the screen, `left` across the region, each print's width coming
 * from its own aspect ratio. Every pile covers the top, the middle and the
 * bottom of the wall, so wherever the page has drifted to there are photographs
 * at every height. Prints deliberately overflow their region's right edge and are
 * laid over by the next cluster, which is what makes the page read as one
 * arrangement rather than as a series of panels.
 *
 * A region's width is in `vw` rather than measured from its contents, which is
 * what makes the layout deterministic: the page's total width no longer depends
 * on which photographs happen to be portrait, so the rail's loop measures the
 * same number before and after the images arrive.
 *
 * ## Why the wheels are not `DragRail axis="y"` (the columns are, and cannot be
 * here)
 *
 * A horizontal rail renders its children **more than once** — that is what makes
 * the loop seamless: when the first copy has travelled out of view the second is
 * pixel-for-pixel where the first started, so subtracting one copy's width is
 * invisible. *Pixel-for-pixel* is a load-bearing claim. Put an independently
 * scrolling rail inside the copies and it stops being true: each copy's wheel
 * would be at its own scroll offset, and every wrap — one every few minutes —
 * would jerk every wheel on screen to a different photograph. It would look
 * exactly like a bug, because it would be one.
 *
 * So the wheels are driven from **one clock, shared by every copy**. A wheel's
 * offset is a pure function of (distance travelled × its speed) folded into its
 * measured height, and every copy of wheel *k* has the same speed and — being
 * the same markup — the same height. All copies therefore hold the identical
 * transform on every frame, and the seam stays invisible. Nothing is
 * synchronised, because nothing has separate state to synchronise.
 *
 * That also answers the gesture question `DragRail axis="y"` has to worry about:
 * these wheels take no input at all. The page takes the drag, the wheels are
 * scenery on it, and there is no axis conflict to resolve.
 *
 * ## Why the arrangement is a fixed table
 *
 * `ARRANGEMENT` is a hand-written cycle of piles and wheels, not a randomiser.
 * Randomness is the obvious way to make a scrapbook look unplanned and it is
 * wrong twice here: a random layout differs between the copies (the seam again),
 * and it re-rolls on every resize, so plugging in a projector would deal the
 * whole wall again. A cycle of seven compositions over material that is itself
 * varied reads as unplanned, and is identical every time it is drawn.
 */

/**
 * How fast the page travels at `steady`, px/s.
 *
 * A little under the columns' 34, because this is the one style where a
 * photograph has to be *read across* — it arrives from the side rather than
 * rising into place, and anything faster than a slow walk turns a scrapbook into
 * a conveyor. 30px/s crosses a 1440px screen in about three quarters of a
 * minute. The pace control multiplies it; see `PACE_FACTORS` in route.ts.
 */
const PLANE_SPEED = 30;

/** One photograph on the page, placed rather than flowed. */
interface Print {
  /** Down the screen, in vh. */
  top: number;
  /** Across the region, as a percentage of its width. */
  left: number;
  /** In vh. The width follows from the photograph's own aspect ratio. */
  height: number;
  /** Degrees. Nothing here exceeds 2.4; see `ARRANGEMENT`. */
  tilt: number;
}

/** One cluster of the page: a region of placed prints, or a turning column. */
type Cluster =
  /** A full-height region, its prints placed across and down it. */
  | { kind: 'pile'; width: number; prints: readonly Print[] }
  /** A column of photographs, full height, turning as it travels. */
  | { kind: 'wheel'; take: number; speed: number };

/**
 * The cycle the page is built from, repeated until the photographs run out.
 *
 * A pile's `width` is in vw and its `prints` are the slots it fills, in order —
 * so `prints.length` is how many photographs it consumes. A wheel's `take` is
 * the same thing for a column. Wheel speeds alternate in sign for the same
 * reason the columns' do: two neighbouring columns moving the same way read as
 * one sheet sliding.
 *
 * The four piles are four *compositions* rather than four sets of numbers — each
 * covers the top, the middle and the bottom of the wall, and each leans a
 * different way. Seven clusters because the cycle should be longer than what fits
 * on screen: at three, somebody looking at the right-hand edge can see the
 * arrangement about to arrive, and the page reads as wallpaper.
 *
 * No tilt exceeds 2.4°. Past about that it stops looking like a photograph put
 * down by hand and starts looking like a broken transform.
 */
const ARRANGEMENT: readonly Cluster[] = [
  {
    kind: 'pile',
    width: 44,
    prints: [
      { top: 1, left: 0, height: 40, tilt: -2 },
      { top: 33, left: 30, height: 36, tilt: 1.6 },
      { top: 60, left: 2, height: 38, tilt: -1.2 },
      { top: 8, left: 60, height: 28, tilt: 2.3 },
    ],
  },
  { kind: 'wheel', take: 5, speed: 22 },
  {
    kind: 'pile',
    width: 38,
    prints: [
      { top: 3, left: 6, height: 46, tilt: 1.3 },
      { top: 44, left: 0, height: 30, tilt: -2.2 },
      { top: 66, left: 26, height: 32, tilt: 1 },
    ],
  },
  { kind: 'wheel', take: 6, speed: -18 },
  {
    kind: 'pile',
    width: 42,
    prints: [
      { top: 0, left: 22, height: 32, tilt: -1.5 },
      { top: 28, left: 0, height: 34, tilt: 2 },
      { top: 58, left: 18, height: 40, tilt: -1 },
      { top: 6, left: 64, height: 30, tilt: 1.4 },
    ],
  },
  {
    kind: 'pile',
    width: 34,
    prints: [
      { top: 2, left: 0, height: 34, tilt: 2.4 },
      { top: 30, left: 18, height: 38, tilt: -1.4 },
      { top: 64, left: 0, height: 34, tilt: 1.8 },
    ],
  },
  { kind: 'wheel', take: 4, speed: 26 },
];

/** How many photographs a cluster consumes. */
function takeOf(cluster: Cluster): number {
  return cluster.kind === 'pile' ? cluster.prints.length : cluster.take;
}

/* ---------------------------------------------------------------------------
 * The shared clock
 *
 * One `requestAnimationFrame` loop for every wheel on the page, at module scope,
 * because every copy of a wheel must be given the *same* number on the same
 * frame — see the note at the top of the file. It runs only while somebody is
 * subscribed, so it stops dead when the presentation closes.
 * ------------------------------------------------------------------------ */

/**
 * Distance travelled, in seconds-at-the-current-pace.
 *
 * **Accumulated rather than read off the wall clock, and that is what makes the
 * pace control usable.** Were a wheel's offset `elapsed × speed`, changing the
 * speed would change where the wheel *has already got to* — every wheel on the
 * wall would jump the moment somebody pressed "faster". Scaling the clock instead
 * of the speed keeps the position continuous: only its rate of change moves.
 */
let travel = 0;
/** The pace multiplier, written by the component that is drawing. */
let rate = 1;
let frame = 0;
let previous = 0;
const drifters = new Set<(distance: number) => void>();

function step(now: number) {
  frame = requestAnimationFrame(step);
  /*
   * Clamped, exactly as `useDragRail` clamps its own: `requestAnimationFrame`
   * does not fire while a tab is hidden, so the first callback after coming back
   * carries the whole absence in it. Ten minutes away would advance every wheel
   * by thousands of pixels in one frame, which is a wall of photographs jumping
   * at once. 50ms is about three frames; anything longer was time the page was
   * not being drawn, and the right answer is to carry on rather than to catch up.
   */
  travel += Math.min((now - previous) / 1000, 0.05) * rate;
  previous = now;
  drifters.forEach((drift) => drift(travel));
}

/** Register a wheel. Returns its unsubscribe, which stops the clock if last. */
function joinClock(drift: (distance: number) => void): () => void {
  drifters.add(drift);
  if (frame === 0) {
    previous = performance.now();
    frame = requestAnimationFrame(step);
  }
  return () => {
    drifters.delete(drift);
    if (drifters.size === 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/* ------------------------------------------------------------------------- */

export function PresentNotebook({
  media,
  factor,
}: {
  media: readonly DocOf<GalleryMedia>[];
  /** The pace, as a multiplier. See `PACE_FACTORS` in route.ts. */
  factor: number;
}) {
  /* The wheels read the pace off the shared clock rather than each holding it,
     so that one press changes every wheel on the wall on the same frame. */
  useEffect(() => {
    rate = factor;
    return () => {
      rate = 1;
    };
  }, [factor]);

  /**
   * The photographs, dealt into the arrangement in order.
   *
   * In order, not shuffled: a gallery is chronological, so consecutive frames
   * are views of one moment — which is what a page of somebody's notebook
   * actually looks like. Dealing round-robin (what the columns do, and for a good
   * reason there) would put four unrelated afternoons in every region.
   *
   * A cluster short of material at the end keeps what it got; a cluster that got
   * nothing is dropped. That is the small-gallery case — nine photographs make
   * one region and a wheel rather than a seventh of a page.
   */
  const clusters = useMemo(() => {
    const built: { cluster: Cluster; items: DocOf<GalleryMedia>[] }[] = [];
    let at = 0;
    let turn = 0;
    while (at < media.length) {
      const cluster = ARRANGEMENT[turn % ARRANGEMENT.length];
      turn += 1;
      if (!cluster) break;
      const items = media.slice(at, at + takeOf(cluster));
      at += takeOf(cluster);
      if (items.length > 0) built.push({ cluster, items });
    }
    return built;
  }, [media]);

  return (
    <DragRail
      className="rail--notebook"
      speed={PLANE_SPEED * factor}
      /*
        `loop` so a short gallery still travels. Without it a page narrower than
        the screen sits perfectly still, which reads as the presentation having
        failed to start rather than as there being eleven photographs.
      */
      loop
    >
      <div className="notebook__plane">
        {clusters.map(({ cluster, items }, index) =>
          cluster.kind === 'wheel' ? (
            <Wheel
              // The position in the cycle is the identity. Two wheels with the
              // same photographs at different points on the page are different
              // wheels, and a remount is what re-measures after a resize.
              key={`wheel-${index}`}
              items={items}
              speed={cluster.speed}
            />
          ) : (
            <div
              key={`pile-${index}`}
              className="notebook__pile"
              style={{ width: `${cluster.width}vw` }}
            >
              {items.map((item, place) => {
                const print = cluster.prints[place];
                if (!print) return null;
                return (
                  <figure
                    key={item.id}
                    className="notebook__print"
                    /*
                      The composition sets where it goes and how tall it is. The
                      *width* is the photograph's own — `.notebook__print` is
                      `width: max-content` and the picture inside carries the
                      ratio, so a panorama is wide and a portrait is narrow and
                      neither is cropped. See `PresentMedia`.
                    */
                    style={{
                      top: `${print.top}vh`,
                      left: `${print.left}%`,
                      height: `${print.height}vh`,
                      transform: `rotate(${print.tilt}deg)`,
                    }}
                  >
                    <PresentMedia item={item} fit="height" />
                  </figure>
                );
              })}
            </div>
          ),
        )}
      </div>
    </DragRail>
  );
}

/**
 * One vertical wheel: a column of photographs turning inside a fixed frame,
 * while the frame itself travels with the page.
 *
 * The reel is drawn enough times to cover the frame from any offset, and the
 * offset is folded back into one reel's height — the same arithmetic as the
 * rails, done here because the *input* is a shared clock rather than this
 * component's own state. See the note at the top of the file for why that
 * distinction is the whole reason this is not a `DragRail`.
 */
function Wheel({ items, speed }: { items: readonly DocOf<GalleryMedia>[]; speed: number }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** One reel's height, including its trailing gap. 0 until measured. */
  const unit = useRef(0);
  const [copies, setCopies] = useState(2);
  const reduced = useReducedMotion();

  /*
   * How tall one reel is, and how many it takes to cover the frame.
   *
   * Re-measured on a resize of either — and the second one is the case that
   * matters: these are photographs, a photograph's box is `aspect-ratio` until
   * its bytes arrive, and a reel that was 800px tall at first paint is 1400px
   * tall a moment later. Measuring once at mount is how a wheel ends up wrapping
   * a third of the way through itself.
   */
  useEffect(() => {
    const box = frameRef.current;
    const track = trackRef.current;
    if (!box || !track) return;

    const measure = () => {
      const first = track.firstElementChild as HTMLElement | null;
      if (!first) return;
      const height = first.getBoundingClientRect().height;
      unit.current = height;
      // One spare beyond what covers the frame, so the seam is always off
      // screen. `height > 0` because repeating a reel that has not been laid out
      // yet is an infinity of nothing.
      setCopies(height > 0 ? Math.max(2, Math.ceil(box.clientHeight / height) + 1) : 2);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const first = track.firstElementChild;
    if (first) observer.observe(first);
    return () => observer.disconnect();
  }, []);

  /*
   * The turning.
   *
   * A transform written straight to the node, not React state: this is sixty
   * updates a second, and a re-render of a column of photographs at that rate is
   * the one thing that would make the page stutter. Nothing else reads the
   * offset, so nothing needs it in state.
   *
   * A machine that asked for less movement gets a still wheel — the photographs
   * are all still there, the column simply does not turn. `DragRail` makes the
   * same call for the page itself, so under that setting the whole notebook is a
   * scrapbook that can be dragged by hand.
   */
  useEffect(() => {
    if (reduced) return;
    return joinClock((distance) => {
      const track = trackRef.current;
      const height = unit.current;
      if (!track || height <= 0) return;
      // Folded into `[0, height)`, so a negative speed turns the wheel the other
      // way rather than running it off the end.
      const travelled = (((distance * speed) % height) + height) % height;
      track.style.transform = `translate3d(0, ${-travelled}px, 0)`;
    });
  }, [speed, reduced]);

  /*
   * A degree of tilt, against the way it turns.
   *
   * Derived from the speed rather than stored in `ARRANGEMENT`, because the two
   * would then be two things to keep in step for no gain: what the tilt is for
   * is stopping a column of photographs from reading as a straight ruled edge
   * down the wall, and either sign does that. The frame is taller than the
   * screen so the tilted top and bottom edges fall off it — see
   * `.notebook__wheel`.
   */
  const tilt = speed > 0 ? -1.2 : 1.2;

  return (
    <div className="notebook__wheel" ref={frameRef} style={{ transform: `rotate(${tilt}deg)` }}>
      <div className="notebook__reels" ref={trackRef}>
        {Array.from({ length: copies }, (_, copy) => (
          <ul className="notebook__reel" key={copy} aria-hidden={copy > 0 || undefined}>
            {/* Fixed width, natural height — the same arrangement as a column. */}
            {items.map((item) => (
              <li key={item.id}>
                <PresentMedia item={item} fit="width" />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
