/**
 * Whether a liturgy is being streamed right now, and which video it is.
 *
 * ---------------------------------------------------------------------------
 * Why a Function, when the Castr probe is just a `fetch` from the page
 *
 * Castr serves its player page with `access-control-allow-origin: *`, so the
 * browser can read it directly and no server is involved. YouTube sends no such
 * header: the identical fetch from a page is blocked, and the site is a static
 * export with nowhere else to put the read. So it happens here, and the browser
 * asks our own origin through the `/api/live` rewrite in firebase.json.
 *
 * The second reason is that a YouTube live embed needs a *video id*, and the id
 * changes every Sunday. The endpoint that used to spare us that —
 * `youtube.com/embed/live_stream?channel=UC…` — no longer resolves; it renders
 * "This video is unavailable" for a channel that is demonstrably live. So the
 * current id has to be looked up, and this is what looks it up.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Why this needs an API key, when nothing else on this site does.
 *
 * Scraping was tried first and thoroughly, because a key has to be provisioned
 * and rotated by hand and avoiding one is worth real effort. It cannot work:
 * YouTube serves a Google Cloud IP a deliberately thinner page than it serves a
 * laptop. Measured against a liturgy that was demonstrably live on 2026-08-21:
 *
 *   from a laptop                     from this Function
 *   ------------------------------    ------------------------------
 *   videoDetails.isLive: true         object absent entirely
 *   <link rel="canonical" …v=ID>      absent
 *   <meta itemprop="startDate">       absent
 *   <meta itemprop="isLiveBroadcast"> absent
 *
 * The video id and the live flag are simply not in the bytes we are given. A
 * browser-shaped User-Agent, `Accept-Language`, and a pre-accepted consent
 * cookie changed nothing — this is not a consent wall or a rate limit. oEmbed
 * refuses a `/live` channel URL outright, and the Atom feed carries no live flag.
 * ---------------------------------------------------------------------------
 *
 * So: the feed for *which videos exist* — free, unmetered, and it does list a
 * broadcast while it is still running — and one `videos.list` call for *which of
 * them is on*. That call costs a single unit of quota for up to fifty ids, where
 * the obvious `search.list?eventType=live` costs a hundred. On the default
 * 10,000 units a day that is the difference between a check every nine seconds
 * and running dry before lunch.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_INTEGRATIONS,
  DEFAULT_INTEGRATIONS_CONFIG,
  channelFeedUrl,
  isYouTubeChannelId,
  liveBroadcastIds,
  parseChannelFeed,
  parseIntegrationsConfig,
  videosListUrl,
} from '@spsm/shared';

/**
 * A YouTube Data API v3 key, restricted to that API.
 *
 * A secret rather than a value in `config/integrations`, because that document
 * is world-readable — see the warning at the top of schema/config.ts. Set with:
 * `firebase functions:secrets:set YOUTUBE_API_KEY`
 */
const YOUTUBE_API_KEY = defineSecret('YOUTUBE_API_KEY');

/**
 * What the secret holds when no real key has been provisioned yet.
 *
 * It is set to this rather than left absent because `firebase deploy` resolves
 * every secret declared anywhere in functions/src during discovery, so one
 * missing secret blocks every deploy — including an unrelated
 * `--only functions:<other>`. This is now the only user of the convention —
 * forms/breeze.ts held the other one and went with the Breeze importer on
 * 2026-09-01 — so if a second appears, keep the two spellings identical.
 */
const NO_KEY_YET = 'unset';

/**
 * How long Hosting's CDN may serve one answer, in seconds.
 *
 * Thirty seconds, matching `/api/bulletin`. A liturgy beginning shows up on the
 * site within half a minute, and a congregation opening the page at once costs
 * YouTube two requests a minute rather than two per person — which matters here
 * more than it does for the bulletin, because this is an unauthenticated read
 * of somebody else's page and the way to lose it is to look like a scraper.
 *
 * `max-age=0` so the *browser* keeps no copy: someone told the liturgy has
 * started must not be served their own cached "nothing is on".
 */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=30, stale-while-revalidate=120';

/** Bounds the upstream read, well inside any caller's patience. */
const TIMEOUT_MS = 8_000;

/**
 * `GET /api/live` -> `{ live, videoId }`.
 *
 * 200 with `live: false` is the ordinary answer on a Tuesday, and is
 * deliberately distinguishable from a failure: every error path returns a
 * non-2xx so the page can tell "there is no service" from "we could not find
 * out", and show a way through to YouTube in the second case.
 */
export const live = onRequest(
  {
    secrets: [YOUTUBE_API_KEY],
    maxInstances: CAPS.live,
    // Same origin through the Hosting rewrite. Nothing here is secret, but
    // there is no reason for another site to spend the parish's quota.
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'This endpoint is read-only; use GET.' });
      return;
    }

    /*
     * The quota this protects is a real one and it is daily.
     *
     * A YouTube API key gets 10,000 units a day and `videos.list` spends one per
     * call, so a loop pointed at this endpoint could exhaust the parish's whole
     * allowance before anybody noticed — and the visible symptom would be the
     * player saying it could not find out whether there was a liturgy, on a
     * Sunday morning. Same generous budget as the bulletin, and for the same
     * reason: one address is one congregation.
     */
    if (throttled(req, res, { bucket: 'live', max: BUDGETS.live })) return;

    const config = await livestream();

    if (!config.enabled) {
      // Somebody switched the stream off in config/integrations. Not an error.
      res.set('Cache-Control', CACHE_CONTROL);
      res.status(200).json({ live: false, videoId: null, reason: 'disabled' });
      return;
    }

    /*
     * `archiveChannelId` rather than `target`, and that is the point of asking
     * here at all. `target` is whatever is embedded — a Castr URL, a single
     * video id — while `archiveChannelId` is the parish's own channel, which is
     * the only field that names something whose live status can be looked up.
     */
    const channelId = config.archiveChannelId.trim();
    if (!isYouTubeChannelId(channelId)) {
      console.error(
        `[live] livestream.archiveChannelId is not a channel id (${channelId || 'empty'}), ` +
          `so there is nothing to check. Set it in ${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS}.`,
      );
      res.status(503).json({ error: 'No channel is configured to check.' });
      return;
    }

    const apiKey = YOUTUBE_API_KEY.value().trim();
    if (!apiKey || apiKey === NO_KEY_YET) {
      console.error(
        '[live] YOUTUBE_API_KEY is not set, so the live check cannot run. Set it with: ' +
          'firebase functions:secrets:set YOUTUBE_API_KEY',
      );
      /*
       * 503 rather than `200 { live: false }`, and the difference is the whole
       * point of having two codes. A 200 saying "not live" tells the page there
       * is no service, and it will say so — during a liturgy. A 503 tells it we
       * could not find out, and it shows the link to the channel instead.
       */
      res.status(503).json({ error: 'The live check is not configured.' });
      return;
    }

    try {
      const found = await findLiveBroadcast(channelId, apiKey);

      res.set('Cache-Control', CACHE_CONTROL);
      res.status(200).json({
        live: !!found,
        videoId: found?.videoId ?? null,
        reason: found ? null : 'not-live',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[live] check failed: ${message}`);
      res.status(502).json({ error: 'Could not reach YouTube.' });
    }
  },
);

/**
 * The channel's live broadcast, or null.
 *
 * ---------------------------------------------------------------------------
 * Two requests rather than one, because the obvious one request does not work.
 *
 * `youtube.com/channel/<id>/live` names the live video plainly — when you ask
 * from a laptop. Asked from a Cloud Function it comes back a *different page*:
 * 1.1MB with the player-response object stripped out, no canonical link, no
 * video id anywhere in it. The only trace of the broadcast left is an `isLive`
 * flag on the view-count renderer, which says a stream is on but not which one.
 * That is not a rate limit or a consent wall — it is simply a thinner page for
 * datacenter IPs, and no header made it thicker.
 *
 * So the id comes from somewhere that treats us the same as anyone: the Atom
 * feed, which needs no key, no browser-shaped request, and returns the live
 * video like any other entry. Then each candidate's own watch page is asked
 * whether it is *currently* on, using the schema.org markup that does survive.
 * ---------------------------------------------------------------------------
 */
async function findLiveBroadcast(
  channelId: string,
  apiKey: string,
): Promise<{ videoId: string } | null> {
  const feed = await get(channelFeedUrl(channelId));
  if (!feed) throw new Error('the channel feed could not be read');

  /*
   * The newest few, not the newest one.
   *
   * The feed is ordered by publish time, which is when a *recording* was
   * processed rather than when a stream aired — so a VOD published this
   * afternoon sorts above a broadcast that started this evening and is still
   * running. Observed exactly that on 2026-08-21: the live liturgy was the
   * feed's second entry, behind the finished morning one. Checking only the head
   * would have missed it.
   */
  const candidates = parseChannelFeed(feed).slice(0, CANDIDATES).map((video) => video.id);
  if (candidates.length === 0) return null;

  const response = await fetch(`${videosListUrl(candidates)}&key=${encodeURIComponent(apiKey)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Thrown rather than returned as "not live": a rejected key or an exhausted
    // quota is us being broken, and the page must not report it as a quiet week.
    throw new Error(`videos.list returned HTTP ${response.status}`);
  }

  const live = liveBroadcastIds(await response.json(), candidates);
  if (live[0]) return { videoId: live[0] };

  console.info(`[live] nothing live among ${candidates.join(', ')}.`);
  return null;
}

/**
 * How many recent videos to ask about.
 *
 * `videos.list` takes up to 50 ids for the same single unit of quota, so this
 * number is not a cost — it is how far back "recent" reaches. Eight covers a
 * feast day with several services published around a broadcast that is still
 * running, and the feed only returns fifteen entries in total.
 */
const CANDIDATES = 8;

/** A page's text, or null if it could not be read. Never throws. */
async function get(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

    if (!response.ok) {
      console.error(`[live] HTTP ${response.status} from ${url}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.error(`[live] could not read ${url}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * The livestream settings, from our own Firestore.
 *
 * Read here rather than taken from the request: a caller that names its own
 * channel is a caller that can point the parish's endpoint anywhere it likes.
 */
async function livestream() {
  try {
    const snapshot = await getFirestore()
      .doc(`${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS}`)
      .get();

    if (!snapshot.exists) {
      console.warn(
        `[live] ${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS} does not exist; ` +
          `using built-in defaults.`,
      );
      return DEFAULT_INTEGRATIONS_CONFIG.livestream;
    }
    return parseIntegrationsConfig(snapshot.data()).livestream;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[live] could not read settings: ${message}`);
    return DEFAULT_INTEGRATIONS_CONFIG.livestream;
  }
}
