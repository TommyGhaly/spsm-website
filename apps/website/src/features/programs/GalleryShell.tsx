'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  type DocOf,
  type GalleryMedia,
  type Program,
  type ProgramEvent,
} from '@spsm/shared';
import { Prose } from '@/components/Prose';
import { PageBody } from '@/components/PageBody';
import { getGalleryMedia, getProgram, getProgramEvent, getProgramEvents } from './data';
import { parseGalleryPath, programEventHref, presentHref, type GalleryRoute } from './route';
import { GalleryGrid } from './GalleryGrid';

/**
 * The one page behind every gallery URL.
 *
 * Firebase Hosting rewrites `/events/**` here when nothing matches on disk, so
 * this component is what a visitor gets for `/events/summercamp/week-1-2027`
 * and every camp created since the last deploy. It reads the address bar,
 * fetches, and renders — routing that the framework would normally do, done
 * here because `output: 'export'` cannot emit a route it has never heard of.
 *
 * The URL is unchanged by a rewrite, so `location.pathname` is the real one.
 *
 * Three things this deliberately does *not* do:
 *
 *  - **No `useSearchParams`.** It suspends, and under `output: 'export'` that
 *    forces the whole route to opt out of prerendering. `location.search` is
 *    read directly in an effect instead.
 *  - **No redirect on a bad path.** A stranger who mistypes a camp name should
 *    see "no such gallery" at the URL they typed, not be bounced somewhere that
 *    makes it look like the link worked.
 *  - **No `notFound()`.** That needs a server. This renders its own not-found
 *    state, with a real link back.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'program'; program: DocOf<Program>; events: DocOf<ProgramEvent>[] }
  | {
      kind: 'event';
      program: DocOf<Program>;
      event: DocOf<ProgramEvent>;
      media: DocOf<GalleryMedia>[];
    };

export function GalleryShell() {
  const [route, setRoute] = useState<GalleryRoute | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });

  // `location` does not exist during the export build, so the path can only be
  // read once mounted. That is the source of the spinner on first paint, and
  // it is the cost decision #2 in docs/program-galleries.md accepted.
  useEffect(() => {
    setRoute(parseGalleryPath(window.location.pathname));
  }, []);

  useEffect(() => {
    if (route === null) return;

    if (route.kind === 'unknown') {
      setState({ kind: 'missing' });
      return;
    }

    // Guards every `setState` below. Without it, a visitor who clicks through
    // to another gallery before the first finishes loading gets whichever
    // request happens to land last — which is not necessarily the page they
    // are now looking at.
    let live = true;

    void (async () => {
      const program = await getProgram(route.programSlug);
      if (!live) return;
      if (!program) {
        setState({ kind: 'missing' });
        return;
      }

      if (route.kind === 'program') {
        const events = await getProgramEvents(program.id);
        if (live) setState({ kind: 'program', program, events });
        return;
      }

      const event = await getProgramEvent(program.id, route.eventSlug);
      if (!live) return;
      if (!event) {
        setState({ kind: 'missing' });
        return;
      }

      const media = await getGalleryMedia(event.id);
      if (live) setState({ kind: 'event', program, event, media });
    })();

    return () => {
      live = false;
    };
  }, [route]);

  if (state.kind === 'loading') return <GalleryLoading />;
  if (state.kind === 'missing') return <GalleryMissing />;
  if (state.kind === 'program') return <ProgramView program={state.program} events={state.events} />;
  return <EventView program={state.program} event={state.event} media={state.media} />;
}

function GalleryLoading() {
  return (
    <PageBody>
      {/*
        `aria-busy` and a live region rather than a bare spinner: a screen
        reader gets no signal at all from a CSS animation, and this page can sit
        here for a moment on a slow connection.
      */}
      <div className="gallery-loading" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading…</span>
        <span className="gallery-loading__spinner" aria-hidden="true" />
      </div>
    </PageBody>
  );
}

function GalleryMissing() {
  return (
    <PageBody>
      <div className="notice">
        <h1>No such gallery</h1>
        <p>
          This link does not lead to one of the parish&apos;s programs. It may have been
          renamed, or the address may have a typo in it.
        </p>
        <p>
          <Link href="/events">See what is on</Link>
        </p>
      </div>
    </PageBody>
  );
}

/** A program: what it is, and every occurrence of it. */
function ProgramView({
  program,
  events,
}: {
  program: DocOf<Program>;
  events: DocOf<ProgramEvent>[];
}) {
  return (
    <article>
      <header className="wrap event-head">
        <p className="meta">
          <Link href="/events">← Events</Link>
        </p>
        <h1>{program.name}</h1>
      </header>

      <PageBody>
        <Prose>{program.description}</Prose>

        {events.length === 0 ? (
          <p className="note">There are no galleries here yet.</p>
        ) : (
          <>
            <h2>Galleries</h2>
            <ul className="grid">
              {events.map((event) => (
                <li className="card card--link" key={event.id}>
                  <h3>
                    <Link href={programEventHref(program.slug, event.slug)}>{event.title}</Link>
                  </h3>
                  {event.description && <p>{firstLine(event.description)}</p>}
                </li>
              ))}
            </ul>
          </>
        )}
      </PageBody>
    </article>
  );
}

/** One occurrence, and its photographs. */
function EventView({
  program,
  event,
  media,
}: {
  program: DocOf<Program>;
  event: DocOf<ProgramEvent>;
  media: DocOf<GalleryMedia>[];
}) {
  // `onPage` and `slideshow` are separate flags on purpose: a page tells its
  // story in twenty photographs and a hall screen runs two hundred. This view
  // shows the page set only.
  const onPage = media.filter((item) => item.placement.onPage);

  return (
    <article>
      <header className="wrap event-head">
        <p className="meta">
          <Link href={`/events/${program.slug}`}>← {program.name}</Link>
        </p>
        <h1>{event.title}</h1>
      </header>

      <PageBody>
        {event.description && <Prose>{event.description}</Prose>}

        {onPage.length === 0 ? (
          <p className="note">There are no photographs in this gallery yet.</p>
        ) : (
          <GalleryGrid media={onPage} />
        )}

        {/*
          Presentation links are public rather than admin-only, and that is a
          choice worth stating: the screen in the hall is often driven by
          whoever is nearest a laptop, not by somebody with an account. Nothing
          here exposes anything a visitor cannot already see on this page.
        */}
        {media.some((item) => item.placement.slideshow) && (
          <p className="note">
            <a className="button" href={presentHref(program.slug, event.slug)}>
              Present this gallery
            </a>
          </p>
        )}
      </PageBody>
    </article>
  );
}

/** The first paragraph of a markdown body, for a card. */
function firstLine(markdown: string): string {
  const [first = ''] = markdown.split(/\n\s*\n/);
  return first.replace(/[#*_`>]/g, '').trim();
}
