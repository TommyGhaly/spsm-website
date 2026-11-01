'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { shuffle, spreadAcross } from '@spsm/shared';

/**
 * `count` items drawn at random from `pool`, with one swapped for a fresh draw
 * on every turn of a cycling tile — so the tile wanders the whole event rather
 * than shuffling the same handful. Tommy: *"choose random images from any of
 * the images in the entire event, not shuffling the same ones."*
 *
 * Only `count` are ever in hand, because every one of them is an `<img>` in the
 * DOM at once (that is what makes the cross-fade a fade). The swap happens to
 * the picture that left the screen *two* turns ago: the one that left one turn
 * ago is still fading out, and replacing it would cut it off mid-fade. The new
 * one then has `count - 2` turns to load before its own turn comes round.
 *
 * `shot` is the tile's counter, read as `shot % length` by the caller. Either a
 * counter that climbs or one that wraps works — only a change of it matters.
 *
 * The first render is `spreadAcross`, deterministic, for the same reason
 * `useShuffled` waits for mount: a `Math.random()` during render gives the
 * server one answer and the browser another.
 */
export function useRandomDraw<T>(
  pool: readonly T[],
  identity: (item: T) => string,
  count: number,
  shot: number,
): readonly T[] {
  const key = pool.map(identity).join('\n');
  const [drawn, setDrawn] = useState<{ key: string; ids: string[] } | null>(null);

  // A fresh hand whenever the pool itself changes.
  useEffect(() => {
    setDrawn({ key, ids: shuffle(key ? key.split('\n') : []).slice(0, count) });
  }, [key, count]);

  const lastShot = useRef(shot);
  useEffect(() => {
    if (shot === lastShot.current) return;
    lastShot.current = shot;
    setDrawn((was) => {
      // Fewer than three and the slot two turns back is the one on screen.
      if (!was || was.key !== key || was.ids.length < 3) return was;
      const inHand = new Set(was.ids);
      const unseen = key.split('\n').filter((id) => !inHand.has(id));
      if (unseen.length === 0) return was;
      const ids = [...was.ids];
      const slot = (((shot - 2) % ids.length) + ids.length) % ids.length;
      ids[slot] = unseen[Math.floor(Math.random() * unseen.length)]!;
      return { key, ids };
    });
  }, [shot, key]);

  return useMemo(() => {
    if (!drawn || drawn.key !== key) return spreadAcross(pool, count);
    const byId = new Map(pool.map((item) => [identity(item), item]));
    return drawn.ids.flatMap((id) => {
      const item = byId.get(id);
      return item === undefined ? [] : [item];
    });
    // `identity` is a lookup, not state; the key already captures the pool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, key, drawn, count]);
}
