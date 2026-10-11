'use client';

/**
 * The event page, editable.
 *
 * ## The rule this is built to
 *
 * **The editor is the page with editable words in it, not the page with a form
 * over it.** The title is the `h1`. The date line is the date line. The
 * description is the paragraph. Where a control has to exist that the page has
 * no place for — a category, a sign-up link — it goes below the rule, in a
 * folded sheet, and is named as something the page does not show.
 *
 * That is what the version before this one was for as well, and it did not
 * achieve it, for one measurable reason: its fields ran the full 1200px of the
 * window while the page they edited is a 68ch reading column. Everything else —
 * a title in a 1216x120 grey box, labels above words that already labelled
 * themselves — followed from that. So the single most important line in this
 * file is that the editing surface is inside the same `PageBody` the read-only
 * page uses, and inherits the same measure.
 *
 * ## One Save, like every editor on the site
 *
 * Changes are held until Save changes in the bar is pressed, and Discard puts
 * the event back as it was saved. This replaced autosave (which had itself
 * replaced a draft-and-publish model) when Tommy asked for every admin editor to
 * save the way the bookstore panel does. There is still no draft and no publish
 * step: Save writes the event, and the event is what the page and the mobile app
 * show. Leaving with unsaved changes is refused by Done and warned by the
 * browser.
 *
 * The one exception is the photograph, which is written as soon as it is chosen
 * or removed — on top of what is *saved*, never taking the unsaved words with
 * it — because the file in storage and the document naming it must not
 * disagree. See `settleHero`.
 *
 * There is still no way to take an event off the website except deleting it.
 *
 * ## The document is re-read on the way in
 *
 * This page's HTML is baked at build time, so the copy it renders can be days
 * old, and every save writes every field. Editing from the baked copy would
 * silently revert anything changed since the build.
 */

import { useCallback, useEffect, useState } from 'react';
/*
 * The form model is `@spsm/shared`'s now, not this folder's.
 *
 * It was `./form` until the mobile app grew an editor for the same document.
 * Two copies of "what counts as a mistake" is two answers to it, so the state,
 * the wall-clock arithmetic, the validation and the words for the enums moved
 * to `packages/shared/src/eventForm.ts` and both surfaces import them. What
 * stays on each side is the drawing.
 */
import {
  EVENT_AUDIENCE_LABELS,
  EVENT_AUDIENCE_OPTIONS,
  EVENT_CATEGORY_LABELS,
  EVENT_CATEGORY_OPTIONS,
  eventMistakes,
  eventStillMissing,
  eventToForm,
  formToDraft,
  startInstantOf,
  type DocOf,
  type Event,
  type EventAudience,
  type EventCategory,
  type EventFieldKey,
  type EventFormState,
} from '@spsm/shared';
import { useEditMode } from '@/features/programs/editMode';
import { PageBody } from '@/components/PageBody';
import { Icon } from '@/components/Icon';
import { BackLink } from '@/components/BackLink';
import { Plain } from '@/components/Inline';
import { Cols, Group, Segmented, TagField } from './EditorParts';
import { HeroBand, type HeroStatus } from './HeroBand';
import { WhenLine } from './WhenLine';
import { BodyField } from './BodyField';
import { EditorBar } from './EditorBar';
import { EditTabPanel, EditTabs } from '@/components/EditTabs';

/** Which tab below the heading is open, and the fields each one holds. */
type Tab = 'page' | 'filing';
const TAB_FIELDS: Record<Tab, readonly (keyof EventFormState)[]> = {
  page: ['body', 'summary'],
  filing: ['category', 'audience', 'tags', 'registrationUrl', 'meetingUrl'],
};

/** How long the undo offer stands after a delete. */
const UNDO_MS = 12_000;

/**
 * How recent a file has to be for the editor's tidying sweep to leave it alone.
 *
 * Generous on purpose. The sweep is looking for objects that have been stranded
 * for months, so sparing the last quarter of an hour costs it nothing — and what
 * it buys is that no sequence of opening the editor and immediately choosing a
 * photograph can end with that photograph deleted. See `sweepEventFiles`.
 */
const TIDY_GRACE_MS = 15 * 60_000;

type Load =
  | { kind: 'reading' }
  | { kind: 'ready' }
  | { kind: 'gone' }
  | { kind: 'failed'; message: string };

type Removal =
  | { kind: 'no' }
  /** Deleted, undo still on offer. `data` is everything needed to put it back. */
  | { kind: 'undoable'; data: Record<string, unknown>; until: number }
  | { kind: 'final' };

export function EventEditor({ baked, onSaved }: {
  baked: DocOf<Event>;
  /**
   * Hands the saved document back up to the page, after every write.
   *
   * Without it, pressing Done shows the *baked* copy again — the words that were
   * in this page's exported HTML at the last build — and the edit appears lost.
   * The read-only page owns the document it renders, so it is the thing that has
   * to be told.
   *
   * It fires after every Save and every photograph change, so Done is never a
   * step backwards.
   */
  onSaved: (event: DocOf<Event>) => void;
}) {
  const edit = useEditMode();

  const [live, setLive] = useState<DocOf<Event>>(baked);
  const [form, setForm] = useState<EventFormState>(() => eventToForm(baked));
  const [load, setLoad] = useState<Load>({ kind: 'reading' });
  const [hero, setHero] = useState<HeroStatus>({ kind: 'idle' });
  const [tab, setTab] = useState<Tab>('page');
  /* What is written, so the form can be compared against it and put back. */
  const [saved, setSaved] = useState<EventFormState>(() => eventToForm(baked));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<Removal>({ kind: 'no' });

  const set = useCallback(<K extends keyof EventFormState>(key: K, value: EventFormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  /* ---- writing --------------------------------------------------------- */

  const save = useCallback(
    async (value: EventFormState) => {
      const draft = formToDraft(value);
      if (!draft) return;
      const [{ updateEventContent }, { auth }] = await Promise.all([
        import('./admin'),
        import('@/lib/auth'),
      ]);
      await updateEventContent(live.id, draft, auth().currentUser?.uid ?? null);

      /*
       * The local copy is advanced by hand rather than re-read. `updateEventContent`
       * stamps `updatedAt: serverTimestamp()`, so reading back would be a round trip
       * for a field nothing here shows — and every value that *is* shown is one that
       * was just sent.
       */
      const { registrationUrl, startAt, endAt, ...rest } = draft;
      setLive((previous) => ({
        ...previous,
        ...rest,
        startAt: startAt.toISOString(),
        endAt: endAt ? endAt.toISOString() : null,
        // `registrationUrl` is the editor's shape, not the document's — pulled
        // out of the spread above so it cannot ride along as a stray key.
        registration: registrationUrl
          ? {
              formId: null,
              externalUrl: registrationUrl,
              opensAt: null,
              closesAt: null,
              capacity: null,
            }
          : null,
      }));
    },
    [live.id],
  );

  /*
   * Telling the page underneath what the editor now holds.
   *
   * An effect, and it used to be a call to `onSaved` from *inside* the
   * `setLive` updater above — which React objects to out loud: "Cannot update a
   * component (`Article`) while rendering a different component
   * (`EventEditor`)". An updater is not a place for side effects. It runs during
   * render, it runs twice under StrictMode, and React may discard and re-run it,
   * so a parent's `setState` fired from in there happens an unpredictable number
   * of times at a moment the parent is not expecting to hear from anybody. Same
   * class of trap as [[spsm-react-strictmode-doubles-updaters]].
   *
   * The effect says the same thing at the only moment it is true: after the
   * render in which `live` changed has committed. It also fires once on mount
   * with the baked copy, which is a `setState` to the value the parent already
   * holds — React bails out of that without re-rendering.
   */
  useEffect(() => {
    onSaved(live);
  }, [live, onSaved]);

  /* ---- reading the real document ------------------------------------- */

  /*
   * What Firestore actually holds replaces the baked copy — possibly days old —
   * and becomes what counts as saved, so opening an event never shows it as
   * changed.
   */
  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'reading' });

    void (async () => {
      try {
        /*
         * Dynamic, and it has to be: `./admin` reaches `lib/firebase`, and a
         * static import would put the Firestore SDK in the chunk this public
         * page loads for every parishioner.
         */
        const { readEvent } = await import('./admin');
        const fresh = await readEvent(baked.id);
        if (!alive) return;
        if (!fresh) {
          setLoad({ kind: 'gone' });
          return;
        }
        const loaded = eventToForm(fresh);
        setLive(fresh);
        setForm(loaded);
        // What was just read is, by definition, already saved.
        setSaved(loaded);
        setLoad({ kind: 'ready' });

        /*
         * Everything under this event that the document does not name.
         *
         * A one-off in principle and a permanent safety net in practice. For as
         * long as "Remove photograph" only cleared a field, every replacement
         * this parish ever made left its predecessor in `events/{slug}/`, still
         * world-readable at the URL it was shared under — and there is no screen
         * that lists them and no document that names them, so nobody can ask for
         * them individually. Opening the editor is the one moment somebody with
         * the grant is looking at this event, which makes it the only place the
         * question can be asked.
         *
         * It also catches the two cases `settleHero` cannot: a tab closed
         * mid-sweep, and a removal made while the date field was empty.
         *
         * Deliberately not awaited and deliberately silent. It is tidying that
         * nobody asked for at this moment, and a failure — a lapsed token, a
         * refusal — must not turn opening an event into an error message about
         * files.
         */
        void (async () => {
          const { sweepEventFiles } = await import('./admin');
          await sweepEventFiles(loaded.slug, fresh.heroImagePath ?? null, TIDY_GRACE_MS);
        })().catch((error) => {
          console.warn('[events] could not tidy the old photographs:', error);
        });
      } catch (error) {
        if (!alive) return;
        setLoad({
          kind: 'failed',
          message:
            error instanceof Error
              ? error.message
              : 'Could not read the latest version of this event.',
        });
      }
    })();

    return () => {
      alive = false;
    };
    // Once per event, which is what re-reading on the way in means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baked.id]);

  /* ---- what is wrong with it ------------------------------------------ */

  /*
   * Two lists, and the split is all that survives of the publish step.
   *
   * `eventMistakes` are wrong — an end before a start, a link that is not a link —
   * and are drawn on the field the moment they are true. `eventStillMissing` is a
   * summary or a description nobody has written yet, which on an event that is
   * live from the moment it is created is the ordinary state of a new one; it is
   * a quiet line in the bar rather than a red field.
   *
   * Mistakes block Save, with a line in the bar saying so; missing words do not.
   */
  const wrong = eventMistakes(form);
  const missing = eventStillMissing(form);

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const dirtyOn = (one: Tab) => TAB_FIELDS[one].some((key) => JSON.stringify(form[key]) !== JSON.stringify(saved[key]));

  /* What blocks Save, in words. A summary or description not yet written does
     not — that is `missing`, the ordinary state of a new event. */
  const problem = !startInstantOf(form) || !formToDraft(form)
    ? 'Give it a date to save'
    : wrong.length > 0
      ? `Fix ${wrong.length === 1 ? 'the field' : 'the fields'} marked in red to save`
      : null;

  async function saveNow() {
    if (!dirty || saving || problem || load.kind !== 'ready') return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(form);
      setSaved(form);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const errorOf = useCallback(
    (field: EventFieldKey): string | null =>
      wrong.find((problem) => problem.field === field)?.message ?? null,
    [wrong],
  );

  /* ---- the actions ---------------------------------------------------- */

  /*
   * Delete is the only one left.
   *
   * `publish`, `unpublish` and `discard` were all here and are all gone with the
   * publish step — and it is worth recording what went with them: there is now no
   * way to take an event off the website except deleting it. A postponed festival
   * used to be one switch and is now a delete and, later, a retype.
   */
  async function remove() {
    setBusy(true);
    try {
      const { deleteEvent } = await import('./admin');
      const data = await deleteEvent(live.id);
      if (!data) {
        setRemoval({ kind: 'final' });
        return;
      }
      setRemoval({ kind: 'undoable', data, until: Date.now() + UNDO_MS });
    } catch (error) {
      setLoad({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Could not delete.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function undoRemove() {
    if (removal.kind !== 'undoable') return;
    setBusy(true);
    try {
      const { restoreEvent } = await import('./admin');
      await restoreEvent(live.id, removal.data);
      setRemoval({ kind: 'no' });
    } catch (error) {
      setLoad({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'Could not put it back.',
      });
    } finally {
      setBusy(false);
    }
  }

  /* The undo offer expiring. A timer rather than a countdown per second: the
     bar says "a few seconds", so nothing on screen has to be re-rendered
     while it runs. */
  useEffect(() => {
    if (removal.kind !== 'undoable') return;
    const left = Math.max(0, removal.until - Date.now());
    const timer = setTimeout(() => setRemoval({ kind: 'final' }), left);
    return () => clearTimeout(timer);
  }, [removal]);

  /* ---- the photograph ------------------------------------------------- */

  /**
   * Write the new photograph onto the saved event now, then clear the bucket of
   * everything it is not using.
   *
   * ---------------------------------------------------------------------------
   * The ordering is the whole of this function, and both halves of it are the
   * fix for a real bug rather than a preference.
   *
   * **The write comes first**, because the form is not the document. Deleting
   * the object before the event stops naming it would leave a broken picture on
   * the live page and in the mobile app, which both read this document directly.
   * Only the photograph is written — on top of the saved copy — so choosing one
   * never saves words that are still waiting for Save.
   *
   * **It is awaited here rather than watched from an effect**, and that is the
   * part that was wrong. The version before this parked the path in state and
   * had a `useEffect` delete it once autosave reported `saved`. The reasoning
   * was right and the mechanism could not work: `EventArticle` renders the
   * editor only while `edit.on`, so **pressing Done unmounts this component** —
   * and pressing Done straight after Remove is not an edge case, it is what
   * everybody does. The effect went with the component, the write went through,
   * and the photograph stayed in a world-readable bucket at the URL it was
   * shared under. Which is exactly the complaint: *"still not deleting from the
   * storage when i delete in the events page."*
   *
   * An awaited sequence in the handler has no such gap. The click owns the whole
   * operation, and the only thing that can interrupt it is closing the tab.
   * ---------------------------------------------------------------------------
   *
   * `keep` is the path that survives: the replacement on a Replace, and null on
   * a Remove. Everything else under `events/{slug}/` goes — see
   * `sweepEventFiles` for why the files the document never named are the ones
   * that most need it.
   */
  async function settleHero(heroImagePath: string | null, keep: string | null) {
    setForm((was) => ({ ...was, heroImagePath }));
    // The photograph on top of what is saved — never the unsaved words with it.
    const next = { ...saved, heroImagePath };

    /*
     * The one state in which this cannot finish. `formToDraft` returns null
     * while the date field is empty mid-retype, so the write would be a no-op
     * and deleting would strand the document pointing at nothing.
     *
     * The picture still leaves the page — that is what was asked for and it is
     * saved as soon as the date is typed — but the file stays, and the person is
     * told rather than left to find out. The next removal or replacement sweeps
     * it, and so does deleting the event.
     */
    if (!formToDraft(next)) {
      setHero({
        kind: 'error',
        message:
          'Taken off the page. The old file stays in storage until this event has a date it ' +
          'can be saved with.',
      });
      return;
    }

    try {
      await save(next);
      setSaved(next);

      const { sweepEventFiles } = await import('./admin');
      await sweepEventFiles(next.slug, keep);
    } catch (error) {
      /*
       * Said out loud rather than logged. "Remove" that quietly leaves the
       * picture served at its old URL is the bug being fixed here, so a removal
       * that only half happened has to be visible to the person who asked for
       * it — and the sentence has to say which half worked.
       */
      setHero({
        kind: 'error',
        message:
          error instanceof Error
            ? `The event is saved, but the old photograph is still in storage: ${error.message}`
            : 'The event is saved, but the old photograph could not be deleted from storage.',
      });
    }
  }

  async function pickHero(file: File) {
    setHero({ kind: 'uploading' });
    try {
      const { uploadEventHero } = await import('./admin');
      const path = await uploadEventHero(file, form.slug);
      setHero({ kind: 'idle' });
      /*
       * Replacing is a removal too, and it is written at once rather than held
       * for Save: Discard can never point the event back at a file that has
       * been swept from storage, because the saved copy already names the new
       * one.
       */
      await settleHero(path, path);
    } catch (error) {
      setHero({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The upload failed.',
      });
    }
  }

  /*
   * A deleted event takes its photographs with it.
   *
   * At `final`, never at `undoable`: undo restores the document, and a document
   * restored without its picture is not the event that was deleted. The whole
   * `events/{slug}/` prefix rather than the one path the document held — see
   * `deleteEventFiles` for why the ones it did not hold are the ones that matter.
   */
  useEffect(() => {
    if (removal.kind !== 'final') return;
    const slug = live.slug;
    void (async () => {
      const { deleteEventFiles } = await import('./admin');
      await deleteEventFiles(slug);
    })();
  }, [removal.kind, live.slug]);

  /* ---- keyboard ------------------------------------------------------- */

  /* Ctrl/Cmd+S is Save, rather than the browser offering to save the page as a file. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    function warn(unload: BeforeUnloadEvent) {
      unload.preventDefault();
      unload.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ---- deleted ------------------------------------------------------- */

  if (removal.kind !== 'no') {
    return (
      <PageBody flush>
        <div className="notice notice--alarm" role="status">
          <h2>{live.title || 'This event'} has been deleted</h2>
          {removal.kind === 'undoable' ? (
            <>
              <p>
                It is gone from the calendar. The website itself catches up at the next
                build.
              </p>
              <p>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void undoRemove()}
                >
                  {busy ? 'Putting it back…' : 'Undo'}
                </button>
              </p>
            </>
          ) : (
            <p>
              The undo window has passed, so this cannot be recovered from here. This page
              stops existing at the next build.
            </p>
          )}
        </div>
      </PageBody>
    );
  }

  if (load.kind === 'gone') {
    return (
      <PageBody flush>
        <div className="notice notice--alarm" role="alert">
          <h2>This event is no longer in the calendar</h2>
          <p>
            Somebody has deleted it. Nothing you type here would bring it back, so the
            editor has stopped.
          </p>
        </div>
      </PageBody>
    );
  }

  /* ---- the editor ---------------------------------------------------- */

  return (
    <article className="ee">
      <HeroBand
        path={form.heroImagePath}
        status={hero}
        onPick={(file) => void pickHero(file)}
        onClear={() => {
          setHero({ kind: 'idle' });
          void settleHero(null, null);
        }}
      />

      <PageBody flush>
        {/*
          The same `gallery-head` the read-only page uses, so the back link, the
          gap under it and the rule at the bottom are in the same places. Only
          the leaves differ.
        */}
        <header className="gallery-head">
          {/*
            Always the calendar. This used to be a prop, because `/staff/events`
            reached the editor from a list and had to send Back there; that
            screen is gone, so every route into this editor is an event's own
            page, and every one of them came from the calendar.
          */}
          <BackLink href="/calendar" label="Church Calendar" />

          {load.kind === 'failed' && (
            <div className="notice notice--alarm" role="alert">
              <h2>That didn&apos;t work</h2>
              <p>{load.message}</p>
            </div>
          )}

          <div className="gallery-head__titles">
            {/*
              An `h1` with an input in it, rather than an input styled to look
              like one. The heading level is a fact about the page and does not
              change because somebody is editing.
            */}
            <h1 className="ee-title">
              <Plain
                name="title"
                label="The name of this event"
                value={form.title}
                placeholder="Name this event"
                onChange={(value) => set('title', value)}
              />
            </h1>

            <WhenLine form={form} set={set} errorOf={errorOf} />

            <p className="ee-where">
              <Icon name="pin" size={16} />
              <Plain
                name="locationName"
                label="Where it is"
                value={form.locationName}
                placeholder="Where is it?"
                onChange={(value) => set('locationName', value)}
              />
              {/*
                The street address appears once there is somewhere to put it.
                An empty second field beside an empty first one is two questions
                where the page asks one.
              */}
              {form.locationName.trim() && (
                <>
                  <span className="ee-where__sep" aria-hidden="true">
                    ·
                  </span>
                  <Plain
                    name="locationAddress"
                    label="Street address"
                    value={form.locationAddress}
                    placeholder="Street address, if it is not the church"
                    onChange={(value) => set('locationAddress', value)}
                  />
                </>
              )}
            </p>
          </div>
        </header>

        <div className="ee-sheet">
          <EditTabs
            tabs={[
              { id: 'page', label: 'Description', dirty: dirtyOn('page') },
              { id: 'filing', label: 'Filing & sign-ups', dirty: dirtyOn('filing') },
            ]}
            value={tab}
            onChange={setTab}
            label="Event settings"
            idPrefix="ee"
          />

          <EditTabPanel idPrefix="ee" value={tab}>
            {tab === 'page' ? (
              <>
              <BodyField
                value={form.body}
                error={errorOf('body')}
                onChange={(value) => set('body', value)}
              />

              {/*
                The summary is edited here and appears nowhere on this page. Said so
                rather than left as a field whose effect is invisible from where you
                are standing.
              */}
              <Group
                label="One line for the calendar"
                error={errorOf('summary')}
                hint={`Not shown on this page — it is what the calendar and the homepage print. ${
                  200 - form.summary.length
                } characters left.`}
              >
                <input
                  name="summary"
                  size={1}
                  value={form.summary}
                  maxLength={200}
                  placeholder="A six-week introduction to writing icons."
                  onChange={(event) => set('summary', event.target.value)}
                />
              </Group>
              </>
            ) : (
              <>
              <Cols>
                <Group label="What kind of event is it?">
                  <select
                    name="category"
                    value={form.category}
                    onChange={(event) => set('category', event.target.value as EventCategory)}
                  >
                    {EVENT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Group>
                <Group
                  label="Who is it for?"
                  hint="Servants-only events never reach the public calendar."
                >
                  <Segmented
                    label="Who it is for"
                    options={EVENT_AUDIENCE_OPTIONS}
                    value={form.audience}
                    onChange={(value) => set('audience', value as EventAudience)}
                  />
                </Group>
              </Cols>

              <Group label="Tags" hint="For grouping and filtering. Press Enter after each one.">
                <TagField tags={form.tags} onChange={(tags) => set('tags', tags)} />
              </Group>

              <Cols>
                <Group
                  label="Sign-up link"
                  error={errorOf('registrationUrl')}
                  hint="An external sign-up page. Built-in forms aren’t available yet."
                >
                  <input
                    name="registrationUrl"
                    size={1}
                    value={form.registrationUrl}
                    placeholder="https://…"
                    onChange={(event) => set('registrationUrl', event.target.value)}
                  />
                </Group>
                <Group
                  label="Online link"
                  error={errorOf('meetingUrl')}
                  hint="For an event people can join remotely."
                >
                  <input
                    name="meetingUrl"
                    size={1}
                    value={form.meetingUrl}
                    placeholder="https://…"
                    onChange={(event) => set('meetingUrl', event.target.value)}
                  />
                </Group>
              </Cols>

              {/*
                The web address is shown and not editable. Changing it while
                standing on the page it names would move the page out from under
                you, and it is the URL anything already shared points at.
              */}
              <p className="ee-slug">
                This page is at <code>/events/{form.slug}</code>. A web address cannot be
                changed once an event exists — every link already shared points at it.
              </p>
              </>
            )}
          </EditTabPanel>
        </div>
      </PageBody>

      <EditorBar
        dirty={dirty}
        saving={saving}
        problem={problem}
        error={saveError}
        missing={missing.map((one) => one.message)}
        busy={busy || load.kind === 'reading'}
        onSave={() => void saveNow()}
        onDiscard={() => {
          setForm(saved);
          setSaveError(null);
        }}
        onDelete={() => void remove()}
        onDone={() => {
          // Leaving would drop what is held, out of sight. The bar says so.
          if (dirty) {
            setSaveError('Save or discard your changes before leaving.');
            return;
          }
          edit.setOn(false);
        }}
      />
    </article>
  );
}
