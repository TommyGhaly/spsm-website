'use client';

import { useCallback, useEffect, useState } from 'react';
import { TOUR_STATIONS } from './stations';

/**
 * The digital version of the passport card.
 *
 * ---------------------------------------------------------------------------
 * The in-person tour hands out a card that collects a stamp at each of the six
 * stations, and a full card is worth two dollars off a dessert. This is that,
 * in `localStorage`.
 *
 * **No account, no write, nothing leaves the phone.** That is not a shortcut —
 * it is the only version of this feature that is worth building. The visitors
 * are members of the public at a festival, many of them children; the parish
 * has no reason to hold a record of who walked which station, and asking a
 * stranger to sign in to collect a sticker would empty the hall. `localStorage`
 * means the reward is on the honour system, exactly as a paper card is: someone
 * determined to get two dollars off a dessert can clear their browser storage,
 * and they could also have drawn six stamps on a card with a pen.
 *
 * The cost of the trade, stated plainly so nobody is surprised by it: a visitor
 * who switches from Safari to Chrome, or opens the page in a private window,
 * starts over. A stamp is cheap to re-collect — it is a tap — so this is an
 * annoyance rather than a loss.
 * ---------------------------------------------------------------------------
 */

/** Versioned, so the shape can change without reading somebody's stale array
 *  as if it were the current one. */
const KEY = 'spsm.tour.passport.v1';

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter against the real station list rather than trusting what is in
    // storage: a renamed station would otherwise leave a stamp that counts
    // toward the six but matches nothing on the page, and the passport would
    // read "6 of 6" with a station still blank.
    const known = new Set(TOUR_STATIONS.map((station) => station.id));
    return parsed.filter((id): id is string => typeof id === 'string' && known.has(id));
  } catch {
    // Private browsing in older Safari threw on every `localStorage` access
    // rather than returning null. An unusable passport must not take the page
    // down with it.
    return [];
  }
}

export type Passport = {
  /** The stations stamped so far. Empty on the server and on first paint. */
  stamped: ReadonlySet<string>;
  /** Whether storage has been consulted yet. Everything that renders
   *  differently once it has — the count, the reward — waits on this, or the
   *  server's "0 of 6" and the browser's "4 of 6" disagree and React
   *  complains about it in the console of every returning visitor. */
  ready: boolean;
  stamp: (id: string) => void;
  reset: () => void;
  count: number;
  complete: boolean;
};

export function usePassport(): Passport {
  const [stamped, setStamped] = useState<ReadonlySet<string>>(() => new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStamped(new Set(read()));
    setReady(true);
  }, []);

  const save = useCallback((next: Set<string>) => {
    setStamped(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      // Out of quota, or storage denied. The passport still works for this
      // visit; it just will not survive a reload. Better than a thrown error
      // taking down the station the reader is on.
    }
  }, []);

  const stamp = useCallback(
    (id: string) => {
      // A functional update, not `stamped` from the closure. Two stations
      // scrolled past in one frame is an ordinary thing on a phone, and read
      // the state directly and the second stamp overwrites the first.
      setStamped((current) => {
        if (current.has(id)) return current;
        const next = new Set(current).add(id);
        try {
          window.localStorage.setItem(KEY, JSON.stringify([...next]));
        } catch {
          /* see above */
        }
        return next;
      });
    },
    [],
  );

  const reset = useCallback(() => save(new Set()), [save]);

  return {
    stamped,
    ready,
    stamp,
    reset,
    count: stamped.size,
    complete: ready && stamped.size === TOUR_STATIONS.length,
  };
}
