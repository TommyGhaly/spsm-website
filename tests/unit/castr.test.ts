import { describe, it, expect } from 'vitest';
import { isStreamOffline, isCastrTarget, DEFAULT_INTEGRATIONS_CONFIG } from '@spsm/shared';

/**
 * `/livestream` decides in the reader's browser whether to show the player or a
 * card saying nothing is on. That decision reads another company's HTML, so the
 * contract these tests pin down is not "does it parse Castr correctly today" —
 * it is **which way it fails when it cannot**.
 *
 * `OFFLINE` is the real response from the parish's player URL on 2026-08-17,
 * trimmed. The live shape could not be captured the same way, because the
 * parish was not streaming at the time; that is exactly why the fail-open cases
 * below carry the weight here.
 */
const OFFLINE = `<!DOCTYPE html><html><head><title> - Castr Playback</title>
<meta property="og:description" content="Stream offline">
<meta property="og:site_name" content="Castr Live Streaming Service">
</head><body class="embed-stream-player-container">
<div id="playback-source-error-wrapper" style="display: flex;justify-content: center;align-items: center;">
<p class="count-title">Stream Offline</p></div></body></html>`;

describe('isStreamOffline', () => {
  it('recognises the offline player page', () => {
    expect(isStreamOffline(OFFLINE)).toBe(true);
  });

  it('recognises it from the og:description alone', () => {
    // The more stable of the two markers: a documented meta tag rather than
    // internal markup. It has to stand on its own if the div is restyled away.
    const metaOnly = OFFLINE.replace(/<div id="playback-source-error-wrapper"[\s\S]*?<\/div>/, '');
    expect(metaOnly).not.toContain('playback-source-error-wrapper');
    expect(isStreamOffline(metaOnly)).toBe(true);
  });

  it('recognises it from the error element alone', () => {
    const divOnly = OFFLINE.replace(/<meta property="og:description"[^>]*>/, '');
    expect(divOnly).not.toContain('og:description');
    expect(isStreamOffline(divOnly)).toBe(true);
  });

  /**
   * The important half. Wrongly showing the player costs a reader one glance at
   * Castr's own offline card; wrongly hiding it tells a homebound parishioner
   * there is no liturgy when there is one. So anything unrecognised must read
   * as live.
   */
  describe('fails open — anything unrecognised is treated as live', () => {
    it('treats a playing stream as live', () => {
      const live = `<!DOCTYPE html><html><head><title>Divine Liturgy - Castr Playback</title>
<meta property="og:description" content="Divine Liturgy">
</head><body class="embed-stream-player-container"><video id="player"></video></body></html>`;
      expect(isStreamOffline(live)).toBe(false);
    });

    it('treats junk, errors, and empty responses as live', () => {
      for (const body of [
        '',
        '   ',
        '<html><body>502 Bad Gateway</body></html>',
        '{"error":"not found"}',
        // A restyled player we no longer recognise at all.
        '<!DOCTYPE html><html><body><div class="castr-v2-player"></div></body></html>',
      ]) {
        expect(isStreamOffline(body)).toBe(false);
      }
    });

    it('does not fire on the words appearing in unrelated prose', () => {
      // A title or description that merely mentions the phrase must not take
      // the player down.
      const mentions = `<meta property="og:description" content="What to do if the stream offline error appears">`;
      expect(isStreamOffline(mentions)).toBe(false);
    });
  });
});

describe('isCastrTarget', () => {
  it('accepts the parish player, including as configured today', () => {
    expect(isCastrTarget(DEFAULT_INTEGRATIONS_CONFIG.livestream.target)).toBe(true);
    expect(isCastrTarget('https://player.castr.com/d_4b45')).toBe(true);
    // Castr uses both domains for players.
    expect(isCastrTarget('https://player.castr.io/abc')).toBe(true);
  });

  it('rejects other providers, so the probe is skipped rather than misapplied', () => {
    // The failure this prevents: a Vimeo URL probed for Castr's markers never
    // matches, so it would read as permanently live — the safe answer, but
    // arrived at by accident, and with no sign the feature had stopped working.
    for (const other of [
      'https://vimeo.com/event/12345/embed',
      'https://www.youtube.com/embed/live_stream?channel=UC6xlDBsD02-k7M5o-51CUQw',
      'https://player.restream.io/?token=abc',
      '',
      'not a url',
      // Must not be fooled by the name appearing somewhere other than the host.
      'https://example.com/castr.com/player',
      'https://notcastr.com/player',
    ]) {
      expect(isCastrTarget(other)).toBe(false);
    }
  });

  it('rejects a non-http scheme', () => {
    expect(isCastrTarget('javascript:alert(1)')).toBe(false);
  });
});
