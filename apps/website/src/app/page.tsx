import Link from 'next/link';
import { getAnnouncements, getUpcomingEvents } from '@/lib/content';
import { getIntegrationsConfig } from '@/lib/config';
import { getCurrentBulletin } from '@/lib/bulletin';
import { EmptyState } from '@/components/Notice';
import { BulletinWeek } from '@/components/BulletinWeek';
import { formatEventWhen, isoOf } from '@/lib/dates';

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
          absent only before the first sync has run. */}
      {bulletin && <BulletinWeek bulletin={bulletin} />}

      <section aria-labelledby="announcements-heading">
        <h2 id="announcements-heading">Announcements</h2>
        {announcements.length === 0 ? (
          <EmptyState what="announcements" collection="announcements" />
        ) : (
          <ul className="grid">
            {announcements.map((item) => (
              <li key={item.id} className="card">
                {item.pinned && <p className="meta pin">Pinned</p>}
                <h3>
                  {item.linkUrl ? <a href={item.linkUrl}>{item.title}</a> : item.title}
                </h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
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
                </li>
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
