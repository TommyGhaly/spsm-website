/**
 * The church schedule, read out of Breeze and served as JSON.
 *
 * ---------------------------------------------------------------------------
 * Why a Function, when /servants used to just frame the calendar in an iframe
 *
 * Three reasons, in the order they matter.
 *
 * **1. The embed URL is a bearer credential and it was being handed to
 * browsers.** Breeze serves the calendar to anyone who requests that URL — no
 * session, no referrer check — so the old design's ceiling was a servant
 * opening dev tools and copying it. Serving the *events* instead of the *URL*
 * removes the credential from the client entirely. Nothing to leak, and
 * revoking an account revokes access now rather than at the next rotation.
 *
 * **2. The browser cannot make this read.** Breeze's event data is behind a
 * session cookie its own embed page sets, on `breezechms.com`, with no CORS
 * header — so a page on our origin is refused, and the site is a static export
 * with nowhere else to put the read.
 *
 * **3. An iframe cannot be made to look like this website.** That was the ask.
 * Breeze renders a fixed-width FullCalendar 2.7.1 grid in its own typography
 * and its own colours, inside a frame that scrolls sideways on a phone. Nothing
 * on our side can touch it. Getting the data means the parish's schedule can be
 * rendered in the parish's own design, at whatever size the reader's screen is.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * How Breeze is actually read. Two requests, and the first one is not optional.
 *
 *   1. GET the embed URL. It is a host page, not data: it returns a session
 *      cookie and an inline script naming one `/ajax/events/details` source per
 *      calendar category the token grants.
 *   2. GET each of those sources with that cookie, plus `start` and `end`.
 *
 * Skipping step 1 and calling the ajax endpoint directly returns 403 with an
 * HTML apology, every time — verified. The cookie is what it wants; a
 * browser-shaped `User-Agent` is not required and this Function does not send
 * one. It identifies itself as the parish website, which is what it is. (The
 * one User-Agent Breeze's WAF does refuse is `curl/*`, which cost an hour of
 * looking in the wrong place and is recorded here so nobody repeats it.)
 *
 * There is no Breeze *API* involved and no `BREEZE_API_KEY`. That key reads the
 * whole member database and is a far larger credential than this needs; the one
 * feature that used it — the forms importer — was removed on 2026-09-01, so
 * nothing in this repo holds it any more. This reads exactly what the embed
 * token already publishes.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * What decides who sees the servants calendar
 *
 * `?scope=servants` requires a verified ID token carrying `servant`, checked
 * here through `httpAuth.ts` — the same door the refund endpoint uses, for the
 * same reason: there is no Firestore write for `firestore.rules` to guard, so
 * the check has to be in code at the entrance.
 *
 * The tagging is leak-proof by construction rather than by care. An occurrence
 * is `parish` if and only if it came back from the **parish** embed; everything
 * the servants embed adds is `servants`. No category id decides it, so a new
 * category added in Breeze can only ever end up on the private side of the line
 * — which is the direction a mistake has to fall.
 * ---------------------------------------------------------------------------
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  MAX_CALENDAR_RANGE_DAYS,
  SERVANTS_DOC_SCHEDULE,
  breezeOccurrence,
  dedupeOccurrences,
  isAllowedEmbedUrl,
  parseBreezeEventSources,
  parseServantsSchedule,
  rangeLength,
  sortOccurrences,
  type CalendarFeed,
  type CalendarOccurrence,
  type CalendarScope,
} from '@spsm/shared';
import { callerOf } from './httpAuth.js';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';

/**
 * The zone every wall-clock string in the response is a reading of.
 *
 * Breeze sends `2026-08-24 17:00:00` with no offset, meaning five in the
 * afternoon in Wayland. It is echoed in the feed rather than assumed by the
 * page, so the mobile app — which will not have the website's `PARISH_TIME_ZONE`
 * constant — reads it from the data.
 */
const PARISH_TIME_ZONE = 'America/New_York';

/**
 * How this Function introduces itself to Breeze.
 *
 * Honest rather than browser-shaped, which turned out to cost nothing: the WAF
 * wants the session cookie, not a fake Chrome. A real contact URL in a
 * User-Agent is what lets whoever runs Breeze's infrastructure find out who is
 * calling if the traffic ever puzzles them.
 */
const USER_AGENT = 'SPSMWayland-Website/1.0 (+https://spsmwayland.org; parish calendar)';

/**
 * How long Hosting's CDN may serve one parish answer, in seconds.
 *
 * Ten minutes. The parish calendar changes when the office edits Breeze, which
 * is a handful of times a week and never urgently — nobody needs a liturgy
 * moved five minutes ago. In exchange, a Sunday morning's readers arriving at
 * once cost Breeze one request per range rather than one per visitor, which
 * matters because each of ours costs Breeze two.
 *
 * `max-age=0` so the browser holds nothing of its own, and
 * `stale-while-revalidate` so a cold instance is never visible as a wait — the
 * same arrangement, and the same reasoning, as `bulletin.ts`.
 */
const PARISH_CACHE = 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600';

/**
 * And how long a servant's answer may be cached: not at all, anywhere.
 *
 * A shared cache keyed on a URL cannot be allowed to hold a response whose
 * contents depended on an `Authorization` header — the next person to ask for
 * that URL is not necessarily a servant. `private` alone would let the browser
 * keep it, which is also wrong on a shared machine in the church office.
 */
const SERVANTS_CACHE = 'private, no-store';

/**
 * Answers already fetched, held per warm instance.
 *
 * This is not the CDN's job duplicated. The CDN cannot cache a servant response
 * at all (see above), and a servant paging back and forth through the weeks is
 * exactly the traffic that would otherwise hit Breeze twice per keystroke. Five
 * minutes, and the key includes the scope so a parish answer can never be
 * served to a servants request or the reverse.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; feed: CalendarFeed }>();

/**
 * Enough for a servant stepping through a year of weeks, and small enough that
 * a warm instance cannot grow without bound. Oldest-first eviction; `Map`
 * iterates in insertion order, which is what makes that one line.
 */
const CACHE_MAX_ENTRIES = 64;

function cached(key: string): CalendarFeed | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.feed;
}

function remember(key: string, feed: CalendarFeed): void {
  cache.set(key, { at: Date.now(), feed });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * `GET /api/calendar?scope=parish|servants&from=YYYY-MM-DD&to=YYYY-MM-DD`
 *
 * → `CalendarFeed`.
 *
 * A range with nothing in it is 200 and an empty `occurrences`, which the page
 * must be able to tell from a failure — August has eighty entries and February
 * might legitimately have a quiet week, and only one of those should make the
 * page say something went wrong.
 */
export const calendar = onRequest(
  {
    maxInstances: CAPS.calendar,
    // Same origin, through the Hosting rewrite in firebase.json. The parish
    // calendar is public information, but there is no reason for another site to
    // read it through the parish's own Breeze quota — and the servants scope
    // must not be reachable cross-origin at all.
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'This endpoint is read-only; use GET.' });
      return;
    }

    /*
     * Breeze's quota, and the range check below is not a substitute for this.
     *
     * That check bounds one request; this bounds a thousand of them. A visitor
     * paging through /calendar spends a handful a minute and a script paging
     * through a decade spends as many as it likes, and both look identical to
     * the range check because every individual request is perfectly legal.
     */
    if (throttled(req, res, { bucket: 'calendar', max: BUDGETS.calendar })) return;

    const from = String(req.query['from'] ?? '');
    const to = String(req.query['to'] ?? '');
    const asked: CalendarScope = req.query['scope'] === 'servants' ? 'servants' : 'parish';

    const days = rangeLength(from, to);
    if (days < 1) {
      res.status(400).json({ error: 'from and to must be YYYY-MM-DD, with to on or after from.' });
      return;
    }
    if (days > MAX_CALENDAR_RANGE_DAYS) {
      res.status(400).json({
        error: `A request may cover at most ${MAX_CALENDAR_RANGE_DAYS} days; this one asked for ${days}.`,
      });
      return;
    }

    /*
     * The authorization check, before anything is read.
     *
     * A request that asks for the servants calendar and cannot prove it is
     * refused rather than quietly downgraded to the parish calendar. Silently
     * serving less than was asked for is how a page ends up showing a servant
     * an incomplete rota and no reason why — the caller needs to know the
     * difference between "your session expired" and "nothing on this week".
     */
    let scope: CalendarScope = 'parish';
    if (asked === 'servants') {
      /*
       * Signing in is the whole check, and that is deliberate rather than lax.
       *
       * There was a second test here — `hasRole(caller, 'servant')` — from when
       * a role ladder existed and a first sign-in granted `servant`. Since
       * every account that could authenticate got that role automatically, the
       * test never refused anybody it had not already refused above; it only
       * produced a second, more confusing failure message when a claim was
       * missing. Sign-in is Microsoft-only and `enforceTenantOnCreate` rejects
       * any account outside the parish's Entra directory, so having a session
       * at all is the qualification. Same rule as `servantEvents` in
       * firestore.rules, which is the other half of this schedule.
       */
      const caller = await callerOf(req);
      if (caller === null) {
        res.status(401).json({ error: 'Sign in to see the servants calendar.' });
        return;
      }
      scope = 'servants';
    }

    const cacheControl = scope === 'servants' ? SERVANTS_CACHE : PARISH_CACHE;
    const key = `${scope}|${from}|${to}`;

    const hit = cached(key);
    if (hit) {
      res.set('Cache-Control', cacheControl);
      res.status(200).json(hit);
      return;
    }

    try {
      const config = parseServantsSchedule(
        (
          await getFirestore().collection(COLLECTIONS.servantsConfig).doc(SERVANTS_DOC_SCHEDULE).get()
        ).data() ?? {},
      );

      if (config.parishEmbedUrl === '') {
        /*
         * 503 rather than an empty 200: the parish has no calendar configured,
         * which is us being unfinished rather than the parish having a quiet
         * week, and the page should say so instead of drawing empty cells.
         */
        console.error(
          '[calendar] servantsConfig/schedule has no parishEmbedUrl, so there is ' +
            'nothing to read. Set it with: node scripts/set-servants-schedule.mjs ' +
            "--parish-url '<embed url>' --write",
        );
        res.status(503).json({ error: 'The church calendar is not configured yet.' });
        return;
      }

      const occurrences: CalendarOccurrence[] = [];

      // Parish first, and that ordering is load-bearing: `dedupeOccurrences`
      // keeps the first of each id, so anything on both calendars stays tagged
      // `parish` and cannot be hidden behind the servants gate.
      occurrences.push(...(await readBreeze(config.parishEmbedUrl, 'parish', from, to)));

      if (scope === 'servants') {
        if (config.embedUrl === '') {
          // Not fatal. A servant asked for the servants calendar and there is
          // no servants calendar configured — they should still get the parish
          // schedule, and `includesServants` below tells them what happened.
          console.warn('[calendar] scope=servants asked for, but no servants embedUrl is set.');
        } else {
          occurrences.push(...(await readBreeze(config.embedUrl, 'servants', from, to)));
        }
      }

      const feed: CalendarFeed = {
        from,
        to,
        timeZone: PARISH_TIME_ZONE,
        occurrences: sortOccurrences(dedupeOccurrences(occurrences)),
        includesServants: scope === 'servants' && config.embedUrl !== '',
      };

      remember(key, feed);
      res.set('Cache-Control', cacheControl);
      res.status(200).json(feed);
    } catch (error) {
      // The URL is never logged — it is the credential. The host and the shape
      // of the failure are what a developer needs, and they are all that goes in.
      console.error('[calendar] could not read the schedule from Breeze:', error);
      res.status(502).json({ error: 'Could not reach the church calendar.' });
    }
  },
);

/**
 * One Breeze embed, from URL to occurrences.
 *
 * Every occurrence returned is tagged `source`, whatever category it came from.
 * The caller decides what that tag means; this function does not inspect
 * category ids, which is the property that keeps the public/private split from
 * depending on a guess.
 */
async function readBreeze(
  embedUrl: string,
  source: 'parish' | 'servants',
  from: string,
  to: string,
): Promise<CalendarOccurrence[]> {
  /*
   * Re-checked here even though `parseServantsSchedule` already blanks a URL
   * that fails the allowlist.
   *
   * Not belt-and-braces for its own sake: this is the last line before a
   * server-side fetch made with the parish's service-account identity, and the
   * document it came from is writable by an admin. An SSRF check one call frame
   * away from the fetch it protects is a check somebody can refactor past.
   */
  if (!isAllowedEmbedUrl(embedUrl)) {
    throw new Error(`Refusing to fetch a calendar from a host that is not Breeze (${source}).`);
  }

  const origin = new URL(embedUrl).origin;

  // Step 1: the host page, for its session cookie and its list of sources.
  const shell = await fetch(embedUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!shell.ok) {
    throw new Error(`Breeze returned HTTP ${shell.status} for the ${source} embed page.`);
  }

  const cookie = shell.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .filter((value): value is string => value !== undefined && value !== '')
    .join('; ');

  const sources = parseBreezeEventSources(await shell.text());
  if (sources.length === 0) {
    /*
     * Thrown rather than returned as an empty list, and the distinction is the
     * whole point. No sources means the token is wrong or Breeze changed its
     * template — and an empty calendar and an unreadable one look identical
     * downstream. One of them should blank the page; this is the other.
     */
    throw new Error(
      `The ${source} embed page named no event sources. The token may be wrong, or ` +
        "Breeze's embed template may have changed.",
    );
  }

  const occurrences: CalendarOccurrence[] = [];

  for (const { path, categoryId } of sources) {
    const url = new URL(path, origin);
    url.searchParams.set('start', from);
    url.searchParams.set('end', to);

    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: cookie,
        // Breeze's own embed sends one, and an ajax endpoint that checks for a
        // referrer is exactly the kind of thing that starts checking later.
        Referer: embedUrl,
        Accept: 'application/json, text/javascript, */*',
      },
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Breeze returned HTTP ${response.status} for ${source} category ${categoryId}.`,
      );
    }

    /*
     * Breeze answers a refused request with 200 and an HTML apology, so the
     * status is not enough to tell success from failure — this parse is the
     * real check. Thrown, not skipped, for the same reason as above.
     */
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new Error(
        `Breeze sent ${body.length} bytes of something that is not JSON for ${source} ` +
          `category ${categoryId}. The session cookie was probably refused.`,
      );
    }

    if (!Array.isArray(raw)) {
      throw new Error(`Breeze sent a ${typeof raw} rather than a list of events (${source}).`);
    }

    for (const entry of raw) {
      // `breezeOccurrence` is what drops Breeze's `metadata` — forty-odd keys
      // of internal state including the email address of whichever member of
      // staff last saved the event. It never reaches this array, so it cannot
      // reach the response.
      const occurrence = breezeOccurrence(entry as Record<string, unknown>, source);
      if (occurrence) occurrences.push(occurrence);
    }
  }

  return occurrences;
}
