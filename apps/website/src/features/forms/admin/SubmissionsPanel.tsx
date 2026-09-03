'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormAnswer, FormDefinition, SubmissionStatus } from '@spsm/shared';
import { money } from '@/features/bookstore/money';
import { isFormUploadPath } from '@spsm/shared';
import type { WithId } from '../data';
import { readFormPhotoUrl } from '../uploads';
import {
  deleteSubmission,
  readSubmissions,
  setSubmissionStatus,
  type SubmissionRow,
} from './adminData';

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
 *
 * ---------------------------------------------------------------------------
 * **A queue, not a list.** The first version drew every submission as an open
 * card with each answer under it, which meant a Sunday's worth of contact
 * messages was several screens of scrolling with no way to tell where the
 * unread ones were. Three things changed and each is a decision:
 *
 *   1. **Rows are shut by default.** Open is the exception — a `new` row opens
 *      itself, because the reason to be in this panel at all is the thing
 *      nobody has read yet.
 *   2. **The filter carries counts.** "New 4" answers the only question a
 *      volunteer opens the drawer to ask, without them having to read the list
 *      to find out. It also makes an empty queue legible: `New 0` is a
 *      different, better thing to see than an empty box.
 *   3. **The contact details are not repeated.** Nearly every form asks for a
 *      name, an email and a phone number, and `formSubmit` copies those three
 *      onto the submission so the panel can show them without knowing the
 *      form. Printing both copies meant the top of every card said the same
 *      three things twice. `redundant()` drops the answer when it is the field
 *      already above it — by value, so a form that asks for something subtly
 *      different keeps both.
 * ---------------------------------------------------------------------------
 */

const STATUSES: { value: SubmissionStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'seen', label: 'Seen' },
  { value: 'handled', label: 'Handled' },
  { value: 'archived', label: 'Archived' },
];

/** The filter above the list. `null` is every status except archived. */
type Filter = SubmissionStatus | null;

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
  const [filter, setFilter] = useState<Filter>(null);
  const [term, setTerm] = useState('');

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

  const all = rows ?? [];

  const counts = useMemo(() => {
    const tally = { new: 0, seen: 0, handled: 0, archived: 0 };
    for (const row of all) tally[row.status] += 1;
    return tally;
  }, [all]);

  /*
   * The search runs over the answers as well as the three contact fields.
   *
   * A volunteer looking for "the van for the Sturbridge retreat" has the
   * destination and not the name, and the destination is an answer. Matching
   * only the header would make the box look broken for the search anybody
   * actually types.
   */
  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return all.filter((row) => {
      if (filter === null ? row.status === 'archived' : row.status !== filter) return false;
      if (!needle) return true;
      return haystack(row).includes(needle);
    });
  }, [all, filter, term]);

  return (
    <div className="fxs">
      <div className="fxs__bar">
        <label className="fxs__pick">
          <span className="visually-hidden">Form</span>
          <select
            value={selected ?? ''}
            onChange={(event) => setSelected(event.target.value || null)}
          >
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

        <label className="fxs__search">
          <span className="visually-hidden">Search these submissions</span>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5 21 21" />
          </svg>
          <input
            type="search"
            value={term}
            placeholder="Search name, email, or an answer"
            onChange={(event) => setTerm(event.target.value)}
          />
        </label>
      </div>

      <div className="fxs__filter" role="group" aria-label="Filter by status">
        <button
          type="button"
          className={filter === null ? 'chip is-on' : 'chip'}
          aria-pressed={filter === null}
          onClick={() => setFilter(null)}
        >
          Open
          <span className="chip__count">{counts.new + counts.seen + counts.handled}</span>
        </button>
        {STATUSES.map((status) => (
          <button
            key={status.value}
            type="button"
            className={filter === status.value ? 'chip is-on' : 'chip'}
            aria-pressed={filter === status.value}
            onClick={() => setFilter(status.value)}
          >
            {status.label}
            <span className="chip__count">{counts[status.value]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="notice notice--alarm" role="alert">
          <p>{error}</p>
        </div>
      )}

      {rows === null && !error && (
        <ul className="fxs__list" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <li key={n} className="fxs__ghost" />
          ))}
        </ul>
      )}

      {rows !== null && visible.length === 0 && (
        <p className="fxs__empty">
          {term.trim()
            ? `Nothing here matches “${term.trim()}”.`
            : filter === null
              ? 'Nothing waiting. Anything archived is under Archived.'
              : `No ${STATUSES.find((s) => s.value === filter)?.label.toLowerCase()} submissions.`}
        </p>
      )}

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
            onDeleted={() => {
              setRows((previous) => (previous ?? []).filter((entry) => entry.id !== row.id));
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

/** Everything on a row that a search should be able to find it by. */
function haystack(row: SubmissionRow): string {
  return [
    row.submitterName,
    row.submitterEmail,
    row.submitterPhone,
    row.formTitle,
    ...Object.values(row.answers).map((answer) =>
      Array.isArray(answer) ? answer.join(' ') : String(answer),
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function SubmissionCard({
  row,
  form,
  onStatus,
  onDeleted,
}: {
  row: SubmissionRow;
  /** The definition, when it still exists — used only for field labels. */
  form: WithId<FormDefinition> | null;
  onStatus: (status: SubmissionStatus) => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(row.status === 'new');
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const answers = Object.entries(row.answers).filter(
    ([, answer]) => !redundant(row, answer),
  );

  const who = row.submitterName ?? '(no name given)';

  async function destroy() {
    setDeleting(true);
    setFailed(null);
    try {
      await deleteSubmission(row.id);
      onDeleted();
    } catch (cause) {
      setDeleting(false);
      setFailed(
        cause instanceof Error ? cause.message : 'The submission could not be deleted.',
      );
    }
  }

  return (
    <li className={`fxs__row is-${row.status}`}>
      <div className="fxs__head">
        <button
          type="button"
          className="fxs__who"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="fxs__caret" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
          <span className="fxs__ident">
            <strong>{who}</strong>
            {/*
              The form title truncates; the date does not.
              -----------------------------------------------------------------
              These were one string with a `·` between them and `text-overflow`
              over the pair, which on a phone meant "Contact the church
              office · …" — the title, which is the same on half the queue, at
              the cost of how long the person has been waiting. Two spans, and
              the one that gives way is the repeated one.
            */}
            <span className="fxs__meta">
              <span className="fxs__form">{row.formTitle}</span>
              {row.submittedAt && <span className="fxs__when">{when(row.submittedAt)}</span>}
            </span>
          </span>
          {row.totalCents > 0 && (
            <span className={row.paymentId ? 'fxs__paid' : 'fxs__owed'}>
              {money(row.totalCents)}
              {!row.paymentId && ' owed'}
            </span>
          )}
        </button>

        {/*
          A native select, styled as the status pill rather than replaced by a
          menu of buttons. Four statuses is one tap on a phone this way, it is
          already reachable from a keyboard, and the colour is never the whole
          signal — the chosen word is inside the pill.
        */}
        <label className={`fxs__status is-${row.status}`}>
          <span className="visually-hidden">Status of {who}</span>
          <select
            value={row.status}
            onChange={(event) => onStatus(event.target.value as SubmissionStatus)}
          >
            {STATUSES.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {open && (
        <div className="fxs__body">
          {(row.submitterEmail || row.submitterPhone) && (
            <div className="fxs__reach">
              {row.submitterEmail && (
                <a className="fxs__reach-link" href={`mailto:${row.submitterEmail}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M3.5 6.5 12 13l8.5-6.5" />
                  </svg>
                  {row.submitterEmail}
                </a>
              )}
              {row.submitterPhone && (
                /* A `tel:` link, because most of the people reading this on a
                   Sunday are on a phone and the next thing they do is ring. */
                <a
                  className="fxs__reach-link"
                  href={`tel:${row.submitterPhone.replace(/[^\d+]/g, '')}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.7 1.5A15.5 15.5 0 0 1 3.5 5.2 1.5 1.5 0 0 1 5 3.5Z" />
                  </svg>
                  {row.submitterPhone}
                </a>
              )}
            </div>
          )}

          {answers.length > 0 && (
            <dl className="fxs__answers">
              {answers.map(([key, answer]) => {
                const photo = isFormUploadPath(answer);
                const text = photo ? '' : render(form, key, answer);
                /*
                 * A paragraph takes the whole width; a word shares the row.
                 *
                 * Decided here rather than in CSS, and that is not a
                 * preference. `:has(dd > …)` was the first attempt and it
                 * cannot work: a rendered answer is a *text node*, which no
                 * selector can match on, so every answer looked short and the
                 * message on a contact submission was a ragged strip down one
                 * half of the row. The component is the only thing that knows
                 * how long the string is.
                 */
                const wide = photo || text.length > 60 || text.includes('\n');

                return (
                  <div key={key} className={wide ? 'fxs__answer is-wide' : 'fxs__answer'}>
                    <dt>{labelFor(form, key)}</dt>
                    <dd>{photo ? <SubmittedPhoto path={answer} /> : text}</dd>
                  </div>
                );
              })}
            </dl>
          )}

          {answers.length === 0 && !row.submitterEmail && !row.submitterPhone && (
            <p className="fxs__empty">This submission carries no answers.</p>
          )}

          {failed && (
            <div className="notice notice--alarm" role="alert">
              <p>{failed}</p>
            </div>
          )}

          {/*
            Delete asks first, and the question is a paragraph rather than a
            second button labelled "Really".
            -------------------------------------------------------------------
            A submission is the only record that this person asked the church
            for something. There is no soft delete, no recycle bin, and no
            export — `formSubmit` notified whoever the form names by email and
            that copy is the only other one there will ever be. So the warning
            names the person, says plainly that it cannot be undone, and points
            at Archived, which is what nearly everyone pressing Delete actually
            wants: the row out of the queue without the record destroyed.
            -------------------------------------------------------------------
          */}
          {confirming ? (
            <div className="fxs__warn" role="alertdialog" aria-label={`Delete ${who}?`}>
              <p className="fxs__warn-lede">
                Delete {who}’s submission to {row.formTitle}?
              </p>
              <p>
                This destroys it for good — there is no undo and no copy kept.
                {row.paymentId && ' A payment was taken against this record.'}
              </p>
              <p>
                To take it out of the queue and keep the record, set it to{' '}
                <strong>Archived</strong> instead.
              </p>
              <div className="fxs__warn-actions">
                <button
                  type="button"
                  className="button button--danger"
                  disabled={deleting}
                  onClick={() => void destroy()}
                >
                  {deleting ? 'Deleting…' : 'Delete for good'}
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={deleting}
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </button>
                <button
                  type="button"
                  className="button button--quiet"
                  disabled={deleting}
                  onClick={() => {
                    setConfirming(false);
                    onStatus('archived');
                  }}
                >
                  Archive instead
                </button>
              </div>
            </div>
          ) : (
            <div className="fxs__actions">
              {row.submittedAt && (
                <span className="fxs__stamp">
                  {row.submittedAt.toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              )}
              <button
                type="button"
                className="fxs__delete"
                onClick={() => setConfirming(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9L17.5 7" />
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * "3 days ago", and the exact stamp is in the open row.
 *
 * Relative up to a month because that is the whole life of a submission in this
 * queue — a volunteer wants to know whether the person has been waiting since
 * this morning or since last Sunday, and "8/31/2026" makes them work that out.
 * Past a month the arithmetic stops being useful and the date is better.
 */
function when(at: Date): string {
  const days = Math.round((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Whether an answer is the same thing as one of the three fields above it.
 *
 * Compared by value rather than by key. `formSubmit` copies name, email and
 * phone onto the submission from whichever fields it recognised, so the keys it
 * copied from are not knowable here — and a form that asks for, say, a second
 * contact's email should keep showing it.
 */
function redundant(row: SubmissionRow, answer: FormAnswer): boolean {
  if (typeof answer !== 'string') return false;
  const value = answer.trim();
  if (!value) return false;
  return (
    value === row.submitterName?.trim() ||
    value === row.submitterEmail?.trim() ||
    value === row.submitterPhone?.trim()
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

/**
 * A photograph somebody attached, fetched with the reviewer's own credentials.
 *
 * `formUploads/` is readable only by staff, which is the whole point of the
 * quarantine — so the URL cannot be stored on the submission and cannot be
 * resolved until a member of staff opens the row. It is fetched here, per photo,
 * when the row is expanded.
 *
 * A failure renders the path as text rather than a broken image. Two things
 * produce one and they are worth telling apart in the console: the file is
 * genuinely gone, or `storage.rules` has not been deployed — which on this
 * project is a live hazard, since that file went undeployed for months.
 */
function SubmittedPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readFormPhotoUrl(path).then((resolved) => {
      if (cancelled) return;
      if (resolved) setUrl(resolved);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed) return <code className="fxs__missing">{path}</code>;
  if (!url) return <span className="meta">Loading photo…</span>;

  return (
    <a className="fxs__photo" href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt="" loading="lazy" />
      <span className="visually-hidden">Open the attached photograph in a new tab</span>
    </a>
  );
}
