'use client';

/**
 * A control that opens a small panel next to itself.
 *
 * ## What this is for
 *
 * Two editors in this codebase edit a page *in place*, and both of them ran into
 * the same wall: some settings are too fiddly to sit permanently in the page's
 * own layout, and putting them in a fixed panel costs a third of the screen for
 * as long as editing is on. The gallery blocks had exactly that — a 272px band
 * across the foot of a 800px-tall laptop, mostly help text.
 *
 * So: the trigger *is* the thing being edited, drawn as the page draws it, and
 * the controls appear beside it only while wanted. Nothing is reserved, nothing
 * moves, and a reader of the page can still see what the page says.
 *
 * ## Why the panel is in a portal
 *
 * Anchored panels get clipped. An event's date line sits inside a header, a
 * gallery block sits inside a horizontally scrolling rail, and both of those
 * ancestors have `overflow` set — so a panel positioned inside the tree is cut
 * off exactly when it is longer than the row it hangs from. In `document.body`
 * it cannot be, and `position: fixed` coordinates measured off the trigger are
 * what put it back in the right place.
 *
 * Mounted only after hydration. `createPortal` to `document.body` during a
 * server render has nowhere to go, and this component is reachable from a
 * statically exported page.
 *
 * ## Why the position is measured rather than animated
 *
 * Measured once on open, and again on scroll and resize. No
 * `requestAnimationFrame` loop following the trigger: rAF does not fire in this
 * project's headless preview at all, so a panel that depended on it would be a
 * panel that could never be checked — and a fixed panel that re-measures on the
 * two events that can move it is correct anyway.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { placeBeside, type Placement } from './anchored';

export function Popover({
  children,
  panel,
  label,
  className,
  /** Drawn on the trigger while the panel is open, for styling the active state. */
  openClassName = 'is-open',
  /** Closes the panel from inside it — a Done button, or a committed choice. */
  onClosed,
  /** Line the panel's right edge up with the trigger's. See `placeBeside`. */
  align = 'start',
}: {
  /** What the trigger looks like. Normally the page's own rendering of the value. */
  children: ReactNode;
  /** The controls. Given a `close` callback so a panel can dismiss itself. */
  panel: (close: () => void) => ReactNode;
  /** The accessible name of the trigger — it usually has no words of its own. */
  label: string;
  className?: string;
  openClassName?: string;
  onClosed?: (() => void) | undefined;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [at, setAt] = useState<Placement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    setAt(null);
    // Focus goes back to what opened the panel. Without this a keyboard user
    // who presses Escape is returned to the top of the document.
    trigger.current?.focus();
    onClosed?.();
  }, [onClosed]);

  const measure = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const own = box.current?.getBoundingClientRect();
    if (!anchor || !own) return;
    setAt(
      placeBeside(
        anchor,
        own,
        { width: window.innerWidth, height: window.innerHeight },
        { align },
      ),
    );
  }, [align]);

  /*
   * Measured in a layout effect, so the panel is never painted at 0,0 first.
   * It is rendered with `visibility: hidden` until there is a position, because
   * measuring needs it in the document — and a flash in the corner is exactly
   * the kind of thing that reads as a bug.
   */
  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (box.current?.contains(target) || trigger.current?.contains(target)) return;
      // Not `close()`: clicking elsewhere should leave focus where it was put,
      // not yank it back to a trigger the person has just navigated away from.
      setOpen(false);
      setAt(null);
      onClosed?.();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // `capture` on scroll, because the thing that scrolls is often an inner
    // rail rather than the window, and a scroll event on it does not bubble.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, close, measure, onClosed]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={[className, open ? openClassName : null].filter(Boolean).join(' ')}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {children}
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            ref={box}
            id={panelId}
            className={at?.flipped ? 'popover popover--above' : 'popover'}
            role="dialog"
            aria-label={label}
            style={
              at
                ? { left: at.left, top: at.top, maxHeight: at.maxHeight }
                : { left: 0, top: 0, visibility: 'hidden' }
            }
          >
            {panel(close)}
          </div>,
          document.body,
        )}
    </>
  );
}
