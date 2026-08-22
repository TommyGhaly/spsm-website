'use client';

import { useEffect, useRef } from 'react';

/**
 * A clip, playing by itself, wherever a photograph would otherwise sit.
 *
 * Tommy: *"the videos on any screen should autoplay ... whether that be the
 * presentation the gallery or the previews they should always autoplay."* Before
 * this, only the presentation collage did — everywhere else a clip was a still
 * poster frame with a play badge on it, and a ministry whose best material is
 * video showed a page of frozen faces.
 *
 * ## Muted, and that is not a preference
 *
 * Unattended autoplay is only permitted for muted media. A `<video autoplay>`
 * with sound is simply refused — the element sits on its poster and nothing says
 * why. So every clip that starts without being asked starts silent; the one place
 * sound belongs is the lightbox, which opens from a click and handles its own
 * playback (see Lightbox.tsx).
 *
 * ## It only plays while it is on screen
 *
 * A gathering can hold dozens of clips. Chrome will happily decode all of them at
 * once, off screen, which on a laptop is a fan spinning up on a page of parish
 * photographs. The observer pauses anything scrolled away and starts it again on
 * the way back, so what a visitor actually sees is always moving.
 *
 * `preload="metadata"` for the same reason: the poster and the dimensions arrive
 * for every clip, the bytes only for the ones that get played.
 */
export function AutoClip({
  src,
  poster,
  className,
  style,
  onError,
}: {
  src: string;
  /** The poster frame, when the transcode produced one. */
  poster?: string | null | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  onError?: (() => void) | undefined;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    /*
     * `play()` returns a promise that rejects when the browser refuses, and an
     * unhandled rejection here is a console error on an ordinary page load —
     * Safari refuses until the document has been interacted with even for muted
     * media. Swallowed rather than reported: the observer below will try again
     * the next time this scrolls into view, and by then there has usually been a
     * gesture.
     */
    const play = () => void node.play().catch(() => undefined);

    if (typeof IntersectionObserver !== 'function') {
      play();
      return;
    }

    const watcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) play();
          else node.pause();
        }
      },
      // A little before the edge, so a clip is already running by the time it is
      // properly in view rather than starting under the reader's eye.
      { rootMargin: '200px' },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [src]);

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      {...(poster ? { poster } : {})}
      {...(style ? { style } : {})}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      // No controls: this is a picture that moves. Every one of them opens in the
      // lightbox, which is where scrubbing and sound live.
      onError={onError}
    />
  );
}
