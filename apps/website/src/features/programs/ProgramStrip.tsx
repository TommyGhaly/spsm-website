'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { focalPosition, type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import { galleryPathUrl } from './media';
import { getProgramMedia, getPrograms } from './data';
import { programHref } from './route';

/**
 * The parish's programs, above the upcoming list on `/events`.
 *
 * This is the only way into the galleries — there is no "Ministries" link
 * anywhere, by decision. `/events` is the single entrance for everything
 * event-shaped: what is coming up, and what the parish has done.
 *
 * A client component on an otherwise static page, which is the interesting
 * part. `/events` itself stays baked — its upcoming list is still read at build
 * time and still crawlable — and only this strip fetches at runtime. That means
 * a program created after the last deploy appears here without one, while the
 * page around it keeps every property a static page has.
 *
 * It renders nothing at all until it has something, rather than a row of grey
 * boxes. An empty frame that might fill in is worse than no frame: a visitor
 * cannot tell it apart from a page that failed.
 */

export function ProgramStrip() {
  const [programs, setPrograms] = useState<DocOf<Program>[] | null>(null);
  const [covers, setCovers] = useState<Record<string, DocOf<GalleryMedia>>>({});

  useEffect(() => {
    let live = true;

    void (async () => {
      const found = await getPrograms();
      if (!live) return;
      setPrograms(found);

      /*
       * One cover per program, fetched in parallel.
       *
       * `Promise.all` rather than a loop with `await` inside it: five programs
       * fetched in sequence is five round trips end to end, and this sits above
       * the fold on a page whose whole job is to look inviting.
       *
       * Currently always the first approved photograph in the program. A
       * program can also name its own cover in `coverMediaId`, which the admin
       * screen sets — honouring it here is a one-line change and is left until
       * that screen exists, so the two land together rather than this reading
       * a field nothing writes.
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
          found_covers.filter((entry): entry is [string, DocOf<GalleryMedia>] => entry[1] !== undefined),
        ),
      );
    })();

    return () => {
      live = false;
    };
  }, []);

  if (programs === null || programs.length === 0) return null;

  return (
    <section aria-labelledby="programs-heading">
      <h2 id="programs-heading">Our programs</h2>
      <ul className="program-strip">
        {programs.map((program) => (
          <li key={program.id}>
            <Link className="program-strip__card" href={programHref(program.slug)}>
              <ProgramCover program={program} cover={covers[program.id]} />
              <span className="program-strip__name">{program.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgramCover({
  program,
  cover,
}: {
  program: DocOf<Program>;
  cover: DocOf<GalleryMedia> | undefined;
}) {
  const path = cover?.renditionPath ?? null;

  // No photographs yet. The card is still a real link with a real name on it —
  // a program with nothing in it is worth reaching, because its description is
  // what tells somebody the camp exists.
  if (path === null) return null;

  return (
    <img
      src={galleryPathUrl(path)}
      // Empty, not the caption. The card's visible name already says where this
      // link goes, and a screen reader announcing a photograph's caption and
      // then the program name reads as two separate things to click.
      alt=""
      loading="lazy"
      decoding="async"
      style={{ objectPosition: focalPosition(cover?.focal) }}
    />
  );
}
