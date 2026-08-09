import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, toDate, type DocOf, type Event } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf, safely, withoutEmbargoed } from '@/lib/firestore';

/**
 * The parish calendar.
 *
 * `servantEvents` is a separate, staff-gated collection and is deliberately not
 * reachable from here. A static file has no request-time auth check, so the
 * only safe way to keep staff-only entries private on a static site is never to
 * put them in the build at all.
 */

export async function getUpcomingEvents(max = 12): Promise<DocOf<Event>[]> {
  return safely(
    'upcoming events',
    async () => {
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.events),
          where('published', '==', true),
          orderBy('startAt', 'asc'),
          limit(max * 3),
        ),
      );

      const live = withoutEmbargoed('events', snapshot.docs.map(docOf<Event>));

      // Past events are filtered here rather than with where('startAt','>=',now)
      // for a reason worth keeping: a build-time range filter bakes the build
      // machine's clock into static HTML. An event would vanish from the page
      // hours before it actually starts, or linger after, depending on when the
      // deploy ran. Filtering after the fetch keeps the query stable and the
      // cutoff explicit.
      const cutoff = Date.now();
      return live
        .filter((event) => {
          const end = toDate(event.endAt) ?? toDate(event.startAt);
          return end === null || end.getTime() >= cutoff;
        })
        .slice(0, max);
    },
    [],
  );
}

export async function getAllEvents(): Promise<DocOf<Event>[]> {
  return safely(
    'all events',
    async () => {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.events), where('published', '==', true)),
      );
      return withoutEmbargoed('events', snapshot.docs.map(docOf<Event>));
    },
    [],
  );
}

export async function getEvent(slug: string): Promise<DocOf<Event> | null> {
  const all = await getAllEvents();
  return all.find((event) => event.slug === slug) ?? null;
}
