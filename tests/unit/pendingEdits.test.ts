import { describe, it, expect } from 'vitest';
import {
  hasImageEdits,
  nextEditsAfterNudge,
  settle,
  type ActualValues,
  type PendingEdit,
} from '../../apps/website/src/features/bookstore/pendingEdits';

/**
 * The stepper's arithmetic, held rather than sent.
 *
 * ---------------------------------------------------------------------------
 * The first version of the save-bar work computed the next count in the
 * component — `setStock(shown + 1)` — and shipped a bug this codebase has now
 * produced twice. Six quick presses on one card are six updates inside a single
 * React batch, and every one of them read `shown` from the render that was on
 * screen when the run began, so all six wrote the same number. Measured in the
 * browser: nine clicks across two books moved each of them by one.
 *
 * The fix was to do the arithmetic against the *previous* held edits, which is
 * what this function is. So the test that matters is the fold: apply the nudge
 * repeatedly, feeding each result into the next call, exactly as React does.
 * ---------------------------------------------------------------------------
 */

const BOOK: ActualValues = { stockCount: 4, section: null };

/** A run of presses, each one applied to what the last one returned. */
function press(
  times: number,
  by: number,
  actual: ActualValues,
  from: Record<string, PendingEdit> = {},
  slug = 'holy-bible',
) {
  let edits = from;
  for (let i = 0; i < times; i += 1) edits = nextEditsAfterNudge(edits, slug, by, actual);
  return edits;
}

describe('holding a stock edit', () => {
  it('accumulates a fast run of presses instead of collapsing them', () => {
    expect(press(6, 1, BOOK)['holy-bible']).toEqual({ stockCount: 10 });
  });

  it('counts down the same way', () => {
    expect(press(3, -1, BOOK)['holy-bible']).toEqual({ stockCount: 1 });
  });

  it('stops at zero rather than going negative', () => {
    // Ten presses down from four. A negative count would be rejected by Square
    // and is not a state the shop can show.
    expect(press(10, -1, BOOK)['holy-bible']).toEqual({ stockCount: 0 });
  });

  it('drops the edit when a run returns to where it started', () => {
    const up = press(3, 1, BOOK);
    const back = press(3, -1, BOOK, up);

    // Not "stockCount: 4" — no entry at all, so the card stops saying "Edited"
    // and the bar stops counting it.
    expect(back).toEqual({});
  });

  it('keeps a held category when the count returns to its saved value', () => {
    /*
     * The bug that "release the whole book when the count matches again" would
     * reintroduce: the category change made a moment earlier would vanish, the
     * card would look clean, and Save would send nothing.
     */
    const withSection = { 'holy-bible': { section: 'icons' } as PendingEdit };
    const up = press(2, 1, { ...BOOK, section: null }, withSection);
    const back = press(2, -1, { ...BOOK, section: null }, up);

    expect(back['holy-bible']).toEqual({ section: 'icons', stockCount: 4 });
  });

  it('leaves an untracked book alone — the arrows are not how that is changed', () => {
    const untracked: ActualValues = { stockCount: null, section: null };
    expect(press(4, 1, untracked)).toEqual({});
  });

  it('does not disturb other books', () => {
    const first = press(2, 1, BOOK, {}, 'holy-bible');
    const both = press(1, 1, { stockCount: 0, section: null }, first, 'the-eucharist');

    expect(both).toEqual({
      'holy-bible': { stockCount: 6 },
      'the-eucharist': { stockCount: 1 },
    });
  });

  it('never mutates the object it was given', () => {
    const before: Record<string, PendingEdit> = { 'holy-bible': { stockCount: 9 } };
    const snapshot = structuredClone(before);

    nextEditsAfterNudge(before, 'holy-bible', 1, BOOK);

    expect(before).toEqual(snapshot);
  });
});

/**
 * Pictures, held until Save.
 *
 * These were sent the moment they were chosen until 2026-09-01, when Tommy asked
 * for the opposite: *"it should wait for me to click save before it tries to
 * save."* Holding them introduces one hazard the immediate version could not
 * have — a book's edit is now a *set* of things, and any code that decides "this
 * book is back to normal, drop it" has to consider all of them. That decision
 * has already silently discarded a field once in this file's history, which is
 * why every case below is about the discard and not about the pictures.
 */
describe('holding pictures', () => {
  const actual: ActualValues = { stockCount: 3, section: 'theology' };
  const picture = { id: 'p1', dataUrl: 'data:image/webp;base64,AAAA' };

  describe('hasImageEdits', () => {
    it('is false for nothing, an absent list and an empty one', () => {
      expect(hasImageEdits(undefined)).toBe(false);
      expect(hasImageEdits({})).toBe(false);
      expect(hasImageEdits({ addImages: [], removeImages: [] })).toBe(false);
    });

    it('is true for either kind of picture work', () => {
      expect(hasImageEdits({ addImages: [picture] })).toBe(true);
      expect(hasImageEdits({ removeImages: ['https://items.sq/a.jpg'] })).toBe(true);
    });
  });

  describe('settle', () => {
    it('drops the book when every field is back where it started', () => {
      const was: Record<string, PendingEdit> = { 'holy-bible': { addImages: [picture] } };
      expect(settle(was, 'holy-bible', { addImages: [] }, actual)).toEqual({});
    });

    it('keeps a held count when the last picture is taken back off', () => {
      const was: Record<string, PendingEdit> = {
        'holy-bible': { stockCount: 7, addImages: [picture] },
      };
      const next = settle(was, 'holy-bible', { stockCount: 7, addImages: [] }, actual);
      expect(next['holy-bible']).toEqual({ stockCount: 7, addImages: [] });
    });

    it('keeps a held category when the last removal is put back', () => {
      const was: Record<string, PendingEdit> = {
        'holy-bible': { section: 'lives', removeImages: ['https://items.sq/a.jpg'] },
      };
      const next = settle(was, 'holy-bible', { section: 'lives', removeImages: [] }, actual);
      expect(next['holy-bible']).toEqual({ section: 'lives', removeImages: [] });
    });

    it('keeps the book when a picture is still held but the count is unchanged', () => {
      const next = settle({}, 'holy-bible', { stockCount: 3, addImages: [picture] }, actual);
      expect(next['holy-bible']?.addImages).toHaveLength(1);
    });
  });

  /**
   * The regression that matters most: stepping a count back to where it began
   * must not throw away a photograph chosen a moment earlier. The same shape of
   * fault ate a category change before the `heldSection` check was added.
   */
  describe('nextEditsAfterNudge with pictures held', () => {
    it('keeps a held picture when the count returns to its original value', () => {
      const was: Record<string, PendingEdit> = {
        'holy-bible': { stockCount: 4, addImages: [picture] },
      };
      const next = nextEditsAfterNudge(was, 'holy-bible', -1, actual);

      expect(next['holy-bible']).toBeDefined();
      expect(next['holy-bible']?.addImages).toEqual([picture]);
      expect(next['holy-bible']?.stockCount).toBe(3);
    });

    it('still drops the book when the count returns and no picture is held', () => {
      const was: Record<string, PendingEdit> = { 'holy-bible': { stockCount: 4 } };
      expect(nextEditsAfterNudge(was, 'holy-bible', -1, actual)).toEqual({});
    });

    it('keeps a held removal across the same round trip', () => {
      const was: Record<string, PendingEdit> = {
        'holy-bible': { stockCount: 4, removeImages: ['https://items.sq/a.jpg'] },
      };
      const next = nextEditsAfterNudge(was, 'holy-bible', -1, actual);
      expect(next['holy-bible']?.removeImages).toEqual(['https://items.sq/a.jpg']);
    });
  });
});
