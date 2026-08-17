'use client';

import { useEffect, useState } from 'react';
import { isStreamOffline } from '@spsm/shared';

/**
 * Whether a liturgy is being streamed right now.
 *
 * A hook because two places need the same answer and must not each go and ask:
 * `LiveFrame` (which shows the player or a notice) and `ShowWhenLive` (which
 * drops the homepage section entirely). Two probes would be two requests to
 * Castr per page, and could disagree with each other on the same screen.
 *
 * Client-side because this is the one question on a static site that cannot be
 * answered at build time — see `isStreamOffline` in @spsm/shared for why the
 * answer comes from the reader's own browser rather than a Cloud Function.
 *
 * Three states rather than two, and the third is the one that matters. While
 * the probe is in flight we know nothing, so callers can render something that
 * claims neither. Collapsing `checking` into `offline` would flash "no live
 * stream" at someone who opened the page mid-liturgy; collapsing it into `live`
 * would flash a black player at everyone else.
 */
export type LiveStatus = 'checking' | 'live' | 'offline';

/** How often to re-check while the tab is being looked at. */
const POLL_MS = 60_000;

/** Bounds the probe. Unreachable is treated as live — see `isStreamOffline`. */
const TIMEOUT_MS = 8_000;

/**
 * @param probeUrl the page to read the stream's status from, or `null` when the
 *   provider cannot be asked — which resolves to `live` immediately, so a
 *   non-Castr stream behaves exactly as it did before any of this existed.
 */
export function useLiveStatus(probeUrl: string | null): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>(probeUrl ? 'checking' : 'live');

  useEffect(() => {
    if (!probeUrl) return;

    // Guards against a resolved probe from a previous run overwriting a newer
    // one after the component unmounts or the URL changes.
    let current = true;

    async function check(url: string) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // Castr's status changes minute to minute and its player page is
          // small, so a cached copy is worse than useless — it is what would
          // make the page insist the stream is offline after it had started.
          cache: 'no-store',
        });
        if (!current) return;
        setStatus(response.ok && isStreamOffline(await response.text()) ? 'offline' : 'live');
      } catch {
        // Unreachable, blocked, or timed out. Treat as live: Castr's own
        // offline screen is a fine fallback, and wrongly hiding a live liturgy
        // is the one failure this must not have.
        if (current) setStatus('live');
      }
    }

    void check(probeUrl);

    /*
     * Re-check while the page is open, so someone who arrives ten minutes early
     * sees the player appear when the liturgy starts rather than having to know
     * to refresh.
     *
     * Only while the tab is visible: a forgotten tab left open overnight should
     * not spend the night polling someone else's server.
     */
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check(probeUrl);
    }, POLL_MS);

    // A tab coming back to the foreground gets an immediate check rather than
    // waiting out the rest of its interval, which is the moment the answer is
    // most likely to have gone stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(probeUrl);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [probeUrl]);

  return status;
}
