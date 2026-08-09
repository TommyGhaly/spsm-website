import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, toDate, type Announcement, type DocOf } from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf, safely, withoutEmbargoed } from '@/lib/firestore';

/**
 * Staff-authored homepage announcements.
 *
 * Distinct from the weekly bulletin, which comes from a different project
 * entirely — see features/bulletin. This collection is for things staff post
 * here, between bulletins.
 */
export async function getAnnouncements(max = 6): Promise<DocOf<Announcement>[]> {
  return safely(
    'announcements',
    async () => {
      // Ordering matches the "pinned first, then newest" composite index in
      // firestore.indexes.json. Sorting in the query rather than afterwards
      // means the limit trims the right documents instead of trimming an
      // arbitrary page and then reordering it.
      const snapshot = await getDocs(
        query(
          collection(db(), COLLECTIONS.announcements),
          where('published', '==', true),
          orderBy('pinned', 'desc'),
          orderBy('createdAt', 'desc'),
          limit(max * 2), // over-fetch: expiry is filtered below, not in the query
        ),
      );

      const live = withoutEmbargoed('announcements', snapshot.docs.map(docOf<Announcement>));
      const now = Date.now();

      return live
        .filter((a) => {
          const expires = toDate(a.expiresAt);
          return expires === null || expires.getTime() > now;
        })
        .slice(0, max);
    },
    [],
  );
}
