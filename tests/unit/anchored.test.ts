import { describe, it, expect } from 'vitest';
import {
  ANCHOR_GAP,
  ANCHOR_MARGIN,
  ANCHOR_MIN_ROOM,
  placeBeside,
} from '../../apps/website/src/components/anchored.js';

/**
 * Where a floating panel goes.
 *
 * Worth testing rather than eyeballing, and the reason is the bug that prompted
 * it: the events editor's date popover and the galleries' properties panel share
 * this arithmetic, the galleries' anchors are *photographs and window-tall
 * ministry plates*, and a plate 686px high in a 900px window produced a 160px
 * letterbox pinned over the masthead. That is a wrong number, not a wrong taste,
 * and a number is something a test can hold.
 *
 * Everything here is pure: two rectangles and a viewport in, coordinates out. No
 * DOM, no browser, which is exactly why the module was split out of `Popover`.
 */

/** A viewport the size of the laptop this project is designed against. */
const laptop = { width: 1280, height: 800 };

function rect(top: number, height: number, left = 100, width = 200) {
  return { top, bottom: top + height, left, right: left + width };
}

describe('placeBeside', () => {
  it('sits under the anchor when there is room', () => {
    const at = placeBeside(rect(100, 30), { width: 320, height: 240 }, laptop);

    expect(at.flipped).toBe(false);
    expect(at.cramped).toBe(false);
    expect(at.top).toBe(130 + ANCHOR_GAP);
    // Left-aligned with the anchor, which is what makes a panel read as
    // belonging to the words above it.
    expect(at.left).toBe(100);
  });

  it('flips above when below is short and above is roomier', () => {
    // 60px under the anchor, 640 over it.
    const at = placeBeside(rect(660, 80), { width: 320, height: 300 }, laptop);

    expect(at.flipped).toBe(true);
    expect(at.cramped).toBe(false);
    // Its bottom edge sits a gap above the anchor's top.
    expect(at.top + Math.min(300, at.maxHeight)).toBeLessThanOrEqual(660 - ANCHOR_GAP);
  });

  it('prefers below even when below is slightly tighter, rather than jumping', () => {
    /*
     * The bias is deliberate and this is the test that pins it. A panel that
     * flips the moment below is one pixel short jumps about as somebody scrolls;
     * `flipped` requires the panel to actually not fit *and* above to be strictly
     * better.
     */
    const at = placeBeside(rect(300, 40), { width: 320, height: 100 }, laptop);
    expect(at.flipped).toBe(false);
  });

  describe('an anchor with no usable side', () => {
    /*
     * The /events case, with the real numbers off a 1280x900 window: a ministry
     * plate 686px high starting at y=147 leaves 47px below and 127px above. The
     * old arithmetic took the larger of the two and clamped to a 160px floor,
     * which is where the letterbox came from.
     */
    const plate = rect(147, 686, 0, 917);

    it('reports itself cramped rather than picking the least bad side', () => {
      const at = placeBeside(plate, { width: 416, height: 264 }, { width: 1280, height: 900 });
      expect(at.cramped).toBe(true);
    });

    it('never offers less than a usable height', () => {
      const at = placeBeside(plate, { width: 416, height: 264 }, { width: 1280, height: 900 });
      expect(at.maxHeight).toBeGreaterThanOrEqual(ANCHOR_MIN_ROOM);
    });

    it('is not cramped for an ordinary small anchor', () => {
      const at = placeBeside(rect(200, 24), { width: 320, height: 240 }, laptop);
      expect(at.cramped).toBe(false);
    });
  });

  describe('staying inside the window', () => {
    it('pulls a panel back from the right edge', () => {
      const at = placeBeside(rect(100, 30, 1200, 60), { width: 400, height: 200 }, laptop);
      expect(at.left).toBe(laptop.width - 400 - ANCHOR_MARGIN);
    });

    it('never returns a negative left, even when the panel is wider than the window', () => {
      /*
       * The two clamp bounds cross over here — `window - panel - margin` is
       * negative — and without the outer `Math.max` the inner `Math.min` returns
       * it. A panel at a negative left has its own left edge off screen, which is
       * the half holding the labels.
       */
      const at = placeBeside(rect(100, 30), { width: 900, height: 200 }, { width: 375, height: 800 });
      expect(at.left).toBe(ANCHOR_MARGIN);
    });

    it('right-aligns to the anchor when asked', () => {
      const at = placeBeside(
        rect(100, 30, 900, 120),
        { width: 300, height: 200 },
        laptop,
        { align: 'end' },
      );
      // 900 + 120 - 300
      expect(at.left).toBe(720);
    });

    it('keeps a flipped panel below the top margin', () => {
      const at = placeBeside(rect(40, 20), { width: 320, height: 600 }, { width: 1280, height: 300 });
      expect(at.top).toBeGreaterThanOrEqual(ANCHOR_MARGIN);
    });
  });
});
