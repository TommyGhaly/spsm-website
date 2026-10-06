/*
 * Measuring an upright wheel off the page: its frame, how tall it may grow, and
 * how tall one picture in it is. Shared by the height handle in `BlockFrame` and
 * the visitor's cap in `GallerySection`.
 */

/**
 * The upright wheel's frame inside a block: the still strip while editing, the
 * drifting one otherwise.
 */
export function stripIn(body: HTMLElement | null): HTMLElement | null {
  return body?.querySelector<HTMLElement>('.pstrip--y, .rail--y') ?? null;
}

/**
 * How tall an upright wheel may be, in px: one whole set of its pictures less the
 * shortest of them.
 *
 * Tommy: *"if there are 10 photos in the wheel it should be able to be 9 or 8
 * photos long."* Less the shortest rather than less the last, because which one is
 * last changes as it scrolls — this is the tallest the frame can be and still have
 * at least one picture out of sight to scroll to. Measured off the tiles of the
 * first set only, because the drifting rail draws its set two or three times over.
 */
export function wheelCap(strip: HTMLElement): number {
  const list = strip.matches('.pstrip--y') ? strip : strip.querySelector('ul');
  const cells = Array.from(list?.children ?? []).filter(
    (one): one is HTMLElement => one instanceof HTMLElement,
  );
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (!first || !last) return 0;
  const span =
    last.getBoundingClientRect().bottom - first.getBoundingClientRect().top;
  const shortest = Math.min(...cells.map((one) => one.getBoundingClientRect().height));
  return Math.max(span - shortest, 0);
}

/** Each picture's top and bottom, in px below the first picture's top. */
export function tileSpans(strip: HTMLElement): { top: number; bottom: number }[] {
  const list = strip.matches('.pstrip--y') ? strip : strip.querySelector('ul');
  const cells = Array.from(list?.children ?? []).filter(
    (one): one is HTMLElement => one instanceof HTMLElement,
  );
  const origin = cells[0]?.getBoundingClientRect().top ?? 0;
  return cells.map((one) => {
    const box = one.getBoundingClientRect();
    return { top: box.top - origin, bottom: box.bottom - origin };
  });
}
