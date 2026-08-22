'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  focalPosition,
  trailLabel,
  trailOf,
  type DocOf,
  type GalleryMedia,
  type GalleryTree,
  type ProgramEvent,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl } from './media';
import { useDisclosureClose } from './Disclosure';
import type { PickerMode } from './pick';

/**
 * Choosing photographs from anywhere beneath the level being edited.
 *
 * The requirement this exists for, restated for a tree: an administrator
 * standing on "Summercamp Week 1 2026" picks the pictures that page shows, and
 * the pictures they may pick from are **every approved photograph in every day
 * and every part of that week** — not only the ones filed on the week itself.
 * One level up, on Summercamp, the same control offers every photograph in every
 * year. It is the same statement at every depth, which is why there is one
 * component rather than one per level.
 *
 * That is why the subtree is read in one query by the page above and handed down
 * here, rather than each level fetching its own: "any picture, from anywhere
 * under this" is a statement about the subtree, so the subtree is the unit that
 * gets loaded.
 *
 * ## Grouped by level, named by its whole trail
 *
 * One flat list of sections, one per level that has photographs in it, in the
 * order the tree gives. Each is headed by its **full trail** — "Week 1 2026 ·
 * Day 1" — rather than its own title, and that is not verbosity: a slug is
 * unique only among siblings, so four camps each have a "Day 1", and a list of
 * four sections headed "Day 1" is a list of four guesses.
 *
 * This replaced two fixed levels of heading (gathering, then subgroup), which
 * could not express a third.
 *
 * ## Two shapes, one component
 *
 * `mode: 'one'` picks a single photograph — a cover. `mode: 'many'` builds an
 * ordered list, and the order matters: the number on each chosen tile is the
 * position it will appear in, so an administrator arranging a page can see the
 * arrangement rather than inferring it. Clicking a chosen tile again removes it,
 * and the numbers close up.
 *
 * ## It takes the whole screen, with the folders down one side
 *
 * Tommy: adding and choosing pictures was confusing. It was a grid inside a panel
 * inside a disclosure row inside a strip across the foot of the window — so the
 * thumbnails were about 90px, the level filters were a wrapped mat of chips above
 * them, and choosing from "every approved photograph in every day of every week"
 * meant doing it three tiles at a time.
 *
 * The width the panel had was the reason it was docked along the bottom in the
 * first place. Giving the picker its own screen resolves that: the panel no longer
 * has to be big enough to hold the biggest thing anybody ever put in it, which is
 * what let the properties panel become something that sits beside what it
 * describes. See `Inspector`.
 *
 * The level filters became a **list down the left**, which is the change that
 * matters most. As chips they were a paragraph of similar-looking phrases that
 * wrapped over four lines and reflowed as you picked one; as a column they are a
 * place, they hold still, and each can carry its own count — so "where are the
 * photographs actually filed" is answerable at a glance rather than by reading.
 *
 * A portal, and modal. It covers the page, so leaving it in the block's own
 * subtree would put a fixed overlay inside a horizontally scrolling rail — and
 * `aria-modal` is the truth of it either way: while this is open there is nothing
 * else to do.
 */

export type { PickerMode };

export function MediaPicker({
  media,
  tree,
  mode,
  selected,
  elsewhere,
  onToggle,
  max,
  /** What the chosen pictures are for. Shown as the picker's own heading. */
  title,
  onClose,
}: {
  /** Every approved item beneath this level. Filtering is this component's job. */
  media: readonly DocOf<GalleryMedia>[];
  /** For naming a level by its whole trail, and for ordering the sections. */
  tree: GalleryTree<DocOf<ProgramEvent>>;
  mode: PickerMode;
  /** Ids, in order, for `many`; zero or one id for `one`. */
  selected: readonly string[];
  /**
   * Already drawn by a *different* block on the same page.
   *
   * Tommy: *"When selecting the pictures for a new section within a screen I want
   * some indication to tell me which pictures are already on the current screen but
   * they can still be selected."* Both halves are the requirement. The mark is a
   * note, not a rule — repeating one photograph in two blocks is a legitimate
   * thing to do deliberately, and the only problem it has ever caused is doing it
   * *by accident* while picking twenty out of four hundred.
   *
   * So nothing here is disabled and nothing is filtered. `selected` still wins the
   * corner: a picture in this block *and* another one shows its position number,
   * because where it sits in the block being edited is the more useful fact.
   */
  elsewhere?: readonly string[];
  /**
   * One tile was clicked. The *caller* applies it, with `togglePick` and a
   * functional state update — see the note on that function for why the next
   * list is not computed here.
   */
  onToggle: (id: string) => void;
  max?: number;
  title: string;
  onClose: () => void;
}) {
  /*
     Done closes the row this sits in, not the selection.

     It used to call `edit.select({ kind: 'page' })`, which on a page that is
     already the selection did nothing — a button that looked like it dismissed
     the picker and did not. The row header collapses it too; this is the same
     action at the bottom of a grid the header may be three screens above.
  */
  const closeRow = useDisclosureClose();

  /* A set, because this is asked once per tile and a picker holds hundreds. */
  const already = useMemo(() => new Set(elsewhere ?? []), [elsewhere]);

  /** `null` is "everything". Otherwise one level's id. */
  const [level, setLevel] = useState<string | null>(null);
  const [kind, setKind] = useState<'all' | 'photo' | 'video'>('all');

  /**
   * The levels that actually have photographs in them, in tree order.
   *
   * Derived from the media rather than from the tree, so an empty level does not
   * contribute an empty heading and an empty filter chip. Sorted by depth then
   * by the trail's own order, which is what makes the sections read down the page
   * the way the tree reads: the week, then its days, then the next week.
   */
  const levels = useMemo(() => {
    const withMedia = new Set(media.map((item) => item.programEventId));
    return [...withMedia]
      .map((id) => ({ id, trail: trailOf(tree, id) }))
      .sort((a, b) => {
        const depth = Math.min(a.trail.length, b.trail.length);
        for (let at = 0; at < depth; at += 1) {
          const left = a.trail[at];
          const right = b.trail[at];
          if (!left || !right || left.id === right.id) continue;
          // The trails part company here, and the tree has already decided which
          // of these two siblings comes first.
          const siblings = tree.byParent.get(left.parentId ?? '') ?? [];
          return (
            siblings.findIndex((one) => one.id === left.id) -
            siblings.findIndex((one) => one.id === right.id)
          );
        }
        // One trail is a prefix of the other: the shallower level first, so a
        // week's own photographs sit above its days'.
        return a.trail.length - b.trail.length;
      })
      .map((one) => ({ id: one.id, label: trailLabel(tree, one.id) }));
  }, [media, tree]);

  const shown = useMemo(
    () =>
      media.filter(
        (item) =>
          (level === null || item.programEventId === level) &&
          (kind === 'all' || item.kind === kind),
      ),
    [media, level, kind],
  );

  /** The visible list, cut into one section per level, in that order. */
  const sections = useMemo(() => {
    const byLevel = new Map<string, DocOf<GalleryMedia>[]>();
    for (const item of shown) {
      const found = byLevel.get(item.programEventId);
      if (found) found.push(item);
      else byLevel.set(item.programEventId, [item]);
    }

    return levels
      .filter((one) => byLevel.has(one.id))
      .map((one) => ({ id: one.id, title: one.label, items: byLevel.get(one.id) ?? [] }));
  }, [shown, levels]);

  const ceiling = max ?? (mode === 'one' ? 1 : Number.POSITIVE_INFINITY);
  const full = mode === 'many' && selected.length >= ceiling;

  /*
   * Escape closes, and the page underneath does not scroll.
   *
   * The scroll lock is not decoration: this is a full-screen overlay with its own
   * scrolling grid, and without it a wheel gesture that reaches the end of the
   * grid carries on scrolling the gallery behind — so closing the picker leaves
   * somebody somewhere else on the page than where they opened it.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeRow();
        onClose();
      }
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeRow, onClose]);

  /**
   * How many are in each level, and how many altogether, after the kind filter.
   *
   * Counted from the kind filter's result rather than from everything, so
   * switching to Clips does not leave a folder advertising 40 items and showing
   * none. The counts are the whole reason the folders beat the chips they replaced
   * — a list of places with numbers on it says where the photographs are.
   */
  const counts = useMemo(() => {
    const byLevel = new Map<string, number>();
    let all = 0;
    for (const item of media) {
      if (kind !== 'all' && item.kind !== kind) continue;
      all += 1;
      byLevel.set(item.programEventId, (byLevel.get(item.programEventId) ?? 0) + 1);
    }
    return { all, byLevel };
  }, [media, kind]);

  const done = () => {
    closeRow();
    onClose();
  };

  return createPortal(
    <div className="picker" role="dialog" aria-modal="true" aria-label={title}>
      <header className="picker__head">
        <div className="picker__title">
          <p className="picker__kind">Choosing pictures</p>
          <h3>{title}</h3>
        </div>

        {/*
          For `many`, this says out loud the one thing that is not obvious: the
          ticks it opens with are what the block is *already* showing, so the
          first click is not "start a list" but "change this one". A block that
          opened as a blank grid would make adding a thirteenth photograph mean
          losing twelve.
        */}
        <p className="picker__hint">
          {mode === 'one'
            ? 'Choose one picture. Click it again to go back to the newest photograph.'
            : `The numbered ones are what this block shows now, in order. Click to add, click again to take one out.${
                Number.isFinite(ceiling) ? ` Up to ${ceiling}.` : ''
              }`}
        </p>

        <button type="button" className="button picker__done" onClick={done}>
          Done
        </button>
      </header>

      <div className="picker__body">
        {/*
          The folders. A list down the side rather than the mat of wrapped chips
          this replaced — see the note at the top of the file. Each is named by its
          whole trail, because a slug is unique only among siblings and four camps
          each have a "Day 1".
        */}
        <nav className="picker__folders" aria-label="Where the photographs are">
          <button
            type="button"
            className={`picker__folder${level === null ? ' is-on' : ''}`}
            aria-pressed={level === null}
            onClick={() => setLevel(null)}
          >
            <span>Everywhere</span>
            <b>{counts.all}</b>
          </button>

          {levels.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`picker__folder${level === one.id ? ' is-on' : ''}`}
              aria-pressed={level === one.id}
              onClick={() => setLevel(one.id)}
            >
              <span>{one.label}</span>
              <b>{counts.byLevel.get(one.id) ?? 0}</b>
            </button>
          ))}

          {/*
            Photographs or clips, at the foot of the folders rather than in a
            second row above the grid. It is the same kind of question — "show me
            less of this" — and two filter rows in two different places was half of
            what made the old header hard to read.
          */}
          <div className="picker__kinds" role="group" aria-label="Kind">
            {(['all', 'photo', 'video'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`chip${kind === option ? ' is-on' : ''}`}
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
              >
                {option === 'all' ? 'Both' : option === 'photo' ? 'Photographs' : 'Clips'}
              </button>
            ))}
          </div>
        </nav>

        <div className="picker__sections">
          {sections.length === 0 ? (
            <p className="note">
              There are no approved photographs here yet. They appear once somebody has
              approved them.
            </p>
          ) : (
            sections.map((section) => (
              <div className="picker__gathering" key={section.id}>
                {/* The heading stays put while its own run of pictures scrolls
                    past, so it is always clear which level you are looking at in a
                    ministry with ten years behind it. */}
                <h4>{section.title}</h4>
                <ul className="picker__grid">
                  {section.items.map((item) => {
                    const at = selected.indexOf(item.id);
                    const chosen = at !== -1;
                    const alsoHere = !chosen && already.has(item.id);
                    const poster = galleryPosterUrl(item);

                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`picker__tile${chosen ? ' is-chosen' : ''}${
                            alsoHere ? ' is-elsewhere' : ''
                          }`}
                          // Disabled only when the list is full *and* this one is
                          // not already in it — otherwise the last-added picture
                          // could not be removed, which is the one action
                          // somebody at the limit actually wants.
                          disabled={full && !chosen}
                          aria-pressed={chosen}
                          onClick={() => onToggle(item.id)}
                        >
                          {poster ? (
                            <img
                              src={poster}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              style={{ objectPosition: focalPosition(item.focal) }}
                            />
                          ) : (
                            <span className="picker__tile-blank">Processing…</span>
                          )}

                          {item.kind === 'video' && (
                            <span className="picker__tile-kind" aria-hidden="true">
                              <Icon name="film" size={14} />
                            </span>
                          )}

                          {chosen && (
                            <span className="picker__tile-mark">
                              {mode === 'many' ? at + 1 : <Icon name="check" size={14} />}
                              <span className="visually-hidden">
                                {mode === 'many' ? `Position ${at + 1}` : 'Chosen'}
                              </span>
                            </span>
                          )}

                          {/*
                            A quiet corner dot rather than a number or a tick, so it
                            cannot be mistaken for a selection at a glance across a
                            grid of two hundred. The words are for a screen reader,
                            which has no corner to read.
                          */}
                          {alsoHere && (
                            <span className="picker__tile-elsewhere" aria-hidden="true" />
                          )}
                          {alsoHere && (
                            <span className="visually-hidden">
                              Already shown elsewhere on this page
                            </span>
                          )}

                          <span className="visually-hidden">
                            {item.caption || 'Untitled photograph'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
