import { describe, it, expect } from 'vitest';
import { togglePick } from '../../apps/website/src/features/programs/pick.js';

/**
 * One click on the admin picture picker.
 *
 * Extracted from the component and tested because of the bug its shape fixes.
 * The picker computed the next list from its `selected` **prop** and handed the
 * result back to the caller — so two clicks arriving before a re-render both
 * read the same starting list, and the second silently discarded the first. The
 * caller now applies this inside a functional state update, which cannot read a
 * stale value.
 *
 * The `many` case is what a ministry page's pictures are, and the *order* is the
 * content: the number drawn on each chosen tile is the position it will appear
 * in. So these assert the order, not just the membership.
 */

const NONE: readonly string[] = [];

describe('togglePick, choosing several', () => {
  const many = (current: readonly string[], id: string, ceiling = 12) =>
    togglePick(current, id, 'many', ceiling);

  it('adds to the end, so the click order is the display order', () => {
    let chosen = many(NONE, 'm-03');
    chosen = many(chosen, 'm-01');
    chosen = many(chosen, 'm-07');
    expect(chosen).toEqual(['m-03', 'm-01', 'm-07']);
  });

  it('removes on a second click and closes the gap', () => {
    expect(many(['m-01', 'm-02', 'm-03'], 'm-02')).toEqual(['m-01', 'm-03']);
  });

  /**
   * Applied one at a time from the previous result, three clicks give three
   * pictures. This is the case that was broken: read from a stale prop, each
   * call starts from `[]` and only the last one survives.
   */
  it('accumulates when applied in sequence', () => {
    const clicks = ['m-01', 'm-02', 'm-03'];
    expect(clicks.reduce((current, id) => many(current, id), NONE)).toEqual(clicks);
  });

  it('refuses to exceed the ceiling', () => {
    expect(many(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });

  /**
   * At the limit, removing must still work — otherwise the last picture added
   * cannot be taken back, which is the one action somebody who has hit the limit
   * actually wants.
   */
  it('still removes at the ceiling', () => {
    expect(many(['a', 'b'], 'b', 2)).toEqual(['a']);
  });

  /** Never the same picture twice on a page. */
  it('does not add a duplicate', () => {
    expect(many(['a'], 'a')).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const before = ['a', 'b'];
    many(before, 'c');
    expect(before).toEqual(['a', 'b']);
  });
});

describe('togglePick, choosing one', () => {
  const one = (current: readonly string[], id: string) => togglePick(current, id, 'one', 1);

  it('replaces whatever was there', () => {
    expect(one(['m-01'], 'm-02')).toEqual(['m-02']);
  });

  /** Clearing the cover is how "use the newest photograph" is expressed. */
  it('clears on a second click of the same picture', () => {
    expect(one(['m-01'], 'm-01')).toEqual([]);
  });

  it('chooses from nothing', () => {
    expect(one(NONE, 'm-01')).toEqual(['m-01']);
  });
});
