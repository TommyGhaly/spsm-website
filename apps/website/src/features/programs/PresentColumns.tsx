'use client';

import { useMemo } from 'react';
import type { DocOf, GalleryMedia } from '@spsm/shared';
import { DragRail } from '@/components/DragRail';
import { PresentMedia } from './PresentParts';

/**
 * The columns: the hall screen that never stops moving.
 *
 * Several columns of photographs, side by side, filling the screen and drifting
 * continuously, with adjacent columns drifting in **opposite directions** —
 * which is what makes it read as a composition in motion rather than as a list
 * going past. There is no slide, no timer, and nothing to advance.
 *
 * ## What this replaced, and why it is still the default
 *
 * One photograph at a time, held for eight seconds, cross-fading to the next.
 * That is a slideshow, and a slideshow on a wall reads as a screensaver — for
 * seven of every eight seconds nothing at all is happening, and what is on
 * screen is one picture surrounded by empty ground. Tommy's word for it was
 * "unprofessional", and the diagnosis in the same breath was the fix: *a
 * collage, moving by itself*.
 *
 * A slide is a choice again — see PresentSlide.tsx, and note what it had to do
 * about the empty ground to earn its way back. This stays the default because it
 * is the one that can be started and left alone.
 *
 * ## It reuses the section rails rather than reimplementing them
 *
 * Each column is a `DragRail axis="y"`, the same component a `column` section
 * uses on a public page. That is not code-sharing for its own sake: the endless
 * loop, the sub-pixel drift accumulation, the tab-away clamp and the
 * reduced-motion opt-out are all subtle, all already solved there, and a second
 * implementation of them would be a second set of the same bugs. A negative
 * `speed` is all "drift downward" takes — `wrap` has always folded negative
 * positions back into range.
 */

/**
 * Drift speeds, in px/s, cycled across the columns.
 *
 * Signs alternate so neighbouring columns move against each other. The
 * magnitudes are deliberately close but not equal: identical speeds make the
 * columns read as one sheet sliding, and wildly different ones read as a fault.
 *
 * Slower than the ministries rail on the homepage (75px/s), because that strip
 * is asking to be read and this one is asking to be looked at. At 34px/s a
 * portrait crosses a 900px column in about half a minute.
 *
 * These are the `steady` numbers. The pace control multiplies all of them by one
 * factor, so the alternation and the near-but-not-equal spacing survive at every
 * speed — see `PACE_FACTORS` in route.ts.
 */
const SPEEDS = [34, -28, 40, -32, 30, -36] as const;

/**
 * The most columns to draw, by viewport width.
 *
 * Four is the point where a photograph in a column is still a photograph on a
 * 1440px screen. Two on a phone — one column is not a collage, and three is a
 * set of stamps.
 */
function columnsFor(width: number): number {
  if (width < 700) return 2;
  if (width < 1180) return 3;
  return 4;
}

export function PresentColumns({
  media,
  width,
  factor,
}: {
  media: readonly DocOf<GalleryMedia>[];
  /** The viewport's width, from the shell, which is already watching it. */
  width: number;
  /** The pace, as a multiplier on the drift. See `PACE_FACTORS` in route.ts. */
  factor: number;
}) {
  /**
   * The pictures, dealt into columns.
   *
   * Dealt round-robin rather than cut into blocks, and that matters: a gallery is
   * ordered, usually chronologically, so consecutive photographs are of the same
   * moment from the same place. Cut into four blocks, each column would be a
   * quarter of the afternoon and the screen would show four unrelated scenes.
   * Dealt, each column carries a spread of the whole set and the screen looks
   * like the camp rather than like four lists.
   *
   * Capped at as many columns as there is material for. Four columns holding one
   * photograph each is not a collage, and a column with one item cannot loop —
   * `DragRail` correctly refuses to drift a strip that already fits.
   */
  const lanes = useMemo(() => {
    if (media.length === 0) return [];
    const count = Math.max(1, Math.min(columnsFor(width), Math.ceil(media.length / 2)));
    const dealt: DocOf<GalleryMedia>[][] = Array.from({ length: count }, () => []);
    media.forEach((item, index) => {
      dealt[index % count]?.push(item);
    });
    return dealt;
  }, [media, width]);

  return (
    <div className="columns__lanes">
      {lanes.map((lane, index) => (
        <DragRail
          // The lane's position in the row *is* its identity — remounting on a
          // resize is what re-deals the pictures, which is intended.
          key={`lane-${index}-of-${lanes.length}`}
          axis="y"
          className="rail--columns"
          /*
            `?? SPEEDS[0]` because `noUncheckedIndexedAccess` types a modular
            index as possibly undefined, and `exactOptionalPropertyTypes` then
            refuses to pass that to an optional prop. The modulo means it can
            never actually be undefined; the fallback says so in a way the
            compiler accepts without an assertion.
          */
          speed={(SPEEDS[index % SPEEDS.length] ?? SPEEDS[0]) * factor}
        >
          <ul className="columns__lane">
            {/*
              The tile carries no shape of its own any more. The column's width is
              fixed and the photograph's own ratio decides the height — at Tommy's
              direction, and see `PresentMedia`: the shape lives on the picture, so
              a lane is as tall as the pictures in it rather than the pictures
              being cropped to fit tiles.
            */}
            {lane.map((item) => (
              <li key={item.id}>
                <PresentMedia item={item} fit="width" />
              </li>
            ))}
          </ul>
        </DragRail>
      ))}
    </div>
  );
}
