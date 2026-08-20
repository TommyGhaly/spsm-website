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
  deleteEventHero,
  listEventsForAdmin,
  listProgramLinkTargets,
  setProgramLink,
  slugify,
  updateEvent,
  uploadEventHero,
  type EventDraft,
  type ProgramLinkTarget,
} from '@/features/events/admin';
import { auth } from '@/lib/auth';
import { publicStorageUrl } from '@/lib/storage';
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
 *
 * Two fields do not behave like the rest, and both are called out where they are
 * rendered:
 *
 *   - **the photograph** is written to Cloud Storage the moment it is chosen,
 *     before the form is submitted, because an upload is slow and a save should
 *     not be. The document holds a path; the bytes are already there.
 *   - **the ministry link** is stored on the `programEvents` document rather
 *     than on this one, and needs a permission this screen does not otherwise
 *     require. It can therefore fail on its own, after the event has saved
 *     perfectly well, which is why it reports separately.
 */

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };
type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /**
   * `linkWarning` is the case where the event saved and the ministry link did
   * not. Reporting that as an error would be a lie about the event, and
   * reporting it as success would be a lie about the link.
   */
  | { kind: 'saved'; at: number; linkWarning: string | null }
  | { kind: 'error'; message: string };

/** What the photograph field is doing, which the save button has to wait for. */
type HeroStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
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
  /** A Storage path under `events/`, already uploaded. Never a URL. */
  heroImagePath: string | null;
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
  heroImagePath: null,
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
    heroImagePath: event.heroImagePath ?? null,
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
    heroImagePath: form.heroImagePath,
  };
}

/**
 * Whether a write was refused by `firestore.rules`.
 *
 * Reads `FirebaseError.code`, not the message, and that is the whole point of
 * the helper. Matching `message.includes('permission')` looked right and was
 * wrong twice over: the SDK's message is upper-cased (`PERMISSION_DENIED`), so
 * the lowercase test never matched — and what it let through instead was the
 * rules engine's own diagnostic, `evaluation error at L429:24 for 'update' @
 * L429, false for 'update' @ L515`, shown verbatim to a volunteer who had in
 * fact done nothing wrong. Caught only by signing in as `staff` and trying it.
 *
 * `code` is a documented, stable string. The message is a debugging aid that
 * belongs in a console.
 */
function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code.includes('permission-denied')) return true;
  // Belt to that braces: a rejection that arrives as a plain Error, or wrapped
  // by something between here and the SDK, still reads correctly.
  return error instanceof Error && /permission[_-]denied/i.test(error.message);
}

/**
 * The link options as `<optgroup>`s.
 *
 * `listProgramLinkTargets` already sorts by ministry then title, so this only
 * has to break the run rather than sort again — and consecutive grouping is what
 * keeps the order the caller chose instead of reimposing a map's.
 */
function groupByProgram(targets: ProgramLinkTarget[]): [string, ProgramLinkTarget[]][] {
  const groups: [string, ProgramLinkTarget[]][] = [];
  for (const target of targets) {
    const last = groups[groups.length - 1];
    if (last && last[0] === target.programName) last[1].push(target);
    else groups.push([target.programName, [target]]);
  }
  return groups;
}

export function EventsAdmin() {
  const [events, setEvents] = useState<DocOf<Event>[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [form, setForm] = useState<FormState>(BLANK);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [slugTouched, setSlugTouched] = useState(false);
  const [hero, setHero] = useState<HeroStatus>({ kind: 'idle' });

  /**
   * The ministry occurrences an event can be filed under.
   *
   * Null while loading and `[]` when there are none — told apart, because "no
   * ministry has a camp set up yet" is a sentence worth writing and "still
   * loading" is not. A failure here is not fatal: the picker disappears and
   * everything else on the form still works.
   */
  const [links, setLinks] = useState<ProgramLinkTarget[] | null>(null);
  const [linkChoice, setLinkChoice] = useState('');

  const reload = useCallback(async () => {
    try {
      setEvents(await listEventsForAdmin());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load events.');
    }
  }, []);

  const reloadLinks = useCallback(async () => {
    try {
      setLinks(await listProgramLinkTargets());
    } catch (error) {
      console.error('[events] could not load the ministry occurrences:', error);
      setLinks([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    void reloadLinks();
  }, [reload, reloadLinks]);

  /**
   * The picker's value is *derived*, not typed into and remembered.
   *
   * It lives outside `FormState` because the link is not a field on this
   * document — it is a field on the `programEvents` document pointing back. So
   * the truth is in `links`, and this re-reads it whenever the selection changes
   * or the list arrives. Putting it in `FormState` meant `edit()` had to know
   * the links were already loaded, and on a cold open they were not.
   */
  /**
   * The event being edited, or null for an unsaved one.
   *
   * Named separately because the two ids in play here are easy to mix up, and
   * mixing them up is a bug that looks like a working screen: `calendarEventId`
   * on a `ProgramEvent` holds an **event** id, while `linkChoice` and
   * `linkedNow` hold a **programEvent** id. Comparing one to the other marked
   * every event's own occurrence as belonging to somebody else.
   */
  const currentEventId = selection.kind === 'existing' ? selection.id : null;

  const linkedNow =
    links?.find((target) => target.calendarEventId === currentEventId && currentEventId !== null)
      ?.programEventId ?? null;

  useEffect(() => {
    setLinkChoice(linkedNow ?? '');
  }, [linkedNow, selection]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function startNew() {
    setSelection({ kind: 'new' });
    setForm(BLANK);
    setErrors([]);
    setSlugTouched(false);
    setStatus({ kind: 'idle' });
    setHero({ kind: 'idle' });
  }

  function edit(event: DocOf<Event>) {
    setSelection({ kind: 'existing', id: event.id });
    setForm(fromEvent(event));
    setErrors([]);
    // Never regenerate the slug of something already published — it is the
    // public URL, and anything already shared points at it.
    setSlugTouched(true);
    setStatus({ kind: 'idle' });
    setHero({ kind: 'idle' });
  }

  /**
   * Chosen a photograph.
   *
   * Uploaded here rather than on submit, which is the decision worth
   * understanding: a 6MB photograph over parish wifi is tens of seconds, and
   * hanging that off the save button means a volunteer presses Save, sees
   * nothing happen, and presses it again. Uploading on choose puts the wait
   * where the person is already looking at the thing they just picked, and by
   * the time they finish the rest of the form it is done.
   *
   * The consequence, stated rather than discovered: an upload that is never
   * saved leaves an orphan object in the bucket. That is the trade — a stray
   * file nobody sees, against a save that appears to hang.
   */
  async function onPickHero(file: File | null) {
    if (!file) return;

    setHero({ kind: 'uploading' });
    const previous = form.heroImagePath;

    try {
      const path = await uploadEventHero(file, form.slug);
      set('heroImagePath', path);
      setHero({ kind: 'idle' });
      // Only after the new path is in hand: a failed upload must not take the
      // existing photograph with it.
      if (previous) void deleteEventHero(previous);
    } catch (error) {
      setHero({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The upload failed.',
      });
    }
  }

  /**
   * Takes the photograph off the form, and the object out of the bucket.
   *
   * The bucket delete happens now rather than on save. It is the same trade as
   * the upload above, the other way round: worst case somebody clears an image,
   * abandons the form, and the document still names a file that is gone — which
   * the event page already renders as "no photograph", because a hero that 404s
   * and a hero that is null have to look the same anyway.
   */
  function onClearHero() {
    const path = form.heroImagePath;
    set('heroImagePath', null);
    setHero({ kind: 'idle' });
    if (path) void deleteEventHero(path);
  }

  async function onSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();

    const found = validate(form);
    setErrors(found);
    if (found.length > 0) return;

    setStatus({ kind: 'saving' });
    try {
      const uid = auth().currentUser?.uid ?? null;
      let id: string;
      if (selection.kind === 'existing') {
        id = selection.id;
        await updateEvent(id, toDraft(form), uid);
      } else {
        id = await createEvent(toDraft(form), uid);
        setSelection({ kind: 'existing', id });
      }

      /*
       * The link is a separate write to a separate collection, attempted only
       * when it has actually changed — so simply re-saving an event does not
       * touch a `programEvent` the editor may have no permission for.
       *
       * Its failure is caught here rather than by the outer handler on purpose.
       * The event is already saved at this point; letting a permission error on
       * somebody else's ministry document surface as "That didn't save" would
       * send the editor back to re-type a form that is safely stored.
       */
      let linkWarning: string | null = null;
      const chosen = linkChoice || null;
      if (chosen !== linkedNow) {
        try {
          await setProgramLink(id, chosen, linkedNow);
          await reloadLinks();
        } catch (error) {
          linkWarning = isPermissionDenied(error)
            ? 'The event saved, but it could not be filed under that ministry — that needs ' +
              'a grant on the ministry itself, which the events role does not include. ' +
              'Ask an administrator to link it, or to give you the ministry.'
            : `The event saved, but the ministry link did not: ${
                error instanceof Error ? error.message : 'unknown error'
              }`;
        }
      }

      await reload();
      setStatus({ kind: 'saved', at: Date.now(), linkWarning });
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
      /*
       * Unpick the ministry link *before* the event goes, or a `programEvent` is
       * left pointing at a document that no longer exists — which renders on the
       * gallery page as a link to a 404. Best effort: an editor without a grant
       * on that ministry can still delete an event, and being unable to tidy the
       * pointer must not stop them.
       */
      if (linkedNow) {
        await setProgramLink(selection.id, null, linkedNow).catch((error: unknown) => {
          console.warn('[events] could not clear the ministry link:', error);
        });
      }
      if (form.heroImagePath) await deleteEventHero(form.heroImagePath);

      await deleteEvent(selection.id);
      await reload();
      await reloadLinks();
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
                {status.linkWarning && <p className="note">{status.linkWarning}</p>}
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

            {/*
              The photograph.
              
              Its own fieldset rather than a field inside "What it is", because
              it behaves differently from everything around it: choosing a file
              uploads it immediately, so this is the one control on the form that
              does something before Save is pressed. Grouping it with the title
              and the description would suggest otherwise.
            */}
            <fieldset>
              <legend>Photograph</legend>

              {form.heroImagePath ? (
                <div className="hero-field">
                  {/*
                    A plain `img`, not `next/image`. Under `output: 'export'`
                    there is no image optimiser at runtime, and the source is a
                    Storage URL this build has never seen — the loader would have
                    to be told the bucket is a remote pattern, to no benefit for
                    one thumbnail on a staff-only screen.
                  */}
                  <img
                    className="hero-field__preview"
                    src={publicStorageUrl(form.heroImagePath)}
                    alt="The photograph chosen for this event"
                  />
                  <div className="hero-field__side">
                    <p className="note">
                      Shown at the top of the event&apos;s own page. It is not used on the
                      calendar, where a picture in a date cell would crowd out the times.
                    </p>
                    <button className="button button--quiet" type="button" onClick={onClearHero}>
                      Remove photograph
                    </button>
                  </div>
                </div>
              ) : (
                <label className="field">
                  <span>Choose an image</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={hero.kind === 'uploading' || !form.slug}
                    onChange={(e) => {
                      void onPickHero(e.target.files?.[0] ?? null);
                      // Cleared so choosing the same file twice, after a failed
                      // upload, still fires a change event.
                      e.target.value = '';
                    }}
                  />
                  <small>
                    {form.slug
                      ? 'JPEG, PNG, or WebP, up to 8MB. A wide photograph works best — it is shown across the top of the page. It uploads as soon as you choose it.'
                      : 'Give the event a title first, so the photograph has somewhere to go.'}
                  </small>
                </label>
              )}

              {hero.kind === 'uploading' && (
                <p className="note" role="status">
                  Uploading…
                </p>
              )}

              {hero.kind === 'error' && (
                <div className="notice notice--alarm" role="alert">
                  <p>{hero.message}</p>
                </div>
              )}
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

              {/*
                Filing an event under a ministry.
                
                Written to the *ministry occurrence*, not to this event — see
                `setProgramLink`. That is why the option list can be shorter than
                an administrator expects and why saving it can fail on its own:
                both are the permission on the ministry, not on the event.
                
                Only occurrences that are free, or already this event's, are
                offered. One already spoken for by another event is shown as
                taken rather than hidden, so it is clear why it cannot be picked.
              */}
              {links !== null && links.length > 0 && (
                <label className="field">
                  <span>Part of a ministry</span>
                  <select value={linkChoice} onChange={(e) => setLinkChoice(e.target.value)}>
                    <option value="">Not part of a ministry</option>
                    {groupByProgram(links).map(([programName, targets]) => (
                      <optgroup key={programName} label={programName}>
                        {targets.map((target) => {
                          /*
                            Compared against the *event* id, not `linkedNow` —
                            see `currentEventId`. Against `linkedNow` this was
                            true for the occurrence the open event is already
                            linked to, which disabled its own selected option and
                            made the link impossible to restore once changed.
                          */
                          const takenBy =
                            target.calendarEventId !== null &&
                            target.calendarEventId !== currentEventId;
                          return (
                            <option
                              key={target.programEventId}
                              value={target.programEventId}
                              disabled={takenBy}
                            >
                              {target.title}
                              {takenBy ? ' — already linked to another event' : ''}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                  <small>
                    Puts a link to this date on the ministry&apos;s gallery page. It does not
                    move the event off the parish calendar.
                  </small>
                </label>
              )}

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
              {/*
                Also disabled while a photograph is uploading. Saving mid-upload
                would write the *previous* path — or none — and leave the finished
                object orphaned, with the form showing an image the document does
                not have.
              */}
              <button
                className="button"
                type="submit"
                disabled={status.kind === 'saving' || hero.kind === 'uploading'}
              >
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
