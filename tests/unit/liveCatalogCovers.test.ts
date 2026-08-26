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
  const A = 'https://items-images.s3.amazonaws.com/files/aaa/original.jpeg';
  const B = 'https://items-images.s3.amazonaws.com/files/bbb/original.jpeg';

  it('keeps the optimised covers while Square still lists the same pictures', () => {
    // The only case where the baked WebP pair is still a copy of the truth.
    expect(keepsBakedImages([A], [A])).toBe(true);
    expect(keepsBakedImages([A, B], [A, B])).toBe(true);
  });

  it('yields when a picture was deleted in Square', () => {
    /*
     * The behaviour asked for: "when I decide to delete them they should
     * delete." An emptied list is Square saying the photograph is gone, and the
     * shop shows its placeholder rather than a file the build happens to hold.
     */
    expect(keepsBakedImages([A], [])).toBe(false);
  });

  it('yields when a picture was added, replaced, or reordered', () => {
    /*
     * Counting could not see any of these. `[A]` → `[A, B]` is arity 1→2 and was
     * caught, but `[A]` → `[B]` is 1→1 — a match under the old rule — and so was
     * a book gaining its *first* photograph while the build already had a cover
     * for it. That second case is the one Tommy hit: he uploaded a photo to The
     * Eucharist, it reached Square and Firestore, and the card never changed.
     */
    expect(keepsBakedImages([A], [B])).toBe(false);
    expect(keepsBakedImages([A], [A, B])).toBe(false);
    expect(keepsBakedImages([A, B], [B, A])).toBe(false);
  });

  it('claims nothing for a product the build never baked', () => {
    // `bakedFrom` is null when the build used Square's own URLs, and absent on a
    // product it never saw. Either way there is no optimised copy to protect.
    expect(keepsBakedImages(null, [A])).toBe(false);
    expect(keepsBakedImages(undefined, [])).toBe(false);
    expect(keepsBakedImages([], [])).toBe(false);
  });
});
