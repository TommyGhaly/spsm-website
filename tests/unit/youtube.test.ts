import { describe, it, expect } from 'vitest';
import {
  isYouTubeChannelId,
  liveBroadcastIds,
  parseUploadsPlaylist,
  parseWatchPageStart,
  pastBroadcasts,
  uploadsPlaylistId,
  uploadsPlaylistUrl,
  videosListUrl,
  watchPageUrl,
} from '@spsm/shared';

/**
 * The archive under the livestream player, and the candidate list the live
 * check picks from, both come out of one `playlistItems.list` response. It
 * replaced the channel's Atom feed on 2026-09-02, when the feed began
 * answering 404 for a channel that exists.
 *
 * `PAGE` is trimmed from the real response for the parish's uploads playlist,
 * including the detail that matters most about it: every item carries the
 * identical title, which is why `PastStream` has no title field and the page is
 * led by the date.
 */
const PAGE = {
  kind: 'youtube#playlistItemListResponse',
  items: [
    {
      snippet: {
        publishedAt: '2026-09-02T01:16:09Z',
        title: 'St Philopater & St Mina Coptic Orthodox Church Live Stream',
        thumbnails: {
          default: { url: 'https://i.ytimg.com/vi/wrtfGSyFmtU/default.jpg' },
          high: { url: 'https://i.ytimg.com/vi/wrtfGSyFmtU/hqdefault.jpg' },
          maxres: { url: 'https://i.ytimg.com/vi/wrtfGSyFmtU/maxresdefault.jpg' },
        },
      },
      contentDetails: { videoId: 'wrtfGSyFmtU', videoPublishedAt: '2026-09-02T01:16:09Z' },
    },
    {
      snippet: {
        publishedAt: '2026-09-01T12:46:24Z',
        title: 'St Philopater & St Mina Coptic Orthodox Church Live Stream',
        thumbnails: {
          default: { url: 'https://i.ytimg.com/vi/st5prkbEQA4/default.jpg' },
          high: { url: 'https://i.ytimg.com/vi/st5prkbEQA4/hqdefault.jpg' },
        },
      },
      contentDetails: { videoId: 'st5prkbEQA4', videoPublishedAt: '2026-09-01T12:46:24Z' },
    },
  ],
};

/** `PAGE` with one field of one item changed, without mutating the original. */
function withItem(index: number, change: (item: any) => void) {
  const copy = JSON.parse(JSON.stringify(PAGE));
  change(copy.items[index]);
  return copy;
}

describe('parseUploadsPlaylist', () => {
  it('reads id, date, and thumbnail out of a real response', () => {
    expect(parseUploadsPlaylist(PAGE)).toEqual([
      {
        id: 'wrtfGSyFmtU',
        publishedAt: '2026-09-02T01:16:09Z',
        thumbnailUrl: 'https://i.ytimg.com/vi/wrtfGSyFmtU/maxresdefault.jpg',
      },
      {
        id: 'st5prkbEQA4',
        publishedAt: '2026-09-01T12:46:24Z',
        thumbnailUrl: 'https://i.ytimg.com/vi/st5prkbEQA4/hqdefault.jpg',
      },
    ]);
  });

  it('takes the largest thumbnail on offer, and never a smaller one', () => {
    // Two sizes on the second item, three on the first. Picking a fixed key
    // would either miss `maxres` where it exists or come back empty where it
    // does not.
    const [first, second] = parseUploadsPlaylist(PAGE);
    expect(first?.thumbnailUrl).toContain('maxresdefault');
    expect(second?.thumbnailUrl).toContain('hqdefault');
  });

  it("prefers the video's publish time over the playlist's", () => {
    /*
     * For an uploads playlist the two are normally the same instant, but they
     * are not the same field: `snippet.publishedAt` is when the video was added
     * to the playlist. The video's own time is the one the archive dates rows
     * by, so it has to win when they disagree.
     */
    const disagreeing = withItem(0, (item) => {
      item.snippet.publishedAt = '2026-01-01T00:00:00Z';
    });
    expect(parseUploadsPlaylist(disagreeing)[0]?.publishedAt).toBe('2026-09-02T01:16:09Z');
  });

  it("falls back to the playlist's date when the video has none", () => {
    const noVideoDate = withItem(0, (item) => {
      delete item.contentDetails.videoPublishedAt;
    });
    expect(parseUploadsPlaylist(noVideoDate)[0]?.publishedAt).toBe('2026-09-02T01:16:09Z');
  });

  it('sorts newest first even when the response does not', () => {
    const outOfOrder = withItem(1, (item) => {
      item.contentDetails.videoPublishedAt = '2026-09-03T00:00:00Z';
    });
    expect(parseUploadsPlaylist(outOfOrder).map((stream) => stream.id)).toEqual([
      'st5prkbEQA4',
      'wrtfGSyFmtU',
    ]);
  });

  it('skips one unusable item without discarding the rest', () => {
    const missingId = withItem(0, (item) => {
      delete item.contentDetails.videoId;
    });
    expect(parseUploadsPlaylist(missingId).map((stream) => stream.id)).toEqual(['st5prkbEQA4']);

    const badDate = withItem(0, (item) => {
      item.contentDetails.videoPublishedAt = 'whenever';
      item.snippet.publishedAt = 'whenever';
    });
    expect(parseUploadsPlaylist(badDate).map((stream) => stream.id)).toEqual(['st5prkbEQA4']);
  });

  it('keeps an item that has no thumbnail, with an empty url', () => {
    const noThumb = withItem(0, (item) => {
      delete item.snippet.thumbnails;
    });
    expect(parseUploadsPlaylist(noThumb)[0]).toMatchObject({
      id: 'wrtfGSyFmtU',
      thumbnailUrl: '',
    });
  });

  it('returns nothing rather than throwing on junk', () => {
    // A body of the wrong shape is what an error response looks like when the
    // status was somehow 200. The caller reads an empty list as "could not find
    // out" and leaves the committed snapshot alone.
    for (const junk of [
      null,
      undefined,
      {},
      'text',
      { items: 'nope' },
      { items: [null, 7] },
      { error: { code: 403, message: 'quota' } },
    ]) {
      expect(() => parseUploadsPlaylist(junk)).not.toThrow();
      expect(parseUploadsPlaylist(junk)).toEqual([]);
    }
  });
});

describe('isYouTubeChannelId', () => {
  it('accepts the parish channel', () => {
    expect(isYouTubeChannelId('UC6xlDBsD02-k7M5o-51CUQw')).toBe(true);
  });

  it('rejects the forms someone would realistically paste instead', () => {
    // The whole reason the check exists: each of these produces a playlist id
    // that resolves to nothing, which would look like "no past streams" rather
    // than a typo.
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

describe('uploadsPlaylistId', () => {
  it('swaps UC for UU', () => {
    // Verified against the API on 2026-09-02: `channels.list` reports exactly
    // this playlist for this channel. Deriving it saves a call and a unit.
    expect(uploadsPlaylistId('UC6xlDBsD02-k7M5o-51CUQw')).toBe('UU6xlDBsD02-k7M5o-51CUQw');
  });

  it('returns anything that is not a channel id unchanged', () => {
    // So the API rejects a bad value loudly, rather than this function
    // inventing a playlist that does not exist.
    for (const value of ['@WaylandCopticChurch', '', 'UUalreadyaplaylist', 'UC-too-short']) {
      expect(uploadsPlaylistId(value)).toBe(value);
    }
  });
});

describe('uploadsPlaylistUrl', () => {
  it('asks for the channel uploads, with both date fields', () => {
    expect(uploadsPlaylistUrl('UC6xlDBsD02-k7M5o-51CUQw', 8)).toBe(
      'https://www.googleapis.com/youtube/v3/playlistItems?' +
        'part=snippet%2CcontentDetails&playlistId=UU6xlDBsD02-k7M5o-51CUQw&maxResults=8',
    );
  });

  it("clamps maxResults to the API's own range", () => {
    // `maxResults=0` and `maxResults=100` are both error responses rather than
    // a clipped list, and either would look like a dead channel.
    expect(uploadsPlaylistUrl('UC6xlDBsD02-k7M5o-51CUQw', 0)).toContain('maxResults=1');
    expect(uploadsPlaylistUrl('UC6xlDBsD02-k7M5o-51CUQw', 500)).toContain('maxResults=50');
  });

  it('carries no key', () => {
    // Same reason as `videosListUrl`: the Function appends it, and this URL is
    // what an error message names.
    expect(uploadsPlaylistUrl('UC6xlDBsD02-k7M5o-51CUQw', 8)).not.toContain('key=');
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
 * A listing's publish time is when the *recording* was published, not when the
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
    // The entire point. `publishDate` is the same late value the listing
    // carries, so picking it up here would reintroduce the bug this fixes.
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
     * for. Candidate order is the uploads playlist's, so taking the first
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
      'https://www.googleapis.com/youtube/v3/videos?part=snippet%2CliveStreamingDetails' +
        '&id=aaaaaaaaaaa%2Cbbbbbbbbbbb',
    );
  });

  it('asks for liveStreamingDetails, which is what makes the archive free', () => {
    /*
     * A v3 quota unit is charged per method, not per part, so naming this part
     * costs nothing on a call the live check was making anyway — and it carries
     * `actualStartTime`, the only field that says when a broadcast went on air.
     * Dropping it would look like tidying an unused parameter and would quietly
     * take `/api/live`'s `recent` list with it.
     */
    expect(videosListUrl(['aaaaaaaaaaa'])).toContain('part=snippet%2CliveStreamingDetails');
  });

  it('carries no key', () => {
    // The key is appended by the Function from Secret Manager. Building it into
    // a shared URL helper would invite it into the website bundle.
    expect(videosListUrl(['aaaaaaaaaaa'])).not.toContain('key=');
  });
});

/**
 * `pastBroadcasts` reads the same `videos.list` response `liveBroadcastIds`
 * does, and answers the other half of the question: not "which of these is on"
 * but "which of these were on". It is what `/api/live` returns as `recent`, and
 * what the app's "Recent services" list is built from.
 *
 * Two behaviours carry the weight. It must **exclude the broadcast that is
 * playing right now**, because the app shows this list directly beneath the
 * player and a "previous services" list whose first row is the current liturgy
 * has miscounted. And it must prefer `actualStartTime` over `publishedAt`,
 * because the second is when YouTube finished processing the recording —
 * routinely twelve hours after the service and often on the following day. Both
 * are the kind of thing that looks right in a code review and wrong on a phone.
 */
describe('pastBroadcasts', () => {
  const item = (
    id: string,
    liveBroadcastContent: string,
    details: Record<string, string> | null,
    publishedAt = '2026-09-10T12:00:00Z',
  ) => ({
    id,
    snippet: {
      liveBroadcastContent,
      publishedAt,
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
    },
    ...(details ? { liveStreamingDetails: details } : {}),
  });

  it('prefers the real start time over the publish time', () => {
    /*
     * Measured against this parish on 2026-08-17: a liturgy that began Sunday
     * at 7:52 AM was published at 03:36Z the next day, so a list built on
     * `publishedAt` showed it as Sunday 11:36 PM — the wrong time, and often
     * the wrong day.
     */
    const streams = pastBroadcasts({
      items: [
        item('aaaaaaaaaaa', 'none', { actualStartTime: '2026-09-13T11:52:00Z' }, '2026-09-14T03:36:00Z'),
      ],
    });

    expect(streams).toEqual([
      {
        id: 'aaaaaaaaaaa',
        startedAt: '2026-09-13T11:52:00.000Z',
        thumbnailUrl: 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg',
      },
    ]);
  });

  it('falls back to the publish time for an ordinary upload', () => {
    // A video that was never streamed has no `liveStreamingDetails` at all.
    // Dropping it would silently shorten the list; the publish date is right
    // for an upload anyway, since there was no broadcast to be late for.
    expect(pastBroadcasts({ items: [item('bbbbbbbbbbb', 'none', null, '2026-09-11T14:00:00Z')] })).toEqual([
      {
        id: 'bbbbbbbbbbb',
        startedAt: '2026-09-11T14:00:00.000Z',
        thumbnailUrl: 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg',
      },
    ]);
  });

  it('leaves out the broadcast that is live now', () => {
    // It is in the player above this list. See the note on the function.
    const streams = pastBroadcasts({
      items: [
        item('aaaaaaaaaaa', 'live', { actualStartTime: '2026-09-15T11:30:00Z' }),
        item('bbbbbbbbbbb', 'none', { actualStartTime: '2026-09-14T11:30:00Z' }),
      ],
    });

    expect(streams.map((stream) => stream.id)).toEqual(['bbbbbbbbbbb']);
  });

  it('leaves out a scheduled broadcast', () => {
    // An `upcoming` stream has nothing in it yet, so it is not something a
    // reader can watch — and it is not "recent" either, it is in the future.
    expect(
      pastBroadcasts({
        items: [item('aaaaaaaaaaa', 'upcoming', { scheduledStartTime: '2026-09-20T11:30:00Z' })],
      }),
    ).toEqual([]);
  });

  it('orders by when the broadcast began, not by publish order', () => {
    /*
     * The two disagree, and this is the case that proves it: Saturday evening's
     * service was processed *after* Sunday morning's liturgy, so publish order
     * puts them the wrong way round. Start time settles it.
     */
    const streams = pastBroadcasts({
      items: [
        item('aaaaaaaaaaa', 'none', { actualStartTime: '2026-09-12T22:40:00Z' }, '2026-09-13T06:00:00Z'),
        item('bbbbbbbbbbb', 'none', { actualStartTime: '2026-09-13T11:52:00Z' }, '2026-09-13T02:00:00Z'),
      ],
    });

    expect(streams.map((stream) => stream.id)).toEqual(['bbbbbbbbbbb', 'aaaaaaaaaaa']);
  });

  it('skips an entry it cannot date rather than the whole page', () => {
    const streams = pastBroadcasts({
      items: [
        { id: 'aaaaaaaaaaa', snippet: { liveBroadcastContent: 'none' } },
        { id: 'bbbbbbbbbbb', snippet: { liveBroadcastContent: 'none', publishedAt: 'not a date' } },
        item('ccccccccccc', 'none', { actualStartTime: '2026-09-13T11:52:00Z' }),
      ],
    });

    expect(streams.map((stream) => stream.id)).toEqual(['ccccccccccc']);
  });

  it('renders no thumbnail rather than dropping a stream that has none', () => {
    // `''` is what `PastStream` uses for "no picture", and both frontends draw
    // their own placeholder for it. A missing image must not hide a liturgy.
    const streams = pastBroadcasts({
      items: [
        { id: 'aaaaaaaaaaa', snippet: { liveBroadcastContent: 'none', publishedAt: '2026-09-13T11:52:00Z' } },
      ],
    });

    expect(streams).toEqual([
      { id: 'aaaaaaaaaaa', startedAt: '2026-09-13T11:52:00.000Z', thumbnailUrl: '' },
    ]);
  });

  it('returns nothing on a body it cannot read, without throwing', () => {
    for (const junk of [null, undefined, {}, { items: 'nope' }, { items: [null, 7] }, 'text']) {
      expect(() => pastBroadcasts(junk)).not.toThrow();
      expect(pastBroadcasts(junk)).toEqual([]);
    }
  });
});
