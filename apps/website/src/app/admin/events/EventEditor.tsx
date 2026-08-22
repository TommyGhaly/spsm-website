'use client';

/**
 * The editor, on the right.
 *
 * ## What was wrong with the one before it
 *
 * It was eight `<fieldset>`s, eighteen controls and 2,119 pixels of form, every
 * one of them expanded, with the Save button off the bottom of the screen and
 * the error messages in a bulleted list off the top. Filling it in meant
 * scrolling three screens; correcting it meant scrolling back up to read what was
 * wrong, then back down to fix it, with the message no longer on screen.
 *
 * It is the same shape of failure the ministry inspector had — see
 * `features/programs/Disclosure`, written after the same complaint — and the fix
 * is the same one: stop listing *settings* and start listing the few things
 * somebody actually came to change.
 *
 * ## What this does instead
 *
 * **Five things are always on the screen**: the name, when, where, the one-line
 * summary and the description. That is an event. Everything else — the
 * photograph, the filing, the web address — is folded, and each fold says what it
 * currently holds so it does not have to be opened to be read.
 *
 * **A draft needs only a name and a day.** The summary and the description are
 * required to *publish*, not to save, which is the change that makes this usable
 * from the church hall: somebody can write down "Festival, September 3rd" in
 * fifteen seconds and finish it at home. The old form refused that outright.
 *
 * **Errors are under the field they are about**, and the Save bar says how many
 * there are and jumps to the first. Nothing is reported anywhere but next to the
 * control that caused it.
 *
 * **Save is always on screen**, in a bar stuck to the bottom, along with the one
 * switch that decides whether any of this is public.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocOf, Event, EventAudience, EventCategory } from '@spsm/shared';
import type { ProgramLinkTarget } from '@/features/events/admin';
import { Icon } from '@/components/Icon';
import { Field, Fold, Row, Segmented, TagInput, focusField } from './fields';
import { HeroField, type HeroStatus } from './HeroField';
import { WhenFields } from './WhenFields';
import {
  AUDIENCE_LABELS,
  AUDIENCE_OPTIONS,
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  SECTION_OF,
  blockingProblems,
  type FieldKey,
  type FormState,
  type SectionId,
} from './form';

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** `linkWarning` is "the event saved and the ministry link did not". */
  | { kind: 'saved'; at: number; linkWarning: string | null }
  | { kind: 'error'; message: string };

interface EditorProps {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  /** True once the web address has been typed into, so it stops following the name. */
  slugLocked: boolean;
  onEditSlug: () => void;

  /** Null for an event that has never been saved. */
  eventId: string | null;
  dirty: boolean;
  status: SaveStatus;

  hero: HeroStatus;
  onPickHero: (file: File) => void;
  onClearHero: () => void;

  /** Null while loading, `[]` when the parish has no ministry occurrences. */
  links: ProgramLinkTarget[] | null;
  linkChoice: string;
  onLinkChoice: (programEventId: string) => void;

  /** Every tag already used anywhere, offered rather than retyped. */
  knownTags: string[];

  onSave: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

/** The link options as `<optgroup>`s, keeping the order the loader chose. */
function groupByProgram(targets: ProgramLinkTarget[]): [string, ProgramLinkTarget[]][] {
  const groups: [string, ProgramLinkTarget[]][] = [];
  for (const target of targets) {
    const last = groups[groups.length - 1];
    if (last && last[0] === target.programName) last[1].push(target);
    else groups.push([target.programName, [target]]);
  }
  return groups;
}

export function EventEditor(props: EditorProps) {
  const { form, set, eventId, dirty, status, hero } = props;

  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    essentials: true,
    photograph: false,
    more: false,
    address: false,
  });
  /**
   * Which fields have been left, and whether a save has been attempted.
   *
   * Errors appear on blur rather than on every keystroke: "Give the event a
   * name" flashing under an empty field somebody has not finished typing into is
   * a form that argues with you. A save attempt shows all of them at once.
   */
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A different event in the editor is a clean slate for all three.
  useEffect(() => {
    setTouched(new Set());
    setAttempted(false);
    setConfirmDelete(false);
  }, [eventId]);

  const problems = useMemo(() => blockingProblems(form), [form]);
  /** The one the Save bar names and jumps to. */
  const first = problems[0] ?? null;
  const problemOf = (field: FieldKey) =>
    problems.find((problem) => problem.field === field) ?? null;

  function errorOf(field: FieldKey): string | null {
    if (!attempted && !touched.has(field)) return null;
    return problemOf(field)?.message ?? null;
  }

  /** Open the fold a problem is in, then put the cursor in it. */
  function jumpTo(field: FieldKey) {
    const section = SECTION_OF[field];
    setOpen((previous) => ({ ...previous, [section]: true }));
    focusField(field);
  }

  function attemptSave() {
    setAttempted(true);
    if (first) {
      jumpTo(first.field);
      return;
    }
    props.onSave();
  }

  /*
   * Ctrl/Cmd+S.
   *
   * Not a nicety: the parish's volunteers all learned to save with it somewhere
   * else, and in a browser it otherwise offers to save the page as a file — so
   * the choice is between honouring it and letting it do something actively
   * confusing on a form with unsaved work in it.
   */
  const saveRef = useRef(attemptSave);
  saveRef.current = attemptSave;
  useEffect(() => {
    function onKey(keyEvent: KeyboardEvent) {
      if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key.toLowerCase() === 's') {
        keyEvent.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const busy = status.kind === 'saving' || hero.kind === 'uploading';
  const justSaved = status.kind === 'saved' && !dirty;

  return (
    <div className="ev-editor">
      <header className="ev-editor__head">
        <div>
          <h2>{form.title.trim() || (eventId ? 'Untitled event' : 'New event')}</h2>
          <p className="ev-editor__where">
            {form.published ? (
              <>
                On the website at <code>/events/{form.slug || '…'}</code>
              </>
            ) : (
              <>A draft — nobody outside this screen can see it</>
            )}
          </p>
        </div>

        <div className="ev-editor__tools">
          <button
            type="button"
            className="button button--quiet button--small"
            onClick={props.onDuplicate}
            title="Start a new event from this one"
          >
            Duplicate
          </button>
          {eventId && (
            <button
              type="button"
              className="button button--danger button--small"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {/*
        Delete, confirmed in place.

        A `window.confirm` was doing this before. It cannot name the event, it
        cannot say what else goes with it, and on a phone it is a system dialog
        over a form — so the safest-looking thing to do is press the button that
        makes it go away, which is fifty-fifty.
      */}
      {confirmDelete && (
        <div className="notice notice--alarm ev-confirm" role="alertdialog" aria-label="Confirm delete">
          <h2>Delete “{form.title.trim() || 'this event'}”?</h2>
          <p>
            The event, its photograph and any link to a ministry gallery all go, and there
            is no undo. If you only want it off the website, set it back to a draft instead.
          </p>
          <div className="ev-confirm__buttons">
            <button
              type="button"
              className="button button--danger"
              onClick={() => {
                setConfirmDelete(false);
                props.onDelete();
              }}
            >
              Delete permanently
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {status.kind === 'error' && (
        <div className="notice notice--alarm" role="alert">
          <h2>That didn&apos;t save</h2>
          <p>{status.message}</p>
        </div>
      )}

      {status.kind === 'saved' && status.linkWarning && (
        <div className="notice notice--alarm" role="alert">
          <h2>Saved, but not filed</h2>
          <p>{status.linkWarning}</p>
        </div>
      )}

      {/* Blur anywhere in the body marks that field as answered, which is what
          lets an error appear when somebody leaves a field rather than while
          they are still in it. One handler, by delegation, instead of an
          `onBlur` repeated on eighteen inputs. */}
      <div
        className="ev-editor__body"
        onBlur={(e) => {
          const name = (e.target as HTMLElement).getAttribute('name');
          if (name) setTouched((previous) => new Set(previous).add(name));
        }}
      >
        <Field
          label="What is it called?"
          error={errorOf('title')}
          required
          hint="The name a parishioner will see on the calendar."
        >
          <input
            name="title"
            className="ev-input--big"
            value={form.title}
            autoComplete="off"
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <WhenFields form={form} set={set} errorOf={errorOf} />

        <Field label="Where is it?" hint="Leave empty if there is nowhere to be.">
          <input
            name="locationName"
            value={form.locationName}
            placeholder="The church hall"
            onChange={(e) => set('locationName', e.target.value)}
          />
        </Field>

        <Field
          label="One line about it"
          error={errorOf('summary')}
          hint={`This is what shows on the calendar and the homepage. ${
            200 - form.summary.length
          } characters left.`}
        >
          <input
            name="summary"
            value={form.summary}
            maxLength={200}
            onChange={(e) => set('summary', e.target.value)}
          />
        </Field>

        <Field
          label="The full description"
          error={errorOf('body')}
          hint={
            <>
              Markdown works: <code>## Heading</code>, <code>**bold**</code>,{' '}
              <code>- list</code>, <code>[link](https://…)</code>.
            </>
          }
        >
          <textarea
            name="body"
            value={form.body}
            rows={9}
            onChange={(e) => set('body', e.target.value)}
          />
        </Field>

        <Fold
          title="Photograph"
          value={form.heroImagePath ? 'One chosen' : 'None'}
          open={open.photograph}
          onToggle={() => setOpen((p) => ({ ...p, photograph: !p.photograph }))}
        >
          <HeroField
            path={form.heroImagePath}
            status={hero}
            ready={Boolean(form.slug)}
            onPick={props.onPickHero}
            onClear={props.onClearHero}
          />
        </Fold>

        <Fold
          title="Filing, sign-ups and directions"
          value={
            <>
              {CATEGORY_LABELS[form.category]} · {AUDIENCE_LABELS[form.audience].toLowerCase()}
              {form.tags.length > 0 &&
                ` · ${form.tags.length} ${form.tags.length === 1 ? 'tag' : 'tags'}`}
              {form.registrationUrl && ' · sign-up link'}
            </>
          }
          open={open.more}
          onToggle={() => setOpen((p) => ({ ...p, more: !p.more }))}
        >
          <Row>
            <Field label="What kind of event is it?">
              <select
                name="category"
                value={form.category}
                onChange={(e) => set('category', e.target.value as EventCategory)}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </Row>

          <Field
            label="Who is it for?"
            hint="Servants-only events never reach the public calendar."
          >
            <Segmented
              label="Who it is for"
              options={AUDIENCE_OPTIONS}
              value={form.audience}
              onChange={(value) => set('audience', value as EventAudience)}
            />
          </Field>

          <Field label="Tags" hint="For grouping and filtering. Press Enter after each one.">
            <TagInput
              tags={form.tags}
              suggestions={props.knownTags}
              onChange={(tags) => set('tags', tags)}
            />
          </Field>

          {/*
            Filing an event under a ministry.

            Written to the *ministry occurrence*, not to this event — see
            `setProgramLink`. That is why the list can be shorter than an
            administrator expects and why saving it can fail on its own: both are
            the permission on the ministry, not on the event.
          */}
          {props.links !== null && props.links.length > 0 && (
            <Field
              label="Part of a ministry"
              hint="Puts a link to this date on the ministry’s gallery page. It stays on the parish calendar either way."
            >
              <select
                name="ministry"
                value={props.linkChoice}
                onChange={(e) => props.onLinkChoice(e.target.value)}
              >
                <option value="">Not part of a ministry</option>
                {groupByProgram(props.links).map(([programName, targets]) => (
                  <optgroup key={programName} label={programName}>
                    {targets.map((target) => {
                      // Compared against the *event* id. Against the current
                      // choice this disabled the occurrence the open event is
                      // already linked to, making the link impossible to restore.
                      const takenBy =
                        target.calendarEventId !== null && target.calendarEventId !== eventId;
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
            </Field>
          )}

          <Field
            label="Sign-up link"
            error={errorOf('registrationUrl')}
            hint="An external sign-up page. Built-in forms aren’t available yet."
          >
            <input
              name="registrationUrl"
              value={form.registrationUrl}
              placeholder="https://…"
              onChange={(e) => set('registrationUrl', e.target.value)}
            />
          </Field>

          <Row>
            <Field label="Street address" hint="Only if it is somewhere other than the church.">
              <input
                name="locationAddress"
                value={form.locationAddress}
                onChange={(e) => set('locationAddress', e.target.value)}
              />
            </Field>
            <Field label="Online link" error={errorOf('meetingUrl')}>
              <input
                name="meetingUrl"
                value={form.meetingUrl}
                placeholder="https://…"
                onChange={(e) => set('meetingUrl', e.target.value)}
              />
            </Field>
          </Row>
        </Fold>

        <Fold
          title="Web address"
          value={<code>/events/{form.slug || '…'}</code>}
          open={open.address}
          onToggle={() => setOpen((p) => ({ ...p, address: !p.address }))}
        >
          {/*
            The slug follows the name until somebody touches it.

            It used to be a required field beside the title, which put the one
            value on the form that must never change after an event is shared
            right next to the one people retype most. Read-only until asked for
            is the same information with the trap taken out.
          */}
          <Field
            label="The link to this event"
            error={errorOf('slug')}
            hint={
              eventId
                ? 'Changing this breaks any link already shared, including one in a bulletin.'
                : 'Made from the name. Change it only if you have a reason to.'
            }
          >
            <input
              name="slug"
              value={form.slug}
              readOnly={!props.slugLocked}
              onFocus={props.onEditSlug}
              onChange={(e) => set('slug', e.target.value)}
            />
          </Field>
          <p className="note">
            spsmwayland.org/events/<strong>{form.slug || '…'}</strong>
          </p>
        </Fold>
      </div>

      {/*
        The bar that is always on the screen.

        Everything with a consequence is in it: whether this is public, whether
        there is anything unsaved, what is still missing, and Save. On the old
        form all four of those were 2,000 pixels down.
      */}
      <footer className="ev-bar">
        {/* Wrapped so the stylesheet can tell the two halves apart: Published
            selected is the accent, Draft selected is not. A neutral highlight on
            both makes the one switch with a public consequence look like a
            preference. */}
        <div className={form.published ? 'ev-publish ev-publish--live' : 'ev-publish'}>
          <Segmented
            label="Whether this event is on the website"
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'live', label: 'Published' },
            ]}
            value={form.published ? 'live' : 'draft'}
            onChange={(value) => set('published', value === 'live')}
          />
        </div>

        <p className="ev-bar__state" role="status">
          {status.kind === 'saving' ? (
            'Saving…'
          ) : hero.kind === 'uploading' ? (
            'Waiting for the photograph to finish uploading…'
          ) : first && (attempted || dirty) ? (
            <button type="button" className="ev-bar__problems" onClick={() => jumpTo(first.field)}>
              <Icon name="close" size={13} />
              {problems.length === 1
                ? first.message
                : `${problems.length} things still needed — go to the first`}
            </button>
          ) : justSaved ? (
            <span className="ev-bar__saved">
              <Icon name="check" size={14} /> Saved. It reaches the website at the next build.
            </span>
          ) : dirty ? (
            'Unsaved changes'
          ) : (
            ''
          )}
        </p>

        {/*
          Also held while a photograph uploads. Saving mid-upload writes the
          *previous* path and leaves the finished object orphaned, with the form
          showing an image the document does not have.
        */}
        <button
          type="button"
          className="button ev-bar__save"
          onClick={attemptSave}
          disabled={busy || !dirty}
        >
          {status.kind === 'saving' ? 'Saving…' : eventId ? 'Save changes' : 'Create event'}
        </button>
      </footer>
    </div>
  );
}
