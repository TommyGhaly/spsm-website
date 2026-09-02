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
  parseUploadsPlaylist,
  parseWatchPageStart,
  uploadsPlaylistUrl,
  watchPageUrl,
} from '../packages/shared/dist/index.js';

/*
 * A missing `.env` is fine here, and has to stay fine — but what it holds is
 * no longer optional. The channel id still comes from
 * `DEFAULT_INTEGRATIONS_CONFIG` below; the *listing* now needs a YouTube API
 * key, because the Atom feed this used to read returns 404 for a channel that
 * exists (see packages/shared/src/youtube.ts). `loadEnvFile` throws ENOENT
 * rather than shrugging, and the scheduled refresh in
 * .github/workflows/refresh-archive.yml runs on a bare checkout with no `.env`
 * at all — it passes the key in the environment instead — so the catch stays.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // The key may be in the environment instead. Checked below either way.
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/website/src/features/livestream/archive.json');
const MAX = 12;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const channel = DEFAULT_INTEGRATIONS_CONFIG.livestream.archiveChannelId;

/*
 * The same key the `live` Function uses, and there is no keyless path left. If
 * you have never put it in `.env`, it is in Secret Manager already:
 *
 *   firebase functions:secrets:access YOUTUBE_API_KEY --project spsm-database
 *
 * Named without printing it, here and everywhere else in this script — the URL
 * carries it in a query parameter, so nothing below logs a URL either.
 */
const apiKey = (process.env.YOUTUBE_API_KEY ?? '').trim();
if (!apiKey || apiKey === 'unset') {
  console.error(
    'YOUTUBE_API_KEY is not set, so the channel cannot be listed — the Atom feed ' +
      'that needed no key now 404s for this channel. Put it in .env, or pass it in ' +
      'the environment. The existing snapshot is untouched.',
  );
  process.exit(1);
}

const listing = await fetch(`${uploadsPlaylistUrl(channel, MAX)}&key=${encodeURIComponent(apiKey)}`);
if (!listing.ok) {
  console.error(
    `playlistItems.list for ${channel} returned HTTP ${listing.status}. A 403 is a ` +
      `rejected key or an exhausted daily quota; a 404 is a channel id that no longer ` +
      `resolves. The existing snapshot is untouched.`,
  );
  process.exit(1);
}

const videos = parseUploadsPlaylist(await listing.json()).slice(0, MAX);
if (videos.length === 0) {
  console.error('The channel listed no videos. The existing snapshot is untouched.');
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
    // Keep the publish date for this one. It runs hours late, which is wrong
    // but is better than dropping the stream from the list entirely.
  }
  /*
   * Canonicalised, not stored as YouTube phrased it. Both sources hand back a
   * timestamp in whatever offset notation they feel like — the watch page says
   * `+00:00` where an older version of this script wrote `.000Z` for the same
   * instant — and the page cannot tell the difference, because `isoOf()`
   * normalises before it reaches the markup.
   *
   * The scheduled refresh can, though. It decides whether to commit by asking
   * `git diff` whether the file moved, so a re-spelled timestamp would read as
   * a change and push a commit that means nothing. One format keeps that test
   * honest.
   */
  streams.push({
    id: video.id,
    startedAt: new Date(startedAt).toISOString(),
    thumbnailUrl: video.thumbnailUrl,
  });
}

streams.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
writeFileSync(OUT, JSON.stringify(streams, null, 2) + '\n');
console.log(`Wrote ${streams.length} streams to ${OUT.replace(ROOT + '/', '')}`);
console.log('Commit it — this is what the site shows when YouTube will not answer.');
