/**
 * Reading a YouTube channel's public Atom feed.
 *
 * In `shared` rather than in the website because the phone app has the same
 * question to ask — "what were the last few liturgies?" — and the answer is a
 * pure function of the feed body. Only the fetch differs between the two, so
 * only the fetch lives in each app.
 *
 * Why the feed and not the YouTube Data API: the feed needs no key. An API key
 * would have to be provisioned, rotated, and kept out of the world-readable
 * `config` document, and it buys one thing this does not need — filtering to
 * `eventType=completed`. The parish's channel is a livestream channel;
 * essentially everything on it is a liturgy. Paying for a credential to exclude
 * the occasional upload is the wrong trade.
 *
 * What the feed costs instead, stated plainly so nobody is surprised by it:
 *
 *   - It returns the 15 most recent videos and no more. There is no paging, so
 *     "recent streams" cannot become "all streams" without moving to the API.
 *   - It does not say whether a video was a livestream, so a non-stream upload
 *     would appear in the list.
 */
import type { FeedVideo } from './schema/config.js';

/** The feed for one channel. Takes a channel id only — never an `@handle`. */
export function channelFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
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
 * Pull the video entries out of a YouTube channel feed.
 *
 * Hand-parsed with a regex rather than an XML library, and that is a deliberate
 * limit rather than a shortcut. This reads three leaf values out of one
 * machine-generated document whose shape YouTube has not changed in a decade;
 * adding a parser dependency to a phone app and a website for that is not a
 * trade worth making. It is only safe *because* the scope is this narrow — if
 * this ever needs nested structure, or attributes beyond `url`, replace it
 * rather than extending it.
 *
 * Never throws. A malformed document yields an empty list, and one malformed
 * entry is skipped rather than discarding the rest of the feed with it.
 */
export function parseChannelFeed(xml: string): FeedVideo[] {
  const videos: FeedVideo[] = [];

  // Entry-by-entry rather than field-by-field across the whole document: the
  // channel itself carries a `<published>` too, and a global scan would pair
  // the channel's creation date with the first video.
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    // Indexed rather than destructured: the project runs
    // `noUncheckedIndexedAccess`, so a capture group is `string | undefined`
    // even when the pattern guarantees it.
    const entry = match[1];
    if (!entry) continue;

    const id = tagOf(entry, 'yt:videoId');
    const publishedAt = tagOf(entry, 'published');

    // Both are required. An entry with no video id is not something we can link
    // to, and one with no date cannot be placed in a list whose whole organising
    // principle is the date.
    if (!id || !publishedAt) continue;
    if (Number.isNaN(Date.parse(publishedAt))) continue;

    videos.push({
      id,
      publishedAt,
      thumbnailUrl: attributeOf(entry, 'media:thumbnail', 'url') ?? '',
    });
  }

  /*
   * Newest-first by publish time, which orders *which videos to look up* — not
   * how the page finally lists them. The true broadcast order can differ, since
   * a morning liturgy and the evening service before it are sometimes published
   * in the opposite order to how they aired. The final sort happens once the
   * real start times are known; see `getPastStreams`.
   */
  return videos.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

/** Text content of the first `<tag>…</tag>`, trimmed, or null. */
function tagOf(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1]?.trim() || null;
}

/** Value of one attribute on the first `<tag …>`, or null. */
function attributeOf(xml: string, tag: string, attribute: string): string | null {
  const element = new RegExp(`<${tag}\\b[^>]*>`).exec(xml)?.[0];
  if (!element) return null;

  const match = new RegExp(`\\b${attribute}="([^"]*)"`).exec(element);
  return match?.[1]?.trim() || null;
}
