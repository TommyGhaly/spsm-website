'use client';

import { useEffect, useRef } from 'react';

/**
 * The sticky masthead, which gets out of the way while you read and comes back
 * when you ask for it.
 *
 * The bar is 5rem of dark red pinned to the top of every page. On a phone that
 * is a sixth of the viewport spent on navigation nobody is using while they
 * read an event description, and on the homepage it sits over the hero. So it
 * slides up once you are past it, and returns on any of the three signals that
 * mean "I want the nav":
 *
 *   - scrolling **up**, which is the gesture everyone already knows;
 *   - moving the pointer into the top of the window, which is where you go
 *     looking for a nav bar that isn't there;
 *   - focusing anything inside it, so a keyboard user tabbing out of the skip
 *     link is not tabbing into an element parked off-screen.
 *
 * The pointer reveal is the only one that is **on loan**: move the mouse back
 * down the page and the bar goes away again, because you were evidently looking
 * at the page rather than at the navigation. A reveal from a scroll up or from
 * focus is not taken back that way — those were asked for. See `byPointer`.
 *
 * This wraps the `<header>` in the **root layout**, so it is every page of the
 * site with no per-page opt-in, and there is nowhere for a page to forget it.
 *
 * ---------------------------------------------------------------------------
 * Three things here are deliberate and easy to undo by accident.
 *
 * **The class is toggled on the DOM node, not held in React state.** `scroll`
 * and `pointermove` both fire at frame rate; a `useState` here would re-render
 * the whole header — wordmark, eight nav links, the auth control — on every
 * frame of every scroll. `classList.toggle` is a no-op when the class is
 * already in the state asked for, so the common case costs nothing.
 *
 * **It refuses to hide while something inside it is open.** `.nav-panel` is
 * absolutely positioned against `.masthead`, so hiding the bar takes the whole
 * open menu with it — on a phone, mid-scroll, the navigation would simply
 * vanish. `[aria-expanded="true"]` catches both the nav toggle and the account
 * menu without this component having to know either exists.
 *
 * **`prefers-reduced-motion` disables the whole behaviour**, rather than
 * removing the transition and keeping the hiding. A bar that teleports away is
 * a worse answer than one that stays put, and staying put is what the header
 * did before this and is not a broken state.
 * ---------------------------------------------------------------------------
 */

/**
 * How far down the page the bar has to be before it is allowed to leave.
 *
 * Roughly the height of the bar itself. Below this it is still overlapping the
 * top of the page, and hiding it there reads as a flicker on a short scroll
 * rather than as getting out of the way.
 */
const HIDE_BELOW = 96;

/**
 * The band at the top of the window that calls the bar back.
 *
 * Deeper than the pointer needs to be accurate — you are reaching for something
 * that is not on screen, so the target has to be the *region* the bar occupies
 * rather than a line at the very edge. The bar itself is 5rem, so this is it
 * plus a little.
 */
const REVEAL_ZONE = 90;

/**
 * How far down the pointer has to travel before a bar it called back goes away
 * again.
 *
 * The gap between this and `REVEAL_ZONE` is hysteresis, and it is required
 * rather than a nicety: with one threshold for both directions, a pointer
 * resting on the boundary would show and hide the bar on every pixel of
 * tremor. 60px is enough that leaving has to be deliberate.
 *
 * Only a bar the *pointer* revealed is taken back this way — see `byPointer`.
 * One revealed by scrolling up stays until you scroll down again, because that
 * is what scrolling up asked for.
 */
const CONCEAL_BELOW = 150;

/**
 * How far up counts as scrolling up.
 *
 * Small, because revealing the bar is the harmless direction: showing it when
 * it was not quite asked for costs a reader nothing, and this only has to clear
 * the sub-pixel jitter a trackpad produces at rest.
 */
const SHOW_DELTA = 4;

/**
 * How far down counts as scrolling down — three times the reveal threshold, and
 * the asymmetry is a bug fix rather than a feel adjustment.
 *
 * ---------------------------------------------------------------------------
 * At a symmetric 4px, `/livestream` failed reproducibly about half the time:
 * scroll down, scroll up, and the bar came back and then hid itself again a
 * moment later with nobody touching anything.
 *
 * The cause is the browser's own scroll anchoring. That page settles its layout
 * after load — the live probe resolves, the embed sizes itself — and the
 * browser compensates by nudging the scroll position, which it does in steps of
 * a pixel or two: 328 → 330 → 331 → 335. Each step is under the threshold and
 * so does not move the reference point, but they *accumulate* against it, and
 * the seventh pixel read as a deliberate scroll down.
 *
 * Any page with late-loading content can do this. The floor has to be above the
 * range that anchoring works in, and 12px is comfortably there while still
 * being a fraction of the ~50–120px a single wheel notch produces.
 *
 * The other half of the fix is in `onScroll`: the reference point resets on
 * every upward movement, so an upward scroll cannot leave a stale anchor for
 * drift to accumulate against.
 * ---------------------------------------------------------------------------
 */
const HIDE_DELTA = 12;

export function Masthead({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = root.current;
    if (!header) return;

    // Asked for less motion: leave the bar exactly where it has always been.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let lastY = window.scrollY;
    let frame = 0;
    let hidden = false;

    /**
     * Whether the pointer is what called the bar back.
     *
     * Only a bar revealed this way is taken away again when the pointer leaves
     * the top of the window. One revealed by scrolling up is not: scrolling up
     * is a request for the navigation, and revoking it because the mouse
     * happens to be in the middle of the screen would be answering a question
     * nobody asked.
     */
    let byPointer = false;

    /**
     * Where the pointer last was, so a scroll can tell whether it is under the
     * bar. `Infinity` until it moves — which is the honest starting value on a
     * touch device, where it never will.
     */
    let pointerY = Number.POSITIVE_INFINITY;

    const setHidden = (next: boolean) => {
      hidden = next;
      header.classList.toggle('masthead--hidden', next);
    };

    /**
     * Open menu, or *keyboard* focus inside the bar — either one pins it down.
     *
     * `:focus-visible` rather than `contains(document.activeElement)`, and the
     * difference is not pedantic. Clicking the Menu button leaves it focused
     * long after the menu is closed, so the plain-focus test pinned the bar
     * open for every mouse user who had opened the nav once — it never came
     * back down until they clicked something else. `:focus-visible` is the
     * browser's own answer to "is this person navigating by keyboard", which is
     * the case this guard actually exists for.
     */
    const isHeld = () =>
      header.querySelector('[aria-expanded="true"], :focus-visible') !== null;

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY;

        // Above the fold the bar is never hidden, whatever the delta says.
        if (y <= HIDE_BELOW) {
          lastY = y;
          byPointer = false;
          setHidden(false);
          return;
        }

        if (delta < 0) {
          // Upward. The reference resets on *every* upward frame, however
          // small — that is what stops a later drift accumulating against a
          // stale anchor and reading as a scroll down. See `HIDE_DELTA`.
          lastY = y;
          if (-delta >= SHOW_DELTA) {
            byPointer = false;
            setHidden(false);
          }
          return;
        }

        // Downward, and deliberately so. `lastY` is *not* moved below the
        // threshold, so a genuinely slow scroll still accumulates past it — the
        // floor is about size, not about speed.
        if (delta < HIDE_DELTA) return;
        lastY = y;

        // Not while a menu is open, and not out from under the pointer: if the
        // mouse is up in the bar, scrolling the page beneath it is not a
        // request to take the thing being pointed at away.
        if (!isHeld() && pointerY > REVEAL_ZONE) {
          byPointer = false;
          setHidden(true);
        }
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerY = event.clientY;

      if (pointerY <= REVEAL_ZONE) {
        // Reaching for a bar that is not there. `byPointer` records that this
        // reveal is on loan, so leaving gives it back.
        if (hidden) {
          byPointer = true;
          setHidden(false);
        }
        return;
      }

      // Moved back down, having called it up. Away it goes again — unless a
      // menu is open in it, or the page has scrolled back to the top, where the
      // bar belongs on screen regardless.
      if (byPointer && pointerY > CONCEAL_BELOW && !isHeld() && window.scrollY > HIDE_BELOW) {
        byPointer = false;
        setHidden(true);
      }
    };

    // Tabbing into the bar while it is parked off-screen. `focusin` rather than
    // `focus` because focus does not bubble. Clears `byPointer` for the same
    // reason a scroll up does — this reveal was asked for and is not on loan.
    const onFocusIn = () => {
      byPointer = false;
      setHidden(false);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    // On `document`, not the header: the point is to catch the pointer arriving
    // at the top of the window when the header is *not* under it.
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    header.addEventListener('focusin', onFocusIn);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('pointermove', onPointerMove);
      header.removeEventListener('focusin', onFocusIn);
      // Nothing should inherit a hidden bar across a remount.
      hidden = false;
      header.classList.remove('masthead--hidden');
    };
  }, []);

  return (
    <header className="masthead" ref={root}>
      {children}
    </header>
  );
}
