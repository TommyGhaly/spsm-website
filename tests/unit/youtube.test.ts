import { describe, it, expect } from 'vitest';
import {
  channelFeedUrl,
  parseChannelFeed,
  parseWatchPageStart,
  watchPageUrl,
  isYouTubeChannelId,
  liveBroadcastIds,
  videosListUrl,
} from '@spsm/shared';

/**
 * The archive under the livestream player is parsed out of YouTube's Atom feed
 * with a regex rather than an XML library — a deliberate narrow scope, which
 * only stays safe if the edges are pinned down. These are those edges.
 *
 * `FEED` is trimmed from the real response for
 * `channel_id=UC6xlDBsD02-k7M5o-51CUQw` on 2026-08-17, including the detail
 * that matters most about it: every entry carries the identical title, which is
 * why `PastStream` has no title field and the page is led by the date.
 */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <id>yt:channel:6xlDBsD02-k7M5o-51CUQw</id>
 <yt:channelId>6xlDBsD02-k7M5o-51CUQw</yt:channelId>
 <title>St Philopater &amp; St Mina Coptic Orthodox Church</title>
 <published>2016-11-24T14:52:59+00:00</published>
 <entry>
  <id>yt:video:2H7mU4a9bEQ</id>
  <yt:videoId>2H7mU4a9bEQ</yt:videoId>
  <title>St Philopater &amp; St Mina Coptic Orthodox Church Live Stream</title>
  <published>2026-08-17T03:36:13+00:00</published>
  <updated>2026-08-17T05:13:43+00:00</updated>
  <media:group>
   <media:thumbnail url="https://i3.ytimg.com/vi/2H7mU4a9bEQ/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
 <entry>
  <id>yt:video:oBDI-wjE0Io</id>
  <yt:videoId>oBDI-wjE0Io</yt:videoId>
  <title>St Philopater &amp; St Mina Coptic Orthodox Church Live Stream</title>
  <published>2026-08-16T14:00:20+00:00</published>
  <media:group>
   <media:thumbnail url="https://i3.ytimg.com/vi/oBDI-wjE0Io/hqdefault.jpg" width="480" height="360"/>
  </media:group>
 </entry>
</feed>`;

describe('parseChannelFeed', () => {
  it('reads id, date, and thumbnail out of a real feed', () => {
    const streams = parseChannelFeed(FEED);

    expect(streams).toEqual([
      {
        id: '2H7mU4a9bEQ',
        publishedAt: '2026-08-17T03:36:13+00:00',
        thumbnailUrl: 'https://i3.ytimg.com/vi/2H7mU4a9bEQ/hqdefault.jpg',
      },
      {
        id: 'oBDI-wjE0Io',
        publishedAt: '2026-08-16T14:00:20+00:00',
        thumbnailUrl: 'https://i3.ytimg.com/vi/oBDI-wjE0Io/hqdefault.jpg',
      },
    ]);
  });

  it("never picks up the channel's own published date", () => {
    // The regression this guards: the feed element carries a <published> of
    // 2016 (when the channel was created). A scan that was not scoped to each
    // <entry> would staple that onto the first video.
    const streams = parseChannelFeed(FEED);
    expect(streams.some((stream) => stream.publishedAt.startsWith('2016'))).toBe(false);
  });

  it('sorts newest first even when the feed does not', () => {
    const outOfOrder = FEED.replace(
      '<published>2026-08-16T14:00:20+00:00</published>',
      '<published>2026-08-18T14:00:20+00:00</published>',
    );
    expect(parseChannelFeed(outOfOrder).map((stream) => stream.id)).toEqual([
      'oBDI-wjE0Io',
      '2H7mU4a9bEQ',
    ]);
  });

  it('skips one unusable entry without discarding the rest', () => {
    const missingId = FEED.replace('<yt:videoId>2H7mU4a9bEQ</yt:videoId>', '');
    expect(parseChannelFeed(missingId).map((stream) => stream.id)).toEqual(['oBDI-wjE0Io']);

    const badDate = FEED.replace(
      '<published>2026-08-17T03:36:13+00:00</published>',
      '<published>whenever</published>',
    );
    expect(parseChannelFeed(badDate).map((stream) => stream.id)).toEqual(['oBDI-wjE0Io']);
  });

  it('keeps an entry that has no thumbnail, with an empty url', () => {
    const noThumb = FEED.replace(
      '<media:thumbnail url="https://i3.ytimg.com/vi/2H7mU4a9bEQ/hqdefault.jpg" width="480" height="360"/>',
      '',
    );
    expect(noThumb).not.toContain('2H7mU4a9bEQ/hqdefault.jpg');
    expect(parseChannelFeed(noThumb)[0]).toMatchObject({
      id: '2H7mU4a9bEQ',
      thumbnailUrl: '',
    });
  });

  it('returns nothing rather than throwing on junk', () => {
    expect(parseChannelFeed('')).toEqual([]);
    expect(parseChannelFeed('<html><body>404</body></html>')).toEqual([]);
    // A truncated download: the opening tag is there, the closing one is not.
    expect(parseChannelFeed('<feed><entry><yt:videoId>abc</yt:videoId>')).toEqual([]);
  });
});

describe('isYouTubeChannelId', () => {
  it('accepts the parish channel', () => {
    expect(isYouTubeChannelId('UC6xlDBsD02-k7M5o-51CUQw')).toBe(true);
  });

  it('rejects the forms someone would realistically paste instead', () => {
    // The whole reason the check exists: each of these produces a feed request
    // that 404s, which would look like "no past streams" rather than a typo.
    expect(isYouTubeChannelId('@WaylandCopticChurch')).toBe(false);
    expect(isYouTubeChannelId('https://www.youtube.com/@WaylandCopticChurch')).toBe(false);
    expect(
      isYouTubeChannelId('https://www.youtube.com/channel/UC6xlDBsD02-k7M5o-51CUQw'),
    ).toBe(false);
    expect(isYouTubeChannelId('')).toBe(false);
    // Right prefix, wrong length.
    expect(isYouTubeChannelId('UC6xlDBsD02-k7M5o-51CU')).toBe(false);
  });
});

describe('channelFeedUrl', () => {
  it('builds the feed address for a channel', () => {
    expect(channelFeedUrl('UC6xlDBsD02-k7M5o-51CUQw')).toBe(
      'https://www.youtube.com/feeds/videos.xml?channel_id=UC6xlDBsD02-k7M5o-51CUQw',
    );
  });
});

describe('watchPageUrl', () => {
  it('builds the watch address for a video', () => {
    expect(watchPageUrl('2H7mU4a9bEQ')).toBe('https://www.youtube.com/watch?v=2H7mU4a9bEQ');
  });
});

/**
 * The fix for the bug that made every row on the page wrong.
 *
 * The feed's `<published>` is when the *recording* was published, not when the
 * liturgy aired. The values below are the real ones YouTube reported for video
 * `2H7mU4a9bEQ` on 2026-08-17: it went out at 07:52 Eastern on the Sunday
 * morning, and the feed dated it 23:36 that night.
 */
describe('parseWatchPageStart', () => {
  const WATCH = `{"microformat":{"playerMicroformatRenderer":{
"publishDate":"2026-08-16T20:36:13-07:00","uploadDate":"2026-08-16T20:36:13-07:00",
"liveBroadcastDetails":{"isLiveNow":false,"startTimestamp":"2026-08-16T11:52:52+00:00","endTimestamp":"2026-08-16T15:13:34+00:00"}}}}`;

  it('reads the broadcast start time', () => {
    expect(parseWatchPageStart(WATCH)).toBe('2026-08-16T11:52:52+00:00');
  });

  it('takes the start time and never the publish date', () => {
    // The entire point. `publishDate` is the same late value the feed carries,
    // so picking it up here would reintroduce the bug this function fixes.
    const start = parseWatchPageStart(WATCH);
    expect(start).not.toContain('20:36');
    expect(Date.parse(start as string)).toBeLessThan(Date.parse('2026-08-16T20:36:13-07:00'));
  });

  it('returns null when the page says nothing, so callers can fall back', () => {
    for (const body of [
      '',
      '<html><body>consent interstitial</body></html>',
      // An ordinary upload rather than a stream: no broadcast details at all.
      '{"microformat":{"playerMicroformatRenderer":{"publishDate":"2026-08-16T20:36:13-07:00"}}}',
      // Present but unparseable, which must not become an Invalid Date.
      '"startTimestamp":"soon"',
      '"startTimestamp":""',
    ]) {
      expect(parseWatchPageStart(body)).toBeNull();
    }
  });

  it('tolerates whitespace in the JSON', () => {
    expect(parseWatchPageStart('"startTimestamp" : "2026-08-16T11:52:52+00:00"')).toBe(
      '2026-08-16T11:52:52+00:00',
    );
  });
});




/**
 * `liveBroadcastIds` reads a `videos.list` response. This is the one call the
 * livestream's live check spends quota on, and it is asked about several videos
 * at once — so which of them comes back as *the* live one, and in what order,
 * is the whole behaviour.
 */
describe('liveBroadcastIds', () => {
  const candidates = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'];

  const body = (entries: Array<[string, string]>) => ({
    items: entries.map(([id, liveBroadcastContent]) => ({ id, snippet: { liveBroadcastContent } })),
  });

  it('returns only the videos YouTube calls live', () => {
    expect(
      liveBroadcastIds(
        body([
          ['aaaaaaaaaaa', 'none'],
          ['bbbbbbbbbbb', 'live'],
          ['ccccccccccc', 'none'],
        ]),
        candidates,
      ),
    ).toEqual(['bbbbbbbbbbb']);
  });

  it('ignores an upcoming broadcast', () => {
    // A scheduled stream has no content in it yet, so putting a player on the
    // page for one would show a countdown where a liturgy should be.
    expect(liveBroadcastIds(body([['aaaaaaaaaaa', 'upcoming']]), candidates)).toEqual([]);
  });

  it('answers in candidate order, not response order', () => {
    /*
     * The API does not promise to echo ids back in the order they were asked
     * for. Candidate order is the channel feed's, so the caller taking the first
     * result gets the most recently published broadcast — which is only true if
     * the ordering is imposed here.
     */
    expect(
      liveBroadcastIds(
        body([
          ['ccccccccccc', 'live'],
          ['aaaaaaaaaaa', 'live'],
        ]),
        candidates,
      ),
    ).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
  });

  it('ignores ids that were not asked about', () => {
    expect(liveBroadcastIds(body([['zzzzzzzzzzz', 'live']]), candidates)).toEqual([]);
  });

  it('returns nothing on a body it cannot read, without throwing', () => {
    // The caller treats an empty list as "could not find out" only because it
    // also checks the HTTP status; a malformed 200 is reported as nothing live.
    for (const junk of [null, undefined, {}, { items: 'nope' }, { items: [null, 7] }, 'text']) {
      expect(() => liveBroadcastIds(junk, candidates)).not.toThrow();
      expect(liveBroadcastIds(junk, candidates)).toEqual([]);
    }
  });
});

describe('videosListUrl', () => {
  it('asks for every candidate in one request', () => {
    // One request for many ids is what makes this cost a single unit of quota
    // rather than one per video.
    expect(videosListUrl(['aaaaaaaaaaa', 'bbbbbbbbbbb'])).toBe(
      'https://www.googleapis.com/youtube/v3/videos?part=snippet&id=aaaaaaaaaaa%2Cbbbbbbbbbbb',
    );
  });

  it('carries no key', () => {
    // The key is appended by the Function from Secret Manager. Building it into
    // a shared URL helper would invite it into the website bundle.
    expect(videosListUrl(['aaaaaaaaaaa'])).not.toContain('key=');
  });
});
