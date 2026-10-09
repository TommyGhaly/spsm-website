'use client';

import { useEffect, useMemo, useState } from 'react';
import { shuffle } from '@spsm/shared';

/**
 * `list` in a random order, chosen once per visit — so a cycling tile does not
 * open on the same picture every time. See `gallery/sample.ts` in @spsm/shared.
 *
 * The first render returns the list unchanged, and the shuffle happens after
 * mount. That is not caution for its own sake: the header's Events menu is
 * prerendered into static HTML, and a `Math.random()` during render would give
 * the server one order and the browser another — a hydration mismatch, and a
 * visible jump. One frame in gallery order, then shuffled, costs nothing anyone
 * sees: the tiles cross-fade in from their loading state anyway.
 *
 * Stable while the set is the same set. `identity` names each item, and only a
 * change to *which* items are in the list draws a new order; a parent passing a
 * fresh array of the same pictures on every render does not reshuffle the tile
 * mid-cycle.
 */
export function useShuffled<T>(list: readonly T[], identity: (item: T) => string): readonly T[] {
  const key = list.map(identity).join('\n');
  const [order, setOrder] = useState<{ key: string; ids: string[] } | null>(null);

  useEffect(() => {
    setOrder({ key, ids: shuffle(key ? key.split('\n') : []) });
  }, [key]);

  return useMemo(() => {
    if (!order || order.key !== key) return list;
    const byId = new Map(list.map((item) => [identity(item), item]));
    return order.ids.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
    // `identity` is a lookup, not state; the key already captures the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, key, order]);
}
