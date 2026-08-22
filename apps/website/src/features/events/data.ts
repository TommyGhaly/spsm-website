import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { COLLECTIONS, toDate, type DocOf, type Event } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf, safely } from '@/lib/firestore';

/**
 * The parish calendar.
 *
 * `servantEvents` is a separate, staff-gated collection and is deliberately not
 * reachable from here. A static file has no request-time auth check, so the
 * only safe way to keep staff-only entries private on a static site is never to
 * put them in the build at all.
 */

/*
 * ## Nothing is filtered here any more, and that is the whole change
 *
 * These queries used to carry `where('published', '==', true)`, run their result
 * through `withoutEmbargoed` for a future `publishAt`, and then strip a
 * `pendingEdit` field holding staff's unpublished words. All three are gone
 * because the thing they protected is gone: at Tommy's direction the events
 * editor has no publish step, so an event in the collection *is* an event on the
 * website.
 *
 * That deleted a real hazard along with the feature. `pendingEdit` put
 * unpublished text into the exported HTML of a public page, and the only thing
 * standing between it and the CDN was a strip in this file. A field that cannot
 * exist cannot leak.
 *
 * The corresponding read rule is now `allow read: if true` on `/events`. It had
 * to be: this file reads the collection anonymously during `next build`, and with
 * `published` absent the old rule denied it.
 */

export async function getUpcomingEvents(max = 12): Promise<DocOf<Event>[]> {
  return safely(
    'upcoming events',
    async () => {
      const snapshot = await getDocs(
        query(collection(db(), COLLECTIONS.events), orderBy('startAt', 'asc'), limit(max * 3)),
      );

      const live = snapshot.docs.map(docOf<Event>);

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
      const snapshot = await getDocs(collection(db(), COLLECTIONS.events));
      return snapshot.docs.map(docOf<Event>);
    },
    [],
  );
}

export async function getEvent(slug: string): Promise<DocOf<Event> | null> {
  const all = await getAllEvents();
  return all.find((event) => event.slug === slug) ?? null;
}
