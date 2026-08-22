'use client';

import { useEffect, useState } from 'react';
import type { DocOf, GalleryMedia, Program } from '@spsm/shared';
import {
  COVER_WINDOW,
  getProgramMedia,
  getProgramPageMedia,
  getPrograms,
  pickProgramCover,
  programTileMedia,
} from './data';
import { CYCLE_MAX, CYCLE_MS, ProgramTile } from './ProgramTile';
import { DragRail } from '@/components/DragRail';
import { SectionHeading, SectionMore } from '@/components/SectionHeading';

/**
 * The ministries on the homepage: the same rail `/events` is, at a fraction of
 * the size.
 *
 * Directly under the welcome, at Tommy's direction, and the position is the
 * argument for it existing at all. What the homepage said about the parish's own
 * life, before this, was a nav item called "Events" — a reader who came for a
 * service time and did not click it left knowing the parish streams a Liturgy
 * and sells books. The photographs are what the parish actually does, so they go
 * where somebody will see them without being asked to navigate.
 *
 * ---------------------------------------------------------------------------
 * **A preview, not the page.** Three differences from `/events`, all of them
 * deliberate:
 *
 *   - **No editing.** No `EditModeProvider`, no toggle, no properties panel. A
 *     ministry is edited on the page that is *about* the ministries, and putting
 *     a second editing surface on the homepage is exactly the confusion the
 *     three-levels-one-panel work removed. Read-only means this component also
 *     reads the visitor's query only — see the note on `getPrograms` below.
 *   - **Smaller plates.** `/events` sizes its tiles off the window height
 *     because the rail *is* the page. Here it is one section of nine, so the
 *     plate is a fixed size that leaves room for the sections either side of it.
 *     See `.program-rail--compact` in globals.css.
 *   - **A link out.** The rail shows what the ministries look like; the page
 *     shows what they are.
 * ---------------------------------------------------------------------------
 *
 * Client-rendered for the same reason `/events` is: a ministry published after
 * the last deploy has to appear without one. That makes the two silent states
 * real rather than defensive — this section has nothing in it until a network
 * round trip finishes. Which of the two it shows is the whole judgement here:
 * while the read is in flight the band and its heading stay, so the schedule
 * below does not jump; if the read comes back empty or fails, the section takes
 * itself off the page entirely rather than leaving a gold eyebrow over bare
 * paper.
 */
export function ActivitiesPreview({ band }: { band: string }) {
  const [programs, setPrograms] = useState<DocOf<Program>[] | null>(null);
  /** program id → the pictures its tile cycles through, in order. */
  const [covers, setCovers] = useState<Record<string, DocOf<GalleryMedia>[]>>({});
  /**
   * Which picture every tile is showing, as one counter for the whole rail —
   * same arrangement as `/events`, and for the same reason: the plates turning
   * together reads as the page turning rather than as five things fidgeting.
   */
  const [shot, setShot] = useState(0);

  useEffect(() => {
    let live = true;

    void (async () => {
      /*
       * The visitor's read, always. `getPrograms` filters on `published`, which
       * is what the rules require of a public query — and unlike `/events` there
       * is no administrator's variant here, because a draft has nothing to be
       * doing on the homepage even for the person who created it.
       */
      const found = await getPrograms();
      if (!live) return;
      setPrograms(found);

      // One cover set each, in parallel. The two window sizes and the fallback
      // are `/events`' logic — see the long note in `ProgramDirectory`, which is
      // the copy of this worth reading.
      const resolved = await Promise.all(
        found.map(async (program) => {
          const curated =
            Array.isArray(program.featuredMediaIds) && program.featuredMediaIds.length > 0;
          const media = curated
            ? await getProgramPageMedia(program.id)
            : await getProgramMedia(program.id, COVER_WINDOW);

          const featured = programTileMedia(program, media, CYCLE_MAX);
          if (featured.length > 0) return [program.id, featured] as const;

          const cover = pickProgramCover(program, media);
          return [program.id, cover ? [cover] : []] as const;
        }),
      );

      if (!live) return;
      setCovers(Object.fromEntries(resolved.filter(([, list]) => list.length > 0)));
    })().catch(() => {
      /*
       * Nothing, and that is the difference from `/events`.
       *
       * There, a failed read gets a notice — the rail is the whole page, so a
       * page that silently renders nothing is a broken page. Here the section is
       * one of nine, and "This could not be loaded" on a homepage reads as the
       * *site* being broken rather than as one request having failed. The
       * ministries are one nav click away either way.
       */
      if (live) setPrograms([]);
    });

    return () => {
      live = false;
    };
  }, []);

  const longest = Math.max(0, ...Object.values(covers).map((list) => list.length));

  useEffect(() => {
    if (longest < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => setShot((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [longest]);

  /*
   * The section owns its own band, and the band is a prop.
   *
   * It has to be one piece: the ground, the heading and the rail either all
   * appear or none of them do, because the two silent states below are real and
   * a gold eyebrow over a band of empty paper is worse than a page with one
   * section fewer. The tint itself still comes from the server — see
   * `alternatingBands` in page.tsx — so the alternation is dealt at build time
   * and nothing arrives late to change the colour of the page.
   */
  if (programs === null) {
    /*
     * The spinner keeps the section's ground and its heading.
     *
     * A section that appears a beat after the page has painted moves everything
     * below it, and the thing below it is the schedule — which is the errand
     * most readers came for. Better a band of the right height with a spinner in
     * it than the bulletin jumping down the page under somebody's cursor.
     */
    return (
      <section className={band} aria-labelledby="activities-heading">
        <div className="wrap">
          <Heading />
          <div className="gallery-loading" aria-busy="true" aria-live="polite">
            <span className="visually-hidden">Loading…</span>
            <span className="gallery-loading__spinner" aria-hidden="true" />
          </div>
        </div>
      </section>
    );
  }

  // Nothing published, or the read failed: no ground, no heading, no gap. The
  // page reads correctly with this section absent — it did until now.
  if (programs.length === 0) return null;

  return (
    <section className={band} aria-labelledby="activities-heading">
      <div className="wrap reveal">
        <Heading />

        <DragRail
          className="rail--programs rail--activities rail--bleed"
          /*
           * Slower than `/events`, because the plates are smaller.
           *
           * `speed` is pixels per second and the two numbers are one ratio: 225 was
           * chosen so an 889px plate crosses in about four seconds. These are about
           * 400px, so the same crossing time is a little over a hundred — at
           * `/events`' 225 a plate this size flies past before it can be read.
           *
           * `loop` for the reason the bookshelf has it: five plates at 400px is
           * about 2100px, which overruns a laptop and stands perfectly still on a
           * large monitor. Repeating the row makes the turning independent of the
           * window and of how many ministries the parish happens to run.
           */
          speed={110}
          loop
        >
          <ul className="program-rail program-rail--compact">
            {programs.map((program) => (
              <li key={program.id}>
                <ProgramTile program={program} shots={covers[program.id] ?? []} shot={shot} />
              </li>
            ))}
          </ul>
        </DragRail>

        {/* The rail is what the ministries look like; the page is what they
            are — when each gathers, who it is for, and the whole of the
            photographs rather than five of them. */}
        <SectionMore href="/events">See all our activities</SectionMore>
      </div>
    </section>
  );
}

/**
 * The section's heading, in one place because both branches above render it.
 *
 * "Our activities" is the name `/events` gives itself, and it is repeated here
 * rather than reworded on purpose: a reader who follows the link should arrive at
 * a page whose title is the words they clicked. See the note in events/page.tsx
 * on why that page has three names and this is the one shown to visitors.
 */
function Heading() {
  return (
    <SectionHeading
      id="activities-heading"
      eyebrow="Our activities"
      title="The life of the parish"
      note="The standing ministries — choose one to see its gatherings."
    />
  );
}
