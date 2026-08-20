'use client';

import { useRef, useState } from 'react';
import type { DocOf, ProgramEvent } from '@spsm/shared';
import {
  submissionsAreOpen,
  submitOne,
  SUBMISSION_MAX_BYTES,
  type SubmissionState,
} from './submit';

/**
 * The form a parishioner uses to send photographs to a gallery.
 *
 * ## No account, and that is the design
 *
 * Sign-in on this site is Microsoft-only against the parish's Entra tenant, so
 * the people who *have* accounts are clergy, staff and servants — precisely not
 * the grandmother with forty photographs of the camp. Requiring an account here
 * would mean collecting nothing. What makes that acceptable is everything
 * downstream: the file lands in a quarantine prefix no visitor can read, the
 * document may only be created `pending`, and nothing is published until an
 * administrator has looked at it. See docs/program-galleries.md §4.
 *
 * ## Uploaded one at a time, on purpose
 *
 * Forty photographs from a phone is forty times several megabytes. Firing them
 * all at once saturates a domestic upstream link, and the browser's own
 * connection limit then queues them anyway — so the only thing parallelism buys
 * is that a failure halfway through is impossible to report against a
 * particular file. Sequential means the list on screen is honest: every row
 * says what actually happened to that photograph.
 */
export function SubmitPhotos({ event }: { event: DocOf<ProgramEvent> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [states, setStates] = useState<SubmissionState[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(chosen: FileList | null) {
    const list = chosen ? Array.from(chosen) : [];
    setFiles(list);
    setStates(list.map(() => ({ kind: 'waiting' }) as SubmissionState));
    setNotice(null);
  }

  function mark(index: number, state: SubmissionState) {
    setStates((previous) => {
      const next = [...previous];
      next[index] = state;
      return next;
    });
  }

  async function send() {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);

    /*
     * Checked once, against the live document, before anything is uploaded.
     *
     * The page's copy of `submissionsOpen` can be minutes old, and the rule
     * checks the real one — so without this a program that closed its gallery
     * this morning still shows the form, accepts forty uploads, and fails on
     * every document write with `permission-denied` after the waiting is done.
     */
    if (!(await submissionsAreOpen(event.id))) {
      setNotice('This gallery has stopped accepting photographs.');
      setBusy(false);
      return;
    }

    let sent = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      if (!file) continue;
      mark(index, { kind: 'sending' });
      try {
        await submitOne(file, { id: event.id, programId: event.programId });
        mark(index, { kind: 'sent' });
        sent += 1;
      } catch (error) {
        console.error('[galleries] submission failed:', error);
        mark(index, {
          kind: 'failed',
          message: error instanceof Error ? error.message : 'It could not be sent.',
        });
      }
    }

    setBusy(false);
    if (sent > 0) {
      setNotice(
        sent === files.length
          ? 'Thank you. The parish will look at these before they appear here.'
          : `${sent} of ${files.length} were sent. The rest are marked below.`,
      );
      // Cleared so the same photographs cannot be sent twice by a second click,
      // which produces duplicate documents that an administrator then has to
      // reject one at a time.
      setFiles([]);
      setStates([]);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  if (!event.submissionsOpen) return null;

  return (
    <section className="submit-photos">
      <h2>Send your photographs</h2>
      <p className="note">
        Photographs and short films from this gathering are welcome. They are reviewed
        before they appear on this page. Up to{' '}
        {Math.round(SUBMISSION_MAX_BYTES / 1024 / 1024)}MB each.
      </p>

      <input
        ref={inputRef}
        type="file"
        // `image/*,video/*` rather than a list of extensions: a phone offers its
        // camera roll for this and a file picker for a list, and the camera roll
        // is where the photographs are.
        accept="image/*,video/*"
        multiple
        disabled={busy}
        onChange={(e) => choose(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="submit-photos__list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span className="submit-photos__name">{file.name}</span>{' '}
              <StateLabel state={states[index] ?? { kind: 'waiting' }} />
            </li>
          ))}
        </ul>
      )}

      <p>
        <button className="button" onClick={send} disabled={busy || files.length === 0}>
          {busy ? 'Sending…' : `Send ${files.length || ''}`.trim()}
        </button>
      </p>

      {/*
        A live region, because the outcome arrives after an upload the visitor
        cannot see the progress of. Without it somebody using a screen reader
        clicks send and is told nothing at all.
      */}
      <p className="note" aria-live="polite">
        {notice}
      </p>
    </section>
  );
}

function StateLabel({ state }: { state: SubmissionState }) {
  if (state.kind === 'waiting') return <span className="meta">waiting</span>;
  if (state.kind === 'sending') return <span className="meta">sending…</span>;
  if (state.kind === 'sent') return <span className="submit-photos__ok">sent</span>;
  return <span className="submit-photos__bad">{state.message}</span>;
}
