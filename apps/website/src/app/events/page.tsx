import type { Metadata } from 'next';
import { getUpcomingEvents, EventCard } from '@/features/events';
import { ProgramStrip } from '@/features/programs';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Events',
  description:
    'Upcoming liturgies, classes, and parish events at St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

/**
 * What is coming up, in order.
 *
 * Retitled from "Parish Calendar" when `/calendar` was added: that name now
 * belongs to the month grid, and two items in the same nav bar leading to two
 * pages with the same title is the reader's problem to untangle, not theirs.
 */
export default async function EventsPage() {
  const events = await getUpcomingEvents(100);

  return (
    <>
      <PageHeader title="Events" />

      <PageBody>
        {/*
          The programs, above the list.

          This page is the only entrance to the galleries — there is no
          "Ministries" link anywhere, deliberately. The strip fetches in the
          browser while everything below it stays baked at build time, so a camp
          added after the last deploy shows up without one.
        */}
        <ProgramStrip />

        <p className="note">Everything coming up, soonest first. Times are shown in Eastern Time.</p>
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
