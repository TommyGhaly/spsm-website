'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!open || !readOnly || longest < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setShot((n) => n + 1), SHELF_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [open, readOnly, longest]);

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
        untoggled menu more subtle."* A handle is a control, and a control in the
        corner of a page of photographs is one more thing to look at than a quiet
        list of where to go next. The count goes with it — it was there to make a
        *closed* shelf informative, and nothing is closed any more.

        The label stays, as a line of small caps rather than a button. Without it
        two tiles in a corner are two pictures with no explanation.
      */}
      {readOnly || inline ? (
        /*
          The tab. What is visible when the cursor is anywhere else.
          
          It carries the count as well as the word, because it is the only thing
          on screen saying the albums exist — "Albums 3" is an invitation and
          "Albums" alone is a heading over nothing.
        */
        <p className="subshelf__legend">
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

      {open && (
        <div className="subshelf__body">
          {items.length === 0 && <p className="subshelf__empty">{empty}</p>}

          {items.length > 0 && (
            <ul className="subshelf__tiles">
              {items.map((item, index) => (
                <li key={item.id}>
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
                      <Tile item={item} shot={shot} readOnly={readOnly} />

                      {!readOnly && (
                      <span className="subshelf__actions">
                        <button
                          type="button"
                          className="subshelf__action"
                          disabled={index === 0 || busy}
                          aria-label={`Move ${item.label} earlier`}
                          onClick={() => item.onMove(-1)}
                        >
                          <Icon name="prev" size={12} />
                        </button>
                        <button
                          type="button"
                          className="subshelf__action"
                          disabled={index === items.length - 1 || busy}
                          aria-label={`Move ${item.label} later`}
                          onClick={() => item.onMove(1)}
                        >
                          <Icon name="next" size={12} />
                        </button>
                        <button
                          type="button"
                          className="subshelf__action"
                          aria-label={`Rename ${item.label}`}
                          /* A `title` as well as the label. The glyph is `expand`,
                             which means "open this bigger" everywhere else on the
                             site and is the closest thing the set has to a pencil —
                             so the tooltip is doing the work the icon cannot. */
                          title={`Rename ${item.label}`}
                          onClick={() => setRenaming({ id: item.id, name: item.label })}
                        >
                          <Icon name="expand" size={12} />
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
