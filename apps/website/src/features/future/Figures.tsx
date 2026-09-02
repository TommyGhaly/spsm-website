'use client';

import { useEffect, useRef, useState } from 'react';
import { HEADLINE } from './plan';

/**
 * How long the count takes, in milliseconds. Short enough that a reader who
 * looks straight at it is not waiting, long enough to register as movement.
 */
const RUN = 1100;

/** `1 - (1 - t)^3`. Fast at the start, settling at the end — a number that
    decelerates into place reads as arriving; a linear one reads as a stopwatch. */
const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * The four headline numbers, counting up the first time they are seen.
 *
 * ---------------------------------------------------------------------------
 * **The server renders the final values, and this only ever animates *down*
 * from them and back.** Which is the whole trick: the HTML on disk says
 * `119,458`, so a reader with JavaScript off, a search engine, and anybody who
 * scrolls past before the observer fires all get the real figure. The
 * animation is an enhancement laid over correct output, not the thing that
 * produces it — the opposite arrangement is how a page ends up shipping four
 * zeroes to Google.
 *
 * Once only, on entering view. A number that re-counts every time it scrolls
 * back into frame is a page that will not sit still, and this one is asking to
 * be believed rather than admired.
 *
 * **`prefers-reduced-motion` is honoured by not starting at all**, rather than
 * by shortening it. Someone who has asked their machine for less movement is
 * not asking for faster movement.
 * ---------------------------------------------------------------------------
 */
export function Figures() {
  const list = useRef<HTMLUListElement>(null);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        const started = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - started) / RUN);
          setProgress(ease(t));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        setProgress(0);
        frame = requestAnimationFrame(tick);
      },
      /* Fire when a third of the row is showing rather than the first pixel:
         these sit at the bottom of a tall band and a count that finishes before
         the reader's eye arrives has not happened as far as they are concerned. */
      { threshold: 0.34 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ul className="future-figures" ref={list}>
      {HEADLINE.map((figure) => {
        /*
         * The value is a display string — "119,458", "5.5" — and the animation
         * has to leave it exactly as authored at rest. So it is parsed for the
         * count and re-rendered in the *source's* shape: the same number of
         * decimal places, and thousands separators only where the source had
         * them. Formatting the interpolated value with a fixed rule instead is
         * how "5.5" becomes "6" a third of the way through and "5" at the end.
         */
        const decimals = (figure.value.split('.')[1] ?? '').length;
        const target = Number(figure.value.replace(/,/g, ''));
        const shown = Number.isFinite(target)
          ? (target * progress).toLocaleString('en-US', {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
              useGrouping: figure.value.includes(','),
            })
          : figure.value;

        return (
          <li key={figure.label} className="future-figure">
            {/*
              `tabular-nums` is on this element in CSS, so the width does not
              jitter as the digits change. Without it the whole row shuffles
              sideways for a second, which is the thing that makes a counting
              number look cheap.
            */}
            <p className="future-figure__value">{shown}</p>
            <p className="future-figure__label">{figure.label}</p>
            <p className="future-figure__note">{figure.note}</p>
          </li>
        );
      })}
    </ul>
  );
}
