'use client';

import { createContext, useEffect, useState } from 'react';
import { isStreamOffline } from '@spsm/shared';

/**
 * Whether a liturgy is being streamed right now.
 *
 * A hook because two places need the same answer and must not each go and ask:
 * `LiveFrame` (which shows the player or a notice) and `ShowWhenLive` (which
 * drops the homepage section entirely). Two probes would be two requests per
 * page, and could disagree with each other on the same screen.
 *
 * Client-side because this is the one question on a static site that cannot be
 * answered at build time — a build on Sunday morning would still be claiming
 * the stream is live on Wednesday.
 */

/**
 * Where the answer comes from. The two providers are genuinely different
 * questions, not one question with a different URL.
 *
 * `castr` reads Castr's own player page straight from the browser, which works
 * only because Castr sends `access-control-allow-origin: *`.
 *
 * `youtube` asks our own `/api/live`, because YouTube sends no such header and
 * the browser is not allowed to read the page. That endpoint also answers the
 * *second* question a YouTube embed needs and Castr's does not — which video —
 * since the id changes every Sunday and the channel-wide embed URL that used to
 * spare us that no longer works.
 */
export type LiveProbe = { kind: 'castr'; url: string } | { kind: 'youtube' };

/**
 * Four states, and the two extra ones each earn their place.
 *
 * `checking` exists so callers can render something that claims neither while
 * the probe is in flight. Collapsing it into `offline` would flash "no live
 * stream" at someone who opened the page mid-liturgy; into `live`, a black
 * player at everyone else.
 *
 * `unknown` means we asked and could not find out — distinct from `offline`,
 * which means we asked and the answer was no. Only the YouTube probe can
 * produce it, and only because there is no fail-open answer available there:
 * showing a player needs a video id, and a failed lookup has not got one. The
 * page's response is to say so and offer the link out, which is what keeps a
 * YouTube markup change from quietly hiding a liturgy.
 */
export type LiveStatus = 'checking' | 'live' | 'offline' | 'unknown';

export interface LiveState {
  status: LiveStatus;
  /** The live broadcast's video id, when the probe could name one. */
  videoId: string | null;
}

/** How often to re-check while the tab is being looked at. */
const POLL_MS = 60_000;

/** Bounds the probe. For Castr, unreachable is treated as live. */
const TIMEOUT_MS = 8_000;

/**
 * @param probe where to read the status, or `null` when there is nothing that
 *   can be asked — which resolves to `live` immediately, so a stream with no
 *   probe behaves exactly as the site did before any of this existed.
 */
export function useLiveStatus(probe: LiveProbe | null): LiveState {
  const [state, setState] = useState<LiveState>({
    status: probe ? 'checking' : 'live',
    videoId: null,
  });

  // Depended on rather than `probe` itself: the object is rebuilt on every
  // render by the component above, so using it directly would restart the
  // effect — and fire a fresh request — on every render.
  const kind = probe?.kind ?? null;
  const url = probe && probe.kind === 'castr' ? probe.url : null;

  useEffect(() => {
    if (!kind) return;

    // Guards against a resolved probe from a previous run overwriting a newer
    // one after the component unmounts or the probe changes.
    let current = true;

    async function check() {
      try {
        const response = await fetch(kind === 'castr' ? url! : '/api/live', {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // The status changes minute to minute, so a cached copy is worse than
          // useless — it is what would make the page insist the stream is
          // offline after it had started.
          cache: 'no-store',
        });
        if (!current) return;

        if (kind === 'castr') {
          const offline = response.ok && isStreamOffline(await response.text());
          setState({ status: offline ? 'offline' : 'live', videoId: null });
          return;
        }

        if (!response.ok) {
          // Our own endpoint is broken or unconfigured, which is not the same
          // as the parish not streaming, and must not be reported as such.
          setState({ status: 'unknown', videoId: null });
          return;
        }

        const body = (await response.json()) as { live?: boolean; videoId?: string | null };
        setState(
          body.live && body.videoId
            ? { status: 'live', videoId: body.videoId }
            : { status: 'offline', videoId: null },
        );
      } catch {
        if (!current) return;
        /*
         * Unreachable, blocked, or timed out — and the right answer differs by
         * provider.
         *
         * Castr fails *open*: its own offline screen is a fine fallback, and
         * wrongly hiding a live liturgy is the one failure this must not have.
         * YouTube cannot do the same, because there is no video id to put in a
         * player, so it says it does not know and the page offers the link out.
         */
        setState({ status: kind === 'castr' ? 'live' : 'unknown', videoId: null });
      }
    }

    void check();

    /*
     * Re-check while the page is open, so someone who arrives ten minutes early
     * sees the player appear when the liturgy starts rather than having to know
     * to refresh.
     *
     * Only while the tab is visible: a forgotten tab left open overnight should
     * not spend the night polling someone else's server.
     */
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);

    // A tab coming back to the foreground gets an immediate check rather than
    // waiting out the rest of its interval, which is the moment the answer is
    // most likely to have gone stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [kind, url]);

  return state;
}

/**
 * A live status already established by an ancestor.
 *
 * This exists for the homepage, where `ShowWhenLive` wraps the whole section
 * and has therefore already asked the question its own `LiveFrame` is about to.
 * Before the YouTube probe that duplication was merely wasteful and could be
 * settled by telling the player not to bother asking. It cannot be settled that
 * way any more: the answer now *carries* the video id, so a player told not to
 * ask would have nothing to put in the frame.
 *
 * `null` means no ancestor has asked, and the consumer probes for itself.
 */
export const InheritedLiveState = createContext<LiveState | null>(null);
