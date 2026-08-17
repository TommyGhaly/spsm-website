import { isCastrTarget, type LivestreamConfig } from '@spsm/shared';
import { LiveFrame } from './LiveFrame';

/**
 * The liturgy stream.
 *
 * Three platforms rather than one guessed-from-the-URL embed, because they
 * genuinely differ: YouTube has a `live_stream?channel=` endpoint that resolves
 * to "whatever is live right now" — which is what a parish actually wants,
 * since the video id changes every week — while Facebook needs its plugin
 * wrapper and anything else needs its iframe src verbatim.
 *
 * This component stays a server component and decides only what can be decided
 * at build time: whether a stream is configured at all, and what its embed URL
 * is. Whether it is *live* is a different kind of question — the answer changes
 * hourly — so it belongs to `LiveFrame`, which asks in the reader's browser.
 */
export function LivestreamPlayer({
  config,
  wide = false,
  probe = true,
}: {
  config: LivestreamConfig;
  /** See `LiveFrame`. Set on `/livestream`, not on the homepage section. */
  wide?: boolean;
  /**
   * Off when an ancestor has already established that the stream is live — the
   * homepage, where `ShowWhenLive` wraps the whole section. Without this the
   * player would ask Castr the same question its own wrapper just asked, which
   * is two requests per page load and two answers that can disagree on screen.
   */
  probe?: boolean;
}) {
  if (!config.enabled || !config.target) {
    return (
      <div className="notice">
        <h2>The stream isn&apos;t set up yet</h2>
        <p>
          Liturgies aren&apos;t being streamed through the website at the moment. If the
          parish is streaming elsewhere, the office can point you to it.
        </p>
      </div>
    );
  }

  const src = embedUrl(config);
  if (!src) {
    return (
      <div className="notice notice--alarm">
        <h2>The stream is misconfigured</h2>
        <p>
          The livestream is switched on but its address can&apos;t be read. A site
          administrator can correct it in <code>config/integrations</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <LiveFrame src={src} probeUrl={probe ? livestreamProbeUrl(config) : null} wide={wide} />

      {config.scheduleNote && <p className="meta">{config.scheduleNote}</p>}

      {config.fallbackUrl && (
        <p>
          Trouble with the player?{' '}
          <a href={config.fallbackUrl} rel="noopener noreferrer" target="_blank">
            Watch on the parish&apos;s channel instead →
          </a>
        </p>
      )}
    </>
  );
}

/**
 * Where to read this stream's live status, or `null` if it can't be asked.
 *
 * Only a Castr target answers this question — see `isCastrTarget`. `null` means
 * "don't ask", and every consumer then behaves as the site did before any of
 * this existed: the player renders unconditionally.
 *
 * Note this deliberately tests `config.target` and not the embed URL: the embed
 * URL is the *embeddable* form, which for YouTube and Facebook is a URL on
 * their domains rather than on the parish's provider.
 */
export function livestreamProbeUrl(config: LivestreamConfig): string | null {
  const target = config.target.trim();
  if (!config.enabled || !target) return null;
  return isCastrTarget(target) ? target : null;
}

/** Null when the target can't be turned into something embeddable. */
function embedUrl(config: LivestreamConfig): string | null {
  const target = config.target.trim();
  if (!target) return null;

  switch (config.platform) {
    case 'youtube':
      // A channel id means "whatever this channel is streaming now", which is
      // the only form that survives the video id changing every Sunday.
      return target.startsWith('UC')
        ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(target)}`
        : `https://www.youtube.com/embed/${encodeURIComponent(target)}`;

    case 'facebook':
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(target)}&show_text=false`;

    case 'custom':
      // Given verbatim, so it must already be an embeddable URL. Reject
      // anything not http(s) rather than dropping an arbitrary scheme into an
      // iframe src.
      return /^https?:\/\//.test(target) ? target : null;
  }
}
