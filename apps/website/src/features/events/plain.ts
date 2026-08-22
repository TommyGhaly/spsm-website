import { toDate, type DocOf, type Event } from '@spsm/shared';

/**
 * An event with every timestamp turned into an ISO string.
 *
 * Needed because the event page is a **server** component handing its event to a
 * **client** one, and everything crossing that boundary has to survive being
 * serialised. `startAt` and the rest arrive from the Firestore SDK as `Timestamp`
 * instances — objects with a `toDate()` method — which React refuses with "only
 * plain objects can be passed to Client Components".
 *
 * A string is a legal `Timestamped` (see the union in `schema/common.ts`) and
 * `toDate` parses one, so nothing downstream has to know this happened:
 * `formatEventWhen`, `fromEvent` and `isoOf` all keep working on the result.
 *
 * Kept out of `data.ts` and `admin.ts` on purpose. `data.ts` is build-time only
 * and `admin.ts` carries write helpers; this is neither, and both server and
 * client import it.
 */
export function plainEvent(event: DocOf<Event>): DocOf<Event> {
  const iso = (value: Parameters<typeof toDate>[0]): string | null =>
    toDate(value)?.toISOString() ?? null;

  // `startAt` is the one field that cannot be null on a real document, and a
  // fallback is better than an exception on a page that would otherwise render:
  // an event whose start is unreadable shows as undated rather than as a 500.
  const start = iso(event.startAt) ?? new Date(0).toISOString();

  return {
    ...event,
    startAt: start,
    endAt: iso(event.endAt),
    // The audit fields are not shown or edited anywhere on this page. They are
    // carried rather than dropped so the value stays a complete `Event` and
    // `fromEvent` does not have to accept a partial one.
    createdAt: iso(event.createdAt) ?? start,
    updatedAt: iso(event.updatedAt) ?? start,
  };
}
