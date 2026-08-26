import { describe, expect, it } from 'vitest';
import { keepsBakedImages } from '../../apps/website/src/features/bookstore/useLiveCatalog';

/**
 * Which pictures survive /bookstore's live refresh.
 *
 * ---------------------------------------------------------------------------
 * This exists because the rule failed in the one direction that is invisible.
 *
 * The shop is prerendered with the build's optimised covers and then swaps in a
 * live Firestore read, so a book added in Square appears without a deploy. The
 * swap used to keep the baked images only when the document listed *the same
 * number* of pictures — which quietly excluded the case where the document lists
 * none, and every product in the parish's mirror lists none, because the mirror
 * is pointed at Square's sandbox and the sandbox has no photographs on its
 * items.
 *
 * So a second after /bookstore loaded, all eleven covers became title
 * placeholders. Nothing errored, nothing moved, and the homepage — server
 * rendered, never running this swap — went on showing the same books with their
 * photographs, which is exactly how it was reported: "the photos are not showing
 * up but they do show up on the homepage".
 *
 * The counts are the whole input, so they are the whole test.
 * ---------------------------------------------------------------------------
 */
describe('keepsBakedImages', () => {
  it('keeps the build’s covers when the document lists no pictures', () => {
    // The regression. Every product in the live mirror looks like this.
    expect(keepsBakedImages(1, 0)).toBe(true);
    expect(keepsBakedImages(3, 0)).toBe(true);
  });

  it('keeps them when the count is unchanged', () => {
    // Nothing happened to the pictures, and the baked pair is the optimised one
    // — Square's URL is the 3105px original with no resize parameter.
    expect(keepsBakedImages(1, 1)).toBe(true);
    expect(keepsBakedImages(4, 4)).toBe(true);
  });

  it('yields to the live list when a picture was genuinely added or removed', () => {
    // A real contradiction: slower images beat wrong ones.
    expect(keepsBakedImages(1, 2)).toBe(false);
    expect(keepsBakedImages(3, 1)).toBe(false);
  });

  it('has nothing to keep for a product the build never saw', () => {
    // Falls through to Square's own URL, which is the point of the live read.
    expect(keepsBakedImages(0, 0)).toBe(false);
    expect(keepsBakedImages(0, 2)).toBe(false);
  });
});
