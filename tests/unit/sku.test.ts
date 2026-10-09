import { describe, expect, it } from 'vitest';
import { formatSku, nextSkuNumber, parseSku } from '@spsm/shared';

/**
 * Bookstore SKUs — `SPSM-0001` and up.
 *
 * The property that matters is that no number is handed out twice. The counter
 * and the catalog can each be ahead of the other (a create whose Square write
 * failed; a SKU typed by hand at the register), so the next number has to clear
 * both, and these tests are mostly about that.
 */
describe('formatSku', () => {
  it('pads to four digits', () => {
    expect(formatSku(1)).toBe('SPSM-0001');
    expect(formatSku(42)).toBe('SPSM-0042');
  });

  it('grows past 9999 rather than wrapping', () => {
    expect(formatSku(12345)).toBe('SPSM-12345');
  });
});

describe('parseSku', () => {
  it('reads its own format back, case and padding aside', () => {
    expect(parseSku('SPSM-0042')).toBe(42);
    expect(parseSku(' spsm-7 ')).toBe(7);
  });

  it('ignores anything that is not one of ours', () => {
    for (const other of ['978-0-123456-47-2', 'BK-0001', 'SPSM-', 'SPSM-0000', '', null, undefined]) {
      expect(parseSku(other)).toBeNull();
    }
  });
});

describe('nextSkuNumber', () => {
  it('starts at one on an unnumbered shop', () => {
    expect(nextSkuNumber([], 0)).toBe(1);
    expect(nextSkuNumber([null, undefined, 'ISBN 123'], 0)).toBe(1);
  });

  it('follows the counter when the counter is ahead', () => {
    // A reservation whose Square write failed leaves a gap, never a repeat.
    expect(nextSkuNumber(['SPSM-0003'], 9)).toBe(10);
  });

  it('follows the catalog when the catalog is ahead', () => {
    // Somebody typed SPSM-0050 at the register.
    expect(nextSkuNumber(['SPSM-0002', 'SPSM-0050', 'SPSM-0007'], 7)).toBe(51);
  });

  it('does not fill gaps', () => {
    // Filling SPSM-0002 would hand out a number that may be on a shelf label.
    expect(nextSkuNumber(['SPSM-0001', 'SPSM-0003'], 0)).toBe(4);
  });

  it('treats a nonsense counter as zero', () => {
    expect(nextSkuNumber(['SPSM-0004'], Number.NaN)).toBe(5);
    expect(nextSkuNumber([], -3)).toBe(1);
  });
});
