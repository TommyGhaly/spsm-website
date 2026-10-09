'use client';

import { useState } from 'react';
import Link from 'next/link';
import { focalPosition, type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import { Grow, Plain } from '@/components/Inline';
import { AutoClip } from './AutoClip';
import { captionOf } from './caption';
import { galleryPathUrl } from './media';
import { useShuffled } from '@/lib/useShuffled';
import { programHref } from './route';

/*
 * The plate itself, and the two numbers that drive its slideshow.
 *
 * These lived in `ProgramDirectory` while `/events` was the only page that drew
 * a ministry. The homepage now draws the same tile at a smaller size — see
 * `ActivitiesPreview` — and a copy of the cross-fade in a second file is two
 * places to change the hold and the fade, which are already a pair that has to
 * move together. Nothing about the markup changed in the move.
 */

/**
 * How many of a ministry's featured pictures the tile cycles through.
 *
 * Not all of them. `featuredMediaIds` allows nine, and nine × five ministries ×
 * the copies the loop renders is a landing page fetching forty-odd photographs
 * before anybody has chosen anything. Five is long enough that the tile does not
 * visibly repeat while somebody is looking at it, and the ministry's own page
 * shows the full set.
 */
export const CYCLE_MAX = 8;

/**
 * How long each picture holds.
 *
 * Short, and the reason is the rail rather than the pictures: the plates drift
 * past at 225px/s, so any one of them is in front of a reader for a few seconds
 * and then gone. At the 5s this started on, a plate showed one picture for its
 * whole appearance and the other four may as well not have been chosen — the
 * cycle existed and nobody would ever have seen it happen.
 *
 * 1.4s gets two or three pictures into the time a plate is on screen. It is
 * faster than one would set a slideshow that stayed put, and that is the point.
 *
 * Paired with the 500ms cross-fade in globals.css: about a third of the cycle,
 * which is enough to read as a dissolve and not so much that the plate is
 * permanently mid-transition. **Change one and check the other** — a fade longer
 * than the hold never resolves into a single picture.
 */
export const CYCLE_MS = 1400;

/**
 * One card.
 *
 * ## Two shapes, and why it is not a link in both
 *
 * Read, it is a `Link` to the ministry. **Edited, it is a `div`** — not a link
 * with its navigation suppressed, which is what the rail used to do. An `<input>`
 * inside an `<a>` is invalid HTML and behaves like it: the anchor swallows the
 * first click, so the caret lands somewhere unpredictable and dragging to select
 * a word starts a link drag instead. The rail's `onClickCapture` still stops a
 * stray click on the plate from navigating; this is about the words.
 *
 * ## What is editable on the tile, and what is not
 *
 * The name and the description, because those are the two things the tile *is*.
 * Everything else about a ministry — whether it is public, its cover, removing
 * it — is in the panel that opens beside the selected tile, because a tile has
 * nowhere to put a switch that would not look like part of the parish's page.
 *
 * The **web address is not editable at all**, and cannot be: a program's slug is
 * its Firestore document id (see `createProgram`), so renaming a ministry changes
 * what it is called and never where it lives. That is why the add-a-ministry
 * plate asks for a name before it creates anything.
 */
export function ProgramTile({
  program,
  shots,
  shot,
  editing = false,
  onName,
  onDescription,
}: {
  program: DocOf<Program>;
  /** The ministry's featured pictures, in the order it chose them. */
  shots: DocOf<GalleryMedia>[];
  /** The rail's shared counter; taken modulo this tile's own length. */
  shot: number;
  /** Draw the words as fields. False for every visitor, and on the homepage. */
  editing?: boolean;
  onName?: ((name: string) => void) | undefined;
  onDescription?: ((description: string) => void) | undefined;
}) {
  const inside = (
    <>
      <ProgramCover shots={shots} shot={shot} />
      <span className="program-card__body">
        {editing && onName ? (
          <span className="program-card__name">
            <Plain
              name={`program-name-${program.id}`}
              label={`The name of ${program.name || 'this ministry'}`}
              value={program.name}
              placeholder="Name this ministry"
              onChange={onName}
            />
          </span>
        ) : (
          <span className="program-card__name">{program.name}</span>
        )}

        {editing && onDescription ? (
          /*
            The **whole** description, not `blurb()`'s 120 characters.
            
            This is the one place the editing view cannot match the reading view,
            and it is the right way round: a field showing a truncation would edit
            the truncation, and pressing a key would silently discard whatever came
            after the cut. So the tile grows while editing. It can afford to — the
            rail is `frozen` in edit mode, so plates of different heights no longer
            slide past each other, which is the reason they were kept equal.
          */
          <span className="program-card__blurb program-card__blurb--editing">
            <Grow
              name={`program-blurb-${program.id}`}
              className="ee-plain"
              value={program.description}
              minRows={2}
              aria-label={`What ${program.name || 'this ministry'} is`}
              placeholder="A line about this ministry, for the tile."
              onChange={onDescription}
            />
          </span>
        ) : (
          blurb(program.description) && (
            <span className="program-card__blurb">{blurb(program.description)}</span>
          )
        )}
      </span>
    </>
  );

  if (editing) {
    return <div className="program-card program-card--editing">{inside}</div>;
  }

  return (
    <Link className="program-card" href={programHref(program.slug)}>
      {inside}
    </Link>
  );
}

/**
 * The plate: the ministry's featured pictures, cross-fading one to the next.
 *
 * All of them are in the DOM at once, stacked, with opacity deciding which is
 * seen. That is what makes it a cross-fade rather than a cut — swapping one
 * element's `src` shows the page's background for however long the new file
 * takes to decode, which on a plate this size is a visible white flash. It also
 * means the next picture is already decoded when its turn comes.
 *
 * The cost is honest: five `<img>` per tile. It is why `CYCLE_MAX` is five and
 * not nine, and why the renditions rather than the originals are what these
 * point at.
 */
function ProgramCover({ shots, shot }: { shots: DocOf<GalleryMedia>[]; shot: number }) {
  /*
   * Which pictures failed to load — a document naming a rendition whose object
   * is not there, from a transcode that failed or a file removed from the bucket
   * by hand. Without this the browser draws its own broken-image icon, which
   * reads as a fault in the website rather than as one missing photograph.
   *
   * A set rather than the single flag this used to be, because there are now
   * several pictures per plate and one of them failing must not take the others
   * down with it.
   */
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  /* A type predicate rather than a truthiness check plus `!` further down: the
     filter is the thing that knows these have a file, so it should be the thing
     that says so. */
  // A random order per visit, so the plate does not open on the same picture
  // every time — see `useShuffled`. The set itself is chosen in `data.ts`.
  const usable = useShuffled(shots, (item) => item.id).filter(
    (item): item is DocOf<GalleryMedia> & { renditionPath: string } =>
      typeof item.renditionPath === 'string' &&
      item.renditionPath.length > 0 &&
      !broken.has(item.id),
  );

  if (usable.length === 0) {
    // Not empty: a program with no photographs yet still needs the plate to keep
    // its shape, or the rail's tiles come out different heights.
    return <span className="program-card__cover program-card__cover--empty" aria-hidden="true" />;
  }

  // Modulo this tile's own length, so a ministry with two pictures cycles
  // between two while the rail's counter climbs past them.
  const current = shot % usable.length;

  const fail = (id: string) =>
    setBroken((was) => {
      const next = new Set(was);
      next.add(id);
      return next;
    });

  return (
    <span className="program-card__cover">
      {usable.map((item, index) => {
        const shot = `program-card__shot${index === current ? ' is-current' : ''}`;

        /*
         * A featured clip plays on the plate rather than being skipped.
         *
         * It used to be skipped by accident, which is worse than either: a video
         * document's `renditionPath` is the mp4 itself, so the filter above
         * accepted it, an `<img>` was pointed at a video file, the load failed
         * and `onError` quietly moved it to `broken`. A ministry that had chosen
         * three clips showed an empty plate and nothing said why.
         */
        if (item.kind === 'video') {
          return (
            <AutoClip
              key={item.id}
              className={shot}
              src={galleryPathUrl(item.renditionPath)}
              poster={item.posterPath ? galleryPathUrl(item.posterPath) : null}
              style={{ objectPosition: focalPosition(item.focal) }}
              onError={() => fail(item.id)}
            />
          );
        }

        return (
          <img
            key={item.id}
            className={shot}
            src={galleryPathUrl(item.renditionPath)}
            // Empty: the card's own name is right beside it, and a screen reader
            // announcing a photograph caption and then the program name reads as
            // two separate links. It is doubly right here — the plate is now
            // several photographs, and naming them all would be a paragraph.
            alt=""
            // The first is what the plate shows before any cycling; the rest can
            // arrive at their leisure.
            loading={index === 0 ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => fail(item.id)}
            style={{ objectPosition: focalPosition(item.focal) }}
          />
        );
      })}
    </span>
  );
}

/**
 * The card's line of description.
 *
 * The same helper the header used, at the length a card has room for. It earns
 * its keep here beyond tidiness: the seeded descriptions open with a
 * "REPLACE \u2014 ..." note addressed to whoever writes the copy, and the previous
 * version printed that on the card as though it were the parish's words.
 */
function blurb(description: string): string {
  return captionOf(description, 120);
}
