'use client';

import { useEffect, useState } from 'react';
import { reviveBulletin, type Bulletin } from '@spsm/shared';

/**
 * The active bulletin, re-read from the source while the page is open rather
 * than taken from the copy baked into the HTML.
 *
 * ---------------------------------------------------------------------------
 * The build-time copy is a first paint, not the answer.
 *
 * `initial` is whatever was active when the site was deployed. It renders
 * instantly, with no request and no gap where the schedule should be, and it is
 * what stays on screen if this check cannot be made. What it must not be is the
 * last word: staff make a different bulletin active in the announcements app,
 * and a static site had no way to notice — the schedule most readers came for
 * was as old as the last deploy.
 *
 * So on mount, on every return to the tab, and on a slow interval while the tab
 * is being looked at, this asks `/api/bulletin`, which follows
 * `config/active_bulletin` in the announcements project (see
 * functions/src/bulletin.ts).
 * ---------------------------------------------------------------------------
 *
 * **It only ever replaces a bulletin; it never removes one.** A response of
 * `bulletin: null` — nothing active, or the section switched off in
 * `config/integrations` — leaves what is on screen alone. That is a deliberate
 * asymmetry, and the alternative is worse in both directions: a section that can
 * empty itself mid-visit takes a band's worth of height out from under whatever
 * the reader is looking at, and the old behaviour for a switched-off section was
 * already "gone at the next deploy" rather than "gone now". A schedule a few
 * days old still tells you when the Liturgy is. An empty band tells you nothing.
 */

/** Where the live read lives. A Hosting rewrite onto the `bulletin` Function. */
const ENDPOINT = '/api/bulletin';

/**
 * How often to re-ask while the tab is actually being looked at.
 *
 * A minute. The CDN in front of the endpoint holds an answer for thirty seconds
 * anyway, so polling faster mostly re-reads the same copy; polling much slower
 * would mean a bulletin made active on a Sunday morning taking a coffee hour to
 * appear on a screen somebody left open.
 */
const POLL_MS = 60_000;

/** Bounds the request. A slow answer is the same as no answer here. */
const TIMEOUT_MS = 8_000;

export function useActiveBulletin(initial: Bulletin): Bulletin {
  const [bulletin, setBulletin] = useState<Bulletin>(initial);

  useEffect(() => {
    // Guards a resolved fetch from a previous run landing after unmount.
    let live = true;

    async function check() {
      try {
        const response = await fetch(ENDPOINT, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          /*
           * The whole point of the request. Without this the browser is free to
           * answer it out of its own HTTP cache, which is the stale copy this
           * exists to get away from — and on a page the reader has open,
           * `no-store` is what makes pressing refresh mean something. The CDN's
           * `s-maxage` still applies and is where the load is absorbed; see
           * `CACHE_CONTROL` in functions/src/bulletin.ts.
           */
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });

        // 503 (not configured) and 502 (source unreachable) are both "we are
        // broken". Keep what is on screen.
        if (!response.ok) return;

        const body: unknown = await response.json();
        if (!live) return;

        const record =
          typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
        if (!record) return;

        const week = reviveBulletin(record['bulletin']);
        // Null covers both "nothing active" and "the response was garbled", and
        // the answer to both is the same: leave it alone.
        if (week) setBulletin(week);
      } catch {
        // Offline, timed out, blocked, or not JSON. Keep what is on screen.
      }
    }

    void check();

    // Only while the tab is visible — a forgotten tab should not spend the
    // night re-reading the parish's schedule.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);

    // Coming back to a tab is when the copy on screen is most likely to have
    // gone stale, so it gets a check immediately rather than waiting out the
    // rest of its interval.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return bulletin;
}
