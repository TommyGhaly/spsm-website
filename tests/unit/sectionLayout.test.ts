import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPIN,
  FIT_SHARE,
  SECTION_FITS,
  SECTION_SCALES,
  SECTION_SCALE_LADDER,
  SECTION_WIDTHS,
  WHEEL_SPINS,
  defaultBand,
  defaultSectionLayout,
  driftsFor,
  layoutForLook,
  dockWidths,
  isWheel,
  nearestSectionScale,
  nearestSectionWidth,
  resolveBands,
  resolveSectionLayout,
  roomAfter,
  sectionWidthFraction,
  stepSectionScale,
  stepSectionWidth,
  fitWheelHeight,
  scalesFor,
  spinFor,
  spinReversed,
  wheelHeight,
  widestWithin,
  titlePlacementFor,
} from '@spsm/shared';

/**
 * Reading a section's arrangement back out of Firestore.
 *
 * Worth real tests because of *when* this runs and what it guards. Every
 * gallery page on the site renders through it, in a visitor's browser, on
 * documents that predate the field — so the interesting inputs are not valid
 * layouts, they are `undefined`, half-written objects, and values from a
 * hand-edited console entry. Any one of those getting through unresolved is a
 * section that renders as nothing at all, on a public page, with no error
 * anywhere.
 */

describe('resolveSectionLayout', () => {
  /** The case that covers every document written before this existed. */
  it('fills in a complete layout from nothing', () => {
    expect(resolveSectionLayout(undefined)).toEqual(defaultSectionLayout());
    expect(resolveSectionLayout(null)).toEqual(defaultSectionLayout());
  });

  /**
   * The default has to be the arrangement these pages already had, or adding the
   * field to a document silently restyles a page nobody touched.
   */
  it('defaults to the arrangement the pages already had', () => {
    const layout = defaultSectionLayout();
    expect(layout.display).toBe('grid');
    expect(layout.title.placement).toBe('above');
    expect(layout.caption.placement).toBe('over');
    // Every block on every gallery page predates this field. Anything but `full`
    // here narrows all of them on deploy.
    expect(layout.width).toBe('full');
  });

  it('keeps what it recognises', () => {
    const layout = resolveSectionLayout({
      display: 'column',
      scale: 'full',
      width: 'half',
      drift: false,
      spin: 'down',
      fit: 'uniform',
      title: { scale: 'display', placement: 'beside', align: 'end' },
      caption: { scale: 'medium', placement: 'below', align: 'center' },
    });

    expect(layout).toEqual({
      display: 'column',
      scale: 'full',
      width: 'half',
      drift: false,
      spin: 'down',
      fit: 'uniform',
      title: { scale: 'display', placement: 'beside', align: 'end' },
      caption: { scale: 'medium', placement: 'below', align: 'center' },
    });
  });

  /*
   * The two fields every gallery document on the site predates. A block written
   * before them must render exactly as it did, which means the defaults have to be
   * the behaviour the wheels already had — leftward, and each picture its own
   * shape.
   */
  it('defaults spin and fit to what the wheels already did', () => {
    const layout = resolveSectionLayout({ display: 'rail' });
    expect(layout.spin).toBe('left');
    expect(layout.fit).toBe('natural');
    expect(defaultSectionLayout().spin).toBe('left');
    expect(defaultSectionLayout().fit).toBe('natural');
  });

  it('drops a spin or fit it does not recognise', () => {
    const layout = resolveSectionLayout({ spin: 'sideways', fit: 'cover' });
    expect(layout.spin).toBe('left');
    expect(layout.fit).toBe('natural');
  });

  /**
   * A partial object is the ordinary case, not an edge one: the editor writes
   * one field at a time, and a document mid-edit has a `display` and no `title`.
   */
  it('completes a partial object rather than rejecting it', () => {
    const layout = resolveSectionLayout({ display: 'rail' });
    expect(layout.display).toBe('rail');
    expect(layout.title).toEqual(defaultSectionLayout().title);
    expect(layout.caption).toEqual(defaultSectionLayout().caption);
  });

  it('completes a partial title without losing the fields that were set', () => {
    const layout = resolveSectionLayout({ title: { placement: 'over' } });
    expect(layout.title.placement).toBe('over');
    expect(layout.title.scale).toBe(defaultSectionLayout().title.scale);
  });

  /**
   * Replaced by the default, never carried through. A `display` nothing
   * understands renders as nothing on the web and as something else again in the
   * app.
   */
  it('replaces a value it does not know', () => {
    expect(resolveSectionLayout({ display: 'carousel' }).display).toBe('grid');
    expect(resolveSectionLayout({ scale: 'enormous' }).scale).toBe('medium');
    expect(resolveSectionLayout({ width: '40%' }).width).toBe('full');
    expect(resolveSectionLayout({ width: 0.5 }).width).toBe('full');
    expect(resolveSectionLayout({ title: { align: 'justify' } }).title.align).toBe(
      'start',
    );
  });

  /** Things a hand-edited document, or a bad migration, actually contains. */
  it('survives values that are not objects at all', () => {
    for (const junk of ['grid', 42, true, [], [{ display: 'rail' }], () => 'rail']) {
      expect(resolveSectionLayout(junk)).toEqual(defaultSectionLayout());
    }
  });

  it('survives a title that is not an object', () => {
    expect(resolveSectionLayout({ display: 'rail', title: 'large' }).title).toEqual(
      defaultSectionLayout().title,
    );
  });

  /*
   * `drift` is the one boolean, and absent must mean *on* — the default — while
   * an explicit `false` must survive. Written as `!== false` for exactly this,
   * so the two cases cannot collapse into each other.
   */
  it('treats an absent drift as on and an explicit false as off', () => {
    expect(resolveSectionLayout({ display: 'rail' }).drift).toBe(true);
    expect(resolveSectionLayout({ display: 'rail', drift: false }).drift).toBe(false);
    expect(resolveSectionLayout({ display: 'rail', drift: true }).drift).toBe(true);
  });

  /** A fresh object every time: callers write these into Firestore. */
  it('does not hand two callers the same nested objects', () => {
    const a = resolveSectionLayout(undefined);
    const b = resolveSectionLayout(undefined);
    expect(a.title).not.toBe(b.title);
    a.title.scale = 'display';
    expect(b.title.scale).toBe('small');
  });
});

/**
 * How wide a block is, and where a drag on its edge lands.
 *
 * The arithmetic is small and the consequence is not: this runs on every
 * `pointermove` of a resize, and a sign error or an off-by-one in the ladder is a
 * handle that jumps the wrong way under somebody's finger. It is in shared rather
 * than in the handle precisely so it can be tested without a pointer — and so the
 * mobile app's editor snaps to the same four places.
 */
describe('nearestSectionWidth', () => {
  /** Each name asked for exactly is the name that comes back. */
  it('returns each width for its own fraction', () => {
    for (const width of SECTION_WIDTHS) {
      expect(nearestSectionWidth(sectionWidthFraction(width))).toBe(width);
    }
  });

  it('snaps to the nearer of the two it lies between', () => {
    // Between a third (0.333) and a half (0.5).
    expect(nearestSectionWidth(0.36)).toBe('third');
    expect(nearestSectionWidth(0.47)).toBe('half');
    // Between a half and two thirds (0.667).
    expect(nearestSectionWidth(0.55)).toBe('half');
    expect(nearestSectionWidth(0.64)).toBe('two-thirds');
    // Between two thirds and full.
    expect(nearestSectionWidth(0.72)).toBe('two-thirds');
    expect(nearestSectionWidth(0.95)).toBe('full');
  });

  /**
   * A drag past either end of the page. Both are ordinary — a pointer leaves the
   * window, or crosses back over the block's own left edge — so neither may be an
   * error, and both have to land on the width at that end.
   */
  it('clamps a drag that leaves the page', () => {
    expect(nearestSectionWidth(-3)).toBe('third');
    expect(nearestSectionWidth(0)).toBe('third');
    expect(nearestSectionWidth(4)).toBe('full');
  });

  /**
   * A container that measured zero divides by zero, which is what a block does
   * on the very first frame after a route change. `NaN` must not produce
   * `undefined` as a class name.
   */
  it('falls back to full width for a measurement that is not a number', () => {
    expect(nearestSectionWidth(Number.NaN)).toBe('full');
    expect(nearestSectionWidth(Number.POSITIVE_INFINITY)).toBe('full');
  });

  /** Exactly between two stops goes to the wider one. See the note on the function. */
  it('breaks a tie towards the wider width', () => {
    const between = (sectionWidthFraction('half') + sectionWidthFraction('third')) / 2;
    expect(nearestSectionWidth(between)).toBe('half');
  });
});

describe('stepSectionWidth', () => {
  /**
   * The keyboard's route to the same setting, and the direction is the thing to
   * get right: the vocabulary is ordered widest-first, so "wider" walks *back*
   * along it.
   */
  it('steps wider and narrower', () => {
    expect(stepSectionWidth('third', 1)).toBe('half');
    expect(stepSectionWidth('half', 1)).toBe('two-thirds');
    expect(stepSectionWidth('two-thirds', 1)).toBe('full');
    expect(stepSectionWidth('full', -1)).toBe('two-thirds');
    expect(stepSectionWidth('half', -1)).toBe('third');
  });

  /** Stops rather than wrapping: a width that jumps from a third to the whole page
      because somebody held an arrow key is not a control anybody trusts. */
  it('stops at each end', () => {
    expect(stepSectionWidth('full', 1)).toBe('full');
    expect(stepSectionWidth('third', -1)).toBe('third');
  });
});

/**
 * Changing a block's shape must not change its width.
 *
 * `layoutForLook` writes every field of the layout — that is deliberate, because a
 * partial nested write to Firestore replaces rather than merges — which means it
 * is also the one function that can silently reset a setting it forgot about. The
 * width is the newest field and therefore the likeliest to be forgotten.
 */
describe('layoutForLook', () => {
  it('carries the width through a change of shape', () => {
    expect(layoutForLook('column', 'large', 'half').width).toBe('half');
    expect(layoutForLook('grid', 'small', 'third').width).toBe('third');
  });

  it('is full width when the caller has no width to pass', () => {
    expect(layoutForLook('rail', 'large').width).toBe('full');
  });
});

describe('titlePlacementFor', () => {
  /**
   * A grid has no reliable edge to put words against — the top-left cell of a
   * packed canvas is whatever the packer put there — so `over` is not offered to
   * it.
   */
  it('falls back to above on a grid', () => {
    const layout = resolveSectionLayout({
      display: 'grid',
      title: { placement: 'over' },
    });
    expect(titlePlacementFor(layout)).toBe('above');
  });

  it('honours over on a rail and a column', () => {
    for (const display of ['rail', 'column'] as const) {
      const layout = resolveSectionLayout({
        display,
        title: { placement: 'over' },
      });
      expect(titlePlacementFor(layout)).toBe('over');
    }
  });

  /**
   * The stored value is not destroyed by being unavailable. Switching a section
   * to a grid and back must not lose the choice — see the note on the function.
   */
  it('leaves the stored value alone', () => {
    const layout = resolveSectionLayout({
      display: 'grid',
      title: { placement: 'over' },
    });
    expect(layout.title.placement).toBe('over');
  });

  it('passes the other placements through unchanged', () => {
    for (const placement of ['above', 'beside'] as const) {
      expect(
        titlePlacementFor(
          resolveSectionLayout({ display: 'grid', title: { placement } }),
        ),
      ).toBe(placement);
    }
  });
});

describe('driftsFor', () => {
  it('is never true for a grid, whatever the flag says', () => {
    expect(driftsFor(resolveSectionLayout({ display: 'grid', drift: true }))).toBe(false);
  });

  it('follows the flag for a rail and a column', () => {
    expect(driftsFor(resolveSectionLayout({ display: 'rail' }))).toBe(true);
    expect(driftsFor(resolveSectionLayout({ display: 'rail', drift: false }))).toBe(
      false,
    );
    expect(driftsFor(resolveSectionLayout({ display: 'column' }))).toBe(true);
  });
});

/**
 * A block's own two lists of photographs.
 *
 * These are what "for each section I want an add button … and an x at the corner
 * of every picture" is stored as, and the case that has to hold is the *absent*
 * one: every band written before these fields existed has neither key, and if
 * either read back as anything but empty, every existing gallery page in the
 * parish would change what it draws the moment this deploys.
 */
describe('resolveBands', () => {
  it('is empty for anything that is not an array', () => {
    for (const value of [undefined, null, 'bands', 3, {}]) {
      expect(resolveBands(value)).toEqual([]);
    }
  });

  /**
   * The migration test: a band from before these fields follows the page.
   *
   * `null`, not `[]`, and the distinction is the whole point of the field being
   * nullable. Every band in the parish predates this, and if an absent list read as
   * an *empty* one they would all have gone blank on deploy.
   */
  it('reads a band written before picks existed as following the page', () => {
    const [band] = resolveBands([
      { id: 'band-1', title: 'Day one', layout: { display: 'rail' } },
    ]);
    expect(band?.picks).toBeNull();
    expect(band?.hidden).toEqual([]);
  });

  /** The other half: a list that is there is honoured, even when it is empty. */
  it('keeps an empty list, because empty is a choice somebody made', () => {
    const [band] = resolveBands([{ id: 'band-1', picks: [] }]);
    expect(band?.picks).toEqual([]);
  });

  it('keeps both lists, in order', () => {
    const [band] = resolveBands([
      { id: 'band-1', title: '', picks: ['c', 'a', 'b'], hidden: ['z'] },
    ]);
    expect(band?.picks).toEqual(['c', 'a', 'b']);
    expect(band?.hidden).toEqual(['z']);
  });

  /*
   * A non-string id is dropped rather than coerced. `String(42)` is not a
   * Firestore document name, so keeping it would put a lookup that can never
   * succeed in the middle of a block's order — and a duplicate would carry the
   * same React key as its original.
   */
  it('drops anything that is not a usable id, and duplicates', () => {
    const [band] = resolveBands([
      {
        id: 'band-1',
        picks: ['a', 42, '', null, 'a', 'b'],
        hidden: [{}, 'z', 'z'],
      },
    ]);
    expect(band?.picks).toEqual(['a', 'b']);
    expect(band?.hidden).toEqual(['z']);
  });

  it('drops a band with no id at all, rather than inventing one', () => {
    expect(
      resolveBands([{ title: 'nameless' }, { id: 'band-1' }]).map((one) => one.id),
    ).toEqual(['band-1']);
  });
});

describe('defaultBand', () => {
  /*
   * A new block arrives **empty**, at Tommy's direction: "adding a new block should
   * add empty." It arrived following the page, on the reasoning that a blank block
   * would look like a failed load — but somebody who has just added one is about to
   * choose what goes in it, and a block that arrives full is one they have to empty
   * first.
   *
   * `[]` and not `null` is the assertion that matters here: `null` would make it
   * follow the page, which is what it used to do.
   */
  it('arrives empty, and takes the look asked for', () => {
    const band = defaultBand('band-1', 'column');
    expect(band.picks).toEqual([]);
    expect(band.hidden).toEqual([]);
    expect(band.layout.display).toBe('column');
    expect(band.title).toBe('');
  });
});

/**
 * Which blocks share a row, and what a drag beside one has to write.
 *
 * The arithmetic is small and the thing it stands in for is not: this is the
 * browser's own auto-placement, restated, and every disagreement between the two
 * is a block that lands somewhere other than where the drag showed it landing.
 */

describe('roomAfter', () => {
  it('counts what is left of the row the last block is on', () => {
    expect(roomAfter([])).toBe(12);
    expect(roomAfter(['half'])).toBe(6);
    expect(roomAfter(['two-thirds'])).toBe(4);
    expect(roomAfter(['half', 'third'])).toBe(2);
    expect(roomAfter(['full'])).toBe(0);
  });

  /*
   * The rule that makes this more than a sum: CSS auto-placement never runs
   * backwards, so a block that does not fit starts a new row and *leaves the hole
   * above it empty*. Summing and taking a remainder would say there are 4 columns
   * free after these three; there are 8, on the second row.
   */
  it('starts a new row rather than filling a hole above', () => {
    expect(roomAfter(['half', 'third', 'two-thirds'])).toBe(4);
    expect(roomAfter(['two-thirds', 'half'])).toBe(6);
  });
});

describe('widestWithin', () => {
  it('takes the widest that fits, and nothing at all below a third', () => {
    expect(widestWithin(12)).toBe('full');
    expect(widestWithin(9)).toBe('two-thirds');
    expect(widestWithin(6)).toBe('half');
    expect(widestWithin(4)).toBe('third');
    expect(widestWithin(3)).toBeNull();
    expect(widestWithin(0)).toBeNull();
  });
});

describe('dockWidths', () => {
  /*
   * The case Tommy described: a full-width grid with a wheel under it, dragged up
   * beside it. Nothing fits next to a full block, so the *grid* is what gives way —
   * by one step, not by half. Somebody who wants halves has a handle on each block's
   * edge; the drag only asked for a place to stand.
   */
  it('narrows a full neighbour by one step to make room', () => {
    expect(dockWidths(['full', 'full'], 1)).toEqual({
      neighbour: 'two-thirds',
      dragged: 'third',
    });
  });

  /*
   * The same rule on a row that is already shared, which is the arrangement the
   * ministry page actually has: a third-width wheel beside a two-thirds grid, and a
   * third block under them. The grid narrows to a third and the row goes three
   * across. A rule that only knew how to halve could not have produced this.
   */
  it('narrows a neighbour that is sharing its row already', () => {
    expect(dockWidths(['third', 'two-thirds', 'full'], 2)).toEqual({
      neighbour: 'third',
      dragged: 'third',
    });
  });

  /*
   * A neighbour that already has room keeps every column it has. A two-thirds grid
   * gets a third beside it, not a half beside a half — the drag asked to put a
   * block next to that one, not to rearrange it.
   */
  it('leaves a neighbour alone when the row has room', () => {
    expect(dockWidths(['two-thirds', 'full'], 1)).toEqual({
      neighbour: null,
      dragged: 'third',
    });
    expect(dockWidths(['half', 'full'], 1)).toEqual({
      neighbour: null,
      dragged: 'half',
    });
    expect(dockWidths(['third', 'full'], 1)).toEqual({
      neighbour: null,
      dragged: 'two-thirds',
    });
  });

  /*
   * Where there is no answer: a half beside a half leaves two columns even with the
   * neighbour at its narrowest, and a row of three thirds is already at the limit.
   * Narrowing something the drag never touched is not on offer, so these fall back
   * to being an ordinary move.
   */
  it('refuses when the narrowest neighbour still leaves no room', () => {
    // A half narrowed to a third leaves two columns, which is narrower than
    // anything a block can be.
    expect(dockWidths(['half', 'half', 'full'], 2)).toBeNull();
    expect(dockWidths(['two-thirds', 'third', 'full'], 2)).toBeNull();
    expect(dockWidths(['third', 'third', 'third', 'full'], 3)).toBeNull();
  });

  /** Nothing to dock against, and nothing off the end of the list. */
  it('has no answer for the first block, or for one that is not there', () => {
    expect(dockWidths(['full', 'full'], 0)).toBeNull();
    expect(dockWidths(['full', 'full'], 2)).toBeNull();
    expect(dockWidths([], 1)).toBeNull();
  });
});

/**
 * How long a wheel is.
 *
 * The ladder here is the stylesheet's, written twice on purpose — see
 * `WHEEL_HEIGHT_REM`. These tests are what says so out loud: if somebody changes
 * `--rail-height` in `globals.css` and not the constant, nothing here fails, but
 * the numbers below are where the pairing is written down.
 */

describe('wheelHeight', () => {
  const view = { rem: 16, height: 900 };

  it('counts a rail in tile height and a column in frame height', () => {
    expect(wheelHeight('rail', 'medium', view)).toBe(13 * 16);
    expect(wheelHeight('column', 'medium', view)).toBe(30 * 16);
  });

  /*
   * `full` is viewport-relative and capped, which is the whole reason the window's
   * height is a parameter: on a short window it is the viewport that decides, and a
   * drag that snapped to 54rem there would snap to a size the block never draws.
   */
  it('caps full against the window on a short one and the rem on a tall one', () => {
    expect(wheelHeight('column', 'full', { rem: 16, height: 600 })).toBe(0.82 * 600);
    expect(wheelHeight('column', 'full', { rem: 16, height: 2000 })).toBe(54 * 16);
  });
});

describe('nearestSectionScale', () => {
  const view = { rem: 16, height: 900 };

  it('lands on the size the pointer is nearest', () => {
    // Exactly on a stop, and a hair either side of the midpoint between two.
    expect(nearestSectionScale(30 * 16, 'column', view)).toBe('medium');
    expect(nearestSectionScale(21 * 16, 'column', view)).toBe('small');
    expect(nearestSectionScale(26 * 16, 'column', view)).toBe('medium');
  });

  /*
   * Same contract as `nearestSectionWidth`: a pointer dragged above the top of the
   * block or off the bottom of the window is an ordinary thing a hand does, so
   * every input has an answer.
   */
  it('answers for a pointer that has left the block entirely', () => {
    expect(SECTION_SCALES).toContain(nearestSectionScale(-4000, 'rail', view));
    expect(nearestSectionScale(-4000, 'rail', view)).toBe('small');
    expect(nearestSectionScale(99999, 'rail', view)).toBe('full');
    expect(SECTION_SCALES).toContain(nearestSectionScale(Number.NaN, 'column', view));
  });
});

describe('stepSectionScale', () => {
  it('walks the ladder and stops at both ends', () => {
    expect(stepSectionScale('small', -1)).toBe('small');
    expect(stepSectionScale('small', 1)).toBe('medium');
    expect(stepSectionScale('full', 1)).toBe('full');
    expect(stepSectionScale('full', -1)).toBe('large');
  });
});

describe('isWheel', () => {
  /*
   * What the length handle is drawn for. A grid's height is however many
   * photographs are in it, so a handle on its bottom edge would point at a number
   * it does not set.
   */
  it('is the two displays that have a length of their own', () => {
    expect(isWheel('rail')).toBe(true);
    expect(isWheel('column')).toBe(true);
    expect(isWheel('grid')).toBe(false);
  });
});

/**
 * Which way a wheel goes, and what happens when the stored direction belongs to
 * the other axis.
 *
 * That mismatch is not corruption — it is what you get by setting a column to run
 * downward and then switching the block to a sideways wheel. The setting is kept
 * so switching back restores it, and `spinFor` supplies the axis default in the
 * meantime.
 */
describe('spinFor', () => {
  const withSpin = (display: 'grid' | 'rail' | 'column', spin: string) =>
    resolveSectionLayout({ display, spin });

  it('honours a spin that belongs to the display axis', () => {
    expect(spinFor(withSpin('rail', 'right'))).toBe('right');
    expect(spinFor(withSpin('rail', 'left'))).toBe('left');
    expect(spinFor(withSpin('column', 'down'))).toBe('down');
    expect(spinFor(withSpin('column', 'up'))).toBe('up');
  });

  it('falls back to the axis default when the stored spin is off-axis', () => {
    // Kept in the document, not honoured here.
    expect(withSpin('column', 'right').spin).toBe('right');
    expect(spinFor(withSpin('column', 'right'))).toBe('up');
    expect(spinFor(withSpin('rail', 'down'))).toBe('left');
  });

  it('answers for a grid as though it were a sideways wheel', () => {
    // A grid does not drift, but the control still has to show something, and a
    // block switched to grid and back must not lose its direction.
    expect(spinFor(withSpin('grid', 'right'))).toBe('right');
    expect(spinFor(withSpin('grid', 'down'))).toBe(DEFAULT_SPIN.rail);
  });

  it('marks exactly the two directions that run backwards along their axis', () => {
    expect(WHEEL_SPINS.filter(spinReversed)).toEqual(['right', 'down']);
  });
});

describe('scalesFor', () => {
  it('offers "one picture" to an upright wheel only', () => {
    expect(scalesFor('column')).toContain('fit');
    expect(scalesFor('rail')).not.toContain('fit');
    expect(scalesFor('grid')).not.toContain('fit');
  });

  it('offers every other size to all three', () => {
    for (const display of ['grid', 'rail', 'column'] as const) {
      for (const scale of SECTION_SCALE_LADDER) {
        expect(scalesFor(display)).toContain(scale);
      }
    }
  });
});

/**
 * The height of a `fit` column: one photograph, less a sliver, so there is always
 * a next one showing and the thing reads as a wheel.
 */
describe('fitWheelHeight', () => {
  it('is a shade under the height one picture draws at that width', () => {
    // A 3:2 landscape in a 300px column draws 200px tall.
    expect(fitWheelHeight(300, 3 / 2)).toBeCloseTo(200 * FIT_SHARE);
    // A 2:3 portrait draws 450px, so the frame is much taller.
    expect(fitWheelHeight(300, 2 / 3)).toBeCloseTo(450 * FIT_SHARE);
  });

  it('always leaves something of the next picture in view', () => {
    const width = 300;
    for (const aspect of [0.5, 2 / 3, 1, 3 / 2, 2.4]) {
      const frame = fitWheelHeight(width, aspect);
      expect(frame).not.toBeNull();
      expect(frame as number).toBeLessThan(width / aspect);
    }
  });

  it('returns null when there is nothing to measure from', () => {
    // Before the first measurement, and for a document with no dimensions. Every
    // caller falls back to the rem ladder.
    expect(fitWheelHeight(0, 1.5)).toBeNull();
    expect(fitWheelHeight(300, 0)).toBeNull();
    expect(fitWheelHeight(Number.NaN, 1.5)).toBeNull();
    expect(fitWheelHeight(300, Number.NaN)).toBeNull();
  });
});

/**
 * `fit` is on the menu and off the ladder. A drag or an arrow key is a request for
 * a height, so it has to land on one of the four fixed sizes.
 */
describe('the size ladder excludes fit', () => {
  it('never snaps a drag onto fit', () => {
    const view = { rem: 16, height: 900 };
    for (const height of [0, 120, 320, 480, 700, 5000]) {
      expect(nearestSectionScale(height, 'column', view)).not.toBe('fit');
      expect(nearestSectionScale(height, 'rail', view)).not.toBe('fit');
    }
  });

  it('still stops at each end of the ladder', () => {
    expect(stepSectionScale('full', 1)).toBe('full');
    expect(stepSectionScale('small', -1)).toBe('small');
  });

  it('steps a fit column back onto the ladder rather than doing nothing', () => {
    expect(stepSectionScale('fit', 1)).toBe('full');
    expect(stepSectionScale('fit', -1)).toBe('large');
  });

  it('keeps fit on the menu', () => {
    expect(SECTION_SCALES).toContain('fit');
    expect(SECTION_SCALE_LADDER as readonly string[]).not.toContain('fit');
  });
});

/** Carried through a change of shape, for the reason captions are. */
describe('layoutForLook keeps the wheel settings', () => {
  it('carries a spin and a fit across a change of display', () => {
    const made = layoutForLook('column', 'large', 'half', 'hidden', 'down', 'uniform');
    expect(made.spin).toBe('down');
    expect(made.fit).toBe('uniform');

    // Switched to a sideways wheel, the downward spin is meaningless but kept, so
    // switching back does not cost it.
    const swung = layoutForLook('rail', made.scale, made.width, 'hidden', made.spin, made.fit);
    expect(swung.spin).toBe('down');
    expect(spinFor(swung)).toBe(DEFAULT_SPIN.rail);
  });

  it('defaults the spin to the axis it is asked for', () => {
    expect(layoutForLook('column', 'medium').spin).toBe(DEFAULT_SPIN.column);
    expect(layoutForLook('rail', 'medium').spin).toBe(DEFAULT_SPIN.rail);
    expect(SECTION_FITS).toContain(layoutForLook('rail', 'medium').fit);
  });
});
