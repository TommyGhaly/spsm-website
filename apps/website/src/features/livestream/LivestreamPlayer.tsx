import type { LivestreamConfig } from '@spsm/shared';

/**
 * The liturgy stream.
 *
 * Three platforms rather than one guessed-from-the-URL embed, because they
 * genuinely differ: YouTube has a `live_stream?channel=` endpoint that resolves
 * to "whatever is live right now" — which is what a parish actually wants,
 * since the video id changes every week — while Facebook needs its plugin
 * wrapper and anything else needs its iframe src verbatim.
 *
 * A static export can't know whether a stream is live at view time, so this
 * always renders the player. YouTube's channel embed handles that itself,
 * showing the upcoming or most recent stream when nothing is live.
 */
export function LivestreamPlayer({ config }: { config: LivestreamConfig }) {
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
      <div className="embed">
        <iframe
          src={src}
          title="Parish livestream"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>

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
