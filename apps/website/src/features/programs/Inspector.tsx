'use client';

/**
 * The properties panel — beside the thing it is about.
 *
 * ## What changed, and why
 *
 * This was a strip fixed across the foot of the window, a third of the screen
 * tall. Measured on a 1280x800 laptop it was **272px — 34% of the viewport** —
 * and it was there for as long as edit mode was on, whether or not anything was
 * selected. With a gallery block 396px tall, that left room for roughly one
 * block and a panel whose default contents were five paragraphs explaining how to
 * use the page.
 *
 * The strip was itself a fix for a 22rem column down the right, which cost the
 * full-bleed rails the width they are judged by. Both were the same mistake in
 * different directions: **reserving permanent screen for controls that are only
 * wanted intermittently.**
 *
 * So the panel is not reserved any more. It appears next to whatever was pressed,
 * sized to its own contents, and it is not there at all until something is
 * selected. Tommy's words for the option he picked: "nothing fixed, nothing
 * reserved, no screen lost when you're not using it."
 *
 * ## The help text is gone
 *
 * It was in `Disclosure`'s idle state, and it existed because the panel was
 * always open on a page-wide selection and had to say *something*. It said, at
 * length, what the controls on the page do. The controls say that themselves now
 * — every block toolbar carries words, not just glyphs — so the paragraph
 * explaining the glyphs has nothing left to explain.
 *
 * ## Two shapes, and why the page-wide one is a pill
 *
 * A photograph, a block, a level: each was clicked, so each has somewhere to be
 * beside. **The page as a whole was not clicked** — it is the selection you get
 * for free on pressing Edit — so anchoring to the last press would put its
 * settings next to whatever happened to be under the cursor.
 *
 * It gets a control of its own instead: a pill in the corner that opens the same
 * contents as a popover anchored to itself. That is also the honest thing for it
 * to be, because it is the one panel somebody goes looking for rather than
 * arrives at.
 *
 * ## Still a frame, not a switchboard
 *
 * It draws the chrome — what is selected, the save state, the close — and the
 * page above decides what goes inside, because only the page knows what a section
 * or a photograph *on it* means. Routing the selection to a panel here would mean
 * this file importing every editor and knowing about both page shapes.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeBeside, type Placement } from '@/components/anchored';
import { Popover } from '@/components/Popover';
import { Icon } from '@/components/Icon';
import { useEditMode } from './editMode';

export function Inspector({
  /** What is selected, in words. "Day 2", "Photograph", "Summercamp". */
  title,
  /** The kind of thing, so the panel changing shape does not read as a fault. */
  kind,
  saving = false,
  children,
}: {
  title: string;
  kind: string;
  saving?: boolean;
  children: ReactNode;
}) {
  const { on, selection, anchor, select } = useEditMode();
  if (!on) return null;

  /*
   * The page-wide selection: a corner pill that opens the same panel. Keyed on
   * nothing, deliberately — it is the one panel that should survive a re-render
   * without closing, and `Popover` owns its own open state.
   */
  if (selection.kind === 'page') {
    return (
      <Popover
        className="inspector-pill"
        label={`Settings for ${title}`}
        align="start"
        panel={() => (
          <div className="inspector">
            <Head kind={kind} title={title} saving={saving} />
            <div className="inspector__content">{children}</div>
          </div>
        )}
      >
        <Icon name="expand" size={14} />
        <span>This page</span>
      </Popover>
    );
  }

  return (
    <Anchored anchor={anchor} onClose={() => select({ kind: 'page' })}>
      <Head
        kind={kind}
        title={title}
        saving={saving}
        onClose={() => select({ kind: 'page' })}
      />
      <div className="inspector__content">{children}</div>
    </Anchored>
  );
}

function Head({
  kind,
  title,
  saving,
  onClose,
}: {
  kind: string;
  title: string;
  saving: boolean;
  onClose?: () => void;
}) {
  return (
    <header className="inspector__head">
      {/*
        Flat, not nested. The kind, the title and the save state are one baseline
        row — a wrapper here made them a stacked block, which on a small panel
        spent a fifth of the height saying two words.
      */}
      <p className="inspector__kind">{kind}</p>
      <h2>{title}</h2>
      {/*
        Always present, never conditional on a write being in flight. A status
        that only appears when something is happening makes its absence
        ambiguous — and with no Save button anywhere in this panel, "did that
        stick?" is the one question it has to answer at a glance.
      */}
      <span className="inspector__state">{saving ? 'Saving…' : 'Saved'}</span>
      {onClose && (
        <button
          type="button"
          className="inspector__close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </header>
  );
}

/**
 * The panel, positioned beside an element somewhere else on the page.
 *
 * A portal, for the same reason `Popover` uses one: the anchors here are
 * photographs inside horizontally scrolling rails and blocks inside sections
 * with `overflow` set, and a panel rendered inside those trees is clipped exactly
 * when it is taller than the row it hangs from.
 *
 * Re-measured on scroll and resize, and **not** on an animation frame. rAF does
 * not fire in this project's headless preview, so a panel that followed its
 * anchor that way would be a panel whose position could never be checked.
 */
function Anchored({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [at, setAt] = useState<Placement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const measure = useCallback(() => {
    const own = box.current?.getBoundingClientRect();
    if (!own) return;
    /*
     * No anchor, or an anchor that has left the document — a photograph that was
     * just removed from the block, most often. The panel goes to the bottom-right
     * corner rather than vanishing: the selection is still real, and a panel that
     * disappears because the thing it described was deleted is indistinguishable
     * from a crash.
     */
    const rect =
      anchor && anchor.isConnected
        ? anchor.getBoundingClientRect()
        : {
            top: window.innerHeight - 24,
            bottom: window.innerHeight - 24,
            left: window.innerWidth - own.width - 24,
            right: window.innerWidth - 24,
          };

    setAt(
      placeBeside(
        rect,
        own,
        { width: window.innerWidth, height: window.innerHeight },
        { align: 'start' },
      ),
    );
  }, [anchor]);

  /*
   * `mounted` is in the dependency list, and it has to be.
   *
   * The portal is not rendered on the first pass — `mounted` starts false so that
   * `createPortal` is never called during a server render. So on that pass there
   * is no element to measure, and `measure` returns early. Without `mounted` here
   * the effect never runs again (nothing else it depends on has changed), `at`
   * stays null, and the panel sits at `visibility: hidden` at the bottom of the
   * document forever — which is exactly what it did.
   */
  useLayoutEffect(() => {
    measure();
  }, [measure, mounted]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    // `capture` on scroll, because the thing that scrolls is usually an inner
    // rail rather than the window, and a scroll event on it does not bubble.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [measure, onClose]);

  if (!mounted) return null;

  /*
   * No click-outside dismissal, unlike `Popover`. Selection here *is* clicking
   * elsewhere on the page — pressing the next photograph moves the panel to it —
   * so a handler that closed on any outside press would fight the thing it is
   * built on, and would swallow the first click of every drag.
   */
  return createPortal(
    <aside
      ref={box}
      className="inspector-float"
      aria-label="Properties"
      style={at ? { left: at.left, top: at.top, maxHeight: at.maxHeight } : { visibility: 'hidden' }}
    >
      {children}
    </aside>,
    document.body,
  );
}
