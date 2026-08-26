'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormAnswer, FormDefinition, SubmissionStatus } from '@spsm/shared';
import { money } from '@/features/bookstore/money';
import type { WithId } from '../data';
import { readSubmissions, setSubmissionStatus, type SubmissionRow } from './adminData';

/**
 * What people have sent in.
 *
 * ---------------------------------------------------------------------------
 * This panel is the reason the drawer needs a staff claim, not the builder.
 *
 * A form definition is public — `firestore.rules` serves every published one to
 * anybody. What is behind the claim is this: names, phone numbers, email
 * addresses, and whatever a given form thought to ask. The rules refuse the read
 * outright without `staff`, so someone who forces the panel open in their own
 * browser gets an error and no rows — but it is worth being clear that the
 * sensitivity of this feature lives here and not in the editor.
 * ---------------------------------------------------------------------------
 */

const STATUSES: { value: SubmissionStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'seen', label: 'Seen' },
  { value: 'handled', label: 'Handled' },
  { value: 'archived', label: 'Archived' },
];

export function SubmissionsPanel({
  formId,
  forms,
}: {
  formId: string | null;
  forms: WithId<FormDefinition>[];
}) {
  const [selected, setSelected] = useState<string | null>(formId);
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async (id: string | null) => {
    setRows(null);
    setError(null);
    try {
      setRows(await readSubmissions(id));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} — if this mentions an index, the link in the console builds it.`
          : 'The submissions could not be read.',
      );
    }
  }, []);

  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  const visible = (rows ?? []).filter(
    (row) => showArchived || row.status !== 'archived',
  );

  return (
    <div className="fxs">
      <div className="field-row">
        <label className="field">
          <span>Form</span>
          <select value={selected ?? ''} onChange={(event) => setSelected(event.target.value || null)}>
            <option value="">All forms</option>
            {forms
              .filter((form) => form.kind !== 'external')
              .map((form) => (
                <option key={form.id} value={form.id}>
                  {form.title}
                </option>
              ))}
          </select>
        </label>
        <label className="field field--check">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          <span>Show archived</span>
        </label>
      </div>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {rows === null && !error && <p className="note">Loading…</p>}
      {rows !== null && visible.length === 0 && <p className="note">Nothing here yet.</p>}

      <ul className="fxs__list">
        {visible.map((row) => (
          <SubmissionCard
            key={row.id}
            row={row}
            form={forms.find((form) => form.id === row.formId) ?? null}
            onStatus={(status) => {
              /*
               * Updated in place rather than re-reading the collection. The
               * list is sorted by date and a refetch would re-run the query for
               * a change that cannot alter the ordering — and would scroll a
               * volunteer working down a long queue back to the top.
               */
              setRows((previous) =>
                (previous ?? []).map((entry) =>
                  entry.id === row.id ? { ...entry, status } : entry,
                ),
              );
              void setSubmissionStatus(row.id, status);
            }}
          />
        ))}
      </ul>

      {rows !== null && rows.length >= 200 && (
        <p className="meta">Showing the 200 most recent.</p>
      )}
    </div>
  );
}

function SubmissionCard({
  row,
  form,
  onStatus,
}: {
  row: SubmissionRow;
  /** The definition, when it still exists — used only for field labels. */
  form: WithId<FormDefinition> | null;
  onStatus: (status: SubmissionStatus) => void;
}) {
  const [open, setOpen] = useState(row.status === 'new');

  return (
    <li className={`fxs__row is-${row.status}`}>
      <div className="fxs__head">
        <button type="button" className="fxs__who" onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{row.submitterName ?? '(no name given)'}</strong>
          <span className="fxs__meta">
            {row.formTitle}
            {row.submittedAt && ` · ${row.submittedAt.toLocaleDateString()}`}
            {row.totalCents > 0 && ` · ${money(row.totalCents)}`}
            {row.paymentId && ' · paid'}
          </span>
        </button>

        <select
          aria-label={`Status of ${row.submitterName ?? 'this submission'}`}
          value={row.status}
          onChange={(event) => onStatus(event.target.value as SubmissionStatus)}
        >
          {STATUSES.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </div>

      {open && (
        <dl className="fxs__answers">
          {(row.submitterEmail || row.submitterPhone) && (
            <>
              {row.submitterEmail && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${row.submitterEmail}`}>{row.submitterEmail}</a>
                  </dd>
                </>
              )}
              {row.submitterPhone && (
                <>
                  <dt>Phone</dt>
                  {/* A `tel:` link, because most of the people reading this on a
                      Sunday are on a phone and the next thing they do is ring. */}
                  <dd>
                    <a href={`tel:${row.submitterPhone.replace(/[^\d+]/g, '')}`}>
                      {row.submitterPhone}
                    </a>
                  </dd>
                </>
              )}
            </>
          )}

          {Object.entries(row.answers).map(([key, answer]) => (
            <div key={key} className="fxs__answer">
              <dt>{labelFor(form, key)}</dt>
              <dd>{render(form, key, answer)}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

/**
 * The question as it was asked, or the raw key.
 *
 * Falls back to the key rather than hiding the row, because a submission
 * outlives the form it came through — deleting a form leaves its submissions in
 * place. A row labelled `service-2` is worse than one labelled "Which service?"
 * and much better than one that is not shown at all.
 */
function labelFor(form: WithId<FormDefinition> | null, key: string): string {
  return form?.fields.find((field) => field.key === key)?.label || key;
}

/**
 * An answer, in the words the person actually saw.
 *
 * Stored answers are option *values* — `sunday-school`, not "Sunday School" —
 * because a value has to survive the label being retyped. Which means printing
 * them raw shows staff a string no one on the form ever read. Mapped back
 * through the definition where it still exists.
 */
function render(
  form: WithId<FormDefinition> | null,
  key: string,
  answer: FormAnswer,
): string {
  const field = form?.fields.find((entry) => entry.key === key);

  const one = (value: string): string =>
    field?.options.find((option) => option.value === value)?.label || value;

  if (Array.isArray(answer)) return answer.map(one).join(', ');
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (typeof answer === 'number') return String(answer);
  return one(answer);
}
