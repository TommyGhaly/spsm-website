/**
 * How one block of pictures is presented.
 *
 * A "section" is a titled block of photographs on a page. There are three
 * levels of them under a ministry, and every one is arranged independently:
 *
 * ```
 * Program          Summercamp            → Program.sectionLayout
 *   └ Event        Week 1 2027           → ProgramEvent.sectionLayout
 *       └ Group    Day 1 · Talent Show   → ProgramEventGroup.layout
 * ```
 *
 * ## Presets, not numbers
 *
 * Every field here is a name from a short list — `'large'`, `'beside'`,
 * `'center'` — and never a pixel value, an em, or a coordinate. Two reasons, and
 * the second is the one that decided it:
 *
 *  - The person using the editor is a parish volunteer a few times a year. A
 *    named choice cannot produce something broken; a font-size box can, and the
 *    result is a page nobody can fix without a developer.
 *  - **The mobile app has to render the same section.** It has no CSS. A stored
 *    `1.375rem` is meaningless to it, where `'large'` is a key it can map to its
 *    own type scale — the same contract the design tokens are built on, and for
 *    the same reason. See packages/shared/src/schema/theme.ts.
 *
 * ## Everything is optional on the way in and complete on the way out
 *
 * Nothing in Firestore is guaranteed to carry any of this: the collections
 * predate it, seeds write partial documents, and a hand-edited console entry can
 * hold anything at all. So no reader touches the raw field — they call
 * `resolveSectionLayout`, which fills every gap from the defaults and drops
 * anything it does not recognise. A section whose layout is absent, half-written
 * or garbage renders as the sensible default rather than as an empty block.
 */

/* -------------------------------------------------------------------------- */
/* The vocabularies                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Three ways a block of pictures can be laid out.
 *
 *  - `grid`   — the twelve-column canvas, arranged by hand or packed
 *               automatically. The default, and the only one that can express a
 *               deliberate composition.
 *  - `rail`   — one row, scrolling sideways, drifting on its own. For a set that
 *               is a sequence rather than a composition: a day of a camp.
 *  - `column` — the same thing turned ninety degrees: a tall frame with a single
 *               column of pictures drifting upward inside it.
 *
 * A `rail` and a `column` are the same mechanism on different axes — see
 * `useDragRail` — which is why they are two values here and not two features.
 */
export const GALLERY_DISPLAYS = ['grid', 'rail', 'column'] as const;
export type GalleryDisplay = (typeof GALLERY_DISPLAYS)[number];

/**
 * How big the pictures are.
 *
 * Deliberately not four sizes of the *section* — the section is always the width
 * of the page. What this scales is the unit the display is built from, and that
 * unit differs per display, which is exactly why this is a name rather than a
 * number:
 *
 *   grid    the row height the twelve-column canvas counts in
 *   rail    the height of the row of tiles
 *   column  the height of the frame the column drifts inside
 *
 * `full` is meaningful for a rail and a column only — a grid at `full` would be
 * one picture per screen, which is what the presentation is for.
 */
export const SECTION_SCALES = ['small', 'medium', 'large', 'full', 'fit'] as const;
export type SectionScale = (typeof SECTION_SCALES)[number];

/**
 * `fit` is the upright wheel's answer to "as tall as the pictures themselves".
 *
 * Tommy asked for a column whose height went *"as far as the height of the
 * pictures themselves"*, then: *"make it slightly smaller"*. Both halves matter.
 * A frame exactly as tall as one photograph is a wheel with nothing to drift
 * into — the next picture starts precisely where the frame ends, so there is
 * never a second one in view and no cue that the wheel goes anywhere. A frame at
 * `FIT_SHARE` of one picture always shows a sliver of the next, which is the
 * whole of what makes it read as a wheel rather than as a photograph.
 *
 * Unlike the other four this is not a number in the stylesheet: it depends on the
 * pictures, so it is computed where they are known and written to `--rail-height`
 * inline. `WHEEL_HEIGHT_REM` still carries a value for it, used before the first
 * measurement lands so the block does not jump.
 *
 * Meaningless on a `rail`, whose height *is* its tile height — `scalesFor` does
 * not offer it there.
 */
export const FIT_SHARE = 0.88;

/**
 * How much of the page's width one block takes.
 *
 * ## Why this exists at all
 *
 * Every block was the width of the page, so blocks could only ever stack. Tommy:
 * *"I want the ability to adjust the sizes of the grid layout in the events pages
 * so i can put a grid next to a vertical scroll wheel."* Which is not a size
 * setting on the *pictures* — that is `scale`, and it was already there — it is a
 * size setting on the **block**, and it is the one thing that lets two blocks
 * share a row.
 *
 * Two blocks sit side by side because their widths fit, not because anything says
 * "put these together". A half beside a half, a two-thirds beside a third: the
 * page is a twelve-column grid and blocks flow into it in their own order. There
 * is no row object, no pairing, and nothing to keep consistent — which is what
 * keeps this one field rather than a layout engine.
 *
 * ## Four names, not a percentage
 *
 * The same argument as everything else in this file, and it bites harder here:
 * a free width is how a page ends up with a 47% block beside a 51% one and a
 * hairline of paper between them that nobody can find the cause of. Four names
 * cannot express that.
 *
 * The drag handle on a block's edge *feels* continuous and is not — it snaps to
 * these four as it moves, and only ever stores one of them. See
 * `nearestSectionWidth`, which is where the snapping lives, in shared rather than
 * in the handle, so the mobile app's own editor snaps identically.
 *
 * `full` is the default, so adding this field to a document changes nothing about
 * how any existing page renders.
 */
export const SECTION_WIDTHS = ['full', 'two-thirds', 'half', 'third'] as const;
export type SectionWidth = (typeof SECTION_WIDTHS)[number];

/**
 * The page is twelve columns wide, for the same divisibility reason the canvas
 * inside a block is — see `GALLERY_COLUMNS`, which is deliberately the same
 * number about a different thing. Not imported from there: `programs.ts` imports
 * *this* file, and a cycle between the two would be a real one.
 */
export const SECTION_COLUMNS = 12;

/** Columns of `SECTION_COLUMNS` each width takes. */
export const SECTION_WIDTH_COLUMNS: Record<SectionWidth, number> = {
  full: 12,
  'two-thirds': 8,
  half: 6,
  third: 4,
};

/** The same thing as a fraction of the page, for the drag handle's arithmetic. */
export function sectionWidthFraction(width: SectionWidth): number {
  return SECTION_WIDTH_COLUMNS[width] / SECTION_COLUMNS;
}

/**
 * The width a drag has landed on.
 *
 * `fraction` is how much of the page's width the pointer is currently asking for
 * — it can be negative (dragged past the block's own left edge), more than one
 * (dragged off the right of the window), or `NaN` from a container that measured
 * zero. All three are ordinary things a pointer does, so none of them is an
 * error: every input produces one of the four widths.
 *
 * Ties go to the **wider** of the two. A drag stopped exactly between a half and
 * a third is more likely to be somebody easing off a full-width block than
 * somebody aiming at the narrowest thing on offer.
 *
 * That is why the comparison carries a tolerance rather than being a plain `<`.
 * `SECTION_WIDTHS` is ordered widest-first, so keeping the incumbent unless the
 * next one is *meaningfully* closer is what makes the tie go wide — and a plain
 * `<` does not achieve it, because these fractions are twelfths. The midpoint of
 * a half and a third comes out a hair nearer the third in binary, so the wider
 * one lost a tie the code claimed it would win. The tolerance is four orders of
 * magnitude below the gap between two adjacent widths, so it can only ever
 * decide an actual tie.
 */
export function nearestSectionWidth(fraction: number): SectionWidth {
  if (!Number.isFinite(fraction)) return 'full';

  const TIE = 1e-9;

  let best: SectionWidth = 'full';
  let smallest = Number.POSITIVE_INFINITY;
  for (const width of SECTION_WIDTHS) {
    const gap = Math.abs(sectionWidthFraction(width) - fraction);
    if (gap < smallest - TIE) {
      smallest = gap;
      best = width;
    }
  }
  return best;
}

/**
 * One step wider or narrower, stopping at each end.
 *
 * The keyboard's route to the same setting. A drag has no keyboard equivalent, so
 * the handle takes arrow keys as well — the same reason `BlockFrame`'s grip is a
 * focusable `role="button"` rather than a bare span.
 */
export function stepSectionWidth(width: SectionWidth, delta: -1 | 1): SectionWidth {
  // `SECTION_WIDTHS` runs widest to narrowest, so a step *wider* is a step back
  // along it. Written out rather than left to the reader of `index - delta`.
  const index = SECTION_WIDTHS.indexOf(width);
  const next = delta === 1 ? index - 1 : index + 1;
  return SECTION_WIDTHS[Math.min(Math.max(next, 0), SECTION_WIDTHS.length - 1)] ?? width;
}

/**
 * How many of the page's columns are free once these blocks have flowed.
 *
 * **Flow, not the layout the page draws.** What it draws comes from `packBlocks`,
 * which measures each block and drops it into the first place it fits, wherever
 * that is. This is the narrower question the *docking drag* asks — "is there a
 * place beside this block, going along its row" — and it is deliberately
 * width-only: it has to answer before anything has been measured, and the mobile
 * app's editor has to answer it the same way from the same four names.
 *
 * Blocks fill a row in their own order and one that does not fit starts a new one,
 * which is the conservative reading of the two: where this says there is room, the
 * packer will certainly find it.
 */
export function roomAfter(widths: readonly SectionWidth[]): number {
  let room = SECTION_COLUMNS;
  for (const width of widths) {
    const columns = SECTION_WIDTH_COLUMNS[width];
    room = columns > room ? SECTION_COLUMNS - columns : room - columns;
  }
  return room;
}

/** The widest block that fits in `room` columns, or null when nothing does. */
export function widestWithin(room: number): SectionWidth | null {
  // Widest-first, so the first match is the answer.
  return SECTION_WIDTHS.find((width) => SECTION_WIDTH_COLUMNS[width] <= room) ?? null;
}

/**
 * The two widths that put a block **beside the one before it**.
 *
 * ## What this is for
 *
 * Adding a block leaves it full width, so it lands under whatever is already
 * there. Tommy: *"in that case it should go under but if it is dragged to the same
 * area as the grid the grid should adjust its width."* So the arrangement is made
 * by the gesture rather than guessed at when the block is created — dragging a
 * wheel up alongside a grid is what asks for the pair, and this is the answer to
 * "what widths do those two have to have".
 *
 * ## The neighbour gives up as little as it can
 *
 * `at` is the dragged block; everything before it has already flowed. If that
 * leaves four columns or more the dragged block takes them and **nothing else on
 * the page changes** — a two-thirds grid keeps its two thirds and gets a third
 * beside it.
 *
 * Only when there is no room does the neighbour move, and then by the smallest
 * step that opens a place: full becomes two-thirds and the wheel takes a third,
 * rather than the pair splitting the row down the middle. Two reasons for the
 * stingy version over the tidy one. The first is that it is the one thing the
 * gesture asked for — somebody who wanted halves has a handle on each block's edge
 * and can say so. The second is that it is the same rule at every width, so a
 * two-thirds grid on a row with a third narrows to a third and the row ends up
 * three across, which is a page nobody would have got from a rule that only knew
 * how to halve.
 *
 * Null when even the narrowest neighbour leaves less than a third free — two
 * halves, say. There is no arrangement of *those two blocks* that fits a third,
 * and the alternative is moving something the drag never touched. The drag falls
 * back to being an ordinary move.
 *
 * @param widths every block on the page, in the order it is laid out.
 * @param at     the dragged block. It docks against `at - 1`, which is the block
 *               it is under; there is no docking against something further away,
 *               because the gesture is "put this next to that" and `that` is what
 *               the pointer is over.
 */
export function dockWidths(
  widths: readonly SectionWidth[],
  at: number,
): { neighbour: SectionWidth | null; dragged: SectionWidth } | null {
  if (at < 1 || at >= widths.length) return null;

  const before = widths.slice(0, at);
  const fits = widestWithin(roomAfter(before));
  if (fits) return { neighbour: null, dragged: fits };

  // Widest-first, so the first candidate that opens a place is the smallest
  // change to the neighbour that could have opened one.
  const now = SECTION_WIDTHS.indexOf(widths[at - 1] as SectionWidth);
  for (const neighbour of SECTION_WIDTHS.slice(now + 1)) {
    const room = roomAfter([...before.slice(0, at - 1), neighbour]);
    const dragged = widestWithin(room);
    if (dragged) return { neighbour, dragged };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Which way a wheel goes                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The direction a wheel travels on its own.
 *
 * Tommy: *"for all of the scroll wheels I want there to be a setting for which
 * direction it spins left right up down. U pick horizontal or vertical then the
 * direction in the settings."* Which is exactly the split: the **axis** is already
 * the display — `rail` is horizontal, `column` is upright — and this is the second
 * half, the way it goes along that axis.
 *
 * Four names rather than a `reverse: boolean`, because the stored value should say
 * what it means. `reverse: true` on a column is unreadable in a Firestore console
 * and unreadable in the mobile app; `'down'` is neither. The cost is that the pair
 * can disagree — a `column` that says `'left'` — and `resolveSectionLayout` settles
 * that on read rather than refusing it on write, the same way `titlePlacementFor`
 * settles a grid whose title was set to sit `over` the pictures.
 */
export const WHEEL_SPINS = ['left', 'right', 'up', 'down'] as const;
export type WheelSpin = (typeof WHEEL_SPINS)[number];

/** The two that mean anything on each axis. */
export const SPINS_FOR_DISPLAY: Record<WheelDisplay, readonly WheelSpin[]> = {
  rail: ['left', 'right'],
  column: ['up', 'down'],
};

/**
 * The way each axis went before this field existed, so adding it to a document
 * changes nothing.
 *
 * A sideways wheel ran `left` — the track translating toward negative x, which
 * reads as the pictures marching leftward — and a column ran `up`.
 */
export const DEFAULT_SPIN: Record<WheelDisplay, WheelSpin> = {
  rail: 'left',
  column: 'up',
};

/**
 * The spin this layout actually travels in.
 *
 * A grid has nowhere to go, so it is asked about the axis it would have if it
 * became a wheel — which keeps the control's value alive across a switch to grid
 * and back, for the reason given on `titlePlacementFor`.
 */
export function spinFor(layout: SectionLayout): WheelSpin {
  const display: WheelDisplay = layout.display === 'grid' ? 'rail' : layout.display;
  return SPINS_FOR_DISPLAY[display].includes(layout.spin)
    ? layout.spin
    : DEFAULT_SPIN[display];
}

/** Whether the spin runs backwards along its axis — what the animation needs. */
export function spinReversed(spin: WheelSpin): boolean {
  return spin === 'right' || spin === 'down';
}

/* -------------------------------------------------------------------------- */
/* How a tile is shaped                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Whether a wheel's pictures keep their own shape.
 *
 *  - `natural` — each tile is the photograph's own aspect ratio. A sideways wheel
 *                fixes the height and the width follows; an upright one fixes the
 *                width and the height follows. Portraits and panoramas stay
 *                portraits and panoramas. **The default, and what the wheels have
 *                always done** — see `.gallery-strip--rail > li`.
 *  - `uniform`  — every tile is the same size and the photograph is cropped to it
 *                around its focal point. The wheel reads as an even ribbon, which
 *                is what a set of near-identical snapshots wants.
 *
 * A name and not a ratio: `uniform` means "square to the axis" — the tile is as
 * wide as it is tall — and a parish that wants 4:5 wants a different thing than
 * this control is for.
 */
export const SECTION_FITS = ['natural', 'uniform'] as const;
export type SectionFit = (typeof SECTION_FITS)[number];

/* -------------------------------------------------------------------------- */
/* How tall a wheel is                                                         */
/* -------------------------------------------------------------------------- */

/** The two displays that are a wheel. A grid's height is its contents. */
export type WheelDisplay = Exclude<GalleryDisplay, 'grid'>;

/** Whether this display has a height of its own to set. */
export function isWheel(display: GalleryDisplay): display is WheelDisplay {
  return display !== 'grid';
}

/**
 * The scale ladder in rem, so a drag can snap to the height it is pointing at.
 *
 * **These are the same four numbers the stylesheet draws** —
 * `.gallery-band--rail.gallery-band--scale-*` sets `--rail-tile` and the
 * `--column` rules set `--rail-height`. Two copies of four numbers, and the
 * alternative was worse in both directions: a handle that snapped by distance
 * travelled rather than to where the pointer is would not follow the edge being
 * dragged, and moving the ladder into inline styles would put a wheel's whole
 * appearance in JavaScript for the benefit of one control. The stylesheet says so
 * beside its own copy.
 *
 * A rail counts in tile height and a column in frame height, which is why this is
 * per display and not one ladder — the same reason `SECTION_SCALES` is a name
 * rather than a number.
 */
export const WHEEL_HEIGHT_REM: Record<WheelDisplay, Record<SectionScale, number>> = {
  rail: { small: 9, medium: 13, large: 18, full: 34, fit: 18 },
  column: { small: 20, medium: 30, large: 42, full: 54, fit: 34 },
};

/** The scales worth offering for this display. `fit` is the column's alone. */
export function scalesFor(display: GalleryDisplay): readonly SectionScale[] {
  return display === 'column'
    ? SECTION_SCALES
    : SECTION_SCALES.filter((one) => one !== 'fit');
}

/**
 * How tall one picture draws in a column this wide, and therefore how tall the
 * frame should be to show it and a hint of the next.
 *
 * `aspect` is width ÷ height, the photograph's own. A portrait gives a tall frame
 * and a panorama a short one, which is the point: the frame follows the pictures
 * rather than the pictures being cropped to the frame.
 *
 * Returns `null` when there is nothing to measure from — no width yet, or a
 * document with no dimensions — and every caller then falls back to the rem in
 * `WHEEL_HEIGHT_REM`.
 */
export function fitWheelHeight(width: number, aspect: number): number | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;
  return (width / aspect) * FIT_SHARE;
}

/**
 * The shortest and tallest an upright wheel's dragged height is stored at, in rem.
 *
 * The floor is about one small landscape — below it the frame is a letterbox and
 * not a wheel. The ceiling is not the real limit, only a guard against a
 * hand-edited document asking for a mile: the real one is the pictures, and the
 * website measures it (one whole set, less the shortest picture, so there is
 * always something left to scroll to). A number here could not know how many
 * photographs are in the block or how wide the column draws them.
 */
export const WHEEL_HEIGHT_MIN_REM = 8;
export const WHEEL_HEIGHT_MAX_REM = 600;

/** Keep a stored height inside the two guards, rounded to a tenth of a rem. */
export function clampWheelHeight(rem: number): number {
  if (!Number.isFinite(rem)) return WHEEL_HEIGHT_MIN_REM;
  const kept = Math.min(Math.max(rem, WHEEL_HEIGHT_MIN_REM), WHEEL_HEIGHT_MAX_REM);
  return Math.round(kept * 10) / 10;
}

/**
 * The share of the window `full` takes before the cap in `WHEEL_HEIGHT_REM`
 * applies — `min(62vh, 34rem)` and `min(82vh, 54rem)`, the same two the
 * stylesheet writes.
 */
export const WHEEL_FULL_VIEWPORT: Record<WheelDisplay, number> = {
  rail: 0.62,
  column: 0.82,
};

/** What the browser is measuring in: one rem, and the height of the window. */
export type Viewport = { rem: number; height: number };

/** How tall a wheel of this shape and size actually draws, in pixels. */
export function wheelHeight(
  display: WheelDisplay,
  scale: SectionScale,
  view: Viewport,
): number {
  const capped = WHEEL_HEIGHT_REM[display][scale] * view.rem;
  return scale === 'full'
    ? Math.min(WHEEL_FULL_VIEWPORT[display] * view.height, capped)
    : capped;
}

/**
 * The size a height drag has landed on.
 *
 * The same contract as `nearestSectionWidth`, and for the same reason: every
 * input produces one of the four, because a pointer dragged above the top of the
 * block or off the bottom of the window is an ordinary thing and not an error.
 */
export function nearestSectionScale(
  height: number,
  display: WheelDisplay,
  view: Viewport,
): SectionScale {
  if (!Number.isFinite(height)) return 'large';

  let best: SectionScale = 'large';
  let smallest = Number.POSITIVE_INFINITY;
  for (const scale of SECTION_SCALE_LADDER) {
    const gap = Math.abs(wheelHeight(display, scale, view) - height);
    if (gap < smallest) {
      smallest = gap;
      best = scale;
    }
  }
  return best;
}

/**
 * The four the drag handle and the keyboard move between, smallest to largest.
 *
 * `SECTION_SCALES` is the *menu*; this is the **ladder**, and they stopped being
 * the same list when `fit` arrived. `fit` is not a size — it is where the size
 * comes from — so it has no place on a rung: its height depends on the pictures,
 * which means its position between `large` and `full` changes with the contents,
 * and a drag that snapped to it would land somewhere different on two blocks
 * dragged to the same pixel. Worse, a keyboard step past `full` would leave a
 * block whose height no longer answered to the arrow keys at all.
 *
 * So `fit` is chosen from the list and never stepped onto. Dragging a `fit`
 * column's edge steps it back onto the fixed ladder, which is the honest
 * behaviour: a drag is a request for a particular height.
 */
export const SECTION_SCALE_LADDER = ['small', 'medium', 'large', 'full'] as const;

/** One step taller or shorter, stopping at each end. The keyboard's route in. */
export function stepSectionScale(scale: SectionScale, delta: -1 | 1): SectionScale {
  // The ladder runs smallest to largest, so a step taller is a step along it.
  const index = SECTION_SCALE_LADDER.indexOf(scale as (typeof SECTION_SCALE_LADDER)[number]);
  // Off the ladder entirely — a `fit` column. A step taller means "the tallest
  // fixed size", a step shorter "the one below it": either way it rejoins the
  // ladder rather than doing nothing.
  if (index === -1) return delta === 1 ? 'full' : 'large';
  const next = index + delta;
  return (
    SECTION_SCALE_LADDER[Math.min(Math.max(next, 0), SECTION_SCALE_LADDER.length - 1)] ??
    scale
  );
}

/** The type scale a section's title is set at. */
export const TEXT_SCALES = ['small', 'medium', 'large', 'display'] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

/**
 * Where a section's title sits.
 *
 *  - `above` — on its own line over the pictures. The default.
 *  - `beside` — in a column to the left, with the pictures taking the rest.
 *               Reads as editorial rather than as a list, and it is the reason
 *               `align` exists.
 *  - `over`  — on top of the pictures, on a scrim. Only honoured for a `rail` or
 *              a `column`, where there is a predictable edge to put it against;
 *              a `grid` falls back to `above`, because the top-left cell of a
 *              packed canvas is not a reliable place to put words.
 */
export const TITLE_PLACEMENTS = ['above', 'beside', 'over'] as const;
export type TitlePlacement = (typeof TITLE_PLACEMENTS)[number];

/**
 * Where a picture's own caption goes.
 *
 * `hidden` is a real choice rather than an omission: a wall of photographs with
 * a line of text under every one is a page of subtitles, and for a rail of
 * twenty pictures from one afternoon the captions say the same thing twenty
 * times. The caption is still the alt text either way — it is never *lost*, only
 * not drawn.
 */
export const CAPTION_PLACEMENTS = ['over', 'below', 'hidden'] as const;
export type CaptionPlacement = (typeof CAPTION_PLACEMENTS)[number];

export const TEXT_ALIGNS = ['start', 'center', 'end'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/* -------------------------------------------------------------------------- */
/* The shape                                                                   */
/* -------------------------------------------------------------------------- */

export interface SectionTitleStyle {
  scale: TextScale;
  placement: TitlePlacement;
  align: TextAlign;
}

export interface SectionCaptionStyle {
  scale: TextScale;
  placement: CaptionPlacement;
  align: TextAlign;
}

export interface SectionLayout {
  display: GalleryDisplay;
  scale: SectionScale;
  /**
   * How much of the page's width the block takes, so two of them can share a
   * row. `full` unless somebody has dragged the block's edge. See
   * `SECTION_WIDTHS`.
   */
  width: SectionWidth;
  /**
   * Whether a `rail` or a `column` moves on its own.
   *
   * Ignored by `grid`, which has nowhere to drift to. Kept as a stored flag
   * rather than inferred from the display because "a sideways row you scroll
   * yourself" is a real and different thing from "a sideways row that goes round
   * on its own", and a parish may well want the first for a set of six.
   *
   * A machine asking for reduced motion gets no drift whatever this says. That
   * is not this flag's business — see `useDragRail`.
   */
  drift: boolean;
  /**
   * Which way it goes along its axis. Settled against the display on read — see
   * `spinFor` — so a value left over from the other axis is not lost.
   */
  spin: WheelSpin;
  /**
   * Whether the pictures keep their own shape or are cropped to a common one.
   * Ignored by `grid`, whose tiles are sized by the canvas. See `SECTION_FITS`.
   */
  fit: SectionFit;
  /**
   * An upright wheel's frame height in rem, set by dragging its bottom edge.
   *
   * `null` is "use `scale`", which is every block written before this existed.
   * Tommy: *"if there are 10 photos in the wheel it should be able to be 9 or 8
   * photos long"* — and the ladder's tallest rung was `min(82vh, 54rem)`, which is
   * two portraits. So the drag stopped snapping and writes the height it was let
   * go at. See `clampWheelHeight` for the limits, and `wheelCap` on the website
   * for why the real ceiling is the pictures rather than a number.
   *
   * Ignored by every display but `column`. Kept across a change of shape, for the
   * reason `scale` is: switching to a grid and back is not asking for a new size.
   */
  height: number | null;
  title: SectionTitleStyle;
  caption: SectionCaptionStyle;
}

/**
 * What a section looks like when nobody has said otherwise.
 *
 * A function, not a constant, and for the reason `defaultProgramAdmin` is one:
 * callers write the result into Firestore, and handing every caller the same
 * nested object is how one section's edit turns up in another.
 *
 * The defaults are the arrangement the section had before any of this existed —
 * a packed grid, a small caps title above it, captions on hover — so adding the
 * field to a document changes nothing about how it renders. That is deliberate:
 * a schema addition that silently restyles every existing page is not a schema
 * addition, it is a redesign nobody asked for.
 */
export function defaultSectionLayout(): SectionLayout {
  return {
    display: 'grid',
    scale: 'medium',
    width: 'full',
    drift: true,
    /* The two directions the wheels already went before either field existed, so
       a document gaining them renders exactly as it did. */
    spin: 'left',
    fit: 'natural',
    height: null,
    title: { scale: 'small', placement: 'above', align: 'start' },
    caption: { scale: 'small', placement: 'over', align: 'start' },
  };
}

/* -------------------------------------------------------------------------- */
/* Reading one back                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Coerce anything at all into a complete, renderable `SectionLayout`.
 *
 * The one function every reader uses. Nothing else should look at the raw field:
 * `undefined`, `null`, a partial object, an object with `display: 'carousel'` in
 * it, and a string are all things this field genuinely arrives as, and every one
 * of them has to produce a section that renders.
 *
 * Unknown values are **replaced by the default, not preserved**. Carrying
 * `display: 'carousel'` through in the hope that something downstream
 * understands it is how a section ends up rendering as nothing at all on the web
 * and as something else again in the app.
 */
export function resolveSectionLayout(value: unknown): SectionLayout {
  const fallback = defaultSectionLayout();
  const source = record(value);
  if (source === null) return fallback;

  const title = record(source['title']) ?? {};
  const caption = record(source['caption']) ?? {};

  return {
    display: oneOf(source['display'], GALLERY_DISPLAYS, fallback.display),
    scale: oneOf(source['scale'], SECTION_SCALES, fallback.scale),
    width: oneOf(source['width'], SECTION_WIDTHS, fallback.width),
    // `!== false` rather than `=== true`: absent means default, and the default
    // is on. Only an explicit `false` switches the drift off.
    drift: source['drift'] === undefined ? fallback.drift : source['drift'] !== false,
    spin: oneOf(source['spin'], WHEEL_SPINS, fallback.spin),
    fit: oneOf(source['fit'], SECTION_FITS, fallback.fit),
    height:
      typeof source['height'] === 'number' && Number.isFinite(source['height'])
        ? clampWheelHeight(source['height'])
        : null,
    title: {
      scale: oneOf(title['scale'], TEXT_SCALES, fallback.title.scale),
      placement: oneOf(title['placement'], TITLE_PLACEMENTS, fallback.title.placement),
      align: oneOf(title['align'], TEXT_ALIGNS, fallback.title.align),
    },
    caption: {
      scale: oneOf(caption['scale'], TEXT_SCALES, fallback.caption.scale),
      placement: oneOf(
        caption['placement'],
        CAPTION_PLACEMENTS,
        fallback.caption.placement,
      ),
      align: oneOf(caption['align'], TEXT_ALIGNS, fallback.caption.align),
    },
  };
}

/**
 * `over` is not available to a grid, so a stored `over` resolves to `above`
 * there.
 *
 * Applied on read rather than refused on write, deliberately. An administrator
 * who sets a rail's title to sit over the pictures and *then* switches the
 * section to a grid has not made a mistake — they have changed their mind about
 * one thing — and losing the other setting would mean setting it again when they
 * switch back. The stored value is honoured the moment it is meaningful again.
 */
export function titlePlacementFor(layout: SectionLayout): TitlePlacement {
  if (layout.display === 'grid' && layout.title.placement === 'over') return 'above';
  return layout.title.placement;
}

/* -------------------------------------------------------------------------- */
/* Extra blocks a page can carry                                               */
/* -------------------------------------------------------------------------- */

/**
 * One block of photographs on a level's page, beyond the first.
 *
 * ## A block is a set of pictures and a way of showing it
 *
 * This has now been both ways round, and the history is worth keeping because the
 * middle version is the one that reads best on paper.
 *
 * Each block once carried a `source` — a *rule* for which photographs it drew.
 * That went, and rightly: a page became several independent galleries stacked,
 * each answering a question the page had already answered. What replaced it was
 * "the page picks its photographs once and every block shows that set", one
 * decision about content and as many about presentation as somebody wants.
 *
 * Tommy, on that: *"for each section I want an add button that lets the admin pick
 * from all subsections and I want an x at the corner of every picture to simply
 * delete it."* Which is a block owning its own pictures again — and the reason it
 * is right this time is that it is no longer a **rule**. `picks` is a list of
 * photographs somebody chose while looking at the block, and `hidden` is the ones
 * they pressed × on. Both are the record of a gesture, not a setting to be
 * configured; there is nothing to understand before using them and nothing to keep
 * consistent with the block above.
 *
 * ## `null` follows the page; `[]` is empty on purpose
 *
 * Three states, not two, and the third one is load-bearing in both directions.
 *
 *  - **`picks: null`** — nobody has picked for this block. It shows whatever the
 *    page's own set is: the automatic spread, or every photograph beneath when
 *    `showAllPictures` is on. Every band written before this field existed reads
 *    as `null`, which is why adding it changed no existing page.
 *  - **`picks: []`** — somebody emptied it, or it has just been added. It shows
 *    nothing, and waits.
 *  - **`picks: [...]`** — exactly those, in that order.
 *
 * A two-state version of this collapsed `[]` into "follow the page", and it was
 * wrong twice. Tommy: *"adding a new block should add empty"* — a block that
 * arrives already full of the page's photographs is one you have to empty before
 * you can fill it. And in the other direction, pressing × on the last picture in a
 * picked block made twenty-four reappear, because emptying the list meant handing
 * it back to the page.
 *
 * The same two things one level up are `featuredMediaIds` and `hiddenMediaIds` on
 * the program or the node. That is the page's *first* block, which is stored in
 * `sectionLayout` rather than in `bands` — same two lists, resolved by the same
 * `pagePictures`, but with only two states: its `featuredMediaIds` has meant
 * "empty is automatic" since long before any of this, and it is never a block
 * somebody *adds*, so the third state has nothing to be for. The caller says which
 * it means; see `pagePictures`.
 */
export interface GalleryBand {
  /** Stable. Also the section's DOM id and its key in the properties panel. */
  id: string;
  /**
   * Shown above it. Empty draws no heading at all — a second block under a page's
   * own pictures usually wants none.
   */
  title: string;
  layout: SectionLayout;
  /**
   * The photographs this block shows, by id, in the order it shows them.
   *
   * `null` is "nobody has picked for this block"; `[]` is "empty, on purpose". See
   * the note above for why those are two states and not one.
   *
   * Ids that no longer resolve are dropped on read, never drawn as a gap.
   */
  picks: string[] | null;
  /**
   * The ones pressed × on while this block was following the page.
   *
   * A separate list from `picks` because the two answer different questions, and
   * collapsing them would break the one case that matters: a page showing every
   * one of two hundred photographs cannot express "minus one" as two hundred
   * picks written into the document. Applied after whichever set won.
   *
   * That case used to be argued from a cap on `picks`, which is gone — but the
   * separation is not merely inherited. "Minus one" as a list of picks is a
   * snapshot: it stops following the page, so a photograph approved tomorrow
   * never appears in the block at all.
   */
  hidden: string[];
}

/**
 * What a newly added block looks like.
 *
 * A function for the reason `defaultSectionLayout` is one: the caller writes the
 * result into Firestore, and handing every caller the same nested object is how
 * one block's edit turns up in another.
 *
 * `large` and no title. Somebody who has just pressed "Add a sideways wheel" has
 * asked for a thing that *moves*, and a wheel that arrives small and untitled
 * under a block that already has a heading is the least surprising thing it can
 * be. Both are one click to change.
 *
 * **`picks: []`, so it arrives empty**, at Tommy's direction: *"adding a new block
 * should add empty."* It arrived following the page — full of the same photographs
 * as the block above it — on the reasoning that a blank block would look like a
 * failed load. That reasoning was wrong about what somebody is doing when they add
 * one: they are about to choose what goes in it, and a block that arrives full is
 * one they have to empty first. The footer says "nothing here yet" beside the Add
 * button, which is the part that stops it reading as a fault.
 */
export function defaultBand(id: string, display: GalleryDisplay): GalleryBand {
  return {
    id,
    title: '',
    layout: layoutForLook(display, 'large'),
    picks: [],
    hidden: [],
  };
}

/**
 * Read a band list off a document that may not have one.
 *
 * Every level written before this field existed has no key at all, and a
 * hand-edited one may have a string where the array should be. Same contract as
 * `resolveSectionLayout`: nothing downstream reads the raw field.
 *
 * **`picks` is `null` when the field is absent**, which is "follow the page" — so
 * every band written before it existed keeps drawing exactly what it drew, and no
 * script has to run. An array that *is* there is honoured even when empty, because
 * empty is a state somebody chose; see `GalleryBand.picks`.
 *
 * `hidden` has no such third state and defaults to empty: "nothing was pressed ×
 * on" and "the field is absent" are the same fact about a block.
 *
 * A `source` on an older band is ignored rather than migrated. It only ever had
 * two values, both of which the page's own set now expresses, and dropping it on
 * read means no script has to run for a page to keep working.
 */
export function resolveBands(source: unknown): GalleryBand[] {
  if (!Array.isArray(source)) return [];
  const bands: GalleryBand[] = [];
  for (const raw of source) {
    const band = record(raw);
    if (!band) continue;
    const id = typeof band['id'] === 'string' ? band['id'] : '';
    if (id === '') continue;
    bands.push({
      id,
      title: typeof band['title'] === 'string' ? band['title'] : '',
      layout: resolveSectionLayout(band['layout']),
      picks: Array.isArray(band['picks']) ? mediaIds(band['picks']) : null,
      hidden: mediaIds(band['hidden']),
    });
  }
  return bands;
}

/**
 * Where the page's own block sits among `bandCount` bands, read off whatever is
 * stored. See `Program.pageBlockAt`.
 *
 * Clamped rather than trusted: a page whose last band was deleted can be holding
 * a position past the end, and that means "last", not "nowhere".
 */
export function pageBlockIndex(stored: unknown, bandCount: number): number {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return 0;
  return Math.min(Math.max(Math.round(stored), 0), Math.max(bandCount, 0));
}

/**
 * Swap two entries of a block order, by key. The list comes back unchanged when
 * either key is missing or they are the same, so a drop onto itself is a no-op.
 */
export function swapBlocks<T extends string>(order: readonly T[], a: T, b: T): T[] {
  const from = order.indexOf(a);
  const to = order.indexOf(b);
  if (from === -1 || to === -1 || from === to) return [...order];
  const next = [...order];
  next[from] = b;
  next[to] = a;
  return next;
}

/**
 * A list of document ids off an unknown field.
 *
 * Non-strings are dropped rather than coerced: an id is a Firestore document name
 * and `String(42)` is not one, so keeping it would put a lookup that can never
 * succeed in the middle of a block's order. Duplicates go too — a picture cannot
 * appear twice in one block, and the second copy would carry the same React key.
 */
function mediaIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const one of value) {
    if (typeof one === 'string' && one !== '') seen.add(one);
  }
  return [...seen];
}

/**
 * A complete layout for one named look.
 *
 * The typography that used to be five rows of controls — title size, title
 * position, title alignment, caption placement — is set here instead, one house
 * style per shape. So "Sideways wheel" is a whole answer rather than the first of
 * six questions.
 *
 * The choices are the site's own conventions rather than a taste:
 *
 *  - **The title is always small caps above.** That is the eyebrow every other
 *    section on this site uses, and a gallery is not the place to invent a second
 *    heading style. It was configurable and the configuration bought nothing but
 *    the chance of a 40px serif title over a strip of camp photographs.
 *  - **Captions show on hover in a grid and not at all in a wheel.** A grid tile
 *    holds still long enough to be read; a caption on a strip moving past at
 *    150px a second is not a caption. A caption is the photograph's alt text
 *    either way, so nothing is lost to a screen reader by not drawing it.
 *  - **A wheel drifts.** A wheel that arrives motionless is the one thing nobody
 *    asks for, and it was the "Movement" row.
 *
 * `scale` is a parameter rather than a per-look constant because it means the
 * same thing in every look and somebody who has set "large" should not have to
 * set it again to change shape.
 *
 * The fields it does not mention do not exist — every field of `SectionLayout` is
 * written, for the reason `setSectionLayout` gives about nested writes.
 */
export function layoutForLook(
  display: GalleryDisplay,
  scale: SectionScale,
  /**
   * Carried through for the same reason `scale` is a parameter: somebody who has
   * dragged a block to half the page and then changes its shape has changed their
   * mind about one thing. Defaulted rather than required, because a *new* block is
   * full width and its caller has no width to pass.
   */
  width: SectionWidth = 'full',
  /**
   * Whether the pictures' captions are drawn, carried through for the same
   * reason `scale` and `width` are parameters rather than reset here.
   *
   * The default is the house style: **on for a grid, off for a wheel.** A grid is
   * a composition somebody arranged and a caption belongs to the picture in it; a
   * wheel of twenty photographs from one afternoon with a line of text on every
   * tile is a page of subtitles.
   *
   * It is a parameter because that default is a *starting point* and was being
   * treated as a rule: switching a block's shape rebuilt its whole layout, so
   * turning captions on for a wheel and then trying it as a grid silently threw
   * the choice away. Tommy asked for the control — *"I want the ability to show vs
   * hide captions for the scroll wheels"* — and a control whose value evaporates
   * when you change something else is not one.
   */
  caption: CaptionPlacement = display === 'grid' ? 'over' : 'hidden',
  /**
   * The spin and the tile shape, carried through for exactly the reason `caption`
   * is: they are choices about the wheel, and changing a block from a sideways
   * wheel to an upright one is changing one thing, not resetting the block.
   *
   * A spin from the other axis is kept rather than corrected. It is meaningless
   * until the display swings back, and `spinFor` supplies the axis default in the
   * meantime — the same trade `titlePlacementFor` makes, so switching there and
   * back does not cost the setting.
   */
  spin: WheelSpin = DEFAULT_SPIN[display === 'grid' ? 'rail' : display],
  fit: SectionFit = 'natural',
  /** The upright wheel's dragged height, carried for the reason `scale` is. */
  height: number | null = null,
): SectionLayout {
  return {
    display,
    scale,
    width,
    drift: true,
    spin,
    fit,
    height,
    title: { scale: 'small', placement: 'above', align: 'start' },
    caption: { scale: 'small', placement: caption, align: 'start' },
  };
}

/*
 * The words a person sees for these values.
 *
 * In the schema rather than beside the controls, because two places now need
 * them: the designer's own chips, and the collapsed summary row in the properties
 * column that says what a section is currently set to. Two lists of the same
 * words drift, and the one that drifts is always the one nobody is looking at.
 *
 * Complete per vocabulary, so adding a value to `GALLERY_DISPLAYS` is a type
 * error until it is named — a `Record<T, string>` cannot be partially filled, so
 * a new display cannot reach a volunteer's screen as `"masonry"`.
 *
 * The mobile app will want the same strings for the same reason.
 */
/*
 * Renamed from "Arranged grid / Sideways rail / Drifting column".
 *
 * `rail` and `column` are this codebase's words. A parish volunteer looking for
 * the thing that goes round sideways does not scan a list for "rail", and
 * "drifting" described the movement — which is no longer a choice, so it was
 * describing something the name did not need to carry.
 */
export const GALLERY_DISPLAY_NAMES: Record<GalleryDisplay, string> = {
  grid: 'Grid',
  rail: 'Sideways wheel',
  column: 'Upright wheel',
};

/*
 * The words on the drag handle's readout.
 *
 * "Full width" rather than "Full", unlike the scale ladder next to it: this is
 * the only vocabulary where `full` sits beside three fractions, and "Full" alone
 * next to "Half" reads as a size of picture rather than a share of the page.
 */
export const SECTION_WIDTH_NAMES: Record<SectionWidth, string> = {
  full: 'Full width',
  'two-thirds': 'Two thirds',
  half: 'Half',
  third: 'One third',
};

export const SECTION_SCALE_NAMES: Record<SectionScale, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  full: 'Full',
  /* Named for what it does, not for the mechanism: the frame ends up the height of
     one photograph less a sliver. "Fit" alone reads as a CSS keyword. */
  fit: 'One picture',
};

/*
 * Said as a direction of travel, not as a side. "Leftward" is where the pictures
 * are going; "Left" beside "Right" in a row of two reads as an alignment control,
 * which is what the title and caption rows above it actually are.
 */
export const WHEEL_SPIN_NAMES: Record<WheelSpin, string> = {
  left: 'Leftward',
  right: 'Rightward',
  up: 'Upward',
  down: 'Downward',
};

export const SECTION_FIT_NAMES: Record<SectionFit, string> = {
  natural: 'Their own shape',
  uniform: 'All the same',
};

/** Whether this display moves by itself, given what was asked for. */
export function driftsFor(layout: SectionLayout): boolean {
  return layout.display !== 'grid' && layout.drift;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}
