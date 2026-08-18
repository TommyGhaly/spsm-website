'use client';

import { useLiveStatus } from './useLiveStatus';

/**
 * The player, or an honest notice in its place when nothing is being streamed.
 *
 * Used on `/livestream`, which is a page *about* watching the liturgy and so
 * has something to say either way. The homepage takes the other approach and
 * removes its section entirely — see `ShowWhenLive`.
 */
export function LiveFrame({
  src,
  probeUrl,
  wide = false,
}: {
  /** The iframe source, shown when live. */
  src: string;
  /**
   * The page to read the stream's status from, or null when the provider can't
   * be asked — in which case the player is always shown, as it was before.
   */
  probeUrl: string | null;
  /**
   * Let the frame fill its column, for `/livestream` where the player is the
   * whole point of the page. Off on the homepage, where it is one section among
   * several and a full-width video would dominate the page.
   */
  wide?: boolean;
}) {
  const status = useLiveStatus(probeUrl);

  if (status === 'live') {
    return (
      <div className={`embed${wide ? ' embed--stage' : ''}`}>
        <iframe
          src={src}
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
        ) : (
          <>
            <p className="standby__title">No live stream right now</p>
            <p className="standby__note">
              The player appears here on its own when a service begins. Until then, the
              most recent services are below.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
