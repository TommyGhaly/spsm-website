import Link from 'next/link';
import { getAnnouncements, AnnouncementList } from '@/features/announcements';
import { getUpcomingEvents, EventCard } from '@/features/events';
import { getCurrentBulletin, BulletinWeek } from '@/features/bulletin';
import { getIntegrationsConfig } from '@/lib/config';
import { EmptyState } from '@/components/Notice';

export default async function HomePage() {
  // Independent reads — no reason to make the build wait on them in sequence.
  // The bulletin is the exception: it needs the config document first, since
  // that says which project and collection to read.
  const [config, announcements, events] = await Promise.all([
    getIntegrationsConfig(),
    getAnnouncements(4),
    getUpcomingEvents(6),
  ]);
  const bulletin = await getCurrentBulletin(config.announcements);

  return (
    <>
      <section className="prose">
        <h1>St. Philopater Mercurius &amp; St. Mina Coptic Orthodox Church</h1>
        <p className="lede">
          A parish of the Coptic Orthodox Church in Wayland, Massachusetts. Everyone is
          welcome — whether you have worshipped with us for years or are visiting for the
          first time.
        </p>
      </section>

      {/* The bulletin is the parish's own weekly sheet, so it leads. It is
          absent only if the source is empty or the section is switched off in
          config/integrations. */}
      {bulletin && <BulletinWeek bulletin={bulletin} />}

      <section aria-labelledby="announcements-heading">
        <h2 id="announcements-heading">Announcements</h2>
        {announcements.length === 0 ? (
          <EmptyState what="announcements" collection="announcements" />
        ) : (
          <AnnouncementList announcements={announcements} />
        )}
      </section>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading">Upcoming at the parish</h2>
        {events.length === 0 ? (
          <EmptyState what="events" collection="events" />
        ) : (
          <>
            <ul className="grid">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </ul>
            <p style={{ marginTop: '1.5rem' }}>
              <Link href="/events">See the full calendar →</Link>
            </p>
          </>
        )}
      </section>
    </>
  );
}
