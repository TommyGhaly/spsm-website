'use client';

import { useMemo, useState } from 'react';
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
 */

export type { PickerMode };

export function MediaPicker({
  media,
  tree,
  mode,
  selected,
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

  return (
    <section className="picker" aria-label={title}>
      <header className="picker__head">
        <h3>{title}</h3>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            closeRow();
            onClose();
          }}
        >
          Done
        </button>
      </header>

      {/*
        For `many`, this says out loud the one thing that is not obvious: the ticks
        it opens with are what the block is *already* showing, so the first click is
        not "start a list" but "change this one". A block that opened as a blank grid
        would make adding a thirteenth photograph mean losing twelve.
      */}
      <p className="picker__hint">
        {mode === 'one'
          ? 'Choose one picture. Click it again to go back to the newest photograph.'
          : `The ticked ones are what this block shows now. Click to add, click again to take one out — the number on a picture is where it appears.${
              Number.isFinite(ceiling) ? ` Up to ${ceiling}.` : ''
            }`}
      </p>

      {/*
        The filters. Present even with one level, because their absence at one
        and appearance at two reads as the panel changing shape for no reason —
        and because "Everywhere" is the state worth naming.

        One chip per level that has photographs, named by its trail. A ministry
        with ten years behind it has a lot of chips; they wrap, and the
        alternative — a select — hides from an administrator the one fact this row
        is for, which is *where the photographs actually are*.
      */}
      <div className="picker__filters">
        <div className="chips" role="group" aria-label="Level">
          <button
            type="button"
            className={`chip${level === null ? ' is-on' : ''}`}
            aria-pressed={level === null}
            onClick={() => setLevel(null)}
          >
            Everywhere
          </button>
          {levels.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`chip${level === one.id ? ' is-on' : ''}`}
              aria-pressed={level === one.id}
              onClick={() => setLevel(one.id)}
            >
              {one.label}
            </button>
          ))}
        </div>

        <div className="chips" role="group" aria-label="Kind">
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
      </div>

      {sections.length === 0 ? (
        <p className="note">
          There are no approved photographs under this level yet. They appear here once
          somebody has approved them.
        </p>
      ) : (
        /*
          Its own scroll area, capped in height.
          
          A ministry with ten years behind it has hundreds of approved
          photographs, and unbounded this panel grew to many screens — pushing
          the gatherings, the footer and everything else off the bottom of a page
          somebody was in the middle of editing. Scrolling the picker rather than
          the page also keeps the *chosen* set visible in the grid above it.
        */
        <div className="picker__sections">
          {sections.map((section) => (
            <div className="picker__gathering" key={section.id}>
              <h4>{section.title}</h4>
              <ul className="picker__grid">
                {section.items.map((item) => {
                  const at = selected.indexOf(item.id);
                  const chosen = at !== -1;
                  const poster = galleryPosterUrl(item);

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`picker__tile${chosen ? ' is-chosen' : ''}`}
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

                        <span className="visually-hidden">
                          {item.caption || 'Untitled photograph'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
