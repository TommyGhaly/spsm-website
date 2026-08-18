/**
 * Refresh the committed snapshot of past livestreams.
 *
 * `apps/website/src/features/livestream/archive.json` is what the site falls
 * back to when YouTube will not answer at build time — see the note in
 * features/livestream/data.ts. It is committed precisely so a rate-limited
 * deploy ships a stale archive rather than an empty one.
 *
 * This writes the file only when the read succeeds and returns something. A
 * failed run leaves the previous snapshot alone, because the whole point of it
 * is to be the last thing that worked.
 *
 * Usage: npm run archive
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  channelFeedUrl,
  parseChannelFeed,
  parseWatchPageStart,
  watchPageUrl,
} from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/website/src/features/livestream/archive.json');
const MAX = 12;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const channel = DEFAULT_INTEGRATIONS_CONFIG.livestream.archiveChannelId;

const feed = await fetch(channelFeedUrl(channel), { headers: { accept: 'application/atom+xml' } });
if (!feed.ok) {
  // 404 on a channel that exists is what rate limiting looks like here.
  console.error(
    `Feed for ${channel} returned HTTP ${feed.status}. YouTube rate-limits after a ` +
      `run of builds; wait and try again. The existing snapshot is untouched.`,
  );
  process.exit(1);
}

const videos = parseChannelFeed(await feed.text()).slice(0, MAX);
if (videos.length === 0) {
  console.error('The feed held no videos. The existing snapshot is untouched.');
  process.exit(1);
}

const streams = [];
for (const video of videos) {
  let startedAt = video.publishedAt;
  try {
    const page = await fetch(watchPageUrl(video.id), {
      headers: { accept: 'text/html', 'user-agent': BROWSER_UA },
    });
    if (page.ok) startedAt = parseWatchPageStart(await page.text()) ?? video.publishedAt;
  } catch {
    // Keep the feed's date for this one. It runs hours late, which is wrong but
    // is better than dropping the stream from the list entirely.
  }
  streams.push({ id: video.id, startedAt, thumbnailUrl: video.thumbnailUrl });
}

streams.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
writeFileSync(OUT, JSON.stringify(streams, null, 2) + '\n');
console.log(`Wrote ${streams.length} streams to ${OUT.replace(ROOT + '/', '')}`);
console.log('Commit it — this is what the site shows when YouTube will not answer.');
