import { describe, expect, it } from 'vitest';
import { withAutoplay, youtubeEmbed } from '../../apps/website/src/features/livestream/embed';

/**
 * The livestream's embed URLs, and the one parameter the player cannot do
 * without.
 *
 * ---------------------------------------------------------------------------
 * `mute=1` is load-bearing, not a preference. Every current browser refuses to
 * start a video with sound the reader did not ask for, so an `autoplay=1` embed
 * *without* it does not autoplay at all — it sits paused, which is exactly the
 * state the whole change was meant to remove. Dropping the mute would therefore
 * look like a small copy fix ("why is it muted?") and silently take autoplay
 * with it, on a page where nobody is watching the parameters.
 *
 * The other half is `withAutoplay`'s restraint: `platform: 'custom'` is a
 * provider's own embed URL, typed in by whoever set the stream up, and pushing
 * query parameters at an unknown player can break the thing it was meant to
 * improve. A stream that needs one press is a much smaller failure than a
 * stream that shows an error.
 * ---------------------------------------------------------------------------
 */
describe('youtubeEmbed', () => {
  it('autoplays muted, inline', () => {
    const url = youtubeEmbed('dQw4w9WgXcQ');

    expect(url).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ?');
    expect(url).toContain('autoplay=1');
    expect(url).toContain('mute=1');
    expect(url).toContain('playsinline=1');
  });

  it('encodes the video id rather than pasting it into a URL', () => {
    expect(youtubeEmbed('a b?c=d')).toContain('/embed/a%20b%3Fc%3Dd?');
  });
});

describe('withAutoplay', () => {
  it('adds the parameters to a YouTube embed', () => {
    const url = withAutoplay('https://www.youtube.com/embed/abc123');

    expect(url).toBe('https://www.youtube.com/embed/abc123?autoplay=1&mute=1&playsinline=1&rel=0');
  });

  it('joins with & when the URL already has a query', () => {
    const url = withAutoplay('https://www.youtube-nocookie.com/embed/abc123?start=30');

    expect(url).toContain('?start=30&autoplay=1');
  });

  it('asks Facebook for autoplay in its own spelling', () => {
    const url = withAutoplay(
      'https://www.facebook.com/plugins/video.php?href=x&show_text=false',
    );

    expect(url).toContain('&autoplay=true');
    // Facebook has no mute parameter — its player mutes itself when it obeys.
    expect(url).not.toContain('mute');
  });

  it('leaves a provider it does not recognise exactly as configured', () => {
    const given = 'https://stream.example.org/player/parish';

    expect(withAutoplay(given)).toBe(given);
  });

  it('is not fooled by a lookalike host', () => {
    const given = 'https://www.youtube.com.evil.test/embed/abc';

    expect(withAutoplay(given)).toBe(given);
  });
});
