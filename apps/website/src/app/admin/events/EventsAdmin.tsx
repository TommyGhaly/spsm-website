'use client';

/**
 * The events admin: the list, the editor, and everything that talks to Firestore.
 *
 * Rebuilt from nothing. The screen this replaces was a single 949-line component
 * holding one 2,119-pixel form; what it did wrong, and why the shape here is
 * different, is written down in `EventEditor` and `EventList` beside the parts
 * that answer it. This file is only the plumbing: what is loaded, what is
 * selected, what is saved, and the three things that go wrong when those meet.
 *
 * ## The three
 *
 * **Losing work.** The old screen replaced the form the instant another event was
 * clicked, with no warning — half an hour of typing gone to a mis-click. Nothing
 * here changes what is in the editor while it holds unsaved changes; a request to
 * is held and asked about.
 *
 * **Losing your place.** Selection is in the query string, so a refresh — or the
 * dev server reloading under you — comes back to the same event. It has to be a
 * query string rather than a path: `firebase.json` has no catch-all rewrite, so
 * `/admin/events/<id>` would 404 on a hard refresh, and the export cannot emit a
 * file for an id that does not exist at build time.
 *
 * **The two writes that are not one write.** Saving an event writes `events`;
 * filing it under a ministry writes `programEvents`, which needs a permission
 * this screen does not otherwise require. The second can fail on its own, after
 * the first has succeeded, and the report has to say so rather than claiming the
 * event did not save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocOf, Event } from '@spsm/shared';
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
  type ProgramLinkTarget,
} from '@/features/events/admin';
import { auth } from '@/lib/auth';
import { EventEditor, type SaveStatus } from './EventEditor';
import { EventList } from './EventList';
import type { HeroStatus } from './HeroField';
import {
  BLANK,
  duplicateOf,
  fromEvent,
  isDirty,
  toDraft,
  type FormState,
} from './form';

type Selection = { kind: 'none' } | { kind: 'new' } | { kind: 'existing'; id: string };

/**
 * Whether a write was refused by `firestore.rules`.
 *
 * Reads `FirebaseError.code`, not the message, and that is the whole point of the
 * helper. Matching `message.includes('permission')` looked right and was wrong
 * twice over: the SDK's message is upper-cased (`PERMISSION_DENIED`), so the
 * lowercase test never matched — and what it let through instead was the rules
 * engine's own diagnostic, shown verbatim to a volunteer who had done nothing
 * wrong.
 */
function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code.includes('permission-denied')) return true;
  return error instanceof Error && /permission[_-]denied/i.test(error.message);
}

export function EventsAdmin() {
  const [events, setEvents] = useState<DocOf<Event>[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selection, setSelection] = useState<Selection>({ kind: 'none' });
  const [form, setForm] = useState<FormState>(BLANK);
  /** What the form looked like when it was loaded or last saved. */
  const [baseline, setBaseline] = useState<FormState>(BLANK);
  const [slugLocked, setSlugLocked] = useState(false);

  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const [hero, setHero] = useState<HeroStatus>({ kind: 'idle' });

  /** A selection waiting on an answer about the unsaved changes in the way. */
  const [pending, setPending] = useState<Selection | null>(null);

  const [links, setLinks] = useState<ProgramLinkTarget[] | null>(null);
  const [linkChoice, setLinkChoice] = useState('');
  /** What the link was when the event was loaded, so a re-save leaves it alone. */
  const [linkBaseline, setLinkBaseline] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);

  const dirty = isDirty(form, baseline) || linkChoice !== linkBaseline;
  const eventId = selection.kind === 'existing' ? selection.id : null;

  /* ---- loading --------------------------------------------------------- */

  /**
   * @returns the events it loaded, so a caller that needs to look one up
   *   straight afterwards does not have to wait for the state to land.
   */
  const reload = useCallback(async (): Promise<DocOf<Event>[] | null> => {
    try {
      const loaded = await listEventsForAdmin();
      setEvents(loaded);
      setLoadError(null);
      return loaded;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load events.');
      return null;
    }
  }, []);

  const reloadLinks = useCallback(async () => {
    try {
      setLinks(await listProgramLinkTargets());
    } catch (error) {
      // Not fatal. The picker disappears and the rest of the form still works.
      console.error('[events] could not load the ministry occurrences:', error);
      setLinks([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    void reloadLinks();
  }, [reload, reloadLinks]);

  /* ---- selection ------------------------------------------------------- */

  const open = useCallback(
    (next: Selection, source: DocOf<Event>[] | null) => {
      if (next.kind === 'existing') {
        const found = source?.find((event) => event.id === next.id);
        if (!found) return;
        const loaded = fromEvent(found);
        setForm(loaded);
        setBaseline(loaded);
        // Never regenerate the slug of something already saved — it is the
        // public URL, and anything already shared points at it.
        setSlugLocked(true);
      } else {
        setForm(BLANK);
        setBaseline(BLANK);
        setSlugLocked(false);
      }
      setSelection(next);
      setStatus({ kind: 'idle' });
      setHero({ kind: 'idle' });

      /*
       * On a phone the list and the editor are stacked, so selecting an event
       * changes something that is a screen below the finger that did it.
       * Nothing appears to happen. On a wide screen they are side by side and
       * scrolling would be wrong, hence the width test.
       */
      if (window.innerWidth < 960) {
        setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
      }
    },
    [],
  );

  /** A selection the user asked for, which unsaved changes may stand in the way of. */
  function request(next: Selection) {
    if (dirty) setPending(next);
    else open(next, events);
  }

  /*
   * The selection, restored from `?id=` once the events are in hand.
   *
   * Guarded by a ref rather than by comparing state, so this runs exactly once
   * per page load. Without the guard, reloading after every save would drag the
   * editor back to whatever the URL said.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || events === null) return;
    restored.current = true;
    const id = new URLSearchParams(window.location.search).get('id');
    if (id === 'new') open({ kind: 'new' }, events);
    else if (id) open({ kind: 'existing', id }, events);
  }, [events, open]);

  /** The query string follows the selection. `replaceState`, so Back leaves. */
  useEffect(() => {
    const target =
      selection.kind === 'existing'
        ? `?id=${encodeURIComponent(selection.id)}`
        : selection.kind === 'new'
          ? '?id=new'
          : window.location.pathname;
    window.history.replaceState(null, '', target);
  }, [selection]);

  /* ---- the ministry link ----------------------------------------------- */

  /**
   * The link is a field on the `programEvents` document pointing *back* at this
   * event, so the truth is in `links` and this re-derives it rather than keeping
   * a copy in the form. Held in `FormState` instead, `open()` had to know the
   * links had already loaded — and on a cold open they had not.
   */
  const linkedNow = useMemo(
    () =>
      eventId === null
        ? null
        : (links?.find((target) => target.calendarEventId === eventId)?.programEventId ?? null),
    [links, eventId],
  );

  useEffect(() => {
    setLinkChoice(linkedNow ?? '');
    setLinkBaseline(linkedNow ?? '');
  }, [linkedNow, selection]);

  /* ---- unsaved work --------------------------------------------------- */

  useEffect(() => {
    if (!dirty) return;
    function warn(unload: BeforeUnloadEvent) {
      unload.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* ---- the form ------------------------------------------------------- */

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      // The web address follows the name until somebody edits it.
      if (key === 'title' && !slugLocked) next.slug = slugify(String(value));
      return next;
    });
  }

  /**
   * A photograph, uploaded on choose rather than on save.
   *
   * A 6MB photograph over the church hall's wifi is tens of seconds. Hanging
   * that off the save button means somebody presses Save, sees nothing, and
   * presses it again — so the wait goes where the person is already looking, at
   * the thing they just picked.
   */
  async function onPickHero(file: File) {
    setHero({ kind: 'uploading' });
    const previous = form.heroImagePath;
    try {
      const path = await uploadEventHero(file, form.slug);
      set('heroImagePath', path);
      setHero({ kind: 'idle' });
      // Only once the new path is in hand: a failed upload must not take the
      // existing photograph with it.
      if (previous) void deleteEventHero(previous);
    } catch (error) {
      setHero({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The upload failed.',
      });
    }
  }

  function onClearHero() {
    const path = form.heroImagePath;
    set('heroImagePath', null);
    setHero({ kind: 'idle' });
    if (path) void deleteEventHero(path);
  }

  /* ---- saving --------------------------------------------------------- */

  /** @returns the saved event's id, or null if nothing was written. */
  async function save(): Promise<string | null> {
    setStatus({ kind: 'saving' });
    try {
      const uid = auth().currentUser?.uid ?? null;
      const draft = toDraft(form);

      let id: string;
      if (selection.kind === 'existing') {
        id = selection.id;
        await updateEvent(id, draft, uid);
      } else {
        id = await createEvent(draft, uid);
        setSelection({ kind: 'existing', id });
        setSlugLocked(true);
      }

      /*
       * The link is a separate write to a separate collection, attempted only
       * when it has actually changed — so re-saving an event does not touch a
       * `programEvent` the editor may have no permission for.
       *
       * Caught here rather than by the outer handler on purpose. The event is
       * already saved; letting a permission error on somebody else's ministry
       * surface as "that didn't save" sends the editor back to re-type a form
       * that is safely stored.
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

      // The baseline moves to what was just written, which is what makes the
      // form clean again and the Save button go quiet.
      setBaseline(form);
      setLinkBaseline(linkChoice);
      await reload();
      setStatus({ kind: 'saved', at: Date.now(), linkWarning });
      return id;
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not save.',
      });
      return null;
    }
  }

  async function onDelete() {
    if (selection.kind !== 'existing') return;
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
      setForm(BLANK);
      setBaseline(BLANK);
      setSelection({ kind: 'none' });
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not delete.',
      });
    }
  }

  /**
   * This event again, as a new one.
   *
   * The parish's commonest act of authorship — the festival and the camp come
   * round every year with the same description and a different date — and the
   * reason it is here rather than in the list: what gets copied is what is *on
   * the screen*, including anything typed and not yet saved.
   */
  function onDuplicate() {
    const copy = duplicateOf(form);
    copy.slug = slugify(copy.title);
    setSelection({ kind: 'new' });
    setForm(copy);
    // Baseline stays blank so the copy counts as unsaved from the outset —
    // it is, and Save has to be available for it.
    setBaseline(BLANK);
    setSlugLocked(false);
    setLinkChoice('');
    setLinkBaseline('');
    setStatus({ kind: 'idle' });
    setHero({ kind: 'idle' });
  }

  /** Every tag anywhere, so the same idea is not spelled three ways. */
  const knownTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const event of events ?? []) {
      for (const tag of event.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [events]);

  return (
    <div className="ev-admin">
      <aside className="ev-admin__list">
        <EventList
          events={events}
          selectedId={eventId}
          loadError={loadError}
          onPick={(event) => request({ kind: 'existing', id: event.id })}
          onNew={() => request({ kind: 'new' })}
        />
      </aside>

      <div className="ev-admin__pane" ref={editorRef}>
        {/*
          The guard.

          Shown instead of switching, not after switching. All three answers are
          spelled out because "OK / Cancel" on a browser dialog does not say which
          one keeps the work — and the one people press when they cannot tell is
          whichever makes the dialog go away.
        */}
        {pending && (
          <div className="notice ev-guard" role="alertdialog" aria-label="Unsaved changes">
            <h2>You have unsaved changes</h2>
            <p>
              “{form.title.trim() || 'This event'}” has edits that are not saved yet.
            </p>
            <div className="ev-guard__buttons">
              <button
                type="button"
                className="button"
                onClick={() => {
                  const next = pending;
                  setPending(null);
                  void (async () => {
                    const saved = await save();
                    // A failed save leaves everything exactly where it was. The
                    // error notice says why, and the work is still in the form.
                    if (saved === null) return;
                    open(next, await reload());
                  })();
                }}
              >
                Save, then go
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  const next = pending;
                  setPending(null);
                  open(next, events);
                }}
              >
                Discard the changes
              </button>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => setPending(null)}
              >
                Stay here
              </button>
            </div>
          </div>
        )}

        {selection.kind === 'none' ? (
          <div className="ev-empty">
            <h2>Nothing open</h2>
            <p>
              Pick an event on the left to change it, or start a new one. A new event needs
              only a name and a day to be saved as a draft — the summary and the description
              can wait until it is ready to go on the website.
            </p>
            <button className="button" type="button" onClick={() => request({ kind: 'new' })}>
              New event
            </button>
          </div>
        ) : (
          <EventEditor
            form={form}
            set={set}
            slugLocked={slugLocked}
            onEditSlug={() => setSlugLocked(true)}
            eventId={eventId}
            dirty={dirty}
            status={status}
            hero={hero}
            onPickHero={(file) => void onPickHero(file)}
            onClearHero={onClearHero}
            links={links}
            linkChoice={linkChoice}
            onLinkChoice={setLinkChoice}
            knownTags={knownTags}
            onSave={() => void save()}
            onDelete={() => void onDelete()}
            onDuplicate={onDuplicate}
          />
        )}
      </div>
    </div>
  );
}
