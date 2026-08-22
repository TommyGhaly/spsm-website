import { describe, it, expect } from 'vitest';
import {
  SECTION_WIDTHS,
  defaultBand,
  defaultSectionLayout,
  driftsFor,
  layoutForLook,
  nearestSectionWidth,
  resolveBands,
  resolveSectionLayout,
  sectionWidthFraction,
  stepSectionWidth,
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
      title: { scale: 'display', placement: 'beside', align: 'end' },
      caption: { scale: 'medium', placement: 'below', align: 'center' },
    });

    expect(layout).toEqual({
      display: 'column',
      scale: 'full',
      width: 'half',
      drift: false,
      title: { scale: 'display', placement: 'beside', align: 'end' },
      caption: { scale: 'medium', placement: 'below', align: 'center' },
    });
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
    expect(resolveSectionLayout({ title: { align: 'justify' } }).title.align).toBe('start');
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
    const layout = resolveSectionLayout({ display: 'grid', title: { placement: 'over' } });
    expect(titlePlacementFor(layout)).toBe('above');
  });

  it('honours over on a rail and a column', () => {
    for (const display of ['rail', 'column'] as const) {
      const layout = resolveSectionLayout({ display, title: { placement: 'over' } });
      expect(titlePlacementFor(layout)).toBe('over');
    }
  });

  /**
   * The stored value is not destroyed by being unavailable. Switching a section
   * to a grid and back must not lose the choice — see the note on the function.
   */
  it('leaves the stored value alone', () => {
    const layout = resolveSectionLayout({ display: 'grid', title: { placement: 'over' } });
    expect(layout.title.placement).toBe('over');
  });

  it('passes the other placements through unchanged', () => {
    for (const placement of ['above', 'beside'] as const) {
      expect(titlePlacementFor(resolveSectionLayout({ display: 'grid', title: { placement } }))).toBe(
        placement,
      );
    }
  });
});

describe('driftsFor', () => {
  it('is never true for a grid, whatever the flag says', () => {
    expect(driftsFor(resolveSectionLayout({ display: 'grid', drift: true }))).toBe(false);
  });

  it('follows the flag for a rail and a column', () => {
    expect(driftsFor(resolveSectionLayout({ display: 'rail' }))).toBe(true);
    expect(driftsFor(resolveSectionLayout({ display: 'rail', drift: false }))).toBe(false);
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
    const [band] = resolveBands([{ id: 'band-1', title: 'Day one', layout: { display: 'rail' } }]);
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
      { id: 'band-1', picks: ['a', 42, '', null, 'a', 'b'], hidden: [{}, 'z', 'z'] },
    ]);
    expect(band?.picks).toEqual(['a', 'b']);
    expect(band?.hidden).toEqual(['z']);
  });

  it('drops a band with no id at all, rather than inventing one', () => {
    expect(resolveBands([{ title: 'nameless' }, { id: 'band-1' }]).map((one) => one.id)).toEqual([
      'band-1',
    ]);
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
