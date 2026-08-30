'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Measure the masthead, and publish its height to CSS.
 *
 * ---------------------------------------------------------------------------
 * The sticky passport has to sit exactly under the masthead, and there is no
 * token that says how tall the masthead is. `--masthead-h` looks like one and
 * is not: it is declared as `5rem` and read by nothing else in the stylesheet,
 * while the bar itself is sized by its contents — 69px on a 375px phone and
 * 85px on a 1280px laptop. Offsetting against the token left an 11px strip of
 * page showing between the two bars on mobile, and hid 5px of the passport
 * behind the masthead on a laptop.
 *
 * Neither is fixable in CSS, because the number is not in CSS. So it is
 * measured, once before the first paint and again whenever the bar changes
 * size, and written onto the tour's root element as `--tour-masthead-h`. The
 * passport's `top` and every station's `scroll-margin-top` read it from there.
 *
 * **Before the paint, not after.** The passport carries a `transition` on `top`
 * so that it tracks the masthead when the masthead slides itself out of the
 * way. An effect that measured *after* the first paint would therefore animate
 * the correction from the 5rem fallback down to the real height — an 11px
 * shuffle of the whole bar on every single page load, for no reason. A layout
 * effect runs after the DOM is in place and before the browser paints, so the
 * value is simply right the first time. `tour-measured` is the belt to that
 * brace: the transition is only armed once a real measurement has landed, so
 * even where a layout effect is skipped there is nothing to animate.
 *
 * `useLayoutEffect` warns when React renders on the server, and this page is
 * pre-rendered — hence the isomorphic alias below rather than a bare import.
 *
 * A `ResizeObserver` rather than a resize listener: the masthead is a container
 * query context, and its height also changes when the parish edits the theme's
 * type scale at runtime, which no window resize accompanies.
 *
 * Nothing is written when the masthead cannot be found. The CSS keeps `5rem` as
 * its fallback — the wrong number, but a survivable one, where `0px` would drop
 * the passport over the top of the page.
 * ---------------------------------------------------------------------------
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useChromeHeight(root: RefObject<HTMLElement | null>): void {
  useIsomorphicLayoutEffect(() => {
    const masthead = document.querySelector('.masthead');
    const node = root.current;
    if (!masthead || !node) return undefined;

    const publish = () => {
      node.style.setProperty(
        '--tour-masthead-h',
        `${Math.round(masthead.getBoundingClientRect().height)}px`,
      );
    };
    publish();

    /*
     * Commit that first value *before* arming the transition.
     *
     * Reading `offsetHeight` forces the browser to flush style and layout, so
     * the passport's `top` settles on the measured height while nothing is
     * transitionable. Adding the class afterwards changes `transition-property`
     * and nothing else, so there is no pending change for it to animate.
     *
     * Setting both in one go — which is what this did first — arms the
     * transition and changes `top` in the same style recalculation, and the bar
     * visibly slides 11px up the screen on every load. The read looks like a
     * line that does nothing and is the entire fix; do not tidy it away.
     */
    void node.offsetHeight;
    node.classList.add('tour-measured');

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(publish);
    observer.observe(masthead);
    return () => observer.disconnect();
  }, [root]);
}
