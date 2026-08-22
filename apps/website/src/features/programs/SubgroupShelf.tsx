'use client';

import { useState } from 'react';
import type { DocOf, GalleryMedia, ProgramEvent } from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPathUrl } from './media';

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
 */
export function SubgroupShelf({
  legend,
  items,
  onAdd,
  addLabel,
  empty,
  busy = false,
}: {
  /** "Gatherings", "Inside this". What these are, in the parish's words. */
  legend: string;
  items: readonly ShelfItem[];
  onAdd: (name: string) => void;
  addLabel: string;
  empty: string;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className={`shelf${open ? ' is-open' : ''}`}>
      {/*
        The handle. Says what the shelf holds and how many, so a closed shelf is
        still informative — the count is the reason somebody opens it.
      */}
      <button
        type="button"
        className="shelf__handle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={open ? 'close' : 'expand'} size={14} />
        <span>{legend}</span>
        <span className="shelf__count">{items.length}</span>
      </button>

      {open && (
        <div className="shelf__body">
          {items.length === 0 && <p className="shelf__empty">{empty}</p>}

          {items.length > 0 && (
            <ul className="shelf__tiles">
              {items.map((item, index) => (
                <li key={item.id}>
                  {renaming?.id === item.id ? (
                    <form
                      className="shelf__rename"
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
                      <button
                        type="button"
                        className={`shelf__tile${item.selected ? ' is-selected' : ''}${
                          item.coverPath ? ' has-cover' : ''
                        }`}
                        onClick={item.onSelect}
                      >
                        {item.coverPath && (
                          <img
                            src={galleryPathUrl(item.coverPath)}
                            alt=""
                            aria-hidden="true"
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <span className="shelf__name">{item.label}</span>
                        {item.note && <span className="shelf__note">{item.note}</span>}
                      </button>

                      <span className="shelf__actions">
                        <button
                          type="button"
                          className="shelf__action"
                          disabled={index === 0 || busy}
                          aria-label={`Move ${item.label} earlier`}
                          onClick={() => item.onMove(-1)}
                        >
                          <Icon name="prev" size={12} />
                        </button>
                        <button
                          type="button"
                          className="shelf__action"
                          disabled={index === items.length - 1 || busy}
                          aria-label={`Move ${item.label} later`}
                          onClick={() => item.onMove(1)}
                        >
                          <Icon name="next" size={12} />
                        </button>
                        <button
                          type="button"
                          className="shelf__action"
                          aria-label={`Rename ${item.label}`}
                          onClick={() => setRenaming({ id: item.id, name: item.label })}
                        >
                          <Icon name="expand" size={12} />
                        </button>
                        <button
                          type="button"
                          className="shelf__action shelf__action--danger"
                          aria-label={`Remove ${item.label}`}
                          onClick={() =>
                            setConfirming(confirming === item.id ? null : item.id)
                          }
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </span>
                    </>
                  )}

                  {confirming === item.id && (
                    <p className="shelf__confirm">
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

          <form
            className="shelf__add"
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
        </div>
      )}
    </div>
  );
}

export interface ShelfItem {
  id: string;
  label: string;
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

/** Narrow helper so the caller does not repeat the draft/count wording. */
export function shelfNote(node: DocOf<ProgramEvent>, inside: number, count: number): string {
  if (!node.published) return 'draft';
  if (inside > 0) return `${inside} inside`;
  return count > 0 ? `${count}` : 'empty';
}
