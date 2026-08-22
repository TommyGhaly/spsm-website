'use client';

import { useContext } from 'react';
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
   * Where to watch if we cannot show the player ourselves. Rendered in the
   * `unknown` state, where it stops being a convenience and becomes the only
   * route to a liturgy that may well be in progress.
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

  // The probe's answer wins over the build's. On a YouTube channel the build
  // has nothing to offer; on a pinned video id it has last week's.
  const playing = videoId ? `https://www.youtube.com/embed/${videoId}` : src;

  if (status === 'live' && playing) {
    return (
      <div className={`embed${wide ? ' embed--stage' : ''}`}>
        <iframe
          src={playing}
          title="Parish livestream"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
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
                    on the parish&apos;s YouTube channel →
                  </a>
                </>
              ) : (
                'If a service is in progress, it will be on the parish’s YouTube channel.'
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
