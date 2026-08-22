'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GALLERY_DISPLAYS,
  GALLERY_DISPLAY_NAMES,
  SECTION_WIDTH_COLUMNS,
  SECTION_WIDTH_NAMES,
  nearestSectionWidth,
  stepSectionWidth,
  type GalleryDisplay,
  type SectionWidth,
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
 */
export function BlockFrame({
  children,
  display,
  onShape,
  width,
  onWidth,
  /** Absent on the page's own first block, which cannot move. */
  onMove,
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
  /** How much of the page this block takes. Drawn by the handle on its edge. */
  width: SectionWidth;
  onWidth: (next: SectionWidth) => void;
  onMove?: ((delta: -1 | 1) => void) | undefined;
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
  const [drag, setDrag] = useState<{ fromY: number; offset: number } | null>(null);

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
      setDrag({ fromY: event.clientY, offset: 0 });
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
    const threshold = Math.max((frame.current?.getBoundingClientRect().height ?? 200) / 3, 48);

    const onPointerMove = (event: PointerEvent) => {
      setDrag((was) => (was === null ? null : { ...was, offset: event.clientY - was.fromY }));
    };

    const onUp = (event: PointerEvent) => {
      const travelled = event.clientY - drag.fromY;
      setDrag(null);
      if (Math.abs(travelled) > threshold) onMove(travelled > 0 ? 1 : -1);
    };

    /*
     * On `window`, not on the grip: a drag that ends outside the window — which is
     * how a drag towards the edge of the screen normally ends — would otherwise
     * never see its `pointerup`, leaving a block stuck mid-move with no way out
     * but a reload.
     */
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, onMove]);

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
  const [sizing, setSizing] = useState<{ left: number; page: number; width: SectionWidth } | null>(
    null,
  );

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
       * Falling back to the block's own width when there is no parent to measure
       * — which is only ever a test renderer — keeps the handle working rather
       * than dividing by zero.
       */
      const page = frame.current?.parentElement?.getBoundingClientRect().width ?? box?.width ?? 0;
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
      setSizing((was) => (was === null || was.width === asked ? was : { ...was, width: asked }));
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

  /*
   * A visitor gets the block and nothing else — no bar, no handle, no grip.
   *
   * Returned before any of the controls rather than hidden with CSS, because
   * every one of them is a button that writes to Firestore. See the note at the
   * top: this rendered for everyone until it read the mode.
   */
  if (!edit.on) {
    return (
      <div className={`block block--w-${shown}`}>
        <div className="block__body">{children}</div>
      </div>
    );
  }

  return (
    <div
      className={`block block--w-${shown}${offset !== null ? ' is-moving' : ''}${
        sizing !== null ? ' is-sizing' : ''
      }`}
      ref={frame}
      style={offset !== null ? { transform: `translate3d(0, ${offset}px, 0)` } : undefined}
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
            const step = key.key === 'ArrowLeft' ? -1 : key.key === 'ArrowRight' ? 1 : null;
            if (step === null) return;
            key.preventDefault();
            const next = stepSectionWidth(width, step);
            if (next !== width) onWidth(next);
          }}
        >
          <span className="block__width">{SECTION_WIDTH_NAMES[shown]}</span>
        </span>
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
