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
 * So: two Data API calls. `playlistItems.list` on the channel's uploads
 * playlist for *which videos exist*, then one `videos.list` for *which of them
 * is on*. One unit of quota each, where the obvious
 * `search.list?eventType=live` costs a hundred. On the default 10,000 units a
 * day that is the difference between a check every seventeen seconds and
 * running dry before lunch.
 *
 * The first of those two used to be the channel's Atom feed, which needed no
 * key at all. It now returns 404 and 500 for a channel that exists, from every
 * network and under every header worth trying — the measurements are in
 * `packages/shared/src/youtube.ts`, above `uploadsPlaylistId`. This endpoint
 * therefore spends two units where it spent one, and the key it already needed
 * for the live check is now load-bearing for the listing as well.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_INTEGRATIONS,
  DEFAULT_INTEGRATIONS_CONFIG,
  isYouTubeChannelId,
  liveBroadcastIds,
  parseUploadsPlaylist,
  pastBroadcasts,
  uploadsPlaylistUrl,
  parseIntegrationsConfig,
  videosListUrl,
  type PastStream,
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
 * `GET /api/live` -> `{ live, videoId, recent }`.
 *
 * 200 with `live: false` is the ordinary answer on a Tuesday, and is
 * deliberately distinguishable from a failure: every error path returns a
 * non-2xx so the page can tell "there is no service" from "we could not find
 * out", and show a way through to YouTube in the second case.
 *
 * ---------------------------------------------------------------------------
 * `recent` is the back catalogue, and it is here because it was already paid
 * for.
 *
 * The website does not use it: `/livestream` reads past streams from
 * `archive.json`, a snapshot committed in `apps/website` and refreshed daily by
 * `.github/workflows/refresh-archive.yml`, because a static export must not
 * fetch at build time — see `features/livestream/data.ts` for that whole
 * argument, which still stands.
 *
 * The **app** cannot read that file. It is a different repository with a
 * different release cadence, and the snapshot rotates completely in about eight
 * days — so a copy bundled into a build would spend most of its life listing
 * liturgies that had already scrolled off the website. Its "Recent services"
 * list is read from here instead, and is therefore always current.
 *
 * It costs nothing. `findLiveBroadcast` below already lists the channel's
 * recent uploads and already asks `videos.list` about them; the only change is
 * that the request now names `liveStreamingDetails` as well as `snippet`, and a
 * v3 quota unit is charged per method rather than per part. Same two units a
 * call, same 30-second CDN cache, one more field in the body.
 *
 * Additive on purpose: the website reads `live` and `videoId` and is untouched
 * by this.
 * ---------------------------------------------------------------------------
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
      /*
       * Somebody switched the stream off in config/integrations. Not an error.
       *
       * `recent` is empty rather than looked up, and that is the same rule
       * `getPastStreams` follows for an empty `archiveChannelId`: a parish that
       * has switched the stream off has switched the archive off with it, and
       * spending two units of quota to list a channel nobody is being shown
       * would be answering a question that is no longer being asked.
       */
      res.set('Cache-Control', CACHE_CONTROL);
      res.status(200).json({ live: false, videoId: null, recent: [], reason: 'disabled' });
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
        live: !!found.videoId,
        videoId: found.videoId,
        recent: found.recent,
        reason: found.videoId ? null : 'not-live',
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
 * So the ids come from the Data API's view of the channel's uploads, which
 * treats us the same as anyone, and then one `videos.list` call asks which of
 * them YouTube says is streaming right now. Until 2026-09-02 the first half was
 * the channel's Atom feed, which was free; it is now dead for this channel and
 * for the `?playlist_id=` spelling of itself.
 * ---------------------------------------------------------------------------
 */
async function findLiveBroadcast(
  channelId: string,
  apiKey: string,
): Promise<{ videoId: string | null; recent: PastStream[] }> {
  /*
   * The newest few, not the newest one.
   *
   * The playlist is ordered by publish time, which is when a *recording* was
   * processed rather than when a stream aired — so a VOD published this
   * afternoon sorts above a broadcast that started this evening and is still
   * running. Observed exactly that on 2026-08-21: the live liturgy was the
   * second entry, behind the finished morning one. Checking only the head would
   * have missed it.
   */
  const uploads = await getJson(`${uploadsPlaylistUrl(channelId, CANDIDATES)}&key=${key(apiKey)}`);
  const candidates = parseUploadsPlaylist(uploads).map((video) => video.id);
  if (candidates.length === 0) return { videoId: null, recent: [] };

  const response = await fetch(`${videosListUrl(candidates)}&key=${key(apiKey)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Thrown rather than returned as "not live": a rejected key or an exhausted
    // quota is us being broken, and the page must not report it as a quiet week.
    throw new Error(`videos.list returned HTTP ${response.status}`);
  }

  /*
   * One body, read twice, for the two different questions it answers — which of
   * these is on now, and which of them were on before. See `videosListUrl` for
   * why asking both costs the same single unit of quota as asking either.
   */
  const body = await response.json();
  const live = liveBroadcastIds(body, candidates);
  const recent = pastBroadcasts(body);

  if (!live[0]) console.info(`[live] nothing live among ${candidates.join(', ')}.`);

  return { videoId: live[0] ?? null, recent };
}

/**
 * How many recent videos to ask about.
 *
 * Free, at any value up to 50. `playlistItems.list` costs one unit whatever
 * `maxResults` says, and `videos.list` takes up to 50 ids for one unit — so
 * this number is not a cost, it is only how far back "recent" reaches.
 *
 * Fifteen, which is what the Atom feed used to return in full; the old code
 * took the first eight of them. The four days of margin that buys matters for
 * one case measured on 2026-09-02: a broadcast **keeps its creation date, not
 * its start time**. St. Thomas Orthodox Cathedral's liturgy that morning was
 * published on 2026-08-26 and started on 09-01, six days apart — so a stream
 * scheduled a week ahead sits that much further down a channel's uploads by the
 * time it goes on air, and a window of eight could have scrolled past it while
 * it was live.
 *
 * A ceiling of 50 rather than paging past it, and that is a real limit: a
 * permanently-running stream published months ago is out of reach here, and
 * nothing in this endpoint will find it. That is the right trade for this
 * parish, which starts a new broadcast for each service, and would be the wrong
 * one for a channel with a 24/7 feed.
 */
const CANDIDATES = 15;

/**
 * One Data API response, parsed. Throws on anything that is not a 200 with a
 * JSON body.
 *
 * Throwing rather than returning null, which is what the page-reading helper
 * this replaced did: every failure here means we could not find out, and the
 * caller turns that into a 502 the player distinguishes from "no service". A
 * null would have to be checked at the one call site anyway.
 *
 * The URL is not logged. It carries the API key in a query parameter, and a
 * secret in a log line is a secret in a log.
 */
async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });

  if (!response.ok) {
    throw new Error(`${new URL(url).pathname} returned HTTP ${response.status}`);
  }
  return await response.json();
}

/** The key, encoded for a query string. Kept short because it appears twice. */
function key(apiKey: string): string {
  return encodeURIComponent(apiKey);
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
