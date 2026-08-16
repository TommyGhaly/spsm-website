import Link from 'next/link';
import type { DocOf, Event } from '@spsm/shared';
import { formatEventWhen, isoOf } from '@/lib/dates';
import { Icon } from '@/components/Icon';

/**
 * `card--link` rather than plain `card`: the class is what stretches the title's
 * anchor over the whole card (see `.card--link h3 a::after`), so the hit target
 * is the card and not the few words of its title. That matters most on a phone,
 * where the title may be two lines inside a 300px box.
 *
 * It also gates the hover lift, so only cards that actually go somewhere move
 * when you point at them.
 */
export function EventCard({ event, showLocation = false }: { event: DocOf<Event>; showLocation?: boolean }) {
  return (
    <li className="card card--link">
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
        <p className="meta card__foot">
          <Icon name="pin" size={14} /> {event.location.name}
        </p>
      )}
    </li>
  );
}
