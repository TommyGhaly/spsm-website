/**
 * Past broadcasts, read from a committed snapshot.
 *
 * ---------------------------------------------------------------------------
 * The build does not talk to YouTube, and that is the point.
 *
 * It used to: every build read the channel feed and then one watch page per
 * stream, thirteen requests a time. That earns rate limiting — on 2026-08-18
 * the feed began returning 404 for a channel that plainly exists, to plain
 * `curl`, from a machine that had read fifteen entries from the same URL
 * minutes earlier. It lifted on its own, which is what throttling does.
 *
 * The failure mode was the bad part rather than the throttling. The build
 * succeeded, the page rendered, and the archive was simply empty — so a deploy
 * landing in a throttled window shipped a livestream page with no past services
 * and nothing anywhere said so.
 *
 * So the network moved out of the build. `archive.json` is the source, and
 * `npm run archive` is the only thing that fetches. Builds are now
 * deterministic, offline, and identical every time — and the same trade the
 * catalog and the covers already make: refreshed by a command, not by a deploy.
 * ---------------------------------------------------------------------------
 */
import snapshot from './archive.json';
import { type LivestreamConfig, type PastStream } from '@spsm/shared';

/** How many streams the page lists. */
const MAX_STREAMS = 12;

/**
 * The archive, newest first.
 *
 * Sorted here rather than trusted from the file: it is hand-editable, and a
 * list of dates that runs backwards in the middle reads as a bug.
 */
export function getPastStreams(
  config: LivestreamConfig,
  max = MAX_STREAMS,
): PastStream[] {
  // An empty channel id means the parish has switched the archive off, and the
  // snapshot should not override that.
  if (!config.archiveChannelId) return [];

  return [...(snapshot as PastStream[])]
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, max);
}
