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
export const SECTION_SCALES = ['small', 'medium', 'large', 'full'] as const;
export type SectionScale = (typeof SECTION_SCALES)[number];

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
    title: {
      scale: oneOf(title['scale'], TEXT_SCALES, fallback.title.scale),
      placement: oneOf(title['placement'], TITLE_PLACEMENTS, fallback.title.placement),
      align: oneOf(title['align'], TEXT_ALIGNS, fallback.title.align),
    },
    caption: {
      scale: oneOf(caption['scale'], TEXT_SCALES, fallback.caption.scale),
      placement: oneOf(caption['placement'], CAPTION_PLACEMENTS, fallback.caption.placement),
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
   * one of two hundred photographs cannot express "minus one" as a list of picks,
   * which is capped at `GALLERY_SUMMARY_MAX`. Applied after whichever set won.
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
  return { id, title: '', layout: layoutForLook(display, 'large'), picks: [], hidden: [] };
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
): SectionLayout {
  return {
    display,
    scale,
    width,
    drift: true,
    title: { scale: 'small', placement: 'above', align: 'start' },
    caption: {
      scale: 'small',
      placement: display === 'grid' ? 'over' : 'hidden',
      align: 'start',
    },
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
