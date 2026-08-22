'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GALLERY_DISPLAYS,
  GALLERY_DISPLAY_NAMES,
  SECTION_SCALES,
  SECTION_SCALE_NAMES,
  SECTION_FIT_NAMES,
  SECTION_WIDTH_COLUMNS,
  SECTION_WIDTH_NAMES,
  SPINS_FOR_DISPLAY,
  WHEEL_SPIN_NAMES,
  isWheel,
  nearestSectionScale,
  nearestSectionWidth,
  stepSectionScale,
  stepSectionWidth,
  wheelHeight,
  type GalleryDisplay,
  type SectionFit,
  type SectionScale,
  type SectionWidth,
  type Viewport,
  type WheelSpin,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { useEditMode } from './editMode';

/**
 * The controls for one block of photographs, **on the block**.
 *
 * ## Why these are not in a panel
 *
 * Tommy, four times, in escalating words, ending with: *"it should be easy to
 * simply drag a scrollwheel to where I want it to be and delete it when I don't
 * want it anymore, same with the rest of the pictures and videos."*
 *
 * Every previous answer I gave was panel work — controls off the page into a
 * properties column, the column into rows, the rows into a list, the list to the
 * bottom of the screen. Each was a smaller panel and none of them was the point.
 * Moving a block is a *gesture*, and no arrangement of a settings list makes a
 * gesture out of two buttons labelled "Move up the page".
 *
 * So the three things you do to a block are on the block: **grab it and move it,
 * change its shape, throw it away.** Nothing to find, nothing to read.
 *
 * The panel is not gone — a caption is text and belongs in a field, and a page's
 * dates belong in a form. But nothing that is fundamentally a *position* or a
 * *deletion* is in there any more.
 *
 * ## Why the drag is pointer events and not HTML5 drag-and-drop
 *
 * `draggable` does not fire on touch at all, so it would be a mouse-only feature
 * on a site the parish reads on phones. The canvas already learnt this — see
 * `GalleryCanvas` — and this uses the same shape: capture the pointer, follow it
 * with a transform, drop on release.
 *
 * ## What the drag actually moves
 *
 * One place, up or down, per drag — not an arbitrary reshuffle. Blocks are a short
 * list (a page carries at most four) and a page of four blocks is fully orderable
 * in three drags, so tracking which of several gaps the pointer is over would be
 * machinery for a case that barely exists.
 *
 * The distance it has to cover is measured off the *live* box, because a block's
 * height depends on its shape and on how many photographs are in it, and both
 * change while somebody is editing.
 *
 * The first block cannot move, and draws no grip. It is the page's own block,
 * stored in `sectionLayout` rather than in `bands`, so it has no position in an
 * order to change; a disabled grip on it would be a control that exists to say no.
 *
 * It **can** be deleted, which it could not until Tommy asked to be able to remove
 * every section of pictures and leave a page empty. Its bin does not splice an
 * array — there is no array — it writes `hidePagePictures` on the page, and takes
 * the "Also from here" strip with it. `removeTitle` is how it says so.
 *
 * ## One bar, with words on everything
 *
 * There used to be two controls per block: a pill of unlabelled glyphs floating
 * over the top-right corner, and a footer below with the labelled Add button.
 * Tommy's verdict was that the block controls were hard to find and read, which
 * is what a row of three 10px glyphs is however well placed — so they are now one
 * bar under the block and everything in it is an icon *and* a word.
 *
 * The Add button was asked for by name — *"for each section I want an add button
 * that lets the admin pick from all subsections"* — and it is why the bar is in
 * the flow rather than floating: a labelled button is the whole difference between
 * "add pictures" being findable and not, and words over photographs are
 * unreadable at any opacity.
 *
 * The cost is one row per block when editing starts. The footer was already
 * costing that; what is gained back is the corner of every block, which was the
 * one part of a photograph the floating pill was guaranteed to cover.
 *
 * ## Nothing at all for a visitor
 *
 * The bar used to render for everyone. Not *styled* for everyone — actually
 * rendered, grip and Delete and all, on every published gallery page, because
 * this component took no view on edit mode and nothing in the stylesheet hid it.
 * It reads the mode itself now and returns the block bare, which is the rule the
 * rest of the section already follows: `EditToggle` "renders nothing at all for a
 * visitor. Not hidden with CSS: absent."
 *
 * ## The width is a drag, not a menu
 *
 * A block's width — see `SECTION_WIDTHS` — is set by pulling the handle on its
 * right edge, and it snaps to four positions as it goes. Tommy asked for the
 * edge over a row of preset buttons, and the bar is the argument for it: it
 * already carries seven controls, and four more would have made the width the
 * loudest thing about a block while being the thing you set once.
 *
 * A drag has no keyboard, so the handle takes arrow keys as well. Same reason the
 * grip above is a focusable `role="button"` rather than a bare span.
 *
 * ## A wheel's length is the other edge
 *
 * A sideways wheel's length is how much of the page it takes, which is the handle
 * above. An upright wheel's is how *tall* it is, and that had no control at all:
 * the size ladder lived in the properties panel and only the page's own first
 * block was wired to it, so a wheel somebody added could not be resized at all.
 *
 * Tommy: *"I should be able to adjust the length of the vertical scroll wheel the
 * same way I can do so with the horizontal one."* So there is a second handle on
 * the bottom edge of a wheel, snapping to the four sizes exactly as the first
 * snaps to the four widths. Wheels only — a grid's height is however many
 * photographs are in it, and a handle that fought the contents would be a control
 * that lies.
 *
 * ## Dragging a block *beside* its neighbour
 *
 * The move drag has always been up and down. A block dragged up into the
 * right-hand side of the block above now docks beside it instead of swapping with
 * it — the neighbour narrows if it has to, and the two share a row. Tommy: *"if it
 * is dragged to the same area as the grid the grid should adjust its width."*
 *
 * Which of the two a drag means is decided by where it ends, and the grip's own
 * position is what makes that unambiguous: it sits at the left end of the bar, so
 * a straight drag upwards ends in the left half of the block above and moves, and
 * one aimed at the space beside it ends in the right half and docks. See
 * `dockWidths` for what the widths become.
 */
export function BlockFrame({
  children,
  display,
  onShape,
  captions,
  onCaptions,
  spin,
  onSpin,
  fit,
  onFit,
  width,
  onWidth,
  place = null,
  scale,
  onHeight,
  /** Absent on the page's own first block, which cannot move. */
  onMove,
  onDock,
  onRemove,
  /**
   * What the bin says it will do. The page's own block overrides it, because
   * "remove this block" is not what removing that one means.
   */
  removeTitle = 'Remove this block',
  label,
  busy = false,
  pictures,
  picker,
}: {
  children: React.ReactNode;
  display: GalleryDisplay;
  onShape: (next: GalleryDisplay) => void;
  /**
   * Which way the wheel goes, and whether its pictures keep their own shape.
   *
   * On the bar rather than in a panel, and that is forced rather than chosen: the
   * properties panel only carries a designer for the page's *own* first block —
   * every extra block's panel is a heading field, because everything else about it
   * is here. Tommy asked for the direction on **all** of the scroll wheels, so here
   * is the only place that is all of them.
   *
   * It is also the right place on its own merits, for the reason given on the
   * captions button below: which way a wheel turns is a thing you judge by looking
   * at it, and the answer arrives the moment you press.
   */
  spin: WheelSpin;
  onSpin: (next: WheelSpin) => void;
  fit: SectionFit;
  onFit: (next: SectionFit) => void;
  /** How much of the page this block takes. Drawn by the handle on its edge. */
  width: SectionWidth;
  onWidth: (next: SectionWidth) => void;
  /**
   * Where the packer put this block, or null while nothing has been packed —
   * before the first measurement, and on a phone, where there is one column.
   *
   * The **row** band comes from here whole, because only the packer knows it. The
   * **column** span does not: it is read off `shown` below, so a width drag
   * changes the block's shape under the pointer rather than waiting for the next
   * measurement to come back. See `useBlockPacking`.
   */
  place?: import('./packing').BlockPlacement | null;
  /** Whether this block draws its pictures' captions. */
  captions: boolean;
  onCaptions: (next: boolean) => void;
  /** How big the pictures inside it are — for a wheel, how long it is. */
  scale: SectionScale;
  /**
   * `live` is a drag still in flight: the block should redraw at that size and
   * nothing should be written yet. The last call of a drag is the only one with
   * `live` false, and it is the one that saves.
   *
   * Two phases rather than one call on release, because a wheel's height is drawn
   * by the block's *contents* — which this component does not own — so unlike the
   * width there is no class it can put on itself to preview the drag. The parent
   * holds the candidate in the same drafts map it already uses to keep a
   * just-changed block from flashing back while a write is in flight.
   */
  onHeight: (next: SectionScale, live: boolean) => void;
  onMove?: ((delta: -1 | 1) => void) | undefined;
  /**
   * Put this block beside the one before it, narrowing that one if it has to.
   *
   * Absent on a block with nothing before it, and on one whose neighbour's row is
   * already shared — see `dockWidths`, which is what decides that and hands back
   * null rather than splitting a shared row a third time.
   */
  onDock?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  removeTitle?: string;
  /** What this block is, for the controls' accessible names. */
  label: string;
  busy?: boolean;
  /**
   * What this block is showing, and the two things you can do about it.
   *
   * Absent draws no footer at all — for a block whose contents are not a choice
   * anybody makes. "Also from here" is that: it is whatever this level holds that
   * the blocks above left out, so there is nothing to add to it.
   */
  pictures?:
    | {
        count: number;
        /** Whether somebody has picked for this block, or it follows the page. */
        picked: boolean;
        /** Open the picker. Drawn as the Add button. */
        onAdd: () => void;
        /** Back to following the page. Absent while it already is. */
        onAutomatic?: (() => void) | undefined;
      }
    | undefined;
  /** The open picker, drawn under the footer. Nothing when it is closed. */
  picker?: React.ReactNode;
}) {
  const edit = useEditMode();
  const frame = useRef<HTMLDivElement | null>(null);
  /** The pictures without the bar, which is what the width handle spans. */
  const body = useRef<HTMLDivElement | null>(null);
  /**
   * The drag in flight: where it began, and how far the pointer has travelled.
   *
   * One object rather than two pieces of state, so a render can never see a
   * started drag with no origin — which is the shape of bug that leaves a block
   * translated by its own distance from the top of the document.
   */
  const [drag, setDrag] = useState<{
    fromX: number;
    fromY: number;
    offset: number;
    docking: boolean;
  } | null>(null);

  const start = useCallback(
    (event: React.PointerEvent) => {
      if (!onMove) return;
      // Otherwise the browser starts its own image-drag on the photographs under
      // the grip, and a text selection across the block.
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still work */
      }
      setDrag({
        fromX: event.clientX,
        fromY: event.clientY,
        offset: 0,
        docking: false,
      });
    },
    [onMove],
  );

  useEffect(() => {
    if (drag === null || !onMove) return;

    /*
     * How far it has to travel to count as a move.
     *
     * A third of its own height. Measuring the *neighbour* would be exact and is
     * not worth it: a block is never shorter than a row of photographs, and a
     * gesture that has covered a third of the one it started in has unambiguously
     * been aimed somewhere else. Below that it springs back, which is what makes an
     * accidental nudge on the grip harmless.
     */
    const threshold = Math.max(
      (frame.current?.getBoundingClientRect().height ?? 200) / 3,
      48,
    );

    /**
     * Whether the pointer is asking for the space *beside* the block above.
     *
     * The neighbour is read off the DOM rather than passed in, because that is
     * what the question is about: not "which block is before this one in an
     * array" but "what is the pointer over". `.block` and not any previous
     * sibling — the Add row is one too, and it is not something to dock against.
     *
     * The right half, so that the two readings of an upward drag stay apart. The
     * grip sits at the left end of the bar, so a straight pull upwards ends in
     * the left half and means *move*; reaching across to the empty side of the
     * block above is a deliberately different gesture, and it is also literally
     * where the block would land.
     */
    const wouldDock = (event: PointerEvent, travelled: number): boolean => {
      if (!onDock) return false;
      /*
       * A gesture, not a click.
       *
       * Without this, *pressing* the grip on a block that already sits beside a
       * taller one rearranges both of them: the pointer is inside the neighbour's
       * box and past its middle the whole time, because that is where the block
       * is. The move drag has always had a threshold for the same reason — a
       * gesture that has gone nowhere has asked for nothing.
       */
      if (travelled < 24) return false;
      const above = frame.current?.previousElementSibling;
      if (!(above instanceof HTMLElement) || !above.classList.contains('block'))
        return false;
      const box = above.getBoundingClientRect();
      return (
        event.clientY >= box.top &&
        event.clientY <= box.bottom &&
        event.clientX > box.left + box.width / 2
      );
    };

    /** How far the pointer has come, in both directions — a dock is mostly sideways. */
    const travel = (event: PointerEvent) =>
      Math.hypot(event.clientX - drag.fromX, event.clientY - drag.fromY);

    const onPointerMove = (event: PointerEvent) => {
      const docking = wouldDock(event, travel(event));
      setDrag((was) =>
        was === null ? null : { ...was, offset: event.clientY - was.fromY, docking },
      );
    };

    const onUp = (event: PointerEvent) => {
      const docking = wouldDock(event, travel(event));
      const travelled = event.clientY - drag.fromY;
      setDrag(null);
      if (docking) {
        onDock?.();
        return;
      }
      if (Math.abs(travelled) > threshold) onMove(travelled > 0 ? 1 : -1);
    };

    /*
     * On `window`, not on the grip: a drag that ends outside the window — which is
     * how a drag towards the edge of the screen normally ends — would otherwise
     * never see its `pointerup`, leaving a block stuck mid-move with no way out
     * but a reload.
     */
    /*
     * A cancelled pointer puts the block back and does nothing else.
     *
     * It used to run the same handler as `pointerup`, which was harmless while the
     * only outcome was a move. It is not now: a cancel is the system taking the
     * gesture away — a phone call, a palm on the trackpad — and docking on one
     * would rewrite two blocks' widths off a gesture nobody finished.
     */
    const onCancel = () => setDrag(null);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [drag, onMove, onDock]);

  const offset = drag?.offset ?? null;

  /**
   * The width drag in flight.
   *
   * `left` and `page` are measured **once, at pointerdown**, and deliberately not
   * re-read as the pointer moves. The block resizes under the hand — that is the
   * whole point of the preview — and in a grid that can pull it up onto the row
   * above, moving the very left edge the fraction is measured from. Re-measuring
   * would make the block fight the pointer.
   *
   * `width` is the snapped candidate, which is what the block draws while the
   * drag is live. Nothing is written until the pointer comes up.
   */
  const [sizing, setSizing] = useState<{
    left: number;
    page: number;
    width: SectionWidth;
  } | null>(null);

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      // Otherwise the pointer starts a text selection across the block, and on a
      // touch screen the page scrolls instead of the handle moving.
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still work */
      }

      const box = body.current?.getBoundingClientRect();
      /*
       * The page's twelve columns, not the block's own box: the fraction being
       * asked for is a share of the *page*, and a block that is already a third
       * wide would otherwise measure every drag against a third of the room.
       *
       * `.blocks` by name rather than the parent element, because the parent is not
       * always the page: a block inside a stack — see `placeBlocks` — has
       * `.blocks__stack` above it, which is as wide as the column the stack stands
       * in, so every drag would have been measured against a third of the page and
       * a nudge would have read as full width.
       *
       * Falling back to the block's own width when there is nothing to measure —
       * which is only ever a test renderer — keeps the handle working rather than
       * dividing by zero.
       */
      const page =
        frame.current?.closest('.blocks')?.getBoundingClientRect().width ??
        box?.width ??
        0;
      setSizing({ left: box?.left ?? 0, page, width });
    },
    [width],
  );

  useEffect(() => {
    if (sizing === null) return;

    const onPointerMove = (event: PointerEvent) => {
      const asked = nearestSectionWidth((event.clientX - sizing.left) / sizing.page);
      // Only when the *snapped* value changes, so the listeners below are not
      // rebuilt on every pixel of a drag that is still inside one step.
      setSizing((was) =>
        was === null || was.width === asked ? was : { ...was, width: asked },
      );
    };

    const onUp = () => {
      const landed = sizing.width;
      setSizing(null);
      if (landed !== width) onWidth(landed);
    };

    // On `window` for the reason the move drag's are: a drag that ends outside
    // the window would otherwise never see its `pointerup`, leaving the block
    // stuck at a width nobody chose.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [sizing, width, onWidth]);

  /** What the block draws: the candidate while a drag is live, the saved one otherwise. */
  const shown = sizing?.width ?? width;

  /**
   * What the packer decided, as a style.
   *
   * The row band whole, the column *start* only — the span beside it is `shown`,
   * the width the pointer is currently asking for, so the block changes shape
   * under a drag instead of holding the last measured one. The next measurement
   * moves everything else out of its way; see `useBlockPacking`.
   *
   * Nothing at all when there is no placement, which leaves the block to
   * `.block--w-*` and ordinary flow: the static page a reader without JavaScript
   * gets, and the single column a phone gets.
   */
  const placed: React.CSSProperties | null =
    place === null
      ? null
      : {
          gridColumn: `${place.col} / span ${SECTION_WIDTH_COLUMNS[shown]}`,
          gridRow: `${place.row} / span ${place.rows}`,
        };

  /**
   * The height drag in flight, for a wheel.
   *
   * `top` is the top of the block's pictures and `chrome` is everything in it that
   * is *not* the wheel — a heading above the strip, the padding around it. Both are
   * measured once at pointerdown, so the arithmetic below is `pointer − top −
   * chrome = the height being asked of the wheel itself`, and a block with a title
   * on it snaps at the same places as one without.
   *
   * Measured rather than assumed, and that is the whole reason this is not a
   * comparison against the ladder directly: the ladder says how tall the *wheel*
   * is at each size, and what the pointer is over is the bottom of the block.
   *
   * `view` is captured with them. Reading the root font size on every pointermove
   * would be a forced style recalculation per frame of a drag, and neither the rem
   * nor the window height changes during one.
   */
  const [heights, setHeights] = useState<{
    top: number;
    chrome: number;
    view: Viewport;
    scale: SectionScale;
  } | null>(null);

  const startHeight = useCallback(
    (event: React.PointerEvent) => {
      if (!isWheel(display)) return;
      // Same two reasons as the width handle: a text selection across the block,
      // and a touch drag that scrolls the page instead of moving the handle.
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still work */
      }

      const box = body.current?.getBoundingClientRect();
      const view: Viewport = {
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
        height: window.innerHeight,
      };
      setHeights({
        top: box?.top ?? 0,
        // Never negative: a block measured mid-transition can be shorter than the
        // wheel it holds, and a negative chrome would offset every snap upwards.
        chrome: Math.max((box?.height ?? 0) - wheelHeight(display, scale, view), 0),
        view,
        scale,
      });
    },
    [display, scale],
  );

  useEffect(() => {
    if (heights === null || !isWheel(display)) return;

    const onPointerMove = (event: PointerEvent) => {
      const asked = nearestSectionScale(
        event.clientY - heights.top - heights.chrome,
        display,
        heights.view,
      );
      if (asked === heights.scale) return;
      setHeights((was) => (was === null ? null : { ...was, scale: asked }));
      // The block redraws at the new size because the parent holds it, not this
      // component — see `onHeight`. Nothing is written until the pointer is up.
      onHeight(asked, true);
    };

    const onUp = () => {
      const landed = heights.scale;
      setHeights(null);
      onHeight(landed, false);
    };

    /*
     * A cancelled height drag saves where it got to rather than reverting.
     *
     * The block has been drawing at that size for as long as the drag has been
     * live, and the candidate is already in the parent's drafts. Throwing it away
     * would leave the page showing one size and the document holding another until
     * something else refetched — which is the worse of the two wrongs.
     */
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [heights, display, onHeight]);

  /** The same, for the height: the candidate while its drag is live. */
  const tall = heights?.scale ?? scale;

  /*
   * A visitor gets the block and nothing else — no bar, no handle, no grip.
   *
   * Returned before any of the controls rather than hidden with CSS, because
   * every one of them is a button that writes to Firestore. See the note at the
   * top: this rendered for everyone until it read the mode.
   */
  if (!edit.on) {
    return (
      <div className={`block block--w-${shown}`} style={placed ?? undefined}>
        <div className="block__body">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`block block--w-${shown}${offset !== null ? ' is-moving' : ''}${
        sizing !== null ? ' is-sizing' : ''
      }${heights !== null ? ' is-sizing-tall' : ''}${drag?.docking ? ' is-docking' : ''}`}
      ref={frame}
      style={{
        ...placed,
        ...(offset !== null ? { transform: `translate3d(0, ${offset}px, 0)` } : {}),
      }}
    >
      <div className="block__body" ref={body}>
        {children}

        {/*
          The width, on the edge that sets it.

          A `slider` rather than a button, because that is what it is: four
          discrete stops, announced by name. `aria-valuenow` counts columns of
          twelve so the numbers a screen reader reads out are the same twelve the
          page is built from, and `aria-valuetext` is what actually gets spoken.

          The readout is drawn only while dragging or focused — see
          `.block__width`. A permanent label saying "Full width" on every block of
          every gallery is furniture, and the handle itself is the affordance.
        */}
        <span
          className="block__resize"
          role="slider"
          tabIndex={0}
          aria-label={`Width of ${label}`}
          aria-valuemin={SECTION_WIDTH_COLUMNS.third}
          aria-valuemax={SECTION_WIDTH_COLUMNS.full}
          aria-valuenow={SECTION_WIDTH_COLUMNS[shown]}
          aria-valuetext={SECTION_WIDTH_NAMES[shown]}
          title="Drag to set how much of the page this block takes"
          onPointerDown={startResize}
          onKeyDown={(key) => {
            const step =
              key.key === 'ArrowLeft' ? -1 : key.key === 'ArrowRight' ? 1 : null;
            if (step === null) return;
            key.preventDefault();
            const next = stepSectionWidth(width, step);
            if (next !== width) onWidth(next);
          }}
        >
          <span className="block__width">{SECTION_WIDTH_NAMES[shown]}</span>
        </span>

        {/*
          A wheel's other dimension, on its other edge.

          Only for a wheel. A grid's height is however many photographs are in it
          and how tall the rows are — `scale` still sets the row height, but a
          handle on the bottom edge of a grid would be pointing at a number it does
          not control, which is a control that lies.

          `aria-valuenow` counts the steps of the ladder rather than pixels: the
          four sizes are names — see `SECTION_SCALES` — and "20rem" is not a thing
          anybody chose. The name is what gets spoken.
        */}
        {isWheel(display) && (
          <span
            className="block__resize block__resize--tall"
            role="slider"
            tabIndex={0}
            aria-label={`Length of ${label}`}
            aria-valuemin={1}
            aria-valuemax={SECTION_SCALES.length}
            aria-valuenow={SECTION_SCALES.indexOf(tall) + 1}
            aria-valuetext={SECTION_SCALE_NAMES[tall]}
            title="Drag to set how long this wheel is"
            onPointerDown={startHeight}
            onKeyDown={(key) => {
              const step =
                key.key === 'ArrowUp' ? -1 : key.key === 'ArrowDown' ? 1 : null;
              if (step === null) return;
              key.preventDefault();
              const next = stepSectionScale(scale, step);
              // Down the screen is taller, which is the direction the handle
              // itself moves — the arrow follows the edge, not the number.
              if (next !== scale) onHeight(next, false);
            }}
          >
            <span className="block__width">{SECTION_SCALE_NAMES[tall]}</span>
          </span>
        )}

        {/*
          Where a drag is about to put the block, while it is still in the air.

          A drag that will dock looks exactly like one that will move — the block
          follows the pointer either way — so without this the difference between
          the two is discovered by letting go. Drawn only while it is true.
        */}
        {drag?.docking && <span className="block__dock">Beside the block above</span>}
      </div>

      {/*
        One bar per block, under it, with words on everything.

        ## What this replaced, and why the floating pill went
        
        There were two controls per block: a pill of unlabelled glyphs floating
        over the top-right corner of the photographs, and a footer in the flow
        below with the labelled Add button in it. The split had a rationale —
        gestures over the block, contents underneath — and Tommy's verdict on the
        result was that the block controls were "hard to find or read", which is
        what a row of three 10px glyphs is however well placed.

        So they are one bar and everything in it says what it does. That costs the
        page one row per block when editing starts, which the footer was already
        costing; and it gains back the corner of every block, which was the one
        part of a photograph the pill was guaranteed to cover.

        Words are hidden below 40rem — see `.block__bar` — where the bar would
        otherwise wrap to three lines. `title` and `aria-label` carry them there.
      */}
      <div className={`block__bar${picker ? ' is-open' : ''}`}>
        {onMove && (
          <span
            className="block__grip"
            role="button"
            tabIndex={0}
            aria-label={`Move ${label}`}
            title="Drag to move this block up or down"
            onPointerDown={start}
            /*
              A keyboard route to the same thing, because a drag has none. This is
              the whole reason the grip is a `role="button"` with a tabindex rather
              than a bare span.
            */
            onKeyDown={(key) => {
              if (key.key === 'ArrowUp') {
                key.preventDefault();
                onMove(-1);
              }
              if (key.key === 'ArrowDown') {
                key.preventDefault();
                onMove(1);
              }
            }}
          >
            <Icon name="expand" size={13} />
            <b>Move</b>
          </span>
        )}

        {/*
          The shape, named. Three buttons rather than a select, because the whole
          list fits on one line and a `<select>` with three options hides two of
          them — and each keeps its glyph, because the glyph is the part that says
          what "upright wheel" actually looks like.
        */}
        <span className="block__shapes" role="group" aria-label={`Shape of ${label}`}>
          {GALLERY_DISPLAYS.map((option) => (
            <button
              key={option}
              type="button"
              className={`block__shape${display === option ? ' is-on' : ''}`}
              aria-pressed={display === option}
              title={GALLERY_DISPLAY_NAMES[option]}
              disabled={busy}
              onClick={() => onShape(option)}
            >
              <span className={`block__glyph block__glyph--${option}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <b>{GALLERY_DISPLAY_NAMES[option]}</b>
            </button>
          ))}
        </span>

        {/*
          The two wheel settings: which way it goes, and whether the pictures keep
          their own shape.

          Only for a wheel — a grid has nowhere to spin to and its tiles are sized
          by the canvas — and drawn as pairs of words rather than glyphs, because
          "Leftward" and "Rightward" have no icon that is clearer than the word.
          The stored values survive a trip through grid, so switching to a grid and
          back costs neither; see `layoutForLook`.
        */}
        {isWheel(display) && (
          <>
            <span
              className="block__spins"
              role="group"
              aria-label={`Direction of ${label}`}
            >
              {SPINS_FOR_DISPLAY[display].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`block__spin${spin === option ? ' is-on' : ''}`}
                  aria-pressed={spin === option}
                  title={`${WHEEL_SPIN_NAMES[option]} — the way this wheel travels`}
                  disabled={busy}
                  onClick={() => onSpin(option)}
                >
                  {WHEEL_SPIN_NAMES[option]}
                </button>
              ))}
            </span>

            {/*
              "One picture" — the upright wheel's height, from its pictures.

              On the bar and not only in the panel's Size list, because that list
              renders for the page's *own* first block alone: every extra block's
              height comes from the drag handle on its edge, and the handle
              deliberately cannot reach `fit` — see `SECTION_SCALE_LADDER` for why a
              content-dependent height has no place on a rung. Without this the one
              setting Tommy asked for would be unreachable on exactly the blocks he
              adds.

              A toggle, and `large` is what it returns to: it is the rung nearest a
              typical portrait in a 30rem column, so switching off changes the height
              least.
            */}
            {display === 'column' && (
              <button
                type="button"
                className={`block__fit${scale === 'fit' ? ' is-on' : ''}`}
                aria-pressed={scale === 'fit'}
                title={
                  scale === 'fit'
                    ? 'The frame is one picture tall. Press to go back to a fixed height.'
                    : 'Make the frame as tall as one of its pictures, less a sliver.'
                }
                disabled={busy}
                onClick={() => onHeight(scale === 'fit' ? 'large' : 'fit', false)}
              >
                One picture
              </button>
            )}

            {/*
              One button, two states, for the reason the captions button is one:
              it is a single setting and a pair would have to explain which of them
              is current. It says what it will *do*, not what it is.
            */}
            <button
              type="button"
              className={`block__fit${fit === 'uniform' ? ' is-on' : ''}`}
              aria-pressed={fit === 'uniform'}
              title={
                fit === 'uniform'
                  ? 'Every picture is cropped to the same size. Press to let them keep their own shapes.'
                  : 'Each picture keeps its own shape. Press to crop them all to the same size.'
              }
              disabled={busy}
              onClick={() => onFit(fit === 'uniform' ? 'natural' : 'uniform')}
            >
              {SECTION_FIT_NAMES[fit]}
            </button>
          </>
        )}

        {/*
          Captions on or off, for this block.
          
          On the bar rather than in a panel, because it is a thing you judge by
          looking: twenty tiles with a line of text under each is either what you
          wanted or obviously not, and the answer is on screen the moment you press
          it. The house default is on for a grid and off for a wheel — see
          `layoutForLook` — and Tommy asked for the wheels' half of that to be a
          choice rather than a rule.
          
          `aria-pressed` rather than two buttons: it is one setting with two states,
          and a pair would have to explain which of them is current.
        */}
        <button
          type="button"
          className={`block__captions${captions ? ' is-on' : ''}`}
          aria-pressed={captions}
          title={
            captions
              ? 'Captions are showing on these pictures. Press to hide them.'
              : 'Captions are hidden on these pictures. Press to show them.'
          }
          disabled={busy}
          onClick={() => onCaptions(!captions)}
        >
          <Icon name={captions ? 'check' : 'close'} size={13} />
          <b>Captions</b>
        </button>

        {pictures && (
          <>
            <button
              type="button"
              className="block__add"
              disabled={busy}
              onClick={pictures.onAdd}
            >
              <Icon name="plus" size={13} />
              <b>Add pictures</b>
            </button>

            {/*
              What it is showing, in words, because the two states look identical
              on screen. A block of twelve photographs that follows the page and a
              block of the same twelve somebody picked behave differently the
              moment a thirteenth is approved, and this line is the only place
              that difference is visible.

              Empty is checked first, because a block added a second ago is empty
              *and* picked — `picks: []` — and "0 picked" is a worse thing to say
              about it than "nothing here yet".
            */}
            <p className="block__count">
              {pictures.count === 0
                ? 'nothing here yet'
                : pictures.picked
                  ? `${pictures.count} picked`
                  : `${pictures.count} chosen for you`}
            </p>

            {pictures.onAutomatic && (
              <button
                type="button"
                className="block__auto"
                disabled={busy}
                onClick={pictures.onAutomatic}
                title="Show whatever this level holds, and keep up to date on its own"
              >
                Back to automatic
              </button>
            )}
          </>
        )}

        {onRemove && (
          <button
            type="button"
            className="block__remove"
            title={removeTitle}
            disabled={busy}
            /*
              No confirmation, and this is the one place a bin needs none: a block
              holds no photographs. It is a way of showing the page's set, so
              removing it destroys nothing and adding it back is one click.
            */
            onClick={onRemove}
          >
            <Icon name="close" size={13} />
            <b>Delete</b>
          </button>
        )}
      </div>

      {picker}
    </div>
  );
}
