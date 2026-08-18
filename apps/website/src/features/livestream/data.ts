/**
 * Past broadcasts, read at build time from the channel's public feed and then
 * from each video's watch page.
 *
 * Two requests deep rather than one, and the second one is not optional. The
 * feed says *which* videos exist; it does not say when they were streamed. Its
 * `<published>` is when the recording was published, which for this parish runs
 * hours after the liturgy and crosses midnight often enough to put a Saturday
 * evening service under Sunday's date. The real air time comes from each watch
 * page — see `parseWatchPageStart` in @spsm/shared for the evidence.
 *
 * Only the fetching is here; both parsers are pure functions in `@spsm/shared`,
 * because the phone app will ask the same questions.
 *
 * The constraint this file adds: **this is a static export**, so the list is
 * frozen at build time. It goes stale between deploys and will not show a
 * liturgy streamed after the last one.
 *
 * ---------------------------------------------------------------------------
 * Why there is a committed snapshot to fall back on.
 *
 * YouTube rate-limits. Reading the feed plus one watch page per stream is
 * thirteen requests, and a run of deploys is enough to earn a spell of 404s
 * from a channel that exists — observed on 2026-08-18, where the same URL that
 * had served fifteen entries began refusing plain `curl` from the same machine
 * for minutes at a time.
 *
 * Without a fallback that is silent and bad: the build succeeds, the page
 * renders, and the archive is simply empty, so a deploy that happens to land in
 * a rate-limited window ships a livestream page with no past services and
 * nothing says so. `archive.json` is the last good read, committed, and it is
 * used whenever the live fetch comes back with nothing. The page is then stale
 * rather than blank, which for a list of past liturgies is barely a difference.
 *
 * Refresh it with `npm run archive`.
 * ---------------------------------------------------------------------------
 */
import snapshot from './archive.json';
import {
  channelFeedUrl,
  isYouTubeChannelId,
  parseChannelFeed,
  parseWatchPageStart,
  watchPageUrl,
  type FeedVideo,
  type LivestreamConfig,
  type PastStream,
} from '@spsm/shared';

/** How many streams the page lists. The feed caps at 15 regardless. */
const MAX_STREAMS = 12;

/** Bounds each fetch, so one hung request cannot stall a deploy. */
const TIMEOUT_MS = 10_000;

/**
 * How many watch pages to fetch at once.
 *
 * They are about 1.2MB each and there is one per listed stream, so this is the
 * heaviest thing the build does over the network. Batched rather than fired all
 * at once to stay a well-behaved client of someone else's server; batched
 * rather than run serially because twelve sequential round trips is a slow
 * deploy for no benefit.
 */
const BATCH = 4;

/**
 * Never throws, and never fails the build.
 *
 * Same principle as `safely()` in `@/lib/firestore`: a parish site whose archive
 * is empty for one deploy is a bad afternoon, and a parish site that will not
 * build is a worse one. Every failure here — YouTube unreachable, the channel
 * renamed, a malformed feed — degrades to an empty list and says why on the
 * build log.
 */
export async function getPastStreams(
  config: LivestreamConfig,
  max = MAX_STREAMS,
): Promise<PastStream[]> {
  const channel = config.archiveChannelId;
  if (!channel) return [];

  // `parseIntegrationsConfig` already blanks anything malformed, so reaching
  // here with a bad id means this was called with a hand-built config.
  if (!isYouTubeChannelId(channel)) {
    console.warn(`[livestream] not a YouTube channel id, skipping the archive: ${channel}`);
    return [];
  }

  const videos = await readChannelFeed(channel);
  if (videos.length === 0) {
    // Rate-limited, unreachable, or an empty channel. Ship the last good read
    // rather than a blank section — see the note at the top of this file.
    const fallback = snapshot as PastStream[];
    console.warn(
      `[livestream] falling back to the committed archive of ${fallback.length} ` +
        `stream(s); run \`npm run archive\` to refresh it.`,
    );
    return fallback.slice(0, max);
  }

  const streams = await withRealStartTimes(videos.slice(0, max));

  /*
   * The final order, and the only one the reader sees.
   *
   * Sorted here rather than in the feed parser because until this point the
   * list was in publish order, which is not broadcast order — a Saturday
   * evening service is sometimes published after the Sunday morning liturgy
   * that followed it.
   */
  return streams.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

async function readChannelFeed(channel: string): Promise<FeedVideo[]> {
  try {
    const response = await fetch(channelFeedUrl(channel), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/atom+xml' },
    });

    if (!response.ok) {
      // 404 is the interesting one: a well-formed id that no longer resolves.
      // Naming the id beats printing the status alone, because the id is the
      // thing someone has to go and correct.
      console.warn(
        `[livestream] channel feed for ${channel} returned ${response.status}; ` +
          `rendering the player without an archive.`,
      );
      return [];
    }

    const videos = parseChannelFeed(await response.text());
    if (videos.length === 0) {
      console.warn(`[livestream] channel feed for ${channel} held no videos.`);
    }
    return videos;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[livestream] could not read the channel feed, rendering without it: ${message}`);
    return [];
  }
}

/**
 * Replace each video's publish time with the time it was actually streamed.
 *
 * A video whose watch page cannot be read keeps the feed's date rather than
 * being dropped. That date is wrong — usually by several hours — but a liturgy
 * listed at the wrong time is a smaller failure than a liturgy missing from the
 * list, and the whole page degrades to its previous behaviour rather than to
 * nothing.
 */
async function withRealStartTimes(videos: FeedVideo[]): Promise<PastStream[]> {
  const streams: PastStream[] = [];
  let unresolved = 0;

  for (let i = 0; i < videos.length; i += BATCH) {
    const batch = videos.slice(i, i + BATCH);
    const resolved = await Promise.all(batch.map(startTimeOf));

    batch.forEach((video, index) => {
      const startedAt = resolved[index];
      if (!startedAt) unresolved += 1;
      streams.push({
        id: video.id,
        startedAt: startedAt ?? video.publishedAt,
        thumbnailUrl: video.thumbnailUrl,
      });
    });
  }

  if (unresolved > 0) {
    // Worth a line on the build log even though the page still renders: it is
    // the signal that YouTube changed their page shape and these times have
    // quietly gone back to being wrong.
    console.warn(
      `[livestream] ${unresolved} of ${videos.length} watch pages did not give a ` +
        `start time; those rows fall back to the feed's publish date, which runs ` +
        `hours late. Check parseWatchPageStart against a current watch page.`,
    );
  }

  return streams;
}

/** The instant a broadcast began, or null if the watch page won't say. */
async function startTimeOf(video: FeedVideo): Promise<string | null> {
  try {
    const response = await fetch(watchPageUrl(video.id), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Without a browser-shaped UA, YouTube serves a consent interstitial that
      // carries no player JSON at all.
      headers: {
        accept: 'text/html',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) return null;
    return parseWatchPageStart(await response.text());
  } catch {
    return null;
  }
}
