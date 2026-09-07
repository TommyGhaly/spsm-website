'use client';

import { useContext } from 'react';
import { withAutoplay, youtubeEmbed } from './embed';
import { InheritedLiveState, useLiveStatus, type LiveProbe } from './useLiveStatus';

/**
 * The player, or an honest notice in its place when nothing is being streamed.
 *
 * Used on `/livestream`, which is a page *about* watching the liturgy and so
 * has something to say either way. The homepage takes the other approach and
 * removes its section entirely — see `ShowWhenLive`.
 */
export function LiveFrame({
  src,
  probe,
  fallbackUrl,
  wide = false,
}: {
  /**
   * The iframe source settled at build time, or null when only the probe can
   * name one — which is the normal case for a YouTube channel, whose live video
   * id changes every Sunday.
   */
  src: string | null;
  /** Where to read the stream's status, or null when nothing can be asked. */
  probe: LiveProbe | null;
  /**
   * Where to watch if the player here will not do.
   *
   * Rendered in exactly two states, and never in `offline`. Beside a live
   * player it is a convenience; in the `unknown` state it stops being one and
   * becomes the only route to a liturgy that may well be in progress. Under
   * "no live stream right now" it would be neither — just a link to whatever
   * the channel URL happens to resolve to on a quiet Tuesday.
   *
   * Empty is a legitimate setting, and is the current one. A channel's `/live`
   * URL is a poor value for it: YouTube answers that with the next *scheduled*
   * broadcast when nothing is on, so a premiere the parish set up and never ran
   * becomes the site's "watch here" link indefinitely. Prefer `/streams`.
   */
  fallbackUrl: string;
  /**
   * Let the frame fill its column, for `/livestream` where the player is the
   * whole point of the page. Off on the homepage, where it is one section among
   * several and a full-width video would dominate the page.
   */
  wide?: boolean;
}) {
  /*
   * An ancestor may already have asked — see `InheritedLiveState`. Its answer
   * wins, and `useLiveStatus(null)` then resolves immediately without a request
   * rather than being skipped, because a hook cannot be called conditionally.
   */
  const inherited = useContext(InheritedLiveState);
  const own = useLiveStatus(inherited ? null : probe);
  const { status, videoId } = inherited ?? own;

  /*
   * The probe's answer wins over the build's. On a YouTube channel the build
   * has nothing to offer; on a pinned video id it has last week's.
   *
   * Either way the URL carries `autoplay=1&mute=1` — see `embed.ts` for why
   * muted is what makes autoplay happen at all. `src` goes through
   * `withAutoplay` rather than being used as-is because it may be a Facebook
   * or custom embed, which want different parameters or none.
   */
  const playing = videoId ? youtubeEmbed(videoId) : src && withAutoplay(src);

  if (status === 'live' && playing) {
    return (
      <>
        <div className={`embed${wide ? ' embed--stage' : ''}`}>
          <iframe
            src={playing}
            title="Church livestream"
            /* `autoplay` here is not optional dressing: without it in the
               permissions list the muted autoplay above is refused by the
               browser and the player sits paused. */
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            /*
             * Eager on `/livestream`, where the player is the first thing on
             * the page and the reason someone opened it — deferring the load of
             * something already on screen only delays the liturgy starting.
             *
             * Still lazy on the homepage section, and deliberately: it can sit
             * below the fold there, and a video that starts playing where
             * nobody can see it is bandwidth spent on nothing.
             */
            loading={wide ? 'eager' : 'lazy'}
          />
        </div>

        {/*
          Only ever beside a player. See the note in `LivestreamPlayer`: rendered
          from there it followed the standby band too, offering help with a
          player that was not on screen and a link to a stream that was not on.

          The mute is stated rather than left to be discovered. It is not a
          setting anyone chose — the browser will not start a stream with sound
          — so a reader hearing nothing has no way to know whether the liturgy
          is silent, their speakers are off, or the player is waiting for them.
        */}
        <p className={`meta${wide ? ' meta--stage' : ''}`}>
          The stream starts muted — use the speaker button in the player to hear it.
          {fallbackUrl && (
            <>
              {' '}
              Trouble with the player?{' '}
              <a href={fallbackUrl} rel="noopener noreferrer" target="_blank">
                Watch on the church&apos;s channel instead →
              </a>
            </>
          )}
        </p>
      </>
    );
  }

  /*
   * Deliberately *not* the 16:9 `.embed` box.
   *
   * Saying "nothing is on" in a frame the size of a video is a large empty
   * rectangle carrying one sentence, and on this page it pushed the recent
   * services — the thing there actually is to watch — off the bottom of the
   * screen. A band a few lines tall states the same fact and leaves the archive
   * where a reader can see it without scrolling.
   */
  return (
    <div className={`standby-band${status === 'checking' ? ' standby-band--checking' : ''}`}>
      {/*
        `aria-live` so the swap is announced. A screen reader user who lands
        here during the probe would otherwise be told nothing at all, then have
        the page silently change under them.
      */}
      <div className="standby" aria-live="polite">
        {status === 'checking' ? (
          <p className="standby__title">Checking for a live service…</p>
        ) : status === 'offline' ? (
          <>
            <p className="standby__title">No live stream right now</p>
            <p className="standby__note">
              The player appears here on its own when a service begins. Until then, the
              most recent services are below.
            </p>
          </>
        ) : (
          /*
           * `unknown`, or live with nothing playable. Both mean the same thing to
           * a reader — we cannot show it here — and both must not be dressed up
           * as "there is no service", because there may well be one. The link is
           * the whole point of this branch.
           */
          <>
            <p className="standby__title">We can&apos;t check the stream right now</p>
            <p className="standby__note">
              {fallbackUrl ? (
                <>
                  If a service is in progress it will be{' '}
                  <a href={fallbackUrl} rel="noopener noreferrer" target="_blank">
                    on the church&apos;s YouTube channel →
                  </a>
                </>
              ) : (
                'If a service is in progress, it will be on the church’s YouTube channel.'
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
