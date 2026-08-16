import { EventsAdmin } from './EventsAdmin';

/**
 * A thin server shell. All the work is in the client component, because every
 * read and write here happens in a signed-in browser rather than at build time.
 */
export default function AdminEventsPage() {
  return <EventsAdmin />;
}
