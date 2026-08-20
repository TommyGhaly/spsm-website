'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { focalPosition, type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import { captionOf } from './caption';
import { getProgramMedia, getPrograms } from './data';
import { galleryPathUrl } from './media';
import { programHref } from './route';

/**
 * The parish's standing programs. This is the whole of `/events`.
 *
 * There is no upcoming-events list here, deliberately and at the parish's
 * direction: the calendar entries were inaccurate, and a page listing the wrong
 * dates is worse than a page that does not list any. `/calendar` still renders
 * the month grid over that collection for anyone who wants it. **Do not
 * reintroduce the list here.**
 *
 * Client-rendered because a program created after the last deploy has to appear
 * without one — see docs/program-galleries.md §2. That makes the three states
 * below real rather than defensive: this page has nothing at all until a
 * network round trip finishes.
 */

export function ProgramDirectory() {
  const [programs, setPrograms] = useState<DocOf<Program>[] | null>(null);
  const [covers, setCovers] = useState<Record<string, DocOf<GalleryMedia>>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;

    void (async () => {
      const found = await getPrograms();
      if (!live) return;
      setPrograms(found);

      /*
       * One cover each, in parallel. A loop with `await` inside it would be
       * five sequential round trips on the page's only content.
       *
       * The newest approved photograph in the program stands in as its cover.
       * `Program.coverMediaId` lets an administrator choose instead; honouring
       * it lands with the admin screen, so that a field and the thing that
       * writes it arrive together.
       */
      const found_covers = await Promise.all(
        found.map(async (program) => {
          const media = await getProgramMedia(program.id, 1);
          return [program.id, media[0]] as const;
        }),
      );

      if (!live) return;
      setCovers(
        Object.fromEntries(
          found_covers.filter(
            (entry): entry is [string, DocOf<GalleryMedia>] => entry[1] !== undefined,
          ),
        ),
      );
    })().catch(() => {
      if (live) setFailed(true);
    });

    return () => {
      live = false;
    };
  }, []);

  if (programs === null && !failed) {
    return (
      <div className="gallery-loading" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading…</span>
        <span className="gallery-loading__spinner" aria-hidden="true" />
      </div>
    );
  }

  /*
   * Two different silences, said differently.
   *
   * "Nothing is published yet" is a content gap the parish can close. "We could
   * not reach the server" is not, and telling somebody the parish runs no
   * programs because their connection dropped is a lie the page should not
   * tell.
   */
  if (failed) {
    return (
      <div className="notice">
        <h2>This could not be loaded</h2>
        <p>The programs are fetched when the page opens, and that request did not
        complete. Refreshing usually settles it.</p>
      </div>
    );
  }

  if (programs === null || programs.length === 0) {
    return (
      <div className="notice">
        <h2>Nothing here yet</h2>
        <p>No programs have been published. They appear here as soon as one is.</p>
      </div>
    );
  }

  return (
    <ul className="program-grid">
      {programs.map((program) => (
        <li key={program.id}>
          <Link className="program-card" href={programHref(program.slug)}>
            <ProgramCover cover={covers[program.id]} />
            <span className="program-card__body">
              <span className="program-card__name">{program.name}</span>
              {blurb(program.description) && (
                <span className="program-card__blurb">{blurb(program.description)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProgramCover({ cover }: { cover: DocOf<GalleryMedia> | undefined }) {
  /*
   * `broken` covers the case where the document names a rendition and the
   * object is not there — a transcode that failed, or a file removed from the
   * bucket by hand. Without it the browser draws its own broken-image icon,
   * which reads as a fault in the website rather than one missing photograph.
   */
  const [broken, setBroken] = useState(false);
  const path = cover?.renditionPath ?? null;

  if (path === null || broken) {
    // Not empty: a program with no photographs yet still needs the card to keep
    // its shape, or the grid rows jump to different heights.
    return <span className="program-card__cover program-card__cover--empty" aria-hidden="true" />;
  }

  return (
    <span className="program-card__cover">
      <img
        src={galleryPathUrl(path)}
        // Empty: the card's own name is right beside it, and a screen reader
        // announcing a photograph caption and then the program name reads as
        // two separate links.
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        style={{ objectPosition: focalPosition(cover?.focal) }}
      />
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
