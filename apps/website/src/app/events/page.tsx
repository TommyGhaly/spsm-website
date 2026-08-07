import type { Metadata } from 'next';
import Link from 'next/link';
import { getUpcomingEvents } from '@/lib/content';
import { EmptyState } from '@/components/Notice';
import { formatEventWhen, isoOf } from '@/lib/dates';

export const metadata: Metadata = {
  title: 'Parish Calendar',
  description:
    'Liturgies, classes, and parish events at St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

export default async function EventsPage() {
  // Only the parish calendar. `servantEvents` is a separate, staff-gated
  // collection and must never be reachable from a static file — there is no
  // request-time auth check on a page that has already been written to disk.
  const events = await getUpcomingEvents(100);

  return (
    <>
      <section className="prose">
        <h1>Parish Calendar</h1>
        <p className="lede">
          Liturgies, classes, and gatherings. Times are shown in Eastern Time.
        </p>
      </section>

      {events.length === 0 ? (
        <EmptyState what="events" collection="events" />
      ) : (
        <ul className="grid">
          {events.map((event) => (
            <li key={event.id} className="card">
              <p className="meta">
                <time dateTime={isoOf(event.startAt)}>
                  {formatEventWhen(event.startAt, event.endAt, event.allDay, event.timeZone)}
                </time>
              </p>
              <h3>
                <Link href={`/events/${event.slug}`}>{event.title}</Link>
              </h3>
              <p>{event.summary}</p>
              {event.location && <p className="meta" style={{ marginTop: '0.75rem' }}>{event.location.name}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
