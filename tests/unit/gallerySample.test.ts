import { describe, expect, it } from 'vitest';
import { shuffle, spreadAcross } from '@spsm/shared';

/**
 * Which few photographs a cycling tile shows, and in what order — see
 * packages/shared/src/gallery/sample.ts. The complaint these answer: a tile of
 * a 600-photograph camp showed the same first five, opening on the same one.
 */
describe('spreadAcross', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i);

  it('takes a cross-section, first and last included', () => {
    expect(spreadAcross(hundred, 5)).toEqual([0, 25, 50, 74, 99]);
  });

  it('never repeats an item', () => {
    const picked = spreadAcross(hundred, 8);
    expect(new Set(picked).size).toBe(8);
  });

  it('returns a short list whole, and nothing for nothing', () => {
    expect(spreadAcross([1, 2, 3], 8)).toEqual([1, 2, 3]);
    expect(spreadAcross(hundred, 0)).toEqual([]);
    expect(spreadAcross([], 5)).toEqual([]);
    expect(spreadAcross(hundred, 1)).toEqual([0]);
  });
});

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    expect([...shuffle(list)].sort()).toEqual(list);
  });

  it('does not touch the original', () => {
    const list = [1, 2, 3];
    shuffle(list);
    expect(list).toEqual([1, 2, 3]);
  });

  it('can open on something other than the first', () => {
    // A generator that always picks index 0 swaps the first item to the end.
    expect(shuffle([1, 2, 3, 4], () => 0)[0]).not.toBe(1);
  });
});
