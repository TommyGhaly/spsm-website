/**
 * Reading the schedule — in the browser, at request time.
 *
 * Nothing here runs at build time. The reader this replaces said the same
 * thing for a different reason — it was fetching a bearer URL that must never
 * be baked into a public file — and that reason is gone with it, because no
 * credential reaches the browser any more. What replaces it is the data.
 *
 * A "this week" view baked into static HTML is whatever week the deploy
 * happened to run in: correct on the day, quietly wrong from the Monday after,
 * and wrong in a way that looks exactly like being right. The same trap
 * `features/events/data.ts` documents for range filters, one step worse because
 * the whole view is a range.
 *
 * The read goes to our own origin — `/api/calendar`, a Hosting rewrite onto the
 * `calendar` Function — because Breeze cannot be called from a page: its event
 * data sits behind a session cookie set on its own origin with no CORS header.
 * See functions/src/calendar.ts.
 */
import { collection, getDocs } from 'firebase/firestore';
import {
  COLLECTIONS,
  occurrenceOfScheduleEntry,
  occurrencesOfBulletin,
  parseCalendarDetail,
  parseScheduleEntry,
  type BulletinLike,
  type CalendarDetail,
  type CalendarFeed,
  type CalendarOccurrence,
} from '@spsm/shared';
import { db } from '@/lib/firebase';

/**
 * What a caller gets back. A feed, or a reason there is not one.
 *
 * `denied` is separated from `error` for the same reason it is in the servants
 * reader it replaces: a session that has expired, or an account that is not a
 * servant, is an ordinary outcome with its own sentence — not a fault, and not
 * something to show an alarm about.
 */
export type ScheduleResult =
  | { kind: 'ok'; feed: CalendarFeed }
  /** Asked for the servants calendar without a session that carries `servant`. */
  | { kind: 'denied'; message: string }
  /** The parish has not configured a calendar yet. */
  | { kind: 'unset' }
  | { kind: 'error'; message: string };

/**
 * Fetch one range.
 *
 * `signal` is not optional in practice and the caller must pass one. Stepping
 * through weeks fires a request per click, they return out of order, and
 * without abortion the calendar settles on whichever week's response happened
 * to land last. See the note in `ChurchCalendar.tsx`.
 */
export async function getSchedule(
  from: string,
  to: string,
  options: { servants: boolean; idToken?: string | null; signal?: AbortSignal },
): Promise<ScheduleResult> {
  const query = new URLSearchParams({ from, to });
  if (options.servants) query.set('scope', 'servants');

  const headers: Record<string, string> = {};
  if (options.servants && options.idToken) {
    headers['Authorization'] = `Bearer ${options.idToken}`;
  }

  try {
    const response = await fetch(`/api/calendar?${query.toString()}`, {
      headers,
      // `?? null` rather than passing it through: `exactOptionalPropertyTypes`
      // is on, and `RequestInit.signal` is `AbortSignal | null` — an explicit
      // `undefined` is not the same thing as the property being absent.
      signal: options.signal ?? null,
    });

    if (response.status === 401 || response.status === 403) {
      return { kind: 'denied', message: await reasonFrom(response) };
    }
    if (response.status === 503) {
      return { kind: 'unset' };
    }
    if (!response.ok) {
      return { kind: 'error', message: await reasonFrom(response) };
    }

    const feed = (await response.json()) as CalendarFeed;
    if (!Array.isArray(feed.occurrences)) {
      return { kind: 'error', message: 'The schedule came back in a shape this page cannot read.' };
    }
    return { kind: 'ok', feed };
  } catch (error) {
    // An abort is the caller's own doing — a newer request superseded this one —
    // and must not be reported as a failure, or every third click through the
    // weeks would flash an error.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { kind: 'error', message: '' };
    }
    return {
      kind: 'error',
      message:
        error instanceof Error && error.message !== ''
          ? error.message
          : 'Could not reach the church calendar.',
    };
  }
}

/** The Function's own sentence where there is one; a generic one where there is not. */
async function reasonFrom(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') return body.error;
  } catch {
    // A non-JSON body from an error status is ordinary — a proxy's own 502 page,
    // or the dev server's HTML 404 when the Functions emulator is not running.
  }
  return `The church calendar answered ${response.status}.`;
}

/**
 * The ID token for a servants request, or null.
 *
 * Dynamically imported, and that is the point: `lib/auth` pulls the ~150KB
 * Firebase Auth SDK, and /calendar is a page most visitors read without ever
 * signing in. This is only ever called once the auth store has already reported
 * a signed-in servant — by which time the SDK is loaded anyway and the import
 * resolves from cache. See lib/authStore.ts for the rule this obeys.
 */
export async function servantIdToken(): Promise<string | null> {
  try {
    const { auth } = await import('@/lib/auth');
    return (await auth().currentUser?.getIdToken()) ?? null;
  } catch (error) {
    console.error('[calendar] could not read an ID token:', error);
    return null;
  }
}

/**
 * This week's bulletin, as calendar occurrences.
 *
 * ---------------------------------------------------------------------------
 * Why the calendar reads the bulletin at all
 *
 * Because it is the better description of the week it covers. The parish writes
 * it by hand every week in the announcements app: it has the photographs, it
 * has a person to ring, it carries the Tuesday Liturgy that Breeze does not
 * know about, and its times are the corrected ones — Breeze still says the
 * St. Maurice meeting is at six when the sheet says seven.
 *
 * It covers exactly one week and nothing else, so it is fetched once rather
 * than per range: stepping to October does not need re-asking, because the
 * answer for October is "the bulletin has nothing to say".
 *
 * A failure here is deliberately silent. The bulletin is an enrichment of a
 * schedule that already renders without it, and an error banner over a calendar
 * that is working would be worse than the missing photographs.
 * ---------------------------------------------------------------------------
 */
export async function getBulletinOccurrences(
  signal?: AbortSignal,
): Promise<CalendarOccurrence[]> {
  try {
    const response = await fetch('/api/bulletin', { signal: signal ?? null });
    if (!response.ok) return [];

    const body = (await response.json()) as { bulletin?: BulletinLike | null };
    if (!body.bulletin || !Array.isArray(body.bulletin.days)) return [];

    /*
     * The JSON is used as-is rather than through `reviveBulletin`. That helper
     * turns ISO strings back into `Date`s, and the only fields it touches —
     * `addedAt`, `publishedAt` — are ones nothing here reads. Everything the
     * schedule needs is already a string on the wire.
     */
    return occurrencesOfBulletin(body.bulletin);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    console.warn('[calendar] the bulletin could not be read; carrying on without it:', error);
    return [];
  }
}

/* ---- the two layers staff maintain --------------------------------------- */

/**
 * Manually added entries, and the annotations laid over everything else.
 *
 * Read in the browser rather than at build time, and that is the point: staff
 * add a service on Sunday morning and it is on the calendar for whoever loads
 * the page next, with no deploy and nobody with deploy rights involved. The
 * same arrangement, for the same reason, as a form published from the drawer on
 * /forms.
 *
 * Both collections are `allow read: if true` — they are part of the public
 * schedule, so an anonymous visitor has to be able to read them or a manually
 * added service would be visible only to staff.
 *
 * Read whole rather than filtered to the visible range. Both are small — a
 * parish adds a handful of entries a term — and a range query would need an
 * index and a re-read on every step through the weeks to save a few kilobytes.
 */
export async function getStaffLayers(): Promise<{
  entries: CalendarOccurrence[];
  details: Map<string, CalendarDetail>;
}> {
  const empty = { entries: [], details: new Map<string, CalendarDetail>() };

  try {
    const [entrySnap, detailSnap] = await Promise.all([
      getDocs(collection(db(), COLLECTIONS.scheduleEntries)),
      getDocs(collection(db(), COLLECTIONS.calendarDetails)),
    ]);

    const entries = entrySnap.docs
      .map((snapshot) => occurrenceOfScheduleEntry(parseScheduleEntry(snapshot.data()), snapshot.id))
      .filter((entry): entry is CalendarOccurrence => entry !== null);

    const details = new Map<string, CalendarDetail>();
    for (const snapshot of detailSnap.docs) {
      const detail = parseCalendarDetail(snapshot.data());
      /*
       * Keyed on the stored `occurrenceId`, **not** on the document id.
       *
       * They are usually the same string, and for Breeze's numeric instance ids
       * they always are. But a document id cannot contain a slash, so
       * `adminData.ts` substitutes those before writing — and keying on the id
       * here would mean an annotation on `event:some/slug` was saved under one
       * name and looked up under another, matching nothing, silently.
       */
      if (detail.occurrenceId !== '') details.set(detail.occurrenceId, detail);
    }

    return { entries, details };
  } catch (error) {
    /*
     * Swallowed, like the bulletin. These are additions to a schedule that
     * renders without them, and an error banner over a working calendar would
     * be a worse outcome than a missing annotation.
     */
    console.warn('[calendar] could not read the staff layers; carrying on without them:', error);
    return empty;
  }
}
