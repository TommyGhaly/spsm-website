/**
 * Reading a YouTube channel's recent videos, and which of them is on air.
 *
 * In `shared` rather than in the website because the phone app has the same two
 * questions to ask — "what were the last few liturgies?" and "is one happening
 * now?" — and both answers are pure functions of a response body. Only the
 * fetch differs between the two, so only the fetch lives in each app.
 *
 * ---------------------------------------------------------------------------
 * ## The channel's Atom feed used to be the source here. It is gone.
 *
 * `youtube.com/feeds/videos.xml?channel_id=…` needed no key, which is why it
 * was chosen: an API key has to be provisioned by hand, rotated by hand, and
 * kept out of the world-readable `config` document, and the feed bought us the
 * list for nothing.
 *
 * It now answers **404, and sometimes 500, for a channel that demonstrably
 * exists** — measured on 2026-09-02 against `UC6xlDBsD02-k7M5o-51CUQw`, which
 * `channels.list` resolves in the same minute to "St Philopater & St Mina
 * Coptic Orthodox Church". Six consecutive requests: 404 404 500 404 404 500.
 * Not a datacenter problem and not throttling of the kind that clears — the
 * same 404 comes back from a residential connection, with an
 * `accept: application/atom+xml` header, with a browser User-Agent, and from
 * the `?playlist_id=UU…` spelling of the same feed. There is nothing left to
 * ask it.
 *
 * The replacement is the uploads playlist through the Data API, which is the
 * set the feed was generated from and returns the same ids in the same order.
 * It costs one unit of quota per call and a key we already provision for the
 * live check — see `functions/src/live.ts`, which now spends two units where it
 * used to spend one.
 *
 * What this costs compared with the feed, stated plainly:
 *
 *   - A credential is now required to list the channel at all. `npm run
 *     archive` and the workflow that runs it need `YOUTUBE_API_KEY` in the
 *     environment; without it there is no fallback that works.
 *   - `playlistItems.list` caps `maxResults` at 50 where the feed returned 15,
 *     so this is more generous rather than less — but it still does not say
 *     whether a video *was* a livestream, so an ordinary upload appears in the
 *     list exactly as it did before.
 * ---------------------------------------------------------------------------
 */
import type { FeedVideo, PastStream } from './schema/config.js';

/**
 * A channel's uploads playlist id.
 *
 * Derived rather than looked up. Every channel's uploads playlist is its own id
 * with `UC` swapped for `UU`, which is a documented property of the id scheme —
 * so asking `channels.list` for `contentDetails.relatedPlaylists.uploads` would
 * spend a unit of quota and a round trip to be told what the string already
 * says. Verified against this parish's channel on 2026-09-02: the API returns
 * `UU6xlDBsD02-k7M5o-51CUQw` for `UC6xlDBsD02-k7M5o-51CUQw`.
 *
 * Takes a channel id only — never an `@handle`, which has no such property.
 * Callers should gate on `isYouTubeChannelId` first; a value that is not a
 * channel id is returned unchanged rather than repaired, so the API rejects it
 * loudly instead of this function inventing a playlist.
 */
export function uploadsPlaylistId(channelId: string): string {
  return /^UC[A-Za-z0-9_-]{22}$/.test(channelId) ? `UU${channelId.slice(2)}` : channelId;
}

/**
 * The `playlistItems.list` request that answers `parseUploadsPlaylist` for one
 * channel's most recent `max` videos.
 *
 * No `key` parameter — the caller appends it, the same arrangement as
 * `videosListUrl`. That keeps the key out of anything that gets logged by
 * accident: this URL is what error messages name.
 *
 * `snippet,contentDetails` because the two carry different dates and the
 * difference matters. `contentDetails.videoPublishedAt` is when the *video* was
 * published; `snippet.publishedAt` is when it was added to this playlist, which
 * for an uploads playlist is normally the same instant but is not the same
 * field. `parseUploadsPlaylist` prefers the first.
 */
export function uploadsPlaylistUrl(channelId: string, max: number): string {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId(channelId),
    // 50 is the API's own ceiling, and 1 its floor. Clamped rather than passed
    // through: `maxResults=0` is an error response, not an empty list.
    maxResults: String(Math.min(50, Math.max(1, Math.trunc(max)))),
  });
  return `https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`;
}

/** The watch page for one video, which is where the true start time lives. */
export function watchPageUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/**
 * When a broadcast actually began, read from its watch page. Null if the page
 * does not say — which is the normal answer for a video that was uploaded
 * rather than streamed.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, since the feed already carries a date
 *
 * The feed's `<published>` is when YouTube published the *recording*: the
 * stream ends, the VOD is processed, and only then is the entry dated. For this
 * parish that is routinely twelve hours after the liturgy, and it crosses
 * midnight often enough that the **day** is wrong too. Checked against YouTube's
 * own figures on 2026-08-17, every row on the page was wrong:
 *
 *   published 2026-08-17 03:36Z ("Sun 11:36 PM")  →  really Sun 16th, 7:52 AM
 *   published 2026-08-16 14:00Z ("Sun 10:00 AM")  →  really Sat 15th, 6:40 PM
 *   published 2026-08-16 02:37Z ("Sat 10:37 PM")  →  really Sat 15th, 7:56 AM
 *
 * The corrected times land where a parish schedule actually lands — liturgies
 * just before 8am, evening services just before 7pm — which is the strongest
 * evidence that this field is the right one.
 * ---------------------------------------------------------------------------
 *
 * The cost, stated plainly: this reads a value out of YouTube's own page JSON,
 * which is internal and may change without notice. Callers must therefore treat
 * `null` as ordinary and fall back to the feed's date rather than dropping the
 * video. A slightly wrong time is worse than a right one but far better than a
 * liturgy missing from the list.
 */
export function parseWatchPageStart(html: string): string | null {
  // `startTimestamp` rather than `publishDate`/`uploadDate`, which are the same
  // publish-time value the feed already gave us.
  const match = /"startTimestamp"\s*:\s*"([^"]+)"/.exec(html);
  const value = match?.[1]?.trim();
  if (!value) return null;

  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * Pull the video entries out of a `playlistItems.list` response.
 *
 * Never throws. A body of the wrong shape yields an empty list, and one
 * malformed item is skipped rather than discarding the rest of the page with
 * it — the caller reports an empty list as "could not find out", which is the
 * honest answer and one the page acts on.
 */
export function parseUploadsPlaylist(body: unknown): FeedVideo[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const videos: FeedVideo[] = [];
  for (const item of items) {
    const snippet = (item as { snippet?: Record<string, unknown> })?.snippet;
    const details = (item as { contentDetails?: Record<string, unknown> })?.contentDetails;

    const id = text(details?.['videoId']);
    // The video's own publish time first; the playlist's only as a fallback.
    // See `uploadsPlaylistUrl` for why both are requested.
    const publishedAt = text(details?.['videoPublishedAt']) ?? text(snippet?.['publishedAt']);

    // Both are required. An entry with no video id is not something we can link
    // to, and one with no date cannot be placed in a list whose whole organising
    // principle is the date.
    if (!id || !publishedAt) continue;
    if (Number.isNaN(Date.parse(publishedAt))) continue;

    videos.push({ id, publishedAt, thumbnailUrl: bestThumbnail(snippet?.['thumbnails']) });
  }

  /*
   * Newest-first by publish time, which orders *which videos to look up* — not
   * how the page finally lists them. The true broadcast order can differ, since
   * a morning liturgy and the evening service before it are sometimes published
   * in the opposite order to how they aired. The final sort happens once the
   * real start times are known; see `getPastStreams`.
   *
   * Sorted here rather than trusted from the response for the same reason the
   * feed's order was re-sorted: the API returns an uploads playlist in reverse
   * publish order today, and nothing in it promises to keep doing so.
   */
  return videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** A trimmed string, or null for anything that is not one. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The largest thumbnail the response offers, or `''`.
 *
 * Largest-first rather than a fixed key: `maxres` and `standard` exist only for
 * some videos, and `high` is the one every video has. The empty string is what
 * `FeedVideo` uses for "no picture" — the page renders its own placeholder for
 * it, so a missing thumbnail must not drop the stream.
 */
function bestThumbnail(value: unknown): string {
  const thumbnails = value as Record<string, { url?: unknown }> | undefined;
  if (!thumbnails) return '';

  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const url = text(thumbnails[size]?.url);
    if (url) return url;
  }
  return '';
}

/**
 * The videos among `candidates` that YouTube says are streaming right now.
 *
 * Reads a `videos.list` response. One request answers for every candidate at
 * once — up to 50 ids — for a single unit of quota, which is what makes polling
 * this every half-minute affordable where `search.list` (100 units a call)
 * would not be.
 *
 * Returned in **candidate order, not response order**. The API does not promise
 * to echo ids back in the order they were asked for, and the caller's order is
 * the meaningful one: it is the channel feed's, so the first live entry is the
 * most recently published broadcast rather than whichever the API happened to
 * list first.
 *
 * Never throws. An unparseable body yields an empty list, which the caller
 * reports as "could not find out" rather than as "nothing is on" — a
 * distinction the page acts on.
 */
export function liveBroadcastIds(body: unknown, candidates: readonly string[]): string[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const live = new Set<string>();
  for (const item of items) {
    const id = (item as { id?: unknown })?.id;
    const content = (item as { snippet?: { liveBroadcastContent?: unknown } })?.snippet
      ?.liveBroadcastContent;
    // `'live'` exactly. The other values are `'none'` for an ordinary video or a
    // finished stream, and `'upcoming'` for a scheduled one — and an upcoming
    // broadcast must not put a player on the page, because there is nothing in
    // it yet.
    if (typeof id === 'string' && content === 'live') live.add(id);
  }

  return candidates.filter((id) => live.has(id));
}

/**
 * The `videos.list` request that answers `liveBroadcastIds` and
 * `pastBroadcasts` for these ids.
 *
 * **`liveStreamingDetails` is free, and that is why both questions are asked
 * here rather than in two calls.** A v3 quota unit is charged per method, not
 * per part: `videos.list` costs one whether you ask for one part or five. So
 * the part that carries `actualStartTime` — the only trustworthy answer to
 * *when did this liturgy begin* — rides along on the request the live check was
 * making anyway, and the archive costs nothing it did not already cost.
 *
 * That is worth stating because the obvious alternative is what
 * `scripts/refresh-archive.mjs` still does: fetch each video's watch page and
 * scrape `startTimestamp` out of its page JSON. That works from a laptop or a
 * GitHub runner and **cannot** work from a Cloud Function, which is served a
 * deliberately thinner page with the player-response object stripped out — see
 * the measurements in `functions/src/live.ts`. `actualStartTime` is the same
 * fact from a documented field, and every caller can read it.
 */
export function videosListUrl(ids: readonly string[]): string {
  const params = new URLSearchParams({
    part: 'snippet,liveStreamingDetails',
    id: ids.join(','),
  });
  return `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
}

/**
 * The broadcasts among these videos that have already finished, newest first.
 *
 * Reads the same `videos.list` response `liveBroadcastIds` reads, and is the
 * other half of it: that one answers "which of these is on now", this one
 * answers "which of these were on before". One request, both answers.
 *
 * **The in-progress broadcast is excluded, and a scheduled one with it.** The
 * word in the name is `past`, and a list of previous services whose first row
 * is the liturgy playing in the player above it is a list that has miscounted.
 * Note this is a real difference from the website's `getPastStreams`, which
 * lists whatever is in `archive.json` including a stream that was live when the
 * snapshot was taken — it can afford to, because the snapshot is up to a day
 * stale and the overlap is rare. A list read live cannot.
 *
 * `startedAt` prefers `liveStreamingDetails.actualStartTime`, which is when the
 * broadcast actually went on air, and falls back to `snippet.publishedAt`,
 * which is when YouTube finished processing the recording — routinely twelve
 * hours later and often on the following day. See `parseWatchPageStart` for the
 * measurements that make the distinction worth this much care; the fallback is
 * here for an ordinary upload, which has no start time because it was never
 * streamed.
 *
 * Never throws. A body of the wrong shape yields an empty list, and one
 * malformed item is skipped rather than discarding the page with it.
 */
export function pastBroadcasts(body: unknown): PastStream[] {
  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const streams: PastStream[] = [];
  for (const item of items) {
    const id = text((item as { id?: unknown })?.id);
    const snippet = (item as { snippet?: Record<string, unknown> })?.snippet;
    const details = (item as { liveStreamingDetails?: Record<string, unknown> })
      ?.liveStreamingDetails;

    if (!id) continue;

    // `'live'` is the one in the player and `'upcoming'` has nothing in it yet.
    // Anything else — `'none'` for a finished stream or a plain upload — is past.
    const content = snippet?.['liveBroadcastContent'];
    if (content === 'live' || content === 'upcoming') continue;

    const startedAt = text(details?.['actualStartTime']) ?? text(snippet?.['publishedAt']);
    // A stream with no date cannot be placed in a list whose whole organising
    // principle is the date. Same rule as `parseUploadsPlaylist`.
    if (!startedAt || Number.isNaN(Date.parse(startedAt))) continue;

    streams.push({
      id,
      /*
       * Canonicalised rather than passed through as YouTube spelled it, for the
       * reason `refresh-archive.mjs` gives at greater length: the two sources
       * disagree on offset notation for the same instant, and a caller that
       * compares or caches these should not see a change where there is none.
       */
      startedAt: new Date(startedAt).toISOString(),
      thumbnailUrl: bestThumbnail(snippet?.['thumbnails']),
    });
  }

  // By start time, not by the response's order or the caller's. The true
  // broadcast order differs from publish order often enough to matter — a
  // morning liturgy and the evening service before it are sometimes processed
  // the other way round — and this is the field that settles it.
  return streams.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
