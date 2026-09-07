'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { SUMMARY_COVERS, type DocOf, type GalleryMedia, type ProgramEvent } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPathUrl } from './media';

/**
 * How long each picture holds on a shelf tile.
 *
 * Slower than the 1.4s on `/events`, and deliberately: those plates drift past
 * on a moving rail and have a few seconds of a reader's attention, so the cycle
 * has to be quick or it never happens. These sit still in a column, so the same
 * speed would be a flicker in the corner of the eye while somebody is reading
 * the page. Paired with the 500ms cross-fade in globals.css.
 */
const SHELF_CYCLE_MS = 3200;

/**
 * What is inside this level, as a shelf in the corner of the page.
 *
 * ## Where this was, and why it moved
 *
 * It was a permanent list at the top of the properties column, taking up to 40% of
 * its height whether or not anybody was using it. Then the panel moved to the
 * bottom third of the screen, and a short wide strip has no room for two lists
 * side by side — so the one that had to give was the one that is *navigation*
 * rather than properties.
 *
 * At Tommy's direction it is a shelf on the **right** that you toggle, and the
 * things in it look like the ministries in the site's own Events menu: a
 * photograph with the name over it. That is the right borrowing rather than a coincidence of taste — those
 * tiles already solve this exact problem elsewhere on the site, which is naming a
 * handful of picture-shaped things in a small space. A list of text labels for
 * "Day 1, Day 2, Talent Show" tells you their names; a list of *their covers*
 * tells you which is which.
 *
 * ## Closed by default
 *
 * Because it is navigation, and the page already has cards for everything in it —
 * the shelf is the shortcut, not the only way through. Its handle carries the count
 * so a closed shelf still says how many parts there are, which is the one fact you
 * would open it for.
 *
 * The one thing it can do that the cards cannot: reach a part with **no
 * photographs in it**, which draws no meaningful card and is exactly the part an
 * administrator has just made and wants to fill.
 *
 * ## Two modes, because a visitor gets it too
 *
 * It began as an administrator's control. Tommy: *"the subgroups for the regular
 * user is still on the bottom — what happened to leaving them in a menu on the
 * side."* So `readOnly` gives a visitor the same shelf without the furniture:
 * no rename, no reorder, no remove, no add, and each tile is a **link** rather
 * than something that selects.
 *
 * Two differences beyond that, both consequences of the cards at the bottom of
 * the page going away when this appears:
 *
 *   - it **starts open**. Closed-by-default was right while the page also had a
 *     card for every level — the shelf was the shortcut, not the route. Take the
 *     cards away and a closed shelf hides the whole of the gallery behind a
 *     handle nobody has been told to press.
 *   - its tiles **cycle through their pictures**, the way the ministries do on
 *     `/events`. That is what makes a column of small tiles legible as places
 *     rather than as labels — see `covers` on `NodeSummary`.
 */
export function SubgroupShelf({
  legend,
  items,
  onAdd,
  onReorder,
  inline = false,
  addLabel,
  empty,
  busy = false,
  readOnly = false,
}: {
  /** "Gatherings", "Inside this". What these are, in the parish's words. */
  legend: string;
  items: readonly ShelfItem[];
  onAdd: (name: string) => void;
  /**
   * Carry a row from one place in the list to another.
   *
   * Given, every row grows a grip and can be dragged; withheld, the list is
   * fixed. Indices into `items` as it is currently drawn, which is the order the
   * caller handed over — so a caller that already has a `move(from, to)` passes
   * it straight through.
   *
   * This replaced a pair of ‹ › buttons on every row. Tommy: *"the ordering of
   * the subsections should be drag and drop"*. They were also two more targets in
   * a row that already had four, and moving a week from the bottom of a camp to
   * the top of it was eleven clicks.
   */
  onReorder?: ((from: number, to: number) => void) | undefined;
  /**
   * Rendered inside the editing column rather than floating in a corner.
   *
   * Two things follow, and both are why this is a prop rather than CSS. The body
   * is `{open && …}`, so hiding the handle in a stylesheet would leave a shelf
   * that can never be opened; and in the column this list *is* the navigation —
   * a list you must open each time you move between two albums costs a click per
   * move, where the floating shelf was a shortcut the page's own cards already
   * duplicated.
   */
  inline?: boolean;
  addLabel: string;
  empty: string;
  busy?: boolean;
  /** A visitor's shelf: links, no editing furniture. See the note above. */
  readOnly?: boolean;
}) {
  /*
   * A read-only menu has no closed state, and this is not merely a default.
   *
   * `useState(readOnly)` was not enough: the visitor's menu and the
   * administrator's are the same component in the same position of the tree, so
   * React reconciles them as one and carries the state across. Leaving edit mode
   * therefore handed the visitor whatever `open` the administrator's shelf had
   * last — and since the read-only version draws no handle, a closed one could
   * not be opened again. Derived rather than stored, so there is nothing to
   * carry.
   */
  const [expanded, setOpen] = useState(false);
  const open = readOnly || inline || expanded;
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  /*
   * One counter for the whole shelf, taken modulo each tile's own length — the
   * same arrangement as the rail on `/events`, and for the same reason: one timer
   * per shelf rather than one per tile.
   *
   * Only runs when there is something to cycle and somebody to see it. A closed
   * shelf, an editing session, or a shelf whose tiles have one picture each all
   * get no timer at all rather than a timer that re-renders to show the same
   * photograph. Reduced motion switches it off and leaves the first picture up,
   * which is what that setting is asking for.
   */
  const [shot, setShot] = useState(0);
  const longest = Math.max(0, ...items.map((item) => item.coverPaths?.length ?? 0));

  /*
   * Dragging a row to a new place.
   *
   * ## Nothing is reordered until the finger comes up
   *
   * This is the second version, and the first one is worth writing down because
   * it looked like a rendering fault rather than a logic one. It held the
   * insertion index in state, re-spliced the list on every move so the gap
   * opened live, and re-measured the rows it was passing from their *current*
   * boxes. Three loops came out of that, all of them visible as the row
   * juddering under the hand:
   *
   * 1. Crossing a midpoint moved the rows, which moved their midpoints, which
   *    could put the pointer back on the other side of one — so the target
   *    flipped back and forth between two slots several times a second.
   * 2. The lifted row's `translateY` was measured from an origin recomputed by
   *    an effect that re-ran on every move, off a box that already carried the
   *    translation. Each move therefore cancelled most of the previous one and
   *    the row stuttered instead of following the finger.
   * 3. Re-splicing moved the lifted row's own place in the flow, so the offset
   *    it was translating *from* jumped by a whole row exactly when the gap
   *    moved.
   *
   * So the geometry is measured once, at the moment of the grab, and never
   * again: the rows are displaced with inline transforms — a paint, not a
   * mutation — and the caller is told the new order once, on release. It is the
   * same arrangement as the forms drawer, which is worth having on purpose:
   * these are the two hand-arranged lists in the back office and they should
   * behave identically.
   *
   * `window` listeners rather than the handle's own, so a drag that ends off the
   * panel still finishes.
   */
  const list = useRef<HTMLUListElement | null>(null);
  /*
   * There is no React state for the drag at all, and that is the point rather
   * than an economy. Everything a gesture changes — the lifted row's class, the
   * list's class, the transforms — is written to the DOM directly, so the one
   * thing that must not happen during a drag cannot: a re-render, which would
   * throw away the inline transforms the whole thing is drawn with.
   */
  const liveRef = useRef<HTMLParagraphElement | null>(null);

  const grab = useCallback(
    (event: React.PointerEvent, index: number) => {
      const node = list.current;
      if (!node || !onReorder) return;
      // Left button and touch only; a right-click on the handle is not a drag.
      if (event.button !== 0) return;
      // Or the browser starts its own drag on the tile's photograph instead.
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* a synthetic pointer; the window listeners below still carry it */
      }

      const rows = [...node.querySelectorAll<HTMLElement>('[data-shelf]')];
      const boxes = rows.map((row) => row.getBoundingClientRect());
      const middles = boxes.map((box) => box.top + box.height / 2);
      /*
       * Each row's own pitch — its height plus the gap below it. Not one number
       * for the list: a two-line ministry name is taller than a one-line one,
       * and displacing every row by the first row's height leaves them
       * overlapping.
       */
      const gap = boxes.length > 1 ? boxes[1]!.top - boxes[0]!.bottom : 0;
      const pitch = boxes.map((box, i) =>
        i + 1 < boxes.length ? boxes[i + 1]!.top - box.top : box.height + gap,
      );
      const startY = event.clientY;
      const label = items[index]?.label ?? 'Row';

      /*
       * A press is not a drag until it has travelled. Without this a press that
       * only means to focus the handle before using `[` and `]` ran a whole
       * gesture, and any tremor wrote the order back.
       */
      const THRESHOLD = 4;
      let live = false;
      let at = index;
      let travel = 0;

      /** Where the lifted row must be drawn to sit in slot `to`. */
      const offsetFor = (to: number) => {
        let d = 0;
        if (to > index) for (let i = index + 1; i <= to; i += 1) d += pitch[i]!;
        if (to < index) for (let i = to; i < index; i += 1) d -= pitch[i]!;
        return d;
      };

      const paint = () => {
        // Clamped to the ends of the list, plus half a row of overshoot so it
        // still feels attached rather than nailed down.
        const slack = (pitch[index] ?? 0) / 2;
        const low = offsetFor(0) - slack;
        const high = offsetFor(rows.length - 1) + slack;
        const y = Math.max(low, Math.min(high, travel));
        rows[index]!.style.transform = `translate3d(0, ${y}px, 0)`;
      };

      const settle = (target: number) => {
        if (target === at) return;
        at = target;
        for (let i = 0; i < rows.length; i += 1) {
          if (i === index) continue;
          /*
           * A row the lifted one has passed moves by the *lifted* row's pitch —
           * that is the space which opened where it used to be, not the row's
           * own height.
           */
          const shift =
            (target > index && i > index && i <= target && -pitch[index]!) ||
            (target < index && i < index && i >= target && pitch[index]!) ||
            0;
          rows[i]!.style.transform = shift ? `translate3d(0, ${shift}px, 0)` : '';
        }
        if (liveRef.current) {
          liveRef.current.textContent = `${label}, position ${target + 1} of ${rows.length}`;
        }
      };

      const onMove = (moveEvent: PointerEvent) => {
        travel = moveEvent.clientY - startY;

        if (!live) {
          if (Math.abs(travel) < THRESHOLD) return;
          live = true;
          rows[index]!.classList.add('is-moving');
          node.classList.add('is-dragging');
          document.body.classList.add('is-reordering');
        }

        paint();

        /*
         * Nudge the panel when the pointer is near its edge, so a list longer
         * than the visible panel can be reordered end to end. Both `clientY`
         * and `middles` are viewport coordinates, so a scroll moves them
         * together and the geometry stays true without re-measuring.
         */
        const scroller = node.closest<HTMLElement>('.subshelf__body, .inspector-col');
        if (scroller) {
          const edge = scroller.getBoundingClientRect();
          const margin = 40;
          const up = moveEvent.clientY - edge.top;
          const down = edge.bottom - moveEvent.clientY;
          if (up < margin) scroller.scrollTop -= Math.min(16, margin - up) / 2;
          else if (down < margin) scroller.scrollTop += Math.min(16, margin - down) / 2;
        }

        /*
         * The slot the pointer is over, counted against the midpoints the rows
         * had when the drag began — which is the whole geometry, since nothing
         * has actually moved. Clamped rather than ignored, so dragging past
         * either end parks the row there.
         */
        let target = middles.filter((middle) => moveEvent.clientY > middle).length;
        if (target > index) target -= 1;
        settle(Math.max(0, Math.min(rows.length - 1, target)));
      };

      /** Put the list back the way it was drawn, and let go of the gesture. */
      const clear = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', drop);
        window.removeEventListener('pointercancel', abandon);
        node.classList.remove('is-dragging');
        document.body.classList.remove('is-reordering');
        // The transforms come off in the same commit the new order goes in, so
        // the row never appears twice in one place or jumps back before it
        // lands.
        for (const row of rows) row.style.transform = '';
        rows[index]!.classList.remove('is-moving');
      };

      const drop = () => {
        clear();
        // A press that never travelled is a press, not a drag.
        if (!live) return;
        if (at !== index) onReorder(index, at);
      };

      /*
       * A cancelled drag writes nothing. `pointercancel` and `pointerup` shared
       * a handler before, so anything that took the pointer away mid-gesture —
       * the browser deciding it was a scroll after all, a touch becoming a
       * system gesture — committed the half-finished move.
       */
      const abandon = () => {
        clear();
        if (live && liveRef.current) liveRef.current.textContent = 'Move cancelled';
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', drop);
      window.addEventListener('pointercancel', abandon);
    },
    [items, onReorder],
  );

  useEffect(() => {
    if (!open || !readOnly || longest < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setShot((n) => n + 1), SHELF_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [open, readOnly, longest]);

  /*
   * Whether this list has anything below the fold, written to the DOM.
   *
   * The editing column caps the list at four rows and change, and the fade over
   * the "Add a…" field is what says the rest is down there — see the `::before`
   * on `.subshelf--inline .subshelf__add`. A fade drawn unconditionally is a
   * fade drawn over the last row of a ministry that has three albums, where
   * nothing is hidden at all, so it has to be told.
   *
   * **A class, set by hand, and no state.** Every other way of doing this
   * re-renders — and a scroll here is not only somebody's trackpad: the drag
   * auto-scrolls this very box when a row is carried near its edge, and the
   * gesture is drawn with inline transforms that a re-render would throw away.
   * That is the same discipline the drag itself keeps, and for the same reason.
   *
   * Both observers are needed. The scroll listener catches reaching the end,
   * where the fade should come off because there is nothing more to promise;
   * the `ResizeObserver` catches the box being capped differently at a
   * breakpoint and the list growing, shrinking or rewrapping under it, which is
   * every add, remove and rename.
   */
  const body = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = body.current;
    if (!node) return;

    const mark = () => {
      const more = node.scrollHeight - node.clientHeight - node.scrollTop > 1;
      node.classList.toggle('has-more', more);
    };

    mark();
    node.addEventListener('scroll', mark, { passive: true });
    const watch = new ResizeObserver(mark);
    watch.observe(node);
    if (list.current) watch.observe(list.current);

    return () => {
      node.removeEventListener('scroll', mark);
      watch.disconnect();
    };
  }, [open, items.length]);

  return (
    <div
      className={
        `subshelf${open ? ' is-open' : ''}` +
        (readOnly ? ' subshelf--reading' : '') +
        (inline ? ' subshelf--inline' : '')
      }
    >
      {/*
        A visitor gets no toggle at all.

        Tommy: *"the subgroups is getting in the way very much I want it to be an
        untoggled menu more subtle."* A handle is a control with two states, and
        the state a visitor would leave it in is whichever one they last pressed
        — so the menu is `:hover` and nothing else, and there is nothing to press.

        Subtle is about the *page*, though, not about the tab. It is loud; what it
        does not do is sit open over the photographs. The two are not in conflict,
        and reading them as one is what made this a faint grey line for a day.
      */}
      {readOnly || inline ? (
        /*
          The tab. What is visible when the cursor is anywhere else.

          It carries the count as well as the word, because it is the only thing
          on screen saying the albums exist — "Albums 3" is an invitation and
          "Albums" alone is a heading over nothing.

          **And it is the only thing, again.** The cards at the foot of the page
          were restored and removed inside a day — Tommy: *"I'd rather just keep
          the side bar … maybe make the button for showing the side bar more
          noticeable."* So the tab is loud now: an oxblood ground with the
          parish's gold hairline, not a line of faint small caps. See
          `.subshelf--reading .subshelf__legend`, and the history in
          `GalleryShell`'s "what is inside" section.

          The arrow is why it is loud rather than merely coloured. A coloured
          strip at the edge of the window is a decoration; a coloured strip with
          a glyph pointing at the page it opens onto says which way the thing
          comes out. Only for a visitor — the inline shelf in the editing column
          is a heading over a list that is already open, and an arrow there would
          point at nothing.
        */
        <p className="subshelf__legend">
          {readOnly && <Icon name="prev" className="subshelf__pull" size={13} />}
          {legend}
          <span className="subshelf__count">{items.length}</span>
        </p>
      ) : (
        <button
          type="button"
          className="subshelf__handle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'close' : 'expand'} size={14} />
          <span>{legend}</span>
          <span className="subshelf__count">{items.length}</span>
        </button>
      )}

      {/*
        `scroller` on the body below: the list is capped at a little over four
        rows in the editing column and scrolls past that, so the bar it draws is
        a real one rather than decoration.

        It is not the cue that the list continues, though, and must not be
        relied on as one — Chromium on macOS keeps its overlay scrollbar whatever
        this asks for, so on the machines the parish office uses there is nothing
        visible until a finger is already on the trackpad. What says "there is
        more" is the half-row the cap leaves showing and the fade it dissolves
        into: see the max-height on `.subshelf--inline .subshelf__body` and the
        `::before` on `.subshelf--inline .subshelf__add`.
      */}
      {open && (
        <div className="subshelf__body scroller" ref={body}>
          {items.length === 0 && <p className="subshelf__empty">{empty}</p>}

          {/*
            What the drag is doing, said out loud. The handle's own label
            carries the position, but it is written at render time and a drag
            deliberately does not re-render — so during the one gesture where
            the position is changing it is the only stale thing on screen.
          */}
          {!readOnly && onReorder && (
            <p ref={liveRef} className="visually-hidden" role="status" aria-live="polite" />
          )}

          {items.length > 0 && (
            <ul className="subshelf__tiles" ref={list}>
              {/*
                `items`, not a copy re-spliced as the pointer moves. The list's
                order is the caller's until the gesture finishes — see the note
                on the drag. `is-moving` and `is-dragging` are added to the DOM
                directly for the same reason: this must not re-render mid-drag.
              */}
              {items.map((item, index) => (
                <li
                  key={item.id}
                  data-shelf={item.id}
                  className={onReorder && !readOnly ? 'has-grip' : undefined}
                >
                  {renaming?.id === item.id ? (
                    <form
                      className="subshelf__rename"
                      onSubmit={(submit) => {
                        submit.preventDefault();
                        const name = renaming.name.trim();
                        if (name) item.onRename(name);
                        setRenaming(null);
                      }}
                    >
                      <input
                        type="text"
                        value={renaming.name}
                        autoFocus
                        aria-label={`Rename ${item.label}`}
                        onChange={(change) =>
                          setRenaming({ id: item.id, name: change.target.value })
                        }
                        // Escape abandons it. Without this the only way out of the
                        // field is to submit, which for a typo means saving it.
                        onKeyDown={(key) => {
                          if (key.key === 'Escape') setRenaming(null);
                        }}
                      />
                      <button type="submit" className="button button--small" disabled={busy}>
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      {/*
                        The tile, borrowed from `NavTile` in SiteNav: a cover with
                        the name over it. `has-cover` only once the photograph has
                        actually loaded, so a name never sits unreadable over a
                        half-painted image — and a part with no cover keeps the
                        plain ground, which is the honest thing for it to look like.
                      */}
                      {/*
                        The grip, and it is deliberately the first thing in the
                        row rather than one more button at the end of it. A handle
                        on the left of a vertical list is where a hand goes
                        looking; among the rename and remove buttons it would be a
                        third icon to tell apart at 12px.

                        Its own element and not the tile, because the tile selects
                        the level — a pointer press that both starts a drag and
                        arms a click is how you end up selecting something every
                        time you fail to move it.
                      */}
                      {!readOnly && onReorder && (
                        <button
                          type="button"
                          className="subshelf__grip"
                          disabled={busy}
                          onPointerDown={busy ? undefined : (event) => grab(event, index)}
                          /*
                            A keyboard route, because a drag has none. `[` and `]`
                            rather than the arrow keys, matching `PictureStrip`:
                            this sits inside a scrolling panel and the arrows are
                            how somebody scrolls it.
                          */
                          onKeyDown={(key) => {
                            const step = key.key === '[' ? -1 : key.key === ']' ? 1 : 0;
                            if (step === 0) return;
                            key.preventDefault();
                            item.onMove(step);
                          }}
                          aria-label={`Move ${item.label}. Press [ or ] to move it up or down.`}
                          title={`Drag to move ${item.label}`}
                        >
                          <Icon name="grip" size={13} />
                        </button>
                      )}

                      <Tile item={item} shot={shot} readOnly={readOnly} />

                      {!readOnly && (
                      <span className="subshelf__actions">
                        <button
                          type="button"
                          className="subshelf__action"
                          aria-label={`Rename ${item.label}`}
                          title={`Rename ${item.label}`}
                          onClick={() => setRenaming({ id: item.id, name: item.label })}
                        >
                          <Icon name="pencil" size={13} />
                        </button>
                        <button
                          type="button"
                          className="subshelf__action subshelf__action--danger"
                          aria-label={`Remove ${item.label}`}
                          onClick={() =>
                            setConfirming(confirming === item.id ? null : item.id)
                          }
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                      )}
                    </>
                  )}

                  {confirming === item.id && (
                    <p className="subshelf__confirm">
                      {item.removeWarning}{' '}
                      <button
                        type="button"
                        className="button button--danger button--small"
                        disabled={busy}
                        onClick={() => {
                          item.onRemove();
                          setConfirming(null);
                        }}
                      >
                        Remove
                      </button>{' '}
                      <button
                        type="button"
                        className="button button--quiet button--small"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && (
          <form
            className="subshelf__add"
            onSubmit={(submit) => {
              submit.preventDefault();
              const name = adding.trim();
              if (!name) return;
              onAdd(name);
              // Cleared rather than kept: adding five days in a row is the common
              // case, and each needs a different name.
              setAdding('');
            }}
          >
            <input
              type="text"
              value={adding}
              placeholder={addLabel}
              aria-label={addLabel}
              onChange={(change) => setAdding(change.target.value)}
            />
            <button type="submit" className="button button--small" disabled={busy || !adding.trim()}>
              Add
            </button>
          </form>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One tile: the level's pictures with its name over them.
 *
 * A `Link` for a visitor and a `button` for an administrator, which is not a
 * detail — a visitor is *going* to the level, an administrator is *selecting* it
 * to edit on the page they are already on, and an anchor that does the second is
 * a link that does not navigate.
 *
 * All the pictures are in the DOM at once, stacked, with opacity deciding which
 * is seen — the same construction as `ProgramTile`'s plate, and for the same
 * reason: swapping one element's `src` shows the ground for however long the new
 * file takes to decode, which reads as a flash.
 */
function Tile({
  item,
  shot,
  readOnly,
}: {
  item: ShelfItem;
  shot: number;
  readOnly: boolean;
}) {
  const shots = item.coverPaths ?? (item.coverPath ? [item.coverPath] : []);
  const current = shots.length > 0 ? shot % shots.length : 0;

  const className = `subshelf__tile${item.selected ? ' is-selected' : ''}${
    shots.length > 0 ? ' has-cover' : ''
  }`;

  const inside = (
    <>
      {shots.map((path, index) => (
        <img
          key={path}
          className={`subshelf__shot${index === current ? ' is-current' : ''}`}
          src={galleryPathUrl(path)}
          alt=""
          aria-hidden="true"
          // The first is what the tile shows before any cycling; the rest can
          // arrive at their leisure.
          loading={index === 0 ? 'eager' : 'lazy'}
          decoding="async"
        />
      ))}
      <span className="subshelf__name">{item.label}</span>
      {item.note && <span className="subshelf__note">{item.note}</span>}
    </>
  );

  if (readOnly && item.href) {
    return (
      <Link className={className} href={item.href}>
        {inside}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={item.onSelect}>
      {inside}
    </button>
  );
}

export interface ShelfItem {
  id: string;
  label: string;
  /** Where a visitor goes when they press it. Unused in the editing shelf. */
  href?: string | undefined;
  /**
   * Up to `SUMMARY_COVERS` pictures for the tile to cycle through, the chosen
   * cover first. Falls back to `coverPath` alone when absent, so the editing
   * shelf — which has no use for a slideshow — need not supply it.
   */
  coverPaths?: readonly string[] | undefined;
  /**
   * Storage path of its cover, or null.
   *
   * A path rather than a URL: the bucket host differs between production and the
   * emulators, and only the browser knows which it is talking to. `media.ts` turns
   * it into a URL at render time — the same contract `ProgramNavChild` uses.
   */
  coverPath: string | null;
  /** A count, or a state — "6", "draft". Never an action. */
  note?: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  /** Shown before a removal is confirmed. Say what happens to the contents. */
  removeWarning: string;
}

/** The cover path for a shelf tile, from the summary the page already computed. */
export function shelfCover(cover: DocOf<GalleryMedia> | null | undefined): string | null {
  if (!cover) return null;
  return cover.kind === 'video' ? cover.posterPath : cover.renditionPath;
}

/**
 * The same, for the several a cycling tile wants.
 *
 * Capped again here rather than trusting the summary: `covers` is already sliced
 * to `SUMMARY_COVERS`, and a second cap costs nothing and means this cannot be
 * the place a wider summary quietly puts twelve images in a corner tile.
 */
export function shelfCovers(
  covers: readonly (DocOf<GalleryMedia> | null | undefined)[] | undefined,
): string[] {
  return (covers ?? [])
    .map(shelfCover)
    .filter((path): path is string => path !== null)
    .slice(0, SUMMARY_COVERS);
}

/** Narrow helper so the caller does not repeat the draft/count wording. */
export function shelfNote(node: DocOf<ProgramEvent>, inside: number, count: number): string {
  if (!node.published) return 'draft';
  if (inside > 0) return `${inside} inside`;
  return count > 0 ? `${count}` : 'empty';
}
