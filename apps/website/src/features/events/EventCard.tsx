import Link from 'next/link';
import type { DocOf, Event } from '@spsm/shared';
import { formatEventWhen, isoOf } from '@/lib/dates';

export function EventCard({ event, showLocation = false }: { event: DocOf<Event>; showLocation?: boolean }) {
  return (
    <li className="card">
      <p className="meta">
        <time dateTime={isoOf(event.startAt)}>
          {formatEventWhen(event.startAt, event.endAt, event.allDay, event.timeZone)}
        </time>
      </p>
      <h3>
        <Link href={`/events/${event.slug}`}>{event.title}</Link>
      </h3>
      <p>{event.summary}</p>
      {showLocation && event.location && (
        <p className="meta" style={{ marginTop: '0.75rem' }}>
          {event.location.name}
        </p>
      )}
    </li>
  );
}
