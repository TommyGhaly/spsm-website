'use client';

/**
 * Making an event: a name, a day, and nothing else.
 *
 * ## Why it asks for exactly two things
 *
 * Because those are the two the document cannot exist without. The slug is
 * derived from the name and is settled for good at this moment — it is the public
 * URL, the value `generateStaticParams` enumerates, and the folder the
 * photograph is filed under — and `startAt` is a required instant with no
 * sensible default, since guessing "today" produces a plausible wrong date, which
 * is worse than a blank one.
 *
 * Everything else is filled in on the event's own editor, where you can see what
 * it looks like. A create form that asks for the description is a form somebody
 * abandons in the church hall.
 *
 * **It is public from the moment this returns**, since there is no draft state any
 * more. That is why the panel says so: an event named and dated here is on the
 * parish calendar at the next build, description or no description.
 *
 * ## The slug is checked before the write, not after
 *
 * Two events with the same slug emit the same route twice, and
 * `generateStaticParams` de-duplicates — so one of the two silently stops having
 * a page. The failure is invisible until somebody follows a link, which makes it
 * exactly the kind of thing to refuse up front.
 */

import { useState } from 'react';
import { PARISH_TIME_ZONE } from '@/lib/dates';
import { Cols, Group } from './EditorParts';

type State =
  | { kind: 'asking' }
  | { kind: 'making' }
  | { kind: 'failed'; message: string };

export function NewEvent({
  onCreated,
  onCancel,
}: {
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [state, setState] = useState<State>({ kind: 'asking' });

  const ready = title.trim().length > 0 && date.length > 0;

  async function create() {
    if (!ready) return;
    setState({ kind: 'making' });
    try {
      const [{ createEvent, slugTaken, slugify }, { wallClockToInstant }, { auth }] =
        await Promise.all([import('./admin'), import('@spsm/shared'), import('@/lib/auth')]);

      const slug = slugify(title);
      if (!slug) {
        setState({
          kind: 'failed',
          message:
            'That name does not make a usable web address. Use some letters or numbers in it.',
        });
        return;
      }
      if (await slugTaken(slug)) {
        setState({
          kind: 'failed',
          message: `There is already an event at /events/${slug}. Give this one a different name.`,
        });
        return;
      }

      /*
       * Midnight in the parish's zone, not `new Date(date)`. The bare string
       * parses as UTC, which on the American east coast is the *previous* day
       * for the first five hours — so a festival created for the 3rd would land
       * on the 2nd in every calendar cell on the site.
       */
      const startAt = wallClockToInstant(`${date}T00:00`, PARISH_TIME_ZONE);
      if (!startAt) {
        setState({ kind: 'failed', message: 'That is not a date the calendar can read.' });
        return;
      }

      const id = await createEvent(
        slug,
        {
          title: title.trim(),
          summary: '',
          body: '',
          startAt,
          endAt: null,
          // All day until somebody says otherwise. The alternative is inventing
          // a time, and a wrong time on the calendar is worse than none.
          allDay: true,
          timeZone: PARISH_TIME_ZONE,
          location: null,
          heroImagePath: null,
          category: 'other',
          tags: [],
          audience: 'parish',
          registrationUrl: null,
        },
        auth().currentUser?.uid ?? null,
      );

      onCreated(id);
    } catch (error) {
      setState({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Could not create the event.',
      });
    }
  }

  return (
    <section className="staff-new">
      <h2>A new event</h2>
      <p className="staff-new__note">
        It goes on the parish calendar straight away — there is no draft step. You can
        change the name later; the web address, no.
      </p>

      <Cols>
        <Group label="What is it called?">
          <input
            name="newTitle"
            size={1}
            value={title}
            autoFocus
            placeholder="Egyptian Coptic Festival"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ready) void create();
            }}
          />
        </Group>
        <Group label="Which day?" hint="You can add times on the next screen.">
          <input
            name="newDate"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Group>
      </Cols>

      {state.kind === 'failed' && (
        <p className="ee-group__error" role="alert">
          {state.message}
        </p>
      )}

      <div className="staff-new__actions">
        <button
          type="button"
          className="button"
          disabled={!ready || state.kind === 'making'}
          onClick={() => void create()}
        >
          {state.kind === 'making' ? 'Creating…' : 'Create and open it'}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
