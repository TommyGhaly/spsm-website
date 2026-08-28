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
 * ## Typing is the save, and there is nothing else
 *
 * No Save button, no Publish button, no draft state. Keystrokes are written to
 * the event a second after they stop, and that is the entire model. Tommy: *"get
 * rid of the publishing logic it should just autosave much less confusing."*
 *
 * This replaced a two-stage arrangement where edits accumulated in a `pendingEdit`
 * copy that a separate Publish promoted. Every awkward thing about the bar came
 * from it: a state pill, an "unpublished changes" marker, a Publish button that
 * appeared and disappeared, a line explaining why it was disabled, and a "throw
 * away my changes" item. All of that is gone, along with `Event.published` itself.
 *
 * **The two things it costs, since nothing in the interface says them any more.**
 * There is no undo — the mobile app reads this document directly, so a mistyped
 * title is the parish's title about a second later. And there is no way to take an
 * event off the website except deleting it; a postponed festival used to be one
 * switch. Both were named before the change was made, and both are the price of
 * the editor never being able to show different words than the page.
 *
 * The mechanics are in `useAutosave`.
 *
 * ## The document is re-read on the way in
 *
 * This page's HTML is baked at build time, so the copy it renders can be days
 * old, and every autosave writes every field. Editing from the baked copy would
 * silently revert anything changed since the build.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocOf, Event, EventAudience, EventCategory } from '@spsm/shared';
import { useEditMode } from '@/features/programs/editMode';
import { PageBody } from '@/components/PageBody';
import { Icon } from '@/components/Icon';
import { BackLink } from '@/components/BackLink';
import { Plain } from '@/components/Inline';
import { Cols, Fold, Group, Segmented, TagField } from './EditorParts';
import { HeroBand, type HeroStatus } from './HeroBand';
import { WhenLine } from './WhenLine';
import { BodyField } from './BodyField';
import { EditorBar } from './EditorBar';
import {
  AUDIENCE_LABELS,
  AUDIENCE_OPTIONS,
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  fromEvent,
  mistakes,
  startInstantOf,
  stillMissing,
  toContentDraft,
  type FieldKey,
  type FormState,
} from './form';
import { useAutosave } from './useAutosave';

/** How long the undo offer stands after a delete. */
const UNDO_MS = 12_000;

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
   * It used to fire on Publish, which was the only moment the document changed.
   * Every autosave changes it now, so it fires on every autosave: the page
   * underneath is not being looked at while somebody types, so the cost is a
   * `setState` nobody sees and the gain is that Done is never a step backwards.
   */
  onSaved: (event: DocOf<Event>) => void;
}) {
  const edit = useEditMode();

  const [live, setLive] = useState<DocOf<Event>>(baked);
  const [form, setForm] = useState<FormState>(() => fromEvent(baked));
  const [load, setLoad] = useState<Load>({ kind: 'reading' });
  const [hero, setHero] = useState<HeroStatus>({ kind: 'idle' });
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removal, setRemoval] = useState<Removal>({ kind: 'no' });

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  /* ---- autosave ------------------------------------------------------- */

  const save = useCallback(
    async (value: FormState) => {
      const draft = toContentDraft(value);
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
      setLive((previous) => {
        const next: DocOf<Event> = {
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
        };
        onSaved(next);
        return next;
      });
    },
    [live.id, onSaved],
  );

  /*
   * Autosave is off until the fresh read has landed, and off once the event has
   * been deleted. Writing before the read would save the baked copy over
   * whatever is actually in Firestore — the precise thing re-reading exists to
   * prevent — and writing after the delete would resurrect it as a fragment.
   */
  const autosave = useAutosave({
    value: form,
    save,
    enabled: load.kind === 'ready' && removal.kind === 'no',
    hold: startInstantOf(form) ? null : 'Waiting for a date it can save',
  });

  /* ---- reading the real document ------------------------------------- */

  /*
   * Below `useAutosave`, and that ordering is load-bearing.
   *
   * The hook seeds "what has been written" from the form it is first handed,
   * which is built from the *baked* copy of the event — the words in the HTML
   * this page was exported with, possibly days old. This effect then replaces the
   * form with what Firestore actually holds. Unless the hook is told, it sees a
   * form that differs from its record and concludes somebody typed — so opening
   * an event would write back exactly what it had just read, stamping `updatedAt`
   * and `updatedBy` on a document nobody touched.
   *
   * Invisible in development, where the dev server renders the "baked" copy
   * fresh on every request and the two always agree. It would have happened on
   * almost every real edit.
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
        const loaded = fromEvent(fresh);
        setLive(fresh);
        setForm(loaded);
        // What was just read is, by definition, already saved.
        autosave.markSaved(loaded);
        setLoad({ kind: 'ready' });
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
    // `autosave.markSaved` is stable — a `useCallback` with no dependencies —
    // so this runs once per event, which is what re-reading on the way in means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baked.id]);

  /* ---- what is wrong with it ------------------------------------------ */

  /*
   * Two lists, and the split is all that survives of the publish step.
   *
   * `mistakes` are wrong — an end before a start, a link that is not a link —
   * and are drawn on the field the moment they are true. `stillMissing` is a
   * summary or a description nobody has written yet, which on an event that is
   * live from the moment it is created is the ordinary state of a new one; it is
   * a quiet line in the bar rather than a red field.
   *
   * Neither blocks anything. Nothing can be blocked: typing is the save.
   */
  const wrong = mistakes(form);
  const missing = stillMissing(form);

  const errorOf = useCallback(
    (field: FieldKey): string | null =>
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

  async function pickHero(file: File) {
    setHero({ kind: 'uploading' });
    const previous = form.heroImagePath;
    try {
      const { uploadEventHero, deleteEventHero } = await import('./admin');
      const path = await uploadEventHero(file, form.slug);
      set('heroImagePath', path);
      setHero({ kind: 'idle' });
      /*
       * The old object is deleted as soon as the form stops pointing at it,
       * which is *before* anything is published. That is a real trade and the
       * wrong one here: discarding the change would leave the event pointing at
       * a file that no longer exists. So the old one is left alone and the
       * bucket keeps it — see `deleteEventHero`'s note on cost.
       */
      void previous;
    } catch (error) {
      setHero({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The upload failed.',
      });
    }
  }

  /* ---- keyboard ------------------------------------------------------- */

  /*
   * Ctrl/Cmd+S writes now, rather than letting the browser offer to save the page
   * as a file over work in progress.
   *
   * It used to publish, because publishing was the only thing a keystroke could
   * usefully mean. With autosave as the whole mechanism it means "do the pending
   * write immediately" — which is almost nothing, and is exactly what somebody
   * pressing it wants: the reflex is "make sure that is saved", and the honest
   * answer is that it is.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void autosave.flush();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autosave]);

  useEffect(() => {
    if (!autosave.dirty) return;
    function warn(unload: BeforeUnloadEvent) {
      unload.preventDefault();
      unload.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave.dirty]);

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
          set('heroImagePath', null);
          setHero({ kind: 'idle' });
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

          <Fold
            title="Filing and sign-ups"
            value={
              <>
                {CATEGORY_LABELS[form.category]} · {AUDIENCE_LABELS[form.audience].toLowerCase()}
                {form.tags.length > 0 &&
                  ` · ${form.tags.length} ${form.tags.length === 1 ? 'tag' : 'tags'}`}
              </>
            }
            open={more}
            onToggle={() => setMore((was) => !was)}
          >
            <Cols>
              <Group label="What kind of event is it?">
                <select
                  name="category"
                  value={form.category}
                  onChange={(event) => set('category', event.target.value as EventCategory)}
                >
                  {CATEGORY_OPTIONS.map((option) => (
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
                  options={AUDIENCE_OPTIONS}
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
          </Fold>
        </div>
      </PageBody>

      <EditorBar
        autosave={autosave.state}
        missing={missing.map((problem) => problem.message)}
        busy={busy || load.kind === 'reading'}
        onDelete={() => void remove()}
        onDone={() => {
          // Flushed rather than trusted to the unmount handler, so "Done" is a
          // promise that what is on screen has been written.
          void autosave.flush().then(() => edit.setOn(false));
        }}
      />
    </article>
  );
}
