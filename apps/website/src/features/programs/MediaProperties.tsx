'use client';

import { useEffect, useState } from 'react';
import {
  trailLabel,
  type DocOf,
  type FocalPoint,
  type GalleryMedia,
  type GalleryTree,
  type MediaPlacement,
  type ProgramEvent,
} from '@spsm/shared';
import { galleryPosterUrl } from './media';
import { Disclosure, DisclosureGroup } from './Disclosure';
import { FocalPicker } from './FocalPicker';

/**
 * One photograph's own properties.
 *
 * Everything about a single picture that is not its *position* — position is a
 * drag on the canvas, which is the right interaction for it and needs no panel.
 * What is left is the three things a panel is actually good for: where it is
 * allowed to appear, which level of the gallery it is filed under, and its
 * caption.
 *
 * ## The caption is the one text field here
 *
 * And it earns its place by doing double duty: `GalleryMedia.caption` is the alt
 * text as well as the visible caption, in every caption mode including `hidden`.
 * A photograph with no caption is a photograph a screen reader announces as
 * nothing at all — so this is the field that quietly fixes the site's largest
 * accessibility gap, and it belongs next to the picture rather than in a queue
 * somebody works through once.
 *
 * ## Three rows: what it says, what must stay in frame, where it goes
 *
 * It was five. "Where it appears", "Its place in the block" and "Filed under"
 * were three rows asking three parts of one question — *where does this
 * photograph live* — and none of them was more than a line of controls. They are
 * one row now. See the note on it.
 *
 * ## Placement is two independent flags, shown as two switches
 *
 * Not a single "visible" toggle: `onPage` and `homepage` genuinely combine, and
 * the photograph that opens a gallery is often also on the front page.
 *
 * It was three. `slideshow` came off at Tommy's direction — every approved
 * photograph is in the presentation now, so the switch would have changed
 * nothing, and this panel's rule is that an administrator is never offered
 * something that will not work. See `subtreeSlideshow`.
 */
export function MediaProperties({
  item,
  tree,
  places,
  onPlacement,
  onFile,
  onCaption,
  onFocal,
  onMove,
  position,
  busy = false,
}: {
  item: DocOf<GalleryMedia>;
  /** For naming a level by its whole trail — "Week 1 2026 · Day 1". */
  tree: GalleryTree<DocOf<ProgramEvent>>;
  /**
   * The levels this photograph may be filed under: the page's own level and
   * everything beneath it.
   *
   * Deliberately not the whole ministry. Moving a picture to a level this page
   * does not show is a change nobody can see the result of, which is the same
   * reason the old subgroup control was absent from the ministry page — except
   * that now the ministry page offers the levels under *it*, so the control
   * exists at every depth instead of only one.
   */
  places: readonly DocOf<ProgramEvent>[];
  onPlacement: (next: MediaPlacement) => void;
  /** Re-file it onto this level. Never null: a photograph is always somewhere. */
  onFile: (programEventId: string) => void;
  onCaption: (caption: string) => void;
  /** What must survive a crop. The write half of a field nothing used to set. */
  onFocal: (next: FocalPoint) => void;
  /**
   * Move it one place earlier or later among the pictures it is shown with.
   *
   * Absent when there is nothing to move it within — a block of one. It is the
   * only way to arrange a rail or a column, whose layout is an order rather than
   * a position, and it works on a grid too: it moves the picture in the sequence
   * the packer reads.
   */
  onMove?: ((delta: -1 | 1) => void) | undefined;
  /** Where it sits now, and how many there are, for the label on those buttons. */
  position?: { at: number; of: number } | undefined;
  busy?: boolean;
}) {
  /**
   * The caption, held locally while it is being typed.
   *
   * Committed on blur and on Enter, not on every keystroke: a write per character
   * is a write per character, and the field is the one place in this panel where
   * the live-and-immediate rule the rest of it follows would be actively wrong.
   *
   * Re-seeded when the selection changes, which is what `key`-less state in a
   * panel that swaps its subject needs — otherwise clicking from one photograph to
   * the next shows the first one's caption over the second one's picture.
   */
  const [caption, setCaption] = useState(item.caption);
  useEffect(() => setCaption(item.caption), [item.id, item.caption]);

  const poster = galleryPosterUrl(item);

  function flag(key: keyof MediaPlacement, label: string, hint: string) {
    return (
      <label className={`switch${item.placement[key] ? ' is-on' : ''}`}>
        <input
          type="checkbox"
          checked={item.placement[key]}
          disabled={busy}
          onChange={(change) =>
            onPlacement({ ...item.placement, [key]: change.target.checked })
          }
        />
        <span className="switch__track" aria-hidden="true">
          <span className="switch__thumb" />
        </span>
        <span className="switch__text">
          <span className="switch__label">{label}</span>
          <span className="switch__hint">{hint}</span>
        </span>
      </label>
    );
  }

  return (
    <DisclosureGroup
      /*
        The caption open to begin with, and this is the one panel where guessing
        is right: a photograph arrives from the approval queue with an empty
        caption, and the caption is its alt text — the site's largest
        accessibility gap sits behind this one field. Anything else somebody wants
        is one click, and the row above it says what it currently holds.
      */
      key={item.id}
      defaultOpen="caption"
    >
      <Disclosure
        id="caption"
        label="Caption"
        value={item.caption ? truncate(item.caption, 24) : 'none yet'}
      >
        <label className="inspector__field">
          <span className="visually-hidden">Caption</span>
          <textarea
            rows={2}
            value={caption}
            autoFocus
            placeholder="What is happening in this picture"
            onChange={(change) => setCaption(change.target.value)}
            onBlur={() => {
              if (caption !== item.caption) onCaption(caption);
            }}
            onKeyDown={(key) => {
              if (key.key === 'Enter' && !key.shiftKey) {
                key.preventDefault();
                (key.target as HTMLTextAreaElement).blur();
              }
            }}
          />
          <span className="inspector__note">
            Also read aloud by a screen reader, so it is worth writing even where
            captions are hidden.
          </span>
        </label>
      </Disclosure>

      {/*
        What must stay in frame — a field the whole site read and nothing wrote.

        `GalleryMedia.focal` has been honoured by the grid, the covers, the tiles
        and the presentation since the schema was written, and the only writer was
        `submit.ts` putting the literal centre on every upload. So every crop on
        the site was centred, including the case the field was added for: a wide
        group shot in a square tile, faces along the top. See `FocalPicker`.
      */}
      {poster && (
        <Disclosure
          id="focal"
          label="What must stay in frame"
          value={isCentred(item.focal) ? 'the middle' : 'chosen'}
        >
          <FocalPicker
            src={poster}
            focal={item.focal}
            busy={busy}
            onChange={onFocal}
          />
        </Disclosure>
      )}

      {/*
        Everything about where the picture goes, in one row.

        This was three: "Where it appears" (two switches), "Its place in the block"
        (two buttons) and "Filed under" (a select). Three rows for three parts of
        one question — *where does this photograph live* — on a panel Tommy called
        "beyond confusing … wayyyy too many settings".

        They are one row now because they are one question, and because none of
        them is more than a line: a select, two switches and two buttons together
        are shorter than any one of the picture grids above.
      */}
      <Disclosure id="where" label="Where it goes" value={lastOf(trailLabel(tree, item.programEventId))}>
        {places.length > 0 && (
          <label className="inspector__field">
            <span>Filed under</span>
            <select
              value={item.programEventId}
              disabled={busy}
              onChange={(change) => onFile(change.target.value)}
            >
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {trailLabel(tree, place.id)}
                </option>
              ))}
              {/*
                A photograph can sit on a level this page does not offer — one above
                it, or one that has since been removed. Its id would otherwise not
                be in the list, so the select would show whichever option came
                first, which is a lie that a stray change event then makes true.
              */}
              {!places.some((place) => place.id === item.programEventId) && (
                <option value={item.programEventId}>
                  {trailLabel(tree, item.programEventId)}
                </option>
              )}
            </select>
            <span className="inspector__note">
              Moving it deeper takes it off this page and puts it on that
              level&apos;s own — where this page then summarises it.
            </span>
          </label>
        )}

        {flag('onPage', 'Shown on the pages', 'Off hides it everywhere except the presentation.')}
        {flag('homepage', 'On the homepage', 'Eligible for the band on the front page.')}

        {/*
          Its order, which is the only way to arrange a wheel — a wheel's layout is
          a sequence, not a set of positions, so there is no canvas to drag on. A
          grid can be dragged and this still works on one.
        */}
        {onMove && position && position.of > 1 && (
          <div className="inspector__group">
            <p className="inspector__legend">
              Number {position.at + 1} of {position.of} in its block
            </p>
            <p className="inspector__move">
              <button
                type="button"
                className="button button--quiet button--small"
                disabled={busy || position.at === 0}
                onClick={() => onMove(-1)}
              >
                Move earlier
              </button>{' '}
              <button
                type="button"
                className="button button--quiet button--small"
                disabled={busy || position.at === position.of - 1}
                onClick={() => onMove(1)}
              >
                Move later
              </button>
            </p>
          </div>
        )}
      </Disclosure>
    </DisclosureGroup>
  );
}

/** For a collapsed row: the last step of a trail, which is the level's own name. */
function lastOf(trail: string): string {
  const parts = trail.split(' · ');
  return parts[parts.length - 1] ?? trail;
}

function truncate(value: string, at: number): string {
  return value.length <= at ? value : `${value.slice(0, at - 1).trimEnd()}…`;
}

/** Whether nobody has moved it — which is every photograph before this existed. */
function isCentred(focal: { x: number; y: number }): boolean {
  return Math.abs(focal.x - 0.5) < 0.01 && Math.abs(focal.y - 0.5) < 0.01;
}

