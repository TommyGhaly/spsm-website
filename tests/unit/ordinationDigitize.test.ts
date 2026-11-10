import { describe, expect, it } from 'vitest';
import { digitizeSignature, suggestThreshold } from '@/features/ordination/digitize';
import { parseOrdinationSignatureProfile, sameOrdinationSigner } from '@spsm/shared';

/** A white `w`×`h` page with black ink at the given cells. */
function page(w: number, h: number, ink: [number, number][], paper = 250): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([paper, paper, paper, 255], i * 4);
  for (const [x, y] of ink) data.set([10, 10, 10, 255], (y * w + x) * 4);
  return data;
}

describe('digitizeSignature', () => {
  it('keeps the ink as black, the paper as transparent, cropped to the ink', () => {
    const out = digitizeSignature(page(20, 10, [[5, 3], [8, 4]]), 20, 10, 128, 1)!;
    expect(out.width).toBe(6);
    expect(out.height).toBe(4);
    const alphas = Array.from({ length: out.width * out.height }, (_, i) => out.data[i * 4 + 3]);
    expect(alphas.filter((a) => a === 255)).toHaveLength(2);
    expect(alphas.filter((a) => a === 0)).toHaveLength(22);
    for (let i = 0; i < out.data.length; i += 4) expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([0, 0, 0]);
  });

  it('finds nothing on a blank page', () => {
    expect(digitizeSignature(page(10, 10, []), 10, 10, 128)).toBeNull();
  });

  it('treats a grey shadow as paper at a low setting and ink at a high one', () => {
    const shaded = page(4, 4, [], 150);
    expect(digitizeSignature(shaded, 4, 4, 100)).toBeNull();
    expect(digitizeSignature(shaded, 4, 4, 200)).not.toBeNull();
  });

  it('suggests a threshold between ink and paper', () => {
    const t = suggestThreshold(page(20, 20, Array.from({ length: 40 }, (_, i) => [i % 20, Math.floor(i / 20)] as [number, number])));
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(250);
  });
});

describe('signature library', () => {
  it('owns an older signature by the uid it is kept at', () => {
    expect(parseOrdinationSignatureProfile({ name: 'Fr. A', image: '' }, 'priest-1').ownerUid).toBe('priest-1');
    expect(parseOrdinationSignatureProfile({ name: 'Fr. A', ownerUid: 'x' }, 'sig').ownerUid).toBe('x');
  });

  it('tells signers apart by name, ignoring case and spacing', () => {
    expect(sameOrdinationSigner({ name: ' Fr.  Mina ' }, { name: 'fr. mina' })).toBe(true);
    expect(sameOrdinationSigner({ name: 'Fr. Mina' }, { name: 'Fr. Mark' })).toBe(false);
  });
});
