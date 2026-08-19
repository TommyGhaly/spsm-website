import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAllEvents, getEvent } from '@/features/events';
import { GalleryShell, getPrograms } from '@/features/programs';
import { Prose } from '@/components/Prose';
import { PageBody } from '@/components/PageBody';
import { Icon } from '@/components/Icon';
import { formatEventWhen, isoOf } from '@/lib/dates';

type Params = { slug: string };

/**
 * `output: 'export'` refuses to build a dynamic segment that yields zero
 * routes. Taken literally that means "the parish has no events scheduled"
 * becomes "the website will not deploy" — an unacceptable thing to hand to a
 * volunteer on a Saturday. This slug keeps one route in existence so the build
 * stays green; the page 404s on it.
 *
 * Underscore-prefixed so it cannot collide with a slug staff would ever type.
 */
const PLACEHOLDER_SLUG = '_none';

/**
 * Static export needs every path enumerated at build time — there is no server
 * to render an unknown slug later. An event added to Firestore after a deploy
 * genuinely does not exist on the site until the next build, which is why
 * publishing has to trigger a rebuild. See docs/decisions.md #6.
 */
export async function generateStaticParams(): Promise<Params[]> {
  const events = await getAllEvents();
  const slugs = events.map((event) => event.slug);

  /*
   * Development only: admit the program slugs as well.
   *
   * `/events/summercamp` is a gallery, and in production it never reaches this
   * route — nothing is exported there, so Hosting falls through to the rewrite.
   * The dev server has no Hosting, and under `output: 'export'` it refuses any
   * param this function did not return, with "missing param … in
   * generateStaticParams()" and a 500. That happens *before* the component
   * runs, so the gallery fallback below cannot rescue it — the slug has to be
   * admitted here or the page is unreachable locally.
   *
   * Not done in production, deliberately: exporting these would bake a real
   * HTML file at `/events/summercamp`, Hosting would serve it as an exact
   * static match, and the rewrite that makes the whole section work would never
   * fire.
   */
  if (process.env.NODE_ENV === 'development') {
    const programs = await getPrograms();
    slugs.push(...programs.map((program) => program.slug));
  }

  // A program and a calendar event sharing a slug would otherwise emit the
  // route twice. Uniqueness across the two is enforced in the admin editor;
  // this keeps the build honest if it ever slips.
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return [{ slug: PLACEHOLDER_SLUG }];
  return unique.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (event) return { title: event.title, description: event.summary };

  // Matches the development fallback below: locally this route also answers for
  // program galleries, and titling one of those "Event not found" reads like a
  // bug in the very page that is working.
  if (process.env.NODE_ENV === 'development') return { title: 'Gallery' };

  return { title: 'Event not found' };
}

export default async function EventPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const event = await getEvent(slug);

  /*
   * Development only: hand an unknown slug to the gallery shell.
   *
   * `/events/summercamp` is a program gallery, and in production it never
   * reaches this file — nothing is exported at that path, so Firebase Hosting
   * falls through to the rewrite. The dev server has no Hosting, and this
   * dynamic route matches any single segment, so it wins and the fallback
   * rewrite in next.config.mjs never gets a chance. Without this branch every
   * program page 404s locally while working in production, which is the worst
   * shape a bug can have.
   *
   * `process.env.NODE_ENV` is statically replaced at build time, so the whole
   * branch is eliminated from the export and production behaviour is unchanged:
   * an unknown slug still 404s, which is what `_none` relies on.
   */
  if (!event && process.env.NODE_ENV === 'development') return <GalleryShell />;
  if (!event) notFound();

  const registration = event.registration;

  return (
    <article>
      {/*
        The event's own title block. It stays here rather than using
        `PageHeader` because an event's name needs its date and location beside
        it, which that component has no slot for — and because `PageHeader` now
        renders nothing on screen at all.
      */}
      <header className="wrap event-head">
        <p className="meta">
          <Link href="/events">← Parish Calendar</Link>
        </p>
        <h1>{event.title}</h1>
        <p className="event-head__when">
          <time dateTime={isoOf(event.startAt)}>
            {formatEventWhen(event.startAt, event.endAt, event.allDay, event.timeZone)}
          </time>
        </p>
        {event.location && (
          <p className="meta">
            <Icon name="pin" size={14} /> {event.location.name}
            {event.location.address && ` · ${event.location.address}`}
          </p>
        )}
      </header>

      <PageBody>
        <Prose>{event.body}</Prose>

        {/*
          Only `externalUrl` is rendered. `registration.formId` points at the
          `forms` collection, which has security rules but no schema and no
          `/forms/[slug]` route yet — linking to it would send a parishioner
          straight to a 404. Restore the branch when that route exists.
        */}
        {registration?.externalUrl && (
          <p>
            <a className="button" href={registration.externalUrl} rel="noopener noreferrer">
              Register for this event
            </a>
          </p>
        )}
      </PageBody>
    </article>
  );
}
