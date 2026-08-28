import type { Metadata } from 'next';
import { occurrenceOfEvent, toDate, type CalendarOccurrence } from '@spsm/shared';
import { getAllEvents } from '@/features/events';
import { ChurchCalendar } from '@/features/calendar';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';
import { PARISH_TIME_ZONE } from '@/lib/dates';

export const metadata: Metadata = {
  title: 'Church Calendar',
  description:
    'The week-by-week and month-by-month calendar of liturgies, feasts, classes, and gatherings at St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

/**
 * The church calendar.
 *
 * ---------------------------------------------------------------------------
 * Two views of one schedule, and the schedule is Breeze
 *
 * This page used to render `events` — the site's own Firestore collection — as
 * a stack of month grids, one per month that had anything in it. In production
 * that collection is **empty**, and it was always going to be: the parish keeps
 * its calendar in Breeze ChMS, where the office already maintains it, and
 * nobody is ever going to retype eight hundred liturgies a year into a website
 * admin so that a second copy can drift from the first.
 *
 * So the schedule is read from Breeze at request time, through
 * `/api/calendar`, and rendered in the parish's own design. What the `events`
 * collection is still *for* is the handful of things that deserve a page —
 * summer camp, the festival, an iconography class — and those are merged in
 * below, keeping their links. See features/calendar/data.ts.
 *
 * The relationship with `/events` is unchanged and still worth keeping
 * straight: **this page answers "what is on the 24th?", `/events` answers "what
 * is coming up?"** One is a grid you scan by date, the other a list you read in
 * order. Neither is a subset of the other.
 * ---------------------------------------------------------------------------
 *
 * The servants schedule is here too, for whoever signs in — it is no longer a
 * page of its own. `ChurchCalendar` explains that at more length.
 */
export default async function CalendarPage() {
  /*
   * The site's own events, whole, at build time.
   *
   * `getAllEvents` rather than `getUpcomingEvents`: the reader can step
   * backwards through the months from here, and a filter applied at build time
   * would decide what "upcoming" meant on the deploy machine's clock and then
   * bake it. There are a few dozen of these; the schedule they are merged into
   * is the thing that needs a range.
   */
  const features: CalendarOccurrence[] = (await getAllEvents())
    .map((event) => {
      const startAt = toDate(event.startAt);
      if (!startAt) return null;

      return occurrenceOfEvent(
        {
          slug: event.slug,
          title: event.title,
          startAt,
          endAt: toDate(event.endAt),
          allDay: event.allDay,
          location: event.location?.name ?? '',
          summary: event.summary,
          timeZone: event.timeZone,
        },
        PARISH_TIME_ZONE,
      );
    })
    .filter((occurrence): occurrence is CalendarOccurrence => occurrence !== null);

  return (
    <>
      {/*
        Back to the hidden `h1`, and the description line is gone with it.

        Both were added when this page opened on a grey line of small print hard
        against the masthead, and a heading was the right fix for that. It is
        not the right fix any more: the page now opens on the day picker, which
        is a substantial thing in its own right, and the ninety pixels of
        heading above it were pushing the week down for no one's benefit — the
        masthead already says which site this is and the nav already says which
        page. Same reasoning `PageHeader` itself gives for having been cut down
        to nothing, and the same reasoning that took the band off /livestream.

        The `h1` stays, invisible: it is the accessible name of the page, what a
        screen reader announces, and what a search result shows.
      */}
      <PageHeader title="Church Calendar" />

      {/*
        `wide`, which lifts the 80rem shell.

        The calendar is not prose — it is seven columns of dates and a schedule,
        and both want width. The month grid in particular was giving each day
        about 130px, which is where "St Philopater & St Mina Online Bible Study"
        turns into three lines of two words. Same reasoning the galleries use it
        for: the thing on the page *is* the page.
      */}
      <PageBody flush wide>
        <ChurchCalendar features={features} />
      </PageBody>
    </>
  );
}
