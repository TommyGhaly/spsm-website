'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ACCOUNT_SUBJECT_VALUE,
  applyCalendarDetails,
  groupByDay,
  mergeCalendarSources,
  type CalendarDetail,
  type CalendarOccurrence,
} from '@spsm/shared';
import { getSnapshot, getServerSnapshot, signIn, subscribe } from '@/lib/authStore';
import { useScreenGrants } from '@/lib/screenGrants';
import {
  getBulletinOccurrences,
  getSchedule,
  getStaffLayers,
  servantIdToken,
  type ScheduleResult,
} from './data';
import { AddEntry } from './AddEntry';
import { EventDialog } from './EventDialog';
import { rangeFor, step, todayInParish, type CalendarView } from './range';
import { WeekView } from './WeekView';
import { ScheduleSkeleton } from './Skeleton';
import { MonthView } from './MonthView';

/**
 * Where to send somebody whose sign-in will not work.
 *
 * The church office's own address and telephone number, read from
 * `config/parish` by the page and handed down — not written out here, so that
 * correcting either is an edit staff can make and not a deploy. Either may be
 * empty on a project nobody has filled that document in for, and the help at
 * the foot of the page drops whichever is missing rather than printing a blank
 * line or an empty `mailto:`.
 */
export interface CalendarOffice {
  email: string;
  phone: string;
}

/**
 * The church calendar: this week, or this month.
 *
 * ---------------------------------------------------------------------------
 * Why the whole thing is a client component, on a site that is a static export
 *
 * Because "this week" is a question about now, and a static export has no now.
 * Every other page here is HTML written to disk when the build ran, which is
 * exactly right for the clergy biographies and exactly wrong for a week view —
 * baked, it would show whichever week the deploy happened to run in and go on
 * showing it, looking entirely correct while being a month out of date.
 * `MonthGrid`'s own comment refuses a month stepper for this reason and renders
 * every month at once instead. This page pays for a stepper with JavaScript.
 *
 * The consequence to accept: the exported HTML for /calendar has no schedule in
 * it. The heading, the description and the site's own authored events are
 * static; the eight-hundred-a-year liturgies arrive on load. There is no way
 * around that while Breeze is the source of truth — see functions/calendar.ts —
 * and it is the right trade for the page whose entire job is to be current.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * The servants schedule is here, and is no longer a page
 *
 * It used to be `/servants`: a route, a nav-less footer link, a sign-in wall,
 * and an iframe. Which meant a servant checking whether they were serving on
 * Sunday had to know a URL that was deliberately hard to find, and then read a
 * second calendar that repeated everything the first one said.
 *
 * Now there is one calendar. Sign in with a church account and the servants
 * entries appear in it, marked, alongside the liturgies they belong beside. The
 * gate has not gone anywhere — it moved to the door of the Function, where it
 * checks a verified ID token rather than hiding a URL — but it is no longer a
 * *screen*. Nobody signs in to see a page; they sign in to see more of this one.
 * ---------------------------------------------------------------------------
 */
export function ChurchCalendar({
  features,
  office,
}: {
  features: CalendarOccurrence[];
  office: CalendarOffice;
}) {
  /*
   * Opens on the month.
   *
   * The month is the orienting view — it answers "what does this month look
   * like" and it is where somebody arriving without a specific question starts.
   * The week is what you step into once you know which week you want.
   */
  const [view, setView] = useState<CalendarView>('month');

  /**
   * `null` until the browser has told us what day it is.
   *
   * Deliberately not initialised with `todayInParish()`, tempting as that is:
   * this component is prerendered into static HTML at build time, so a lazy
   * initialiser would run on the build machine, bake *that* day into the
   * markup, and then disagree with the browser on hydration — a React text
   * mismatch on every cell, and a first paint showing the wrong week.
   *
   * One frame of a skeleton is the cost. It is also honest: until this resolves
   * the page genuinely does not know which week to show.
   */
  const [anchor, setAnchor] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  /** Bumped by the Today button, so the wheel re-centres even if the week did
      not change. See the prop of the same name on `WeekView`. */
  const [recentre, setRecentre] = useState(0);

  useEffect(() => {
    const now = todayInParish();
    setAnchor(now);
    setToday(now);
  }, []);

  /* ---- who is reading ---------------------------------------------------- */

  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /*
   * The servants' rota is shown to anybody signed in, and that is the model
   * rather than a shortcut. This asked `hasRole(session.claims, 'servant')`
   * back when a first sign-in granted that role automatically — so it always
   * meant "signed in", and it now says so. `servantEvents` in firestore.rules
   * is `signedIn()` for the same reason: sign-in is Microsoft-only and
   * restricted to the parish's Entra directory, so having a session is being on
   * the rota.
   */
  const isServant = session.kind === 'signed-in';
  /**
   * Whether to offer sign-in at all — and `restoring` counts as "do not".
   *
   * A returning servant's first client render is `restoring` while Firebase
   * checks the session hint, and drawing the offer through that would flash
   * "sign in to see the servants schedule" at somebody who is already signed in
   * and about to be shown it. The prerendered HTML says `signed-out`, so this
   * does appear for a fraction of a second before hydration on a returning
   * servant's page load; that is the same trade the masthead's own sign-in
   * control makes, and it is the right way round — the signed-out majority get
   * the honest answer painted immediately.
   */
  const signedOut = session.kind !== 'signed-in' && session.kind !== 'restoring';
  /*
   * Whether to draw the edit controls — the `events` grant, not the role.
   *
   * This asked `hasRole(session.claims, 'staff')`, which matched the rules on
   * `scheduleEntries` and `calendarDetails` at the time. Both are now
   * `hasScreen('events')`, so the role check became the stricter-than-policy
   * case: somebody given the parish calendar at /access would have been served
   * every write by the rules and shown no control to make one with.
   *
   * `useScreenGrants` answers from the token for a superadmin and reads the
   * member document only for everybody else, so a signed-out visitor still
   * triggers nothing.
   *
   * Not a security boundary, and worth saying so where somebody will read it:
   * this decides whether the edit controls are *drawn*. `firestore.rules` is
   * what decides whether a write lands, and a member who edits this check out
   * of their own browser still cannot save anything.
   */
  const { canAdmin: canAdminScreenHere } = useScreenGrants();
  const mayEditCalendar = canAdminScreenHere('events');

  /**
   * Whether to ask for the servants calendar. On by default for a servant.
   *
   * A switch rather than nothing at all, because a servant is also a
   * parishioner: "what is the parish doing this week" and "what am I on the
   * hook for" are different questions, and the internal entries — tentative
   * plans, which van is out, blocked-off prep days — are noise against the
   * first one. Off, this page is exactly what everybody else sees.
   */
  const [wantServants, setWantServants] = useState(true);
  const [deniedNote, setDeniedNote] = useState<string | null>(null);

  // Signing out mid-session must not leave the switch claiming to include a
  // calendar nobody is going to be served any more.
  useEffect(() => {
    if (!isServant) setDeniedNote(null);
  }, [isServant]);

  const askingForServants = isServant && wantServants;

  /* ---- this week's bulletin ---------------------------------------------- */

  /**
   * Fetched once, on mount, rather than per range.
   *
   * The bulletin covers exactly one week — whichever one the parish has active —
   * so re-asking when the reader steps to October would spend a request to be
   * told the same thing. It is merged into whatever range happens to contain
   * its days and is invisible everywhere else.
   */
  const [bulletin, setBulletin] = useState<CalendarOccurrence[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void getBulletinOccurrences(controller.signal).then(setBulletin);
    return () => controller.abort();
  }, []);

  /* ---- what staff have added and annotated -------------------------------- */

  /**
   * Manually added entries, and the details laid over everything else.
   *
   * `reload` is bumped after any staff write so this re-reads. A listener would
   * be live without it, but it would also hold a Firestore subscription open on
   * a page most visitors read once — and the only writer is the person looking
   * at the page, who does not need to be told about their own edit by the
   * server.
   */
  const [layers, setLayers] = useState<{
    entries: CalendarOccurrence[];
    details: Map<string, CalendarDetail>;
  }>({ entries: [], details: new Map() });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    void getStaffLayers().then((next) => {
      if (live) setLayers(next);
    });
    return () => {
      live = false;
    };
  }, [reload]);

  /* ---- the fetch --------------------------------------------------------- */

  const range = useMemo(() => (anchor ? rangeFor(view, anchor) : null), [view, anchor]);

  const [result, setResult] = useState<ScheduleResult | null>(null);
  /**
   * How many requests are outstanding, rather than a boolean.
   *
   * Two can be: a click on "next week" while the previous week is still in
   * flight. A boolean gets set false by whichever *finishes* first and the
   * spinner disappears while the calendar is still catching up.
   */
  const [pending, setPending] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!range) return;

    /*
     * Aborted on cleanup, and the sequence number is checked besides.
     *
     * Stepping quickly through the weeks fires a request per click and they do
     * not come back in order — Breeze is slower for a range it has not cached,
     * so the *older* request can easily land last. Without both guards the
     * calendar settles on whichever response arrived last rather than on the
     * week the reader is looking at, and it looks like the arrows are broken.
     */
    const controller = new AbortController();
    latest.current += 1;
    const sequence = latest.current;

    setPending((count) => count + 1);

    /*
     * Exactly one decrement per increment, which is what this flag is for.
     *
     * The obvious arrangement — decrement when the request settles, and again in
     * the cleanup — double-counts every request that finishes *before* its
     * effect is torn down, which is the common case. Clamping the result at zero
     * hides it while leaving the count wrong whenever two requests overlap, so
     * the busy state would clear with one still in flight. The flag makes the
     * accounting true rather than merely non-negative.
     */
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      setPending((count) => Math.max(0, count - 1));
    };

    void (async () => {
      const idToken = askingForServants ? await servantIdToken() : null;
      const next = await getSchedule(range.from, range.to, {
        servants: askingForServants,
        idToken,
        signal: controller.signal,
      });

      done();
      if (sequence !== latest.current) return;

      // An abort reports itself as an error with no message; it is this effect's
      // own doing and must not be shown to anybody.
      if (next.kind === 'error' && next.message === '') return;

      /*
       * A refused servants request falls back to the parish calendar rather
       * than to nothing. The claim in the token disagreed with the claim in
       * this tab — a role changed, or the session outlived it — and the parish
       * schedule is still the right thing to be looking at.
       */
      if (next.kind === 'denied') {
        setDeniedNote(next.message);
        setWantServants(false);
        return;
      }

      setResult(next);
    })();

    return () => {
      controller.abort();
      done();
    };
  }, [range, askingForServants]);

  /* ---- what to draw ------------------------------------------------------ */

  const byDay = useMemo(() => {
    if (!range) return new Map<string, CalendarOccurrence[]>();

    const schedule = result?.kind === 'ok' ? result.feed.occurrences : [];

    /*
     * The site's own events are filtered to the visible range here rather than
     * being fetched for it: they arrive whole, from the build, because there are
     * a few dozen of them and they are already in the page. This is also what
     * puts something on screen before the Function answers — and what keeps a
     * festival on the calendar if Breeze is unreachable.
     */
    const inRange = (entries: CalendarOccurrence[]) =>
      entries.filter((entry) => entry.endDay >= range.from && entry.day <= range.to);

    /*
     * Three sources, one schedule.
     *
     * `mergeCalendarSources` is what stops the same service appearing twice
     * under two names — the bulletin and Breeze describe the same week and
     * agree on almost none of the wording. The order of the arguments does not
     * matter; precedence is decided inside, by source.
     */
    /*
     * Four sources now, and the details laid over whatever survives the merge.
     *
     * The details go on *after* merging, not before: a note is attached to an
     * occurrence id, and the merge is what decides which of two descriptions of
     * the same service keeps its id. Annotating first would put the note on the
     * copy that loses.
     */
    return groupByDay(
      applyCalendarDetails(
        mergeCalendarSources([inRange(layers.entries), inRange(features), inRange(bulletin), schedule]),
        layers.details,
      ),
    );
  }, [result, features, bulletin, layers, range]);

  const includesServants = result?.kind === 'ok' && result.feed.includesServants;

  /** The occurrence the dialog is showing, and which of its days was clicked. */
  const [opened, setOpened] = useState<{
    occurrence: CalendarOccurrence;
    day: string;
  } | null>(null);

  /*
   * Re-read from `byDay` rather than kept as the object that was clicked, so
   * that saving a detail updates the open dialog instead of leaving it showing
   * what was true a moment ago.
   */
  const openedNow =
    opened === null
      ? null
      : ((byDay.get(opened.day) ?? []).find((entry) => entry.id === opened.occurrence.id) ??
        opened.occurrence);

  return (
    <>
      <section className="schedule" aria-busy={pending > 0}>
        <header className="schedule__bar">
          <div className="schedule__views" role="group" aria-label="Calendar view">
            <ViewButton current={view} value="week" onPick={setView}>
              Week
            </ViewButton>
            <ViewButton current={view} value="month" onPick={setView}>
              Month
            </ViewButton>
          </div>

          <div className="schedule__nav">
            <button
              type="button"
              className="schedule__step"
              onClick={() => setAnchor((at) => (at ? step(view, at, -1) : at))}
              disabled={anchor === null}
              aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
            >
              <Chevron direction="left" />
            </button>

            {/*
              An `aria-live` region, because the heading is the only thing that
              says the view moved. A sighted reader sees the whole grid change;
              somebody on a screen reader pressed a button labelled "next week"
              and needs to hear which week they landed on.
            */}
            <h2 className="schedule__range" aria-live="polite">
              {range ? range.label : ' '}
            </h2>

            <button
              type="button"
              className="schedule__step"
              onClick={() => setAnchor((at) => (at ? step(view, at, 1) : at))}
              disabled={anchor === null}
              aria-label={view === 'week' ? 'Next week' : 'Next month'}
            >
              <Chevron direction="right" />
            </button>

            <button
              type="button"
              className="schedule__today"
              onClick={() => {
                setAnchor(todayInParish());
                setRecentre((count) => count + 1);
              }}
              /*
               * In the month view this is disabled once the month containing
               * today is on screen, because there is nothing further for it to do.
               *
               * In the week view it stays live even then, and that is the whole
               * point: the wheel can be scrolled two days off today while today
               * is still in the range, and the old rule disabled the one control
               * that brings it back. Somebody reading Wednesday then has no way
               * to return to today except by scrolling and counting.
               */
              disabled={
                today === null ||
                (view === 'month' && range !== null && today >= range.from && today <= range.to)
              }
            >
              Today
            </button>
          </div>
        </header>

        {deniedNote && (
          <div className="notice notice--alarm" role="alert">
            <h3>The servants schedule was not available</h3>
            <p>{deniedNote}</p>
            <p className="note">
              The rest of the calendar below is the parish schedule, which is unaffected.
            </p>
          </div>
        )}

        <Body
          view={view}
          range={range}
          byDay={byDay}
          today={today}
          result={result}
          recentre={recentre}
          onOpen={(occurrence, day) => setOpened({ occurrence, day })}
        />

        {/*
          The servants switch sits at the foot rather than above the calendar.

          It is a control a few dozen people touch once, and it was the first
          thing between the stepper and the week — a band of blue explaining a
          distinction to somebody who had come to find out when the Liturgy is.
          Down here it is still the first thing a servant looks for, because it is
          the only blue on the page.
        */}
        <footer className="schedule__foot">
          <Legend showServants={includesServants} />
          {isServant && (
            <div className="schedule__servants">
              <label className="schedule__switch">
                <input
                  type="checkbox"
                  checked={wantServants}
                  onChange={(event) => {
                    setDeniedNote(null);
                    setWantServants(event.target.checked);
                  }}
                />
                <span>Include the servants schedule</span>
              </label>
              <p className="schedule__servants-note">
                {includesServants
                  ? 'Signed in with your church account, so the servants entries are in the calendar above and marked.'
                  : wantServants
                    ? 'Loading the servants entries…'
                    : 'Showing only what everyone else sees.'}
              </p>
            </div>
          )}

          {/*
            The signed-out half of the servants switch: one line, in the same
            place the switch itself occupies for somebody who has signed in.

            Deliberately not a band, not a card, and not azure. A visitor who
            came to find out when the Liturgy is should be able to read past
            this without it having interrupted them — the servants schedule is
            not something the church is selling, it is a thing a few dozen
            people need and everybody else does not. The offer is a sentence and
            a link, and the explanation of *how* is further down the page, where
            it interrupts nobody.
          */}
          {signedOut && (
            <p className="schedule__signin">
              Serving?{' '}
              <button
                type="button"
                className="schedule__signin-link"
                onClick={() => void signIn()}
                disabled={session.kind === 'signing-in'}
              >
                {session.kind === 'signing-in' ? 'Opening Microsoft…' : 'Sign in'}
              </button>{' '}
              with your church account and the servants schedule appears in the calendar above.
            </p>
          )}

          {/*
            The add control sits with the calendar rather than on a screen of
            its own — the site's settled pattern, and it earns it here: whoever
            is adding a service is looking at the week they are adding it to.

            It defaults to the day in view, so adding something to the week you
            are reading is one field shorter.
          */}
          {mayEditCalendar && (
            <AddEntry
              defaultDay={today ?? range?.from ?? ''}
              onAdded={() => setReload((count) => count + 1)}
            />
          )}
        </footer>

        <EventDialog
          occurrence={openedNow}
          day={opened?.day ?? null}
          detail={openedNow ? (layers.details.get(openedNow.id) ?? null) : null}
          mayEdit={mayEditCalendar}
          onClose={() => setOpened(null)}
          onChanged={() => setReload((count) => count + 1)}
        />
      </section>

      {signedOut && <SignInHelp office={office} busy={session.kind === 'signing-in'} />}
    </>
  );
}

/**
 * How to sign in, what to do when it refuses you, and how to be given an
 * account — below the calendar, and only for somebody who is not signed in.
 *
 * ---------------------------------------------------------------------------
 * Why this is on /calendar and not a page of its own
 *
 * Because the question is asked here. The servants schedule is part of this
 * calendar rather than a screen behind a door — `ChurchCalendar`'s own comment
 * explains why — so "how do I see the rota" is a question somebody has while
 * looking at the rota's page, and answering it on a separate route means the
 * answer is one more thing to go and find. It also means the line in the footer
 * above can be one sentence: everything it does not say is directly below.
 *
 * Three columns, in the order the trouble happens: how it works, what to do
 * when it does not, and what to do if you were never given an account. The
 * third is the one with a form behind it, and it is deliberately last — most
 * people who read this have an account and have forgotten which button opens
 * it.
 *
 * Hidden entirely from anybody signed in. A servant who is already looking at
 * their own rota does not need instructions for getting to it, and the church
 * office's number is on /contact where it belongs for every other purpose.
 * ---------------------------------------------------------------------------
 */
function SignInHelp({ office, busy }: { office: CalendarOffice; busy: boolean }) {
  return (
    <aside className="signin-help" aria-labelledby="signin-help-heading">
      <h2 className="signin-help__title" id="signin-help-heading">
        Signing in
      </h2>

      <div className="signin-help__cols">
        <section className="signin-help__col">
          <h3>How to sign in</h3>
          <ol className="signin-help__steps">
            <li>
              Press the circle at the top right of any page — on a phone it is at the foot of
              the menu.
            </li>
            <li>
              Microsoft asks for your church account, the address ending{' '}
              <span className="signin-help__nowrap">@spsmwayland.org</span>, and its password.
            </li>
            <li>
              You are returned here, and the servants entries are in the calendar above, marked,
              with a switch at its foot to set them aside again.
            </li>
          </ol>
          <p>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => void signIn()}
              disabled={busy}
            >
              {busy ? 'Opening Microsoft…' : 'Sign in with Microsoft'}
            </button>
          </p>
        </section>

        <section className="signin-help__col">
          <h3>If it will not let you in</h3>
          {/*
            The refusal this actually produces, named. Sign-in is restricted to
            the church's own Microsoft directory — see the single-tenant note in
            docs/api-keys.md — so a personal Outlook or Hotmail address does not
            fail because something is broken, it fails because it is not a church
            account, and somebody who is told that stops trying to fix it.
          */}
          <p>
            A personal Microsoft, Outlook, or Hotmail address is refused: only accounts in the
            church&rsquo;s own directory can sign in. Check that you are using your church
            address, and that you are not signed in to a personal Microsoft account in the same
            browser.
          </p>
          <p>
            If it still refuses you, the church office can look at the account.
            <OfficeContacts office={office} />
          </p>
        </section>

        <section className="signin-help__col">
          <h3>If you have no church account</h3>
          <p>
            Church accounts are given to those serving. Ask the office for one and say which
            service you serve in; the request reaches them with everything else sent from this
            site.
          </p>
          <p>
            {/*
              An ordinary link, not a form of its own. The contact form already
              carries the office's notification address, its confirmation email,
              and a row in the submissions table — `?about=` only arrives there
              with the subject already chosen, so these are one line in that
              table rather than a pile of "A general question".
            */}
            <a
              className="button"
              href={`/contact?about=${ACCOUNT_SUBJECT_VALUE}#write-heading`}
            >
              Ask for a church account
            </a>
          </p>
        </section>
      </div>
    </aside>
  );
}

/**
 * The office's address and telephone number, as a sentence, skipping whichever
 * of the two `config/parish` does not have. Neither is written out in this
 * codebase; both are staff-editable, and a blank field prints nothing at all
 * rather than "Write to ." or a `mailto:` that opens an empty message.
 */
function OfficeContacts({ office }: { office: CalendarOffice }) {
  return (
    <>
      {office.email && (
        <>
          {' '}
          Write to <a href={`mailto:${office.email}`}>{office.email}</a>.
        </>
      )}
      {office.phone && (
        <>
          {' '}
          {/* Punctuation stripped for the dialler, exactly as ContactDetails does it. */}
          or call <a href={`tel:${office.phone.replace(/[^\d+]/g, '')}`}>{office.phone}</a>.
        </>
      )}
    </>
  );
}

/**
 * The grid, or the reason there is not one.
 *
 * Split out so the states are in one place and in a readable order. The order
 * matters: a feed that has already loaded keeps being rendered while the next
 * one is in flight, so stepping through the weeks moves the grid rather than
 * blanking it and redrawing. Only the very first load shows a skeleton.
 */
function Body({
  view,
  range,
  byDay,
  today,
  result,
  recentre,
  onOpen,
}: {
  view: CalendarView;
  range: ReturnType<typeof rangeFor> | null;
  byDay: Map<string, CalendarOccurrence[]>;
  today: string | null;
  result: ScheduleResult | null;
  recentre: number;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  /*
   * Both of the waiting states are the grid, drawn at its real size, with the
   * schedule shimmering in it — see Skeleton.tsx. They differ only in how much
   * of it we can fill in honestly: without a range there are no dates yet.
   */
  if (!range) {
    return (
      <ScheduleSkeleton view={view} range={null} today={null} label="Working out what week it is…" />
    );
  }

  /*
   * `result === null` on its own, and the `&& pending` that used to be here was
   * a real bug rather than a redundant guard.
   *
   * `pending` is incremented inside the fetch effect, and an effect runs after
   * the render that scheduled it — so on the two renders between `anchor`
   * landing and that effect firing, the range is set, no schedule has arrived,
   * and `pending` is still 0. The old condition let those two fall through to
   * the grid, which in the month view draws a complete, correct-looking month
   * with almost nothing in it. The reader got the finished calendar first and
   * the skeleton second, which reads as a flicker and not as loading — it is
   * why the month view appeared to have no skeleton at all.
   *
   * No schedule is no schedule, whether or not a request has been counted yet.
   * Stepping to another week is unaffected: `result` is non-null by then, and
   * the grid keeps rendering while the next feed is in flight.
   */
  if (result === null) {
    return (
      <ScheduleSkeleton view={view} range={range} today={today} label="Loading the schedule…" />
    );
  }

  if (result?.kind === 'unset') {
    return (
      <div className="notice">
        <h3>Not set up yet</h3>
        <p>
          The church calendar hasn&apos;t been connected. An administrator sets the Breeze
          calendar in <code>servantsConfig/schedule</code>.
        </p>
      </div>
    );
  }

  if (result?.kind === 'error') {
    /*
     * The grid is still drawn underneath this, and that is the point. The site's
     * own events are already in `byDay` from the build, so an unreachable Breeze
     * costs the reader the liturgies and not the page.
     */
    return (
      <>
        <div className="notice notice--alarm" role="alert">
          <h3>Couldn&apos;t load the full schedule</h3>
          <p>{result.message}</p>
        </div>
        <Grid view={view} range={range} byDay={byDay} today={today} recentre={recentre} onOpen={onOpen} />
      </>
    );
  }

  return <Grid view={view} range={range} byDay={byDay} today={today} recentre={recentre} onOpen={onOpen} />;
}

function Grid({
  view,
  range,
  byDay,
  today,
  recentre,
  onOpen,
}: {
  view: CalendarView;
  range: ReturnType<typeof rangeFor>;
  byDay: Map<string, CalendarOccurrence[]>;
  today: string | null;
  recentre: number;
  onOpen: (occurrence: CalendarOccurrence, day: string) => void;
}) {
  return view === 'week' ? (
    <WeekView range={range} byDay={byDay} today={today} recentre={recentre} onOpen={onOpen} />
  ) : (
    <MonthView range={range} byDay={byDay} today={today} onOpen={onOpen} />
  );
}

function ViewButton({
  current,
  value,
  onPick,
  children,
}: {
  current: CalendarView;
  value: CalendarView;
  onPick: (view: CalendarView) => void;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      className={active ? 'schedule__view schedule__view--on' : 'schedule__view'}
      onClick={() => onPick(value)}
      // `aria-pressed` rather than `aria-current`: this is a toggle between two
      // renderings of the same page, not navigation to a different one.
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

/**
 * What the colours mean.
 *
 * Always rendered, unlike the old one, because the colours are now on every
 * entry rather than marking a distinction only servants could see. A key to a
 * scheme the reader is looking at is worth four short lines; the old one
 * explained a servants marker to people who were never shown it.
 *
 * `other` is deliberately absent. It is the absence of a claim — the classifier
 * could not place the title — and a legend row reading "Other" invites the
 * reader to look for a meaning that is not there.
 */
function Legend({ showServants }: { showServants: boolean }) {
  return (
    <ul className="schedule__legend">
      <li>
        <span className="schedule__swatch schedule__swatch--liturgy" aria-hidden="true" />
        Liturgies &amp; prayers
      </li>
      <li>
        <span className="schedule__swatch schedule__swatch--study" aria-hidden="true" />
        Classes &amp; studies
      </li>
      <li>
        <span className="schedule__swatch schedule__swatch--gathering" aria-hidden="true" />
        Meetings &amp; gatherings
      </li>
      {showServants && (
        <li>
          <span className="schedule__swatch schedule__swatch--servants" aria-hidden="true" />
          Servants only
        </li>
      )}
    </ul>
  );
}

/** The arrows on the stepper. Inline so they inherit `currentColor`. */
function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
