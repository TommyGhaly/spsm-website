import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminGate } from '@/components/AdminGate';
import { PageBody } from '@/components/PageBody';
import { StaffEvents } from '@/features/events';

/**
 * Events and drafts — the one events screen that is not an event's own page.
 *
 * This is **not** the return of `/admin/events`. That screen was a second editor
 * over the same collection, and having two was the problem it was deleted for.
 * This one edits nothing itself: it lists, it creates, and it hands off to the
 * same `EventEditor` an event's own page uses. The whole argument is at the top
 * of `features/events/StaffEvents`.
 *
 * ## Why `/staff/` is a new top-level segment
 *
 * `firebase.json` rewrites `/events/**` onto the exported gallery shell, so
 * anything under `/events` is competing with that rewrite — and an event
 * slugged the same as the screen would collide with it outright. Nothing
 * rewrites `/staff/**`.
 *
 * ## Two things this page needs that most do not
 *
 * `noindex`, like `/servants` — not as a control, since a static export is a
 * public file either way, but because a parish calendar admin screen in a search
 * result is only ever a wrong turn. It is absent from `sitemap.ts` for the same
 * reason, which needs no code here: that file lists routes explicitly.
 *
 * And a `Suspense` boundary, because `StaffEvents` reads the query string to
 * know which event to open. `useSearchParams` suspends during a static render,
 * and without a boundary `output: 'export'` fails the build outright rather than
 * degrading — the query string is only knowable in the browser, which is exactly
 * why it is where the event id lives.
 */
export const metadata: Metadata = {
  title: 'Events and drafts',
  robots: { index: false, follow: false },
};

export default function StaffEventsPage() {
  return (
    <AdminGate requires="staff" area="parish calendar">
      <Suspense
        fallback={
          <PageBody flush>
            <p className="note">Loading…</p>
          </PageBody>
        }
      >
        <StaffEvents />
      </Suspense>
    </AdminGate>
  );
}
