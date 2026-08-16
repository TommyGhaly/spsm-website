import type { Metadata } from 'next';
import {
  getUpcomingEvents,
  groupEventsByDay,
  monthsWithEvents,
  MonthGrid,
} from '@/features/events';
import { EmptyState } from '@/components/Notice';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Parish Calendar',
  description:
    'The month-by-month calendar of liturgies, feasts, classes, and gatherings at St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

/**
 * The calendar, laid out as months.
 *
 * This and `/events` are two views of one collection, which is the distinction
 * to keep straight when editing either: **this page answers "what is on the
 * 24th?", `/events` answers "what is coming up?"** One is a grid you scan by
 * date, the other a list you read in order. Neither is a subset of the other and
 * neither should grow into the other.
 *
 * Only months that actually contain something are rendered. A parish calendar
 * with an empty November grid in it looks like a page that failed to load; the
 * months present are the months with services in them.
 */
export default async function CalendarPage() {
  // The same 100-event window `/events` reads, so the two views can never
  // disagree about what is published.
  const events = await getUpcomingEvents(100);
  const byDay = groupEventsByDay(events);
  const months = monthsWithEvents(byDay);

  return (
    <>
      <PageHeader
        title="Parish Calendar"
        lede="Liturgies, feasts, classes, and gatherings, month by month. Times are shown in Eastern Time."
      />

      <PageBody>
        {months.length === 0 ? (
          <EmptyState what="events" collection="events" />
        ) : (
          months.map((monthKey) => (
            /*
              `overflow-x: auto` lives on this wrapper rather than on the table:
              a scroll container has to be the table's *parent*, and putting the
              overflow on the table itself does nothing. Seven columns of events
              do not fit a 320px phone, and squeezing them to fit produces cells
              one word wide.
            */
            <div className="calendar-scroll reveal" key={monthKey}>
              <MonthGrid monthKey={monthKey} byDay={byDay} />
            </div>
          ))
        )}
      </PageBody>
    </>
  );
}
