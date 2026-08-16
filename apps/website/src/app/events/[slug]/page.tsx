import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAllEvents, getEvent } from '@/features/events';
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
  if (events.length === 0) return [{ slug: PLACEHOLDER_SLUG }];
  return events.map((event) => ({ slug: event.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) return { title: 'Event not found' };
  return { title: event.title, description: event.summary };
}

export default async function EventPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const event = await getEvent(slug);
  if (!event) notFound();

  const registration = event.registration;

  return (
    <article>
      {/* Its own header band, like every other page, rather than PageHeader —
          an event's title needs the date and location alongside it, which the
          shared component has no slot for. */}
      <header className="page-head">
        <div className="wrap">
          <div className="page-head__inner">
            <p className="meta">
              <Link href="/events">← Parish Calendar</Link>
            </p>
            <h1>{event.title}</h1>
            <p className="lede">
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
          </div>
        </div>
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
