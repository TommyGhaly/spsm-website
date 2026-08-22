import { PARISH_TIME_ZONE } from '@/lib/dates';

/**
 * Today's date in the parish's own zone, as `YYYY-MM-DD`.
 *
 * **Evaluated at build time**, because this is a static export — so "today" is
 * the day the site was built, not the day it is read. That is accurate for a
 * site rebuilt on publish and drifts otherwise, which is why it only ever adds a
 * highlight: a missing "Today" marker is a non-event, whereas hiding past days
 * based on a stale date would silently empty the schedule.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate module called from the page, rather than a line inside
 * `BulletinWeek` where it used to live.
 *
 * `BulletinWeek` is now rendered inside a client component, so that a bulletin
 * made active in the announcements app reaches the homepage without a deploy.
 * A static export renders client components once at build time as well, so a
 * clock read inside one produces the day of the *deploy* on the server side of
 * hydration and the day of the *visit* on the browser side. React treats that
 * disagreement as a hydration mismatch and throws the tree away to re-render it.
 *
 * Reading it here — in a module with no `'use client'`, called from the server
 * page and passed down as a prop — means both sides of hydration see the same
 * string, and the flag behaves exactly as it did before any of this was live.
 * ---------------------------------------------------------------------------
 */
export function todayInParish(): string {
  // `en-CA` gives ISO order (YYYY-MM-DD) directly, avoiding a manual reassembly
  // of the parts.
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: PARISH_TIME_ZONE,
  }).format(new Date());
}
