'use client';

/**
 * The one events screen that is not an event's own page.
 *
 * ## Why it has to exist, given that everything else is edited in place
 *
 * Two things genuinely cannot be done in place, and neither is an oversight:
 *
 *  - **A new event has no page to be in place on.** It has no slug until
 *    somebody names it, and under `output: 'export'` a page exists only if the
 *    build enumerated it.
 *  - **A draft is not exported at all.** `getAllEvents` filters on
 *    `published == true`, so an unpublished event has no URL on the website, and
 *    it is precisely the event somebody most wants to get back to.
 *
 * Both used to live at `/admin/events`. When that section was deleted they went
 * with it, and the code said so out loud — "there is at present no way to create
 * an event or open an unpublished draft through the site". This is that gap.
 *
 * ## Why the editor is *on* this page rather than linked from it
 *
 * A newly created event still has no page until the next build, so "create, then
 * go to it" cannot work — the link would 404 in production and fall through to
 * the gallery shell. So this page hosts `EventEditor` itself, keyed by a `?id=`
 * in the query string. Query strings survive static export because they are read
 * in the browser; a path segment would not.
 *
 * Once an event is published and the site rebuilt, its own page takes over and
 * this screen is only a way in.
 *
 * ## Why `/staff/events` and not `/events/staff`
 *
 * `firebase.json` rewrites `/events/**` onto the exported gallery shell. An
 * exported file at that path would win over the rewrite today and would be one
 * careless change away from not doing so — and an event slugged `edit` would
 * collide with it outright. Nothing rewrites `/staff/**`.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toDate, type DocOf, type Event } from '@spsm/shared';
import { PageBody } from '@/components/PageBody';
import { Icon } from '@/components/Icon';
import { formatEventWhen } from '@/lib/dates';
import { EventEditor } from './EventEditor';
import { NewEvent } from './NewEvent';

type List =
  | { kind: 'loading' }
  | { kind: 'ready'; events: DocOf<Event>[] }
  | { kind: 'failed'; message: string };

/**
 * Sign-in and the role check are not here.
 *
 * `AdminGate` wraps this from the route, which is the same arrangement
 * `/servants` uses — and it is the better one, because the gate also *offers*
 * sign-in. A check inside this component could only ever say no to somebody who
 * is signed out, which is the one visitor who has something they can do about it.
 */
export function StaffEvents() {
  const router = useRouter();
  const params = useSearchParams();
  const editing = params.get('id');

  if (editing) {
    return <EditOne id={editing} onClose={() => router.push('/staff/events')} />;
  }

  return <TheList onOpen={(id) => router.push(`/staff/events?id=${id}`)} />;
}

/* -------------------------------------------------------------------------- */
/* The list                                                                    */
/* -------------------------------------------------------------------------- */

function TheList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<List>({ kind: 'loading' });
  const [making, setMaking] = useState(false);

  const load = useCallback(async () => {
    setList({ kind: 'loading' });
    try {
      const { listEventsForAdmin } = await import('./admin');
      setList({ kind: 'ready', events: await listEventsForAdmin() });
    } catch (error) {
      setList({
        kind: 'failed',
        message:
          error instanceof Error ? error.message : 'Could not read the list of events.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const events = list.kind === 'ready' ? list.events : [];

  /*
   * One list, newest first, exactly as `listEventsForAdmin` returns it.
   *
   * It used to be three groups — drafts, published-with-unpublished-changes, and
   * the rest — and the grouping was the whole reason this screen sorted anything:
   * a draft had no page of its own, so this was the only way to reach it. There
   * are no drafts now. Every event is on the website, every one has a page, and a
   * heading over a single group is a heading that says nothing.
   */

  return (
    <PageBody flush>
      <header className="staff-head">
        <div>
          <h1>Events and drafts</h1>
          <p className="staff-head__note">
            Everything in the parish calendar. An event is edited on its own page; this
            is where you make one, and where a new one lives until the site is next
            built and it has a page of its own.
          </p>
        </div>
        <button type="button" className="button" onClick={() => setMaking(true)}>
          <Icon name="plus" size={14} /> New event
        </button>
      </header>

      {making && (
        <NewEvent
          onCancel={() => setMaking(false)}
          onCreated={(id) => {
            setMaking(false);
            onOpen(id);
          }}
        />
      )}

      {list.kind === 'loading' && <p className="note">Reading the calendar…</p>}

      {list.kind === 'failed' && (
        <div className="notice notice--alarm" role="alert">
          <h2>Could not read the calendar</h2>
          <p>{list.message}</p>
          <p>
            <button type="button" className="button button--quiet" onClick={() => void load()}>
              Try again
            </button>
          </p>
        </div>
      )}

      {list.kind === 'ready' && events.length === 0 && (
        <div className="notice" role="status">
          <h2>Nothing in the calendar yet</h2>
          <p>Make the first event and it will appear here.</p>
        </div>
      )}

      <Group rows={events} onOpen={onOpen} />
    </PageBody>
  );
}

/**
 * The list.
 *
 * No longer takes a title or a hint. It took both when there were three of these
 * on the page, one per publish state; there is one now, and a heading over the
 * only list on a screen called "Events and drafts" is a label for a thing that
 * needs no labelling.
 */
function Group({
  rows,
  onOpen,
}: {
  rows: DocOf<Event>[];
  onOpen: (id: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="staff-group">
      <ul className="staff-list">
        {rows.map((event) => (
          <li key={event.id}>
            <button type="button" className="staff-row" onClick={() => onOpen(event.id)}>
              <span className="staff-row__name">{event.title || 'Untitled event'}</span>
              <span className="staff-row__when">
                {toDate(event.startAt)
                  ? formatEventWhen(event.startAt, event.endAt, event.allDay, event.timeZone)
                  : 'No date'}
              </span>
              <span className="staff-row__go" aria-hidden="true">
                <Icon name="chevron" size={14} />
              </span>
            </button>

            {/*
              A link to the live page. Offered rather than promised: the page is
              written by `next build`, so an event created since the last deploy
              has none yet. It is a plain link beside the row rather than the row
              itself, because the row's job is to open the editor.
            */}
            <Link className="staff-row__view" href={`/events/${event.slug}`}>
              View the page
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* One event, edited here                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Reads the event, then hands it to the same editor its own page uses.
 *
 * The read is here rather than inside `EventEditor` because that component takes
 * a document — on an event's own page it gets the one baked into the HTML, and it
 * re-reads for freshness. Here there is no baked copy at all, so somebody has to
 * do the first read, and the editor's own re-read then simply agrees with it.
 */
function EditOne({ id, onClose }: { id: string; onClose: () => void }) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; event: DocOf<Event> } | { kind: 'failed'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { readEvent } = await import('./admin');
        const event = await readEvent(id);
        if (!alive) return;
        setState(
          event
            ? { kind: 'ready', event }
            : { kind: 'failed', message: 'That event is not in the calendar any more.' },
        );
      } catch (error) {
        if (!alive) return;
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Could not read that event.',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (state.kind === 'loading') {
    return (
      <PageBody flush>
        <p className="note">Opening…</p>
      </PageBody>
    );
  }

  if (state.kind === 'failed') {
    return (
      <PageBody flush>
        <div className="notice notice--alarm" role="alert">
          <h2>Could not open that event</h2>
          <p>{state.message}</p>
          <p>
            <button type="button" className="button button--quiet" onClick={onClose}>
              Back to the list
            </button>
          </p>
        </div>
      </PageBody>
    );
  }

  return (
    <EventEditor
      baked={state.event}
      /* Nothing above this needs the saved document — the list is re-read when
         Done takes us back to it. */
      onSaved={() => undefined}
      onDone={onClose}
      back={{ href: '/staff/events', label: 'Events and drafts' }}
    />
  );
}
