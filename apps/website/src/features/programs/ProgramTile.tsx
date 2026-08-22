'use client';

import { useState } from 'react';
import Link from 'next/link';
import { focalPosition, type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import { captionOf } from './caption';
import { galleryPathUrl } from './media';
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
export const CYCLE_MAX = 5;

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
 * One card, without any editing furniture.
 *
 * Extracted because the ticker renders the whole set **twice** — the second copy
 * is what makes the loop seamless — and duplicating the admin controls with it
 * would put two "Edit" buttons on screen for the same ministry.
 */
export function ProgramTile({
  program,
  shots,
  shot,
}: {
  program: DocOf<Program>;
  /** The ministry's featured pictures, in the order it chose them. */
  shots: DocOf<GalleryMedia>[];
  /** The rail's shared counter; taken modulo this tile's own length. */
  shot: number;
}) {
  return (
    <Link className="program-card" href={programHref(program.slug)}>
      <ProgramCover shots={shots} shot={shot} />
      <span className="program-card__body">
        <span className="program-card__name">{program.name}</span>
        {blurb(program.description) && (
          <span className="program-card__blurb">{blurb(program.description)}</span>
        )}
      </span>
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
  const usable = shots.filter(
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

  return (
    <span className="program-card__cover">
      {usable.map((item, index) => (
        <img
          key={item.id}
          className={`program-card__shot${index === current ? ' is-current' : ''}`}
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
          onError={() =>
            setBroken((was) => {
              const next = new Set(was);
              next.add(item.id);
              return next;
            })
          }
          style={{ objectPosition: focalPosition(item.focal) }}
        />
      ))}
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
