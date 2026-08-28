'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  EMPTY_CALENDAR_DETAIL,
  isSafeLink,
  kindOf,
  type CalendarDetail,
  type CalendarOccurrence,
} from '@spsm/shared';
import { removeCalendarDetail, removeScheduleEntry, saveCalendarDetail } from './adminData';
import { dayParts, formatClock } from './range';

/**
 * One occurrence, opened.
 *
 * ---------------------------------------------------------------------------
 * A native `<dialog>`, not a div with a high z-index.
 *
 * The element brings the whole of modal behaviour with it and gets the parts
 * that are tedious to reimplement right: focus moves in on open and returns to
 * whatever was focused on close, Escape dismisses, the page behind is inert,
 * and it renders in the top layer so nothing on the page can end up above it.
 * The calendar has a wheel with a 3D transform in it, which creates a
 * containing block for positioned descendants — a hand-rolled overlay would
 * have had to escape that, and the top layer is not subject to it at all.
 *
 * The one thing to watch: `showModal()` throws if the dialog is already open,
 * so the effect below closes before it opens.
 * ---------------------------------------------------------------------------
 *
 * Staff get an editing form in the same dialog rather than a separate screen.
 * What they may do differs by source, and the difference is the point:
 *
 *   any occurrence     add or change a detail — a note, a location, a contact,
 *                      a link. Never a title or a time; those belong to
 *                      whichever source the entry came from.
 *   `manual` only      delete the whole thing, because the parish owns it.
 */
export function EventDialog({
  occurrence,
  day,
  detail,
  mayEdit,
  onClose,
  onChanged,
}: {
  occurrence: CalendarOccurrence | null;
  day: string | null;
  detail: CalendarDetail | null;
  mayEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (occurrence === null) {
      if (element.open) element.close();
      return;
    }
    if (!element.open) element.showModal();
  }, [occurrence]);

  if (occurrence === null) return null;

  const parts = day ? dayParts(day) : null;

  return (
    /*
     * `onClose` covers Escape and the close button alike — the element fires it
     * however it was dismissed, so there is one path back to the caller's state
     * rather than three that have to agree.
     *
     * `onClick` handles the backdrop: a click that lands on the dialog element
     * itself rather than on anything inside it *is* the backdrop, because the
     * backdrop is painted by the dialog's own box.
     */
    <dialog
      ref={dialog}
      className="sched-dialog"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-label={occurrence.title}
    >
      <div className="sched-dialog__inner">
        <header className="sched-dialog__head">
          <div>
            <h2 className={`sched-dialog__title sched-dialog__title--${kindOf(occurrence)}`}>
              {occurrence.title}
            </h2>
            {parts && (
              <p className="sched-dialog__when">
                {parts.weekday} {parts.dayOfMonth} {parts.month}
                {!occurrence.allDay && occurrence.startTime && (
                  <>
                    {' · '}
                    {formatClock(occurrence.startTime)}
                    {occurrence.endTime && ` until ${formatClock(occurrence.endTime)}`}
                  </>
                )}
                {occurrence.allDay && ' · All day'}
              </p>
            )}
          </div>

          <button
            type="button"
            className="sched-dialog__close"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {occurrence.imageUrl && (
          <img className="sched-dialog__image" src={occurrence.imageUrl} alt="" aria-hidden="true" />
        )}

        <dl className="sched-dialog__facts">
          {occurrence.location !== '' && (
            <>
              <dt>Where</dt>
              <dd>{occurrence.location}</dd>
            </>
          )}
          {occurrence.description !== '' && (
            <>
              <dt>Notes</dt>
              <dd>{occurrence.description}</dd>
            </>
          )}
          {occurrence.contact && (
            <>
              <dt>Contact</dt>
              <dd>{occurrence.contact}</dd>
            </>
          )}
          {occurrence.link && (
            <>
              <dt>Link</dt>
              <dd>
                {/* `noopener` because this leaves the site. `noreferrer` too:
                    a Zoom room's referrer log has no business knowing which
                    page of a church website somebody came from. */}
                <a href={occurrence.link.url} target="_blank" rel="noopener noreferrer">
                  {occurrence.link.label}
                </a>
              </dd>
            </>
          )}
          {occurrence.href && (
            <>
              <dt>Page</dt>
              <dd>
                <Link href={occurrence.href}>Read more about this</Link>
              </dd>
            </>
          )}
        </dl>

        {!hasAnything(occurrence) && !mayEdit && (
          <p className="sched-dialog__bare">
            Nothing more is recorded about this one.
          </p>
        )}

        {mayEdit && (
          <DetailForm
            occurrence={occurrence}
            detail={detail}
            onChanged={onChanged}
            onDone={() => dialog.current?.close()}
          />
        )}
      </div>
    </dialog>
  );
}

/** Whether the dialog has anything to say beyond the title and the time. */
function hasAnything(occurrence: CalendarOccurrence): boolean {
  return (
    occurrence.location !== '' ||
    occurrence.description !== '' ||
    occurrence.contact !== null ||
    occurrence.link !== null ||
    occurrence.href !== null
  );
}

/**
 * The staff editing form.
 *
 * Title and time are shown above and are **not** fields. They belong to
 * whichever source the occurrence came from, and a website that quietly
 * disagreed with Breeze about when the Liturgy starts would be worse than one
 * that says less. What is editable is what no source supplies.
 */
function DetailForm({
  occurrence,
  detail,
  onChanged,
  onDone,
}: {
  occurrence: CalendarOccurrence;
  detail: CalendarDetail | null;
  onChanged: () => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<CalendarDetail>(
    detail ?? { ...EMPTY_CALENDAR_DETAIL, occurrenceId: occurrence.id },
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A different occurrence in the same dialog is a different draft.
  useEffect(() => {
    setDraft(detail ?? { ...EMPTY_CALENDAR_DETAIL, occurrenceId: occurrence.id });
    setProblem(null);
  }, [occurrence.id, detail]);

  const set = (field: keyof CalendarDetail) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      onChanged();
    } catch (error) {
      // The raw message: the person seeing this is the one who can fix it, and
      // "could not save" would send them to the code rather than to the rules.
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const linkIsBad = draft.linkUrl !== '' && !isSafeLink(draft.linkUrl);

  return (
    <form
      className="sched-dialog__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (linkIsBad) return;
        void run(async () => {
          const { occurrenceId: _ignored, ...rest } = draft;
          await saveCalendarDetail(occurrence.id, rest);
          onDone();
        });
      }}
    >
      <h3>Details</h3>
      <p className="note">
        Anyone can see these. The title and the time come from{' '}
        {occurrence.source === 'manual' ? 'this entry' : sourceName(occurrence.source)} and are not
        edited here.
      </p>

      <label>
        <span>Note</span>
        <textarea
          rows={2}
          value={draft.note}
          onChange={(event) => set('note')(event.target.value)}
          placeholder="Bring a jacket — we are in the hall this week."
        />
      </label>

      <label>
        <span>Where</span>
        <input
          type="text"
          value={draft.location}
          onChange={(event) => set('location')(event.target.value)}
          placeholder="Church hall, lower level"
        />
      </label>

      <div className="sched-dialog__pair">
        <label>
          <span>Contact</span>
          <input
            type="text"
            value={draft.contactName}
            onChange={(event) => set('contactName')(event.target.value)}
            placeholder="Servant Michael"
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="tel"
            value={draft.contactPhone}
            onChange={(event) => set('contactPhone')(event.target.value)}
            placeholder="(774) 573-7878"
          />
        </label>
      </div>

      <div className="sched-dialog__pair">
        <label>
          <span>Link</span>
          <input
            type="url"
            value={draft.linkUrl}
            onChange={(event) => set('linkUrl')(event.target.value)}
            placeholder="https://zoom.us/j/…"
            aria-invalid={linkIsBad || undefined}
          />
        </label>
        <label>
          <span>Link text</span>
          <input
            type="text"
            value={draft.linkLabel}
            onChange={(event) => set('linkLabel')(event.target.value)}
            placeholder="Join on Zoom"
          />
        </label>
      </div>

      {linkIsBad && (
        <p className="sched-dialog__problem" role="alert">
          A link has to start with http:// or https://.
        </p>
      )}
      {problem && (
        <p className="sched-dialog__problem" role="alert">
          {problem}
        </p>
      )}

      <div className="sched-dialog__actions">
        <button type="submit" className="button" disabled={busy || linkIsBad}>
          {busy ? 'Saving…' : 'Save details'}
        </button>

        {detail && (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => void run(() => removeCalendarDetail(occurrence.id))}
          >
            Clear details
          </button>
        )}

        {/*
          Only for `manual`. Everything else was read from somewhere the parish
          maintains separately, and deleting a liturgy here would not delete it
          from Breeze — it would make the website disagree until the next read
          put it back. See schema/scheduleAdmin.ts.
        */}
        {occurrence.source === 'manual' && (
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await removeScheduleEntry(occurrence.id);
                onDone();
              })
            }
          >
            Remove this entry
          </button>
        )}
      </div>
    </form>
  );
}

function sourceName(source: CalendarOccurrence['source']): string {
  if (source === 'bulletin') return 'the weekly bulletin';
  if (source === 'feature') return "the event's own page";
  return 'the church calendar in Breeze';
}
