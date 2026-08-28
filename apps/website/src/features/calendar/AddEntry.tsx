'use client';

import { useEffect, useRef, useState } from 'react';
import { EMPTY_SCHEDULE_ENTRY, SCHEDULE_KINDS, type ScheduleEntry } from '@spsm/shared';
import { addScheduleEntry } from './adminData';

const KIND_LABELS: Record<string, string> = {
  liturgy: 'Liturgy or prayer',
  study: 'Class or study',
  gathering: 'Meeting or gathering',
  other: 'Something else',
};

/**
 * Add something the parish is doing that no source knows about.
 *
 * ---------------------------------------------------------------------------
 * On /calendar, and in a dialog in the middle of it.
 *
 * On this page rather than a screen of its own, which is the site's settled
 * pattern — the shop is edited on its cards, a form in a drawer on /forms — and
 * it earns it here particularly well: whoever is adding a service is looking at
 * the week they are adding it to.
 *
 * In a dialog rather than inline, because inline it opened at the *foot* of the
 * page, which is where the button is and nowhere near where anybody is looking.
 * Centred, it arrives under the cursor. It also means the form and the event
 * dialog behave the same way, and both get the top layer's focus handling and
 * Escape for free — see the note in EventDialog.tsx.
 *
 * The form is deliberately short. Everything on it is something a calendar
 * needs; anything that only a *page* would need is absent, because an entry
 * that deserves a page should be an `Event`, which is made in the Firestore
 * console — `/staff/events` did it until 28 Aug 2026 and nothing replaced it.
 * ---------------------------------------------------------------------------
 */
export function AddEntry({ defaultDay, onAdded }: { defaultDay: string; onAdded: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ScheduleEntry>({
    ...EMPTY_SCHEDULE_ENTRY,
    day: defaultDay,
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const set = <K extends keyof ScheduleEntry>(field: K, value: ScheduleEntry[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  // `showModal()` throws if the dialog is already open, so this closes first.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const ready = draft.title.trim() !== '' && draft.day !== '';

  return (
    <>
      <button
        type="button"
        className="button sched-add__open"
        onClick={() => {
          setDraft({ ...EMPTY_SCHEDULE_ENTRY, day: defaultDay });
          setProblem(null);
          setOpen(true);
        }}
      >
        Add to the schedule
      </button>

      <dialog
        ref={dialog}
        className="sched-dialog sched-dialog--add"
        /* Fires however it was dismissed — Escape, the backdrop, or Cancel — so
           there is one path back to `open` rather than three that must agree. */
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
        aria-label="Add to the schedule"
      >
        <form
          className="sched-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;

            setBusy(true);
            setProblem(null);
            void addScheduleEntry({
              ...draft,
              title: draft.title.trim(),
              // An entry with no start time is an all-day entry. The parser says
              // the same thing; doing it here too means the stored document is
              // already coherent rather than relying on being read back through it.
              allDay: draft.startTime === '',
              endDay: draft.endDay === '' ? draft.day : draft.endDay,
            })
              .then(() => {
                dialog.current?.close();
                onAdded();
              })
              .catch((error: unknown) => {
                // The raw message. Whoever sees this is the person who can fix it,
                // and a rules refusal reads very differently from a network failure.
                setProblem(error instanceof Error ? error.message : String(error));
              })
              .finally(() => setBusy(false));
          }}
        >
          <h3>Add to the schedule</h3>

          <label>
            <span>What is it?</span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) => set('title', event.target.value)}
              placeholder="Choir practice"
              autoFocus
              required
            />
          </label>

          <div className="sched-add__pair">
            <label>
              <span>Day</span>
              <input
                type="date"
                value={draft.day}
                onChange={(event) => set('day', event.target.value)}
                required
              />
            </label>
            <label>
              <span>Until (optional)</span>
              <input
                type="date"
                value={draft.endDay}
                min={draft.day}
                onChange={(event) => set('endDay', event.target.value)}
              />
            </label>
          </div>

          <div className="sched-add__pair">
            <label>
              <span>Starts</span>
              <input
                type="time"
                value={draft.startTime}
                onChange={(event) => set('startTime', event.target.value)}
              />
            </label>
            <label>
              <span>Ends</span>
              <input
                type="time"
                value={draft.endTime}
                onChange={(event) => set('endTime', event.target.value)}
              />
            </label>
          </div>
          <p className="note">Leave the start time empty for something that runs all day.</p>

          <fieldset className="sched-add__kinds">
            {/*
          Asked rather than guessed. Every other source has its kind read off
          its title because there is nothing else to go on; here somebody is
          typing the thing in, so asking is both more accurate and less work.
        */}
            <legend>Kind</legend>
            {SCHEDULE_KINDS.map((kind) => (
              <label key={kind} className="sched-add__kind">
                <input
                  type="radio"
                  name="kind"
                  value={kind}
                  checked={draft.kind === kind}
                  onChange={() => set('kind', kind)}
                />
                <span
                  className={`sched-add__swatch sched-add__swatch--${kind}`}
                  aria-hidden="true"
                />
                {KIND_LABELS[kind]}
              </label>
            ))}
          </fieldset>

          <label>
            <span>Where (optional)</span>
            <input
              type="text"
              value={draft.location}
              onChange={(event) => set('location', event.target.value)}
              placeholder="Church hall"
            />
          </label>

          <label>
            <span>Note (optional)</span>
            <textarea
              rows={2}
              value={draft.note}
              onChange={(event) => set('note', event.target.value)}
            />
          </label>

          {problem && (
            <p className="sched-dialog__problem" role="alert">
              {problem}
            </p>
          )}

          <div className="sched-add__actions">
            <button type="submit" className="button" disabled={busy || !ready}>
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => dialog.current?.close()}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
