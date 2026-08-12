'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMMON_TIME_ZONES,
  EVENT_AUDIENCES,
  EVENT_CATEGORIES,
  instantToWallClock,
  toDate,
  wallClockToInstant,
  zoneAbbreviation,
  type DocOf,
  type Event,
  type EventAudience,
  type EventCategory,
} from '@spsm/shared';
import {
  createEvent,
  deleteEvent,
  listEventsForAdmin,
  slugify,
  updateEvent,
  type EventDraft,
} from '@/features/events/admin';
import { auth } from '@/lib/auth';
import { PARISH_TIME_ZONE, formatEventWhen } from '@/lib/dates';

/**
 * The events admin.
 *
 * One page, deliberately: a list on the left, a form on the right, and no
 * dynamic route for the selected record. `firebase.json` has no catch-all
 * rewrite, so `/admin/events/some-id` would 404 on a hard refresh unless the
 * export emitted that exact file — which it cannot, because the ids do not
 * exist at build time. Selection is component state instead.
 *
 * Times are the part worth reading carefully. Staff type a wall-clock reading
 * and pick a zone; `wallClockToInstant` turns that into the instant stored in
 * `startAt`, and the zone is stored beside it in `timeZone` because the parish's
 * intent ("9am") survives DST while an offset does not.
 */

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

/** Form state is all strings — it mirrors the inputs, not the document. */
interface FormState {
  slug: string;
  title: string;
  summary: string;
  body: string;
  startWall: string;
  endWall: string;
  allDay: boolean;
  timeZone: string;
  locationName: string;
  locationAddress: string;
  meetingUrl: string;
  category: EventCategory;
  audience: EventAudience;
  tags: string;
  registrationUrl: string;
  published: boolean;
}

const BLANK: FormState = {
  slug: '',
  title: '',
  summary: '',
  body: '',
  startWall: '',
  endWall: '',
  allDay: false,
  timeZone: PARISH_TIME_ZONE,
  locationName: '',
  locationAddress: '',
  meetingUrl: '',
  category: 'other',
  audience: 'parish',
  tags: '',
  registrationUrl: '',
  published: false,
};

function fromEvent(event: DocOf<Event>): FormState {
  const zone = event.timeZone || PARISH_TIME_ZONE;
  const start = toDate(event.startAt);
  const end = toDate(event.endAt);

  return {
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    body: event.body,
    startWall: start ? instantToWallClock(start, zone) : '',
    endWall: end ? instantToWallClock(end, zone) : '',
    allDay: event.allDay,
    timeZone: zone,
    locationName: event.location?.name ?? '',
    locationAddress: event.location?.address ?? '',
    meetingUrl: event.location?.meetingUrl ?? '',
    category: event.category,
    audience: event.audience,
    tags: event.tags.join(', '),
    registrationUrl: event.registration?.externalUrl ?? '',
    published: event.published,
  };
}

function validate(form: FormState): string[] {
  const errors: string[] = [];

  if (!form.title.trim()) errors.push('Give the event a title.');
  if (!form.summary.trim()) errors.push('Write a one-line summary — it shows on the calendar.');
  if (!form.body.trim()) errors.push('Write the event description.');

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(form.slug)) {
    errors.push('The web address may only use lowercase letters, numbers, and hyphens.');
  }

  const start = wallClockToInstant(form.startWall, form.timeZone);
  if (!start) errors.push('Set a start date and time.');

  if (form.endWall) {
    const end = wallClockToInstant(form.endWall, form.timeZone);
    if (!end) errors.push('The end time is not a valid date.');
    else if (start && end.getTime() < start.getTime()) {
      errors.push('The event ends before it starts.');
    }
  }

  if (form.registrationUrl && !/^https?:\/\//.test(form.registrationUrl)) {
    errors.push('The registration link must start with http:// or https://');
  }

  return errors;
}

function toDraft(form: FormState): EventDraft {
  const startAt = wallClockToInstant(form.startWall, form.timeZone);
  if (!startAt) throw new Error('Start time is invalid.');

  return {
    slug: form.slug,
    title: form.title.trim(),
    summary: form.summary.trim(),
    body: form.body.trim(),
    startAt,
    endAt: form.endWall ? wallClockToInstant(form.endWall, form.timeZone) : null,
    allDay: form.allDay,
    timeZone: form.timeZone,
    location: form.locationName.trim()
      ? {
          name: form.locationName.trim(),
          address: form.locationAddress.trim() || null,
          meetingUrl: form.meetingUrl.trim() || null,
        }
      : null,
    category: form.category,
    audience: form.audience,
    tags: form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    published: form.published,
    registrationUrl: form.registrationUrl.trim() || null,
  };
}

export function EventsAdmin() {
  const [events, setEvents] = useState<DocOf<Event>[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [slugTouched, setSlugTouched] = useState(false);

  const reload = useCallback(async () => {
    try {
      setEvents(await listEventsForAdmin());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load events.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function startNew() {
    setSelection({ kind: 'new' });
    setForm(BLANK);
    setErrors([]);
    setSlugTouched(false);
    setStatus({ kind: 'idle' });
  }

  function edit(event: DocOf<Event>) {
    setSelection({ kind: 'existing', id: event.id });
    setForm(fromEvent(event));
    setErrors([]);
    // Never regenerate the slug of something already published — it is the
    // public URL, and anything already shared points at it.
    setSlugTouched(true);
    setStatus({ kind: 'idle' });
  }

  async function onSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();

    const found = validate(form);
    setErrors(found);
    if (found.length > 0) return;

    setStatus({ kind: 'saving' });
    try {
      const uid = auth().currentUser?.uid ?? null;
      if (selection.kind === 'existing') {
        await updateEvent(selection.id, toDraft(form), uid);
      } else {
        const id = await createEvent(toDraft(form), uid);
        setSelection({ kind: 'existing', id });
      }
      await reload();
      setStatus({ kind: 'saved', at: Date.now() });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save.',
      });
    }
  }

  async function onDelete() {
    if (selection.kind !== 'existing') return;
    if (!confirm('Delete this event? This cannot be undone.')) return;

    setStatus({ kind: 'saving' });
    try {
      await deleteEvent(selection.id);
      await reload();
      setSelection({ kind: 'none' });
      setForm(BLANK);
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not delete.',
      });
    }
  }

  // Shown next to the time inputs so a DST mistake is visible while it is being
  // made, rather than on the morning of the event.
  const zoneHint = useMemo(() => {
    const instant = wallClockToInstant(form.startWall, form.timeZone);
    return instant ? zoneAbbreviation(instant, form.timeZone) : '';
  }, [form.startWall, form.timeZone]);

  return (
    <div className="admin-split">
      <section className="admin-list">
        <div className="admin-list__head">
          <h1>Events</h1>
          <button className="button" type="button" onClick={startNew}>
            New event
          </button>
        </div>

        {loadError && (
          <div className="notice notice--alarm" role="alert">
            <h2>Could not load events</h2>
            <p>{loadError}</p>
          </div>
        )}

        {events === null && !loadError && <p className="note">Loading…</p>}

        {events?.length === 0 && (
          <p className="note">
            Nothing on the calendar yet. Add the festival, the camp, the classes — not the
            weekly liturgies.
          </p>
        )}

        <ul className="admin-list__items">
          {events?.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                className={
                  selection.kind === 'existing' && selection.id === event.id
                    ? 'admin-item admin-item--current'
                    : 'admin-item'
                }
                onClick={() => edit(event)}
              >
                <strong>{event.title || '(untitled)'}</strong>
                <span className="meta">
                  {formatEventWhen(
                    event.startAt,
                    event.endAt,
                    event.allDay,
                    event.timeZone || PARISH_TIME_ZONE,
                  )}
                </span>
                <span className={event.published ? 'tag tag--live' : 'tag'}>
                  {event.published ? 'Published' : 'Draft'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="admin-form">
        {selection.kind === 'none' ? (
          <p className="note">Choose an event to edit, or start a new one.</p>
        ) : (
          <form className="form" onSubmit={onSubmit} noValidate>
            {errors.length > 0 && (
              <div className="notice notice--alarm" role="alert">
                <h2>Please check the following</h2>
                <ul>
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {status.kind === 'error' && (
              <div className="notice notice--alarm" role="alert">
                <h2>That didn&apos;t save</h2>
                <p>{status.message}</p>
              </div>
            )}

            {status.kind === 'saved' && (
              <div className="notice" role="status">
                <p>
                  Saved. It appears on the website at the next build — usually within about
                  ten minutes.
                </p>
              </div>
            )}

            <fieldset>
              <legend>What it is</legend>

              <label className="field">
                <span>
                  Title <abbr title="required">*</abbr>
                </span>
                <input
                  value={form.title}
                  onChange={(e) => {
                    set('title', e.target.value);
                    if (!slugTouched) set('slug', slugify(e.target.value));
                  }}
                  required
                />
              </label>

              <label className="field">
                <span>
                  Web address <abbr title="required">*</abbr>
                </span>
                <input
                  value={form.slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set('slug', e.target.value);
                  }}
                  required
                />
                <small>
                  spsmwayland.org/events/<strong>{form.slug || '…'}</strong>
                  {selection.kind === 'existing' &&
                    ' — changing this breaks any link already shared.'}
                </small>
              </label>

              <label className="field">
                <span>
                  Summary <abbr title="required">*</abbr>
                </span>
                <input
                  value={form.summary}
                  onChange={(e) => set('summary', e.target.value)}
                  maxLength={200}
                  required
                />
                <small>One line. Shows on the calendar and the homepage.</small>
              </label>

              <label className="field">
                <span>
                  Description <abbr title="required">*</abbr>
                </span>
                <textarea
                  value={form.body}
                  onChange={(e) => set('body', e.target.value)}
                  rows={10}
                  required
                />
                <small>
                  Markdown works: <code>## Heading</code>, <code>**bold**</code>,{' '}
                  <code>- list</code>, <code>[link](https://…)</code>.
                </small>
              </label>
            </fieldset>

            <fieldset>
              <legend>When</legend>

              <label className="field field--check">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(e) => set('allDay', e.target.checked)}
                />
                <span>All day — don&apos;t show a time</span>
              </label>

              <div className="field-row">
                <label className="field">
                  <span>
                    Starts <abbr title="required">*</abbr>
                  </span>
                  <input
                    type="datetime-local"
                    value={form.startWall}
                    onChange={(e) => set('startWall', e.target.value)}
                    required
                  />
                </label>

                <label className="field">
                  <span>Ends</span>
                  <input
                    type="datetime-local"
                    value={form.endWall}
                    onChange={(e) => set('endWall', e.target.value)}
                  />
                  <small>Leave blank if it&apos;s open-ended.</small>
                </label>

                <label className="field field--narrow">
                  <span>Time zone</span>
                  <select value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)}>
                    {COMMON_TIME_ZONES.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                  {zoneHint && <small>Saves as {zoneHint}.</small>}
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Where</legend>

              <label className="field">
                <span>Place</span>
                <input
                  value={form.locationName}
                  onChange={(e) => set('locationName', e.target.value)}
                  placeholder="The church hall"
                />
              </label>

              <div className="field-row">
                <label className="field">
                  <span>Address</span>
                  <input
                    value={form.locationAddress}
                    onChange={(e) => set('locationAddress', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Online link</span>
                  <input
                    value={form.meetingUrl}
                    onChange={(e) => set('meetingUrl', e.target.value)}
                    placeholder="https://…"
                  />
                </label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Filing and sign-ups</legend>

              <div className="field-row">
                <label className="field">
                  <span>Category</span>
                  <select
                    value={form.category}
                    onChange={(e) => set('category', e.target.value as EventCategory)}
                  >
                    {EVENT_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Who it&apos;s for</span>
                  <select
                    value={form.audience}
                    onChange={(e) => set('audience', e.target.value as EventAudience)}
                  >
                    {EVENT_AUDIENCES.map((audience) => (
                      <option key={audience} value={audience}>
                        {audience}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="field">
                <span>Tags</span>
                <input
                  value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="youth, outreach"
                />
                <small>Comma separated.</small>
              </label>

              <label className="field">
                <span>Registration link</span>
                <input
                  value={form.registrationUrl}
                  onChange={(e) => set('registrationUrl', e.target.value)}
                  placeholder="https://…"
                />
                <small>
                  An external sign-up page. Built-in forms aren&apos;t available yet.
                </small>
              </label>
            </fieldset>

            <fieldset>
              <legend>Publishing</legend>
              <label className="field field--check">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) => set('published', e.target.checked)}
                />
                <span>Published — visible on the website</span>
              </label>
              <p className="note">
                Unpublished events stay here and never reach the public site. There is no
                scheduled publishing yet: it goes live at the next build after you tick this.
              </p>
            </fieldset>

            <div className="admin-actions">
              <button className="button" type="submit" disabled={status.kind === 'saving'}>
                {status.kind === 'saving' ? 'Saving…' : 'Save event'}
              </button>
              {selection.kind === 'existing' && (
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => void onDelete()}
                  disabled={status.kind === 'saving'}
                >
                  Delete
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
