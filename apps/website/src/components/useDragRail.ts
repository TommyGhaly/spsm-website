'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * One rail that drifts on its own and is pulled by hand. Shared by every
 * sideways strip on the site — see `DragRail` for the markup that goes with it.
 *
 * ## Why this drives `scrollLeft` rather than a CSS animation
 *
 * The obvious implementation is `@keyframes` translating a track by -50%, and it
 * was the first one here. It cannot satisfy "until it is pulled": a CSS
 * transform and the reader's own offset are two independent quantities, so the
 * moment somebody drags the rail the animation keeps running underneath them and
 * the two fight. Stopping the animation then snaps the content back to wherever
 * the transform had got to, throwing away the position the reader just chose.
 *
 * Driving `scrollLeft` makes the automatic and the manual the *same* quantity.
 * Pausing is then simply ceasing to add to it, and resuming carries on from
 * wherever the hand left off. There is one position in this system, which is
 * why the drift, a drag, a flick, a trackpad swipe and a Tab keypress can all be
 * mixed in one gesture without any of them contradicting another.
 *
 * ## Why the scroll container has `overflow: hidden`
 *
 * Because the parish asked for the scrollbar gone, and because a *hidden*
 * scrollbar and no scrollbar are different things. `scrollbar-width: none` still
 * leaves the browser panning the container natively, which is momentum we do not
 * control and cannot wrap — so a touch flick would coast to the end of the
 * content and stop dead at the seam, in the one place the rail is supposed to be
 * endless. With the native pan switched off, every pixel of movement is ours:
 * mouse drag, touch drag, horizontal trackpad swipe and the drift are the same
 * code path, and all four loop.
 *
 * The cost is that horizontal panning has to be implemented rather than
 * inherited, which is most of the length of this file. `touch-action: pan-y`
 * (set in CSS) is what keeps the page itself scrollable through the rail: the
 * browser keeps the vertical axis and hands us the horizontal one.
 *
 * ## The loop
 *
 * Seamlessness needs the set rendered more than once: when the first copy has
 * travelled fully out of view the second is pixel-for-pixel where the first
 * started, so subtracting one copy's width is invisible. `copies` is measured
 * rather than fixed at two — two copies are only enough when one copy is at
 * least as wide as the viewport, which is true of the ministries and not true of
 * three clergy portraits on a wide screen.
 *
 * The duplicates are `aria-hidden` in `DragRail`, and everything focusable in
 * them is given `tabindex="-1"` here, so a screen reader reads the set once and
 * Tab visits each link once. They stay **clickable**: at most scroll positions
 * some of what a reader can see is a duplicate, and a tile that does nothing
 * when pressed is not a tile. A copy behaves identically to the original because
 * every handler in these rows is keyed by item id or index rather than by
 * position in the DOM.
 */

/**
 * Pixels per second of unattended drift.
 *
 * 26, then 60, now 75 — all three at Tommy's direction, and the direction of
 * travel is the useful part of that history. 26 was chosen so a ministry's name
 * could be read as it passed, which turned out to be the wrong thing to
 * optimise for: at that speed a 32rem tile takes twenty seconds to cross and the
 * rail reads as a page that has not finished loading rather than as something
 * going round. 75 crosses one in about seven seconds.
 *
 * Do not tune this by whether the labels are readable in a screenshot. It is
 * legible in motion, and the point of the movement is to say that the row
 * continues. A strip of smaller tiles can pass its own `speed`.
 */
const SPEED = 75;
/** ms of stillness after a hand leaves before the drift comes back. */
const RESUME_AFTER = 1600;
/** ms the drift takes to reach full speed from a standstill. */
const RAMP = 900;
/** px a press must travel before it counts as a drag rather than a click. */
const THRESHOLD = 6;
/** Velocity retained per 16ms after a throw. */
const FRICTION = 0.94;
/** px/s below which a coast is over. */
const STILL = 14;
/** px/s cap on a throw, so a violent flick does not teleport the rail. */
const MAX_FLING = 2800;

/**
 * The two axes, as a table of everything that differs between them.
 *
 * A table rather than an `if` at each of the dozen sites that touch a coordinate.
 * There were twelve of them — `scrollLeft`, `clientWidth`, `clientX`, `deltaX`,
 * two paddings, a rect dimension — and an `if (axis === 'x')` at each is twelve
 * chances to convert one of them and miss another, which produces a rail that
 * measures on one axis and scrolls on the other.
 */
const AXES = {
  x: {
    scroll: 'scrollLeft',
    view: 'clientWidth',
    padStart: 'paddingLeft',
    padEnd: 'paddingRight',
    extent: (rect: DOMRect) => rect.width,
    main: (event: { clientX: number; clientY: number }) => event.clientX,
    cross: (event: { clientX: number; clientY: number }) => event.clientY,
    mainDelta: (event: WheelEvent) => event.deltaX,
    crossDelta: (event: WheelEvent) => event.deltaY,
  },
  y: {
    scroll: 'scrollTop',
    view: 'clientHeight',
    padStart: 'paddingTop',
    padEnd: 'paddingBottom',
    extent: (rect: DOMRect) => rect.height,
    main: (event: { clientX: number; clientY: number }) => event.clientY,
    cross: (event: { clientX: number; clientY: number }) => event.clientX,
    mainDelta: (event: WheelEvent) => event.deltaY,
    crossDelta: (event: WheelEvent) => event.deltaX,
  },
} as const;

export interface DragRailOptions {
  /**
   * Stop the drift and leave it stopped. For the case where something else on
   * the page has taken over — an open editor, a dialog — and movement behind it
   * would be noise.
   */
  frozen?: boolean;
  /** Pixels per second. Defaults to `SPEED`; a strip of small tiles can go faster. */
  speed?: number;
  /** Set false for a strip that should be draggable but never drift by itself. */
  drift?: boolean;
  /**
   * Turn even when the set is too short to overflow, by repeating it.
   *
   * Off by default, because for most rails a set that already fits is a set with
   * nothing to say: fading its ends and sliding it along would be movement
   * announcing content that is entirely on screen.
   *
   * On for a rail whose *turning is the point* rather than an invitation to
   * scroll — the homepage shelf, where the books going round is what says the
   * parish has a bookstore. Without this, a shelf stops dead the moment the
   * window is wider than the catalog: eleven titles turn on a laptop and sit
   * still on a large monitor, which reads as the animation being broken rather
   * than as there being enough books to see.
   *
   * The mechanism is the one already here — enough copies to cover the viewport —
   * applied to a short set as well as a long one. So the row does genuinely
   * overflow once it is repeated, and every gesture, the wrap and the seam work
   * unchanged.
   */
  loop?: boolean;
  /**
   * Which way it moves. `'x'` is a sideways rail; `'y'` is a tall frame with a
   * column drifting upward inside it.
   *
   * ## A vertical rail deliberately does less
   *
   * On `'y'` the wheel and touch are **left entirely to the page**, and only a
   * mouse drag pulls the column. That is not an unfinished port; it is the only
   * arrangement that is usable.
   *
   * A vertical column is 60–80% of the viewport tall. If it claimed vertical
   * gestures the way the sideways rail claims horizontal ones, then a reader on a
   * phone who put a thumb anywhere on it — which is most of the screen — would
   * find the page itself had stopped scrolling. There is no threshold or
   * direction test that gets out of this, because on a vertical rail inside a
   * vertical page the gesture the reader means and the gesture the rail wants are
   * *the same gesture*. The horizontal rail has no such problem, which is why it
   * can take the axis it is on.
   *
   * So the column drifts, stops under a finger, and can be pulled with a mouse.
   * A touch reader gets the drift and the page keeps its scroll.
   */
  axis?: 'x' | 'y';
  /**
   * Run the drift backwards along the axis.
   *
   * The whole of the direction setting, and it is one sign. Increasing the scroll
   * offset carries the pictures *toward* the start of the axis — leftward on `'x'`,
   * upward on `'y'` — which is what both wheels have always done and what
   * `DEFAULT_SPIN` records. Negating it carries them the other way.
   *
   * Only the automatic drift is reversed. A hand still drags the strip whichever
   * way it is pulled, and the wrap is symmetric, so nothing else on either axis has
   * to know about this. See `spinFor` in the section schema for where the value
   * comes from.
   */
  reverse?: boolean;
}

export interface DragRail {
  /** The scroll container. */
  ref: React.RefObject<HTMLDivElement | null>;
  /** The flex track holding the copies. Measured, not scrolled. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /** How many times to render the children. 1 when the set already fits. */
  copies: number;
  /** True when the rail can move: one copy overruns the viewport, or `loop` is on. */
  overflowing: boolean;
  /** True while a hand is actually pulling it. Drives the cursor. */
  dragging: boolean;
}

export function useDragRail(options: DragRailOptions = {}): DragRail {
  const {
    frozen = false,
    speed = SPEED,
    drift = true,
    loop = false,
    axis = 'x',
    reverse = false,
  } = options;
  const a = AXES[axis];

  const ref = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const [copies, setCopies] = useState(1);
  const [overflowing, setOverflowing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [allowsMotion, setAllowsMotion] = useState(true);

  /**
   * The rail's position, in pixels, as a float.
   *
   * Not read back from `scrollLeft` each frame, and this is not tidiness. At
   * 75px/s a frame advances the rail by a pixel, and a browser that stores the
   * scroll offset as an integer rounds that to nothing — the rail would sit
   * perfectly still while this hook believed it was moving. Keeping the real
   * number here and writing it out means sub-pixel drift accumulates properly.
   *
   * It doubles as the record of what we last wrote, which is how a scroll this
   * hook did not cause gets noticed (see `onScroll`).
   */
  const pos = useRef(0);
  /** One copy's width. 0 until measured. */
  const unit = useRef(0);
  /** px/s of leftover motion from a throw. */
  const velocity = useRef(0);
  /** Ramp-in factor, 0 to 1, so the drift fades up rather than snapping on. */
  const ramp = useRef(0);
  /** `performance.now()` before which the drift stays away. */
  const resumeAt = useRef(0);
  /** A hand is on the rail: a pointer is down, or a native drag is in flight. */
  const held = useRef(false);
  const nativeDrag = useRef(false);
  /** Swallow the click that ends a drag. */
  const suppressClick = useRef(false);

  /*
   * The loop reads these rather than closing over them, so that pausing does not
   * tear down and rebuild the animation. Restarting the effect would reset the
   * frame clock, and a reset clock is a visible jump.
   */
  const driftAllowed = useRef(false);
  const looping = useRef(false);
  /*
   * Signed, so the ramp below needs no knowledge of the direction. Kept in the ref
   * rather than applied at the call site because the fling and the hand read the
   * same ref and must *not* be reversed — only the drift has a direction of its
   * own.
   */
  const speedRef = useRef(speed);
  speedRef.current = reverse ? -speed : speed;

  /*
   * There is no reader-facing pause. There was — a small button in the corner,
   * which is what WCAG 2.2.2 asks of anything that moves for more than five
   * seconds — and it came off at Tommy's direction. `prefers-reduced-motion` and
   * the pause-under-the-finger below are what remain; see `DragRail`.
   */
  driftAllowed.current = drift && allowsMotion && overflowing && !frozen;
  looping.current = overflowing && copies > 1;

  /** Fold a position back into the first copy. */
  const wrap = useCallback((x: number) => {
    const width = unit.current;
    if (!looping.current || width <= 0) return x;
    const v = x % width;
    return v < 0 ? v + width : v;
  }, []);

  /** Move the rail by `d` and write it out. The only place the scroll is set. */
  const slide = useCallback(
    (d: number) => {
      const el = ref.current;
      if (!el) return;
      pos.current = wrap(pos.current + d);
      el[a.scroll] = pos.current;
    },
    [wrap, a],
  );

  /* ---- what the reader has asked of the browser ------------------------- */

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setAllowsMotion(!query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  /* ---- measurement ------------------------------------------------------ */

  /*
   * How wide one copy is, how many copies it takes to cover the viewport, and
   * whether there is anything to scroll at all.
   *
   * Re-measured on a resize of *either* the container or the first copy. The
   * second is the one that matters in practice: these strips carry photographs,
   * a photograph arrives after first paint, and a strip that was 900px wide when
   * the page opened is 1400px wide a moment later. Measuring once at mount is
   * how you get a rail that wraps a third of the way through its content.
   */
  useEffect(() => {
    const el = ref.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const measure = () => {
      const first = track.firstElementChild as HTMLElement | null;
      if (!first) return;

      const style = getComputedStyle(el);
      const inset = parseFloat(style[a.padStart]) + parseFloat(style[a.padEnd]);
      const view = el[a.view] - (Number.isNaN(inset) ? 0 : inset);
      const width = a.extent(first.getBoundingClientRect());
      unit.current = width;

      // The `+ 1` is slack for sub-pixel layout: a strip that comes out
      // 900.3px wide in a 900px box is not something to start scrolling.
      const over = width > view + 1;
      /*
       * `loop` turns a set that fits into one that goes round anyway — see the
       * option. `width > 0` rather than plain `loop`, because a strip whose
       * images have not arrived yet measures zero, and repeating nothing forever
       * is an empty rail that has decided it is endless.
       */
      const turning = over || (loop && width > 0);
      setOverflowing(turning);
      /*
       * Enough copies that the viewport is covered from any position in
       * `[0, width)`. Two suffices when one copy is at least a viewport wide;
       * a short set needs more, and `Math.max(2, …)` keeps at least one spare
       * so the seam is always off-screen.
       *
       * This arithmetic is what makes `loop` cost nothing extra: a set half a
       * viewport wide gets three copies, the track then genuinely overruns the
       * box, and the wrap, the drag and the seam all work on the same numbers
       * they always did.
       */
      setCopies(turning ? Math.max(2, Math.ceil(view / Math.max(width, 1)) + 1) : 1);

      // A rail that has just stopped turning — a window widened, a filter
      // narrowing the set — has to come home, or it is left showing blank track.
      pos.current = turning ? wrap(pos.current) : 0;
      el[a.scroll] = pos.current;
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const first = track.firstElementChild;
    if (first) observer.observe(first);
    return () => observer.disconnect();
  }, [wrap, copies, a, loop]);

  /*
   * The duplicates come out of the tab order.
   *
   * Deliberately after every render and with no dependency array: the copies
   * change when the viewport does, and their contents change whenever the caller
   * re-renders — a ministry finishing its cover, a book leaving the basket. The
   * pass is a query over a few dozen nodes, which is cheaper than being wrong
   * about when it needs to run.
   *
   * `tabindex="-1"` rather than `inert`, which is what this was and which also
   * blocks pointer events — leaving half the tiles on screen unclickable. This
   * is the combination that means "not for the keyboard or a screen reader, but
   * still a control": the first copy carries the real tab stops, and a mouse or
   * a thumb can press whatever is in front of it.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    // `Array.from` rather than an index loop: `children[i]` is typed as possibly
    // undefined under `noUncheckedIndexedAccess`, and a non-null assertion here
    // would be a claim about a live DOM collection rather than about this code.
    Array.from(track.children)
      .slice(1)
      .forEach((copy) => {
        copy
          .querySelectorAll<HTMLElement>('a, button, input, select, textarea, [tabindex]')
          .forEach((el) => {
            el.tabIndex = -1;
          });
      });
  });

  /* ---- the drift -------------------------------------------------------- */

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      frame = requestAnimationFrame(step);

      /*
       * Clamped. `requestAnimationFrame` does not fire while a tab is hidden, so
       * the first callback after coming back carries the whole absence in it —
       * ten seconds away becomes a 260px jump in a single frame, which reads as
       * a glitch. 50ms is about three frames; anything longer was time the page
       * was not being drawn, and the right response is to carry on rather than
       * to catch up.
       */
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (held.current || nativeDrag.current) return;

      // Coasting from a throw. This runs even when the drift is switched off:
      // a flick has to be allowed to finish, or releasing feels like hitting a
      // wall.
      if (Math.abs(velocity.current) > STILL) {
        slide(velocity.current * dt);
        velocity.current *= Math.pow(FRICTION, dt / 0.016);
        if (Math.abs(velocity.current) <= STILL) {
          velocity.current = 0;
          resumeAt.current = now + RESUME_AFTER;
        }
        return;
      }
      velocity.current = 0;

      if (!driftAllowed.current || now < resumeAt.current) {
        ramp.current = 0;
        return;
      }

      // Eased in over RAMP, and eased with a curve rather than linearly: a rail
      // that begins moving at full speed the instant the delay expires is the
      // one thing that makes the resumption look mechanical.
      ramp.current = Math.min(1, ramp.current + (dt * 1000) / RAMP);
      const eased = ramp.current * ramp.current * (3 - 2 * ramp.current);
      slide(speedRef.current * eased * dt);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [slide]);

  /* ---- the hand --------------------------------------------------------- */

  useEffect(() => {
    const el = ref.current;
    if (!el || !overflowing) return;

    let id: number | null = null;
    /** Along the axis the rail moves on. */
    let startMain = 0;
    /** Across it — the axis the *page* moves on. */
    let startCross = 0;
    let lastMain = 0;
    let lastT = 0;
    let active = false;

    const stand = () => {
      held.current = false;
      resumeAt.current = performance.now() + RESUME_AFTER;
      ramp.current = 0;
    };

    const onDown = (event: PointerEvent) => {
      // Right-click and middle-click are not gestures. A secondary button that
      // grabbed the rail would mean the context menu opened over a moving one.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      id = event.pointerId;
      startMain = lastMain = a.main(event);
      startCross = a.cross(event);
      lastT = event.timeStamp;
      active = false;
      /*
       * Frozen on contact, before any threshold. Pressing a moving tile and
       * having it carry on sliding out from under the finger is the single
       * thing that makes one of these strips feel cheap; and because the drift
       * comes back on its own a moment later, stopping early costs nothing.
       * (The old rule was the opposite — a press had to be proven a drag first
       * — because back then a press stopped the rail permanently.)
       */
      held.current = true;
      velocity.current = 0;
      ramp.current = 0;
    };

    const onMove = (event: PointerEvent) => {
      if (id !== event.pointerId) return;

      if (!active) {
        /*
         * A vertical column never takes a touch. On the axis the page scrolls
         * on, the gesture the reader means and the gesture this wants are the
         * same one — see `axis` in the options — so a column that claimed it
         * would stop a phone scrolling past a frame filling most of the screen.
         * A mouse has a scrollbar and a wheel to fall back on; a thumb does not.
         */
        if (axis === 'y' && event.pointerType !== 'mouse') return;

        const along = a.main(event) - startMain;
        if (Math.abs(along) < THRESHOLD) return;
        // A gesture that is mostly across the rail belongs to the page. Only
        // relevant on touch, where the same pointer could have been meant for
        // either — and getting it wrong means a rail that eats attempts to
        // scroll the page.
        if (Math.abs(along) <= Math.abs(a.cross(event) - startCross)) return;
        active = true;
        setDragging(true);
        // Capture, so a drag that leaves the rail — or the window — keeps
        // being a drag rather than being abandoned mid-pull.
        el.setPointerCapture(event.pointerId);
      }

      const step = a.main(event) - lastMain;
      const dt = Math.max(event.timeStamp - lastT, 1) / 1000;
      lastMain = a.main(event);
      lastT = event.timeStamp;

      // Incremental, never `startScroll - totalDx`: an absolute anchor is wrong
      // the moment the position wraps mid-drag, and pulling the rail past the
      // seam is exactly what it is for.
      slide(-step);

      // Smoothed. A single 4ms sample of a trackpad is mostly noise, and noise
      // in the last sample before release is what turns a gentle let-go into a
      // fling in the wrong direction.
      velocity.current = 0.7 * velocity.current + 0.3 * (-step / dt);
    };

    const onUp = (event: PointerEvent) => {
      if (id !== event.pointerId) return;
      id = null;
      stand();

      if (!active) {
        // A press that never became a drag: leave the click alone. Somebody
        // tapping a tile is choosing it.
        velocity.current = 0;
        return;
      }
      active = false;
      setDragging(false);
      velocity.current = Math.max(-MAX_FLING, Math.min(MAX_FLING, velocity.current));

      /*
       * The click that follows this pointerup is not a choice, it is the end of
       * a pull — and every tile in these rails is a link. Without this,
       * dragging the ministries sideways navigates to whichever one you let go
       * over. The timeout is the release valve: if no click arrives (a drag that
       * ended outside any target) the flag must not survive to eat a real one.
       */
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 350);
    };

    const onCancel = (event: PointerEvent) => {
      if (id !== event.pointerId) return;
      id = null;
      active = false;
      velocity.current = 0;
      setDragging(false);
      stand();
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    /*
     * A horizontal trackpad swipe, or a shift-wheel. With native panning off,
     * this is the only thing that delivers it — and it has to be a non-passive
     * listener to be able to take the event, which React's `onWheel` cannot be.
     *
     * Vertical wheeling is left entirely alone. The wheel event lands on
     * whatever is under the cursor, so claiming it would mean a rail that
     * blocks the page from scrolling whenever the pointer happens to rest on it.
     *
     * Which means a **vertical column claims nothing at all here**: its own axis
     * is the page's axis, so the one delta it could act on is the one it must not
     * take. Registered and returning early rather than not registered, so this
     * reasoning sits next to the rule it explains.
     */
    const onWheel = (event: WheelEvent) => {
      if (axis === 'y') return;
      if (Math.abs(a.mainDelta(event)) <= Math.abs(a.crossDelta(event))) return;
      event.preventDefault();
      velocity.current = 0;
      slide(a.mainDelta(event));
      stand();
    };

    /**
     * A scroll this hook did not cause — which, with panning off, means the
     * browser bringing a focused link into view. Adopt it rather than fight it:
     * Tab through the rail and it follows the focus, then carries on from there.
     */
    const onScroll = () => {
      if (held.current || nativeDrag.current) return;
      if (Math.abs(el[a.scroll] - pos.current) <= 2) return;
      pos.current = el[a.scroll];
      velocity.current = 0;
      stand();
    };

    /*
     * HTML5 drag-and-drop, which is how an administrator reorders the
     * ministries. Two jobs. First: a native drag must not start in the middle of
     * a pan, or the reader ends up dragging a ghost image of a photograph
     * sideways. Second, and less obvious: once a native drag begins the browser
     * stops sending pointer events and no `pointerup` ever arrives, so `held`
     * would be released by the `pointercancel` that starts the drag and the rail
     * would drift under a tile being dropped. `nativeDrag` is a separate latch
     * with `dragend` as its only release.
     */
    const onDragStart = (event: DragEvent) => {
      if (active) {
        event.preventDefault();
        return;
      }
      nativeDrag.current = true;
    };

    const onDragEnd = () => {
      nativeDrag.current = false;
      stand();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('dragstart', onDragStart);
      el.removeEventListener('dragend', onDragEnd);
      // Leaving `held` set — a rail unmounted mid-drag, or one whose content
      // shrank to fit while being pulled — would freeze the next rail this
      // effect runs for.
      held.current = false;
      nativeDrag.current = false;
    };
  }, [overflowing, slide, a, axis]);

  return { ref, trackRef, copies, overflowing, dragging };
}
