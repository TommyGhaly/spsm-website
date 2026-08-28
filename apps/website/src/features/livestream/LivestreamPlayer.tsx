import { isCastrTarget, isYouTubeChannelId, type LivestreamConfig } from '@spsm/shared';
import { LiveFrame } from './LiveFrame';
import type { LiveProbe } from './useLiveStatus';

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
  const available = livestreamProbe(config);
  // Withheld, not absent, when `probe` is false: an ancestor has already asked
  // and hands its answer down through context.
  const liveProbe = probe ? available : null;

  // Tested against `available` rather than `liveProbe`, because the homepage
  // passes `probe={false}` and a settings-only check would call that
  // misconfigured. Only genuinely misconfigured when *neither* half can produce
  // a player: no usable embed URL from the settings, and no probe that could
  // name one at request time. A YouTube channel legitimately has the first and
  // not the second, which is why this is not simply `!src`.
  if (!src && !available) {
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

  /*
   * The "watch on the channel instead" link is *not* rendered here, and used to
   * be. A server component cannot know whether the stream is on, so the link
   * went out unconditionally — which put "Trouble with the player? Watch on the
   * church's channel instead →" directly beneath a band reading "No live stream
   * right now". There was no player to have trouble with, and the link led to
   * whatever YouTube resolves `/channel/…/live` to when nothing is live: on
   * 2026-08-28 that was a broadcast scheduled for 2026-05-03 that never aired.
   *
   * So it belongs to `LiveFrame`, which knows the answer, and appears in the two
   * states where it means something: beside a player that may be misbehaving,
   * and in place of one we could not check.
   */
  return (
    <>
      <LiveFrame src={src} probe={liveProbe} fallbackUrl={config.fallbackUrl} wide={wide} />

      {config.scheduleNote && <p className="meta">{config.scheduleNote}</p>}
    </>
  );
}

/**
 * How to read this stream's live status, or `null` if it can't be asked.
 *
 * `null` means "don't ask", and every consumer then behaves as the site did
 * before any of this existed: the player renders unconditionally.
 *
 * Note this deliberately tests `config.target` and not the embed URL: the embed
 * URL is the *embeddable* form, which for YouTube and Facebook is a URL on
 * their domains rather than on the parish's provider.
 */
export function livestreamProbe(config: LivestreamConfig): LiveProbe | null {
  if (!config.enabled) return null;

  const target = config.target.trim();
  if (isCastrTarget(target)) return { kind: 'castr', url: target };

  /*
   * `archiveChannelId` rather than `target`, because it is the field that names
   * the parish's own channel — the only thing whose live status can be looked
   * up. `target` may be a single video id, or the channel id, or empty; none of
   * those is a reliable answer to "what is this parish streaming now".
   */
  if (config.platform === 'youtube' && isYouTubeChannelId(config.archiveChannelId.trim())) {
    return { kind: 'youtube' };
  }

  return null;
}

/** Null when the target can't be turned into something embeddable. */
function embedUrl(config: LivestreamConfig): string | null {
  const target = config.target.trim();
  if (!target) return null;

  switch (config.platform) {
    case 'youtube':
      /*
       * A channel id has no build-time embed, and used to.
       * `youtube.com/embed/live_stream?channel=UC…` was the form that survived
       * the video id changing every Sunday — and YouTube has retired it. On
       * 2026-08-21 it rendered "This video is unavailable" for a channel that
       * was live at that moment, whose watch page reported `playableInEmbed:
       * true` and `playabilityStatus: OK`, and whose video id embedded fine.
       *
       * So the id is resolved at request time instead, by `/api/live`. Null
       * here is not a failure: it means "ask the probe", and the misconfigured
       * notice above is careful not to treat it as one.
       */
      return isYouTubeChannelId(target)
        ? null
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
