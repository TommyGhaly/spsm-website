import type { Metadata } from 'next';
import { getUpcomingEvents, EventCard } from '@/features/events';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Parish Calendar',
  description:
    'Liturgies, classes, and parish events at St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

export default async function EventsPage() {
  const events = await getUpcomingEvents(100);

  return (
    <>
      <PageHeader
        title="Parish Calendar"
        lede="Liturgies, classes, and gatherings. Times are shown in Eastern Time."
      />

      <PageBody>
        {events.length === 0 ? (
          <EmptyState what="events" collection="events" />
        ) : (
          <ul className="grid">
            {events.map((event) => (
              <EventCard key={event.id} event={event} showLocation />
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
