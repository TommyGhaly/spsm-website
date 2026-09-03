'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import {
  defaultSubmissionNode,
  submissionTargets,
  type DocOf,
  type GalleryTree,
  type Program,
  type ProgramEvent,
  type SubmissionTarget,
  MAX_FILES_PER_BATCH,
  VIDEO_MAX_BYTES,
  formatBytes,
} from '@spsm/shared';
import {
  prepare,
  programAcceptsSubmissions,
  submitOne,
  type Prepared,
  type SubmissionState,
} from './submit';
import { useProgramAdmin } from './useProgramAdmin';

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
 * ## On every level, including the ministry's own page
 *
 * This used to render only on a level, and only while that level's own
 * `submissionsOpen` was true — so a visitor on the Summercamp page had nowhere
 * to send anything, and a visitor on Day 1 could send only to Day 1. Both are
 * now the same form: it appears wherever a gallery does, and the level is
 * something the sender chooses rather than something the URL decides.
 *
 * A parishioner looking at the Week 1 page may well be holding photographs of
 * Day 3. The old form filed those under Week 1 and an administrator moved every
 * one of them by hand.
 *
 * ## Many pictures at a time, and the three things that took
 *
 * `multiple` was always on the input, and that was not the same as supporting a
 * batch:
 *
 *  - **Picking again replaced the batch.** The handler called `setFiles(list)`,
 *    so somebody who selected twelve photographs and then remembered four more
 *    lost the twelve. On iOS that is not an edge case — the picker offers one
 *    album at a time, so "add the rest" is the *normal* way to send a set. Files
 *    are appended now, and an identical file picked twice is dropped.
 *  - **There was no way to change your mind about one.** Forty rows and no ×, so
 *    removing one photograph meant starting the selection over.
 *  - **You could not see what you had picked.** Forty filenames off a phone are
 *    forty variations of `IMG_0042`, which tells nobody anything. Each row
 *    carries a thumbnail now, drawn from the file in the browser, uploading
 *    nothing.
 *
 * Dropping files on the box works too — the obvious gesture on a laptop where
 * the photographs are in a folder that is already open.
 *
 * ## A choice per photograph, not per batch
 *
 * Forty photographs off a phone are rarely all from the same afternoon. The
 * batch control sets every row at once — the common case, and one click — and
 * each row can then disagree with it.
 *
 * Nothing here is trusted. The queue re-files whatever it likes before
 * approving; this is a stranger's opinion, offered because they are the only
 * person who knows which day their photographs are of.
 *
 * ## Uploaded one at a time, on purpose
 *
 * Forty photographs from a phone is forty times several megabytes. Firing them
 * all at once saturates a domestic upstream link, and the browser's own
 * connection limit then queues them anyway — so the only thing parallelism buys
 * is that a failure halfway through is impossible to report against a particular
 * file. Sequential means the list on screen is honest: every row says what
 * actually happened to that photograph.
 */

/** One file waiting to be sent, with everything its row needs to draw itself. */
interface Picked {
  /**
   * A stable key, not the filename.
   *
   * Two photographs off two phones are both `IMG_0042.HEIC`, and React keyed on
   * the name would hand one row's thumbnail and upload state to the other.
   */
  id: string;
  file: File;
  /**
   * The condensed bytes and what to say about them, or null while that is
   * still being worked out.
   *
   * Computed when the file is *chosen* rather than when it is sent, which is
   * the whole point of it living on the row: the "condensed" note has to be on
   * screen before anything is uploaded, so that nobody is surprised afterwards
   * by what left their laptop.
   */
  prepared: Prepared | null;
  /** The level its sender chose for it. */
  target: string;
  state: SubmissionState;
  /**
   * An `object:` URL for the thumbnail, or null for a video and for anything the
   * browser will not draw.
   *
   * Revoked when the row goes away and when the form unmounts — see `revoke`.
   * Forty un-revoked URLs is forty phone photographs held in memory for as long
   * as the tab is open.
   */
  preview: string | null;
}

export function SubmitPhotos({
  program,
  tree,
  node,
}: {
  program: DocOf<Program>;
  tree: GalleryTree<DocOf<ProgramEvent>>;
  /** The level whose page this is, or null for the ministry's own page. */
  node: DocOf<ProgramEvent> | null;
}) {
  /**
   * Whether the panel is open. Closed is the resting state.
   *
   * Tommy: *"I want the add photos section to be on the top and I want it to be a
   * button that opens a panel."* Both halves are one change. The form used to be a
   * whole section at the foot of the page — a drop zone, a row per file with its own
   * level picker, a batch control — and the note above its call site argued that
   * somebody arriving from a link came to look at the photographs, so the invitation
   * belonged after them. That reasoning holds for a *section* and is what makes a
   * section the wrong shape: at the top it would push the gallery down, and at the
   * bottom nobody sending photographs can find it.
   *
   * A button is small enough to sit at the top without costing the pictures
   * anything, and the panel is where the form gets the room it actually needs.
   */
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  /**
   * What the batch control is showing.
   *
   * Held rather than derived, because the control writes every row and then has
   * nothing to read itself back from — a row may disagree with it a moment later.
   * A `<select>` rendered with a value it does not hold snaps back to its
   * placeholder after every choice, which is the same class of bug as the scroll
   * wheel edits that appeared to do nothing.
   */
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * Whether the person filling this in runs the ministry, held in a ref.
   *
   * A ref because `add` is a plain function called from an event handler and
   * would otherwise close over a stale value from the render in which the file
   * input was created — the grant arrives asynchronously, so on a fast pick it
   * is very often still false at that moment.
   *
   * It decides one thing only: whether to condense. `useProgramAdmin` says in
   * its own header that it decides what to *draw*, and this is no exception —
   * the upload endpoint makes the same decision independently from a verified
   * token, so getting this wrong costs a needlessly shrunk photograph, never an
   * upload somebody was not entitled to.
   */
  const admin = useProgramAdmin();
  const isProgramAdmin = useRef(false);
  isProgramAdmin.current = admin.ready && admin.canEditProgram(program.id);

  /*
   * Everywhere a photograph may be sent: the ministry itself, then every level
   * in it in reading order, with its depth.
   *
   * The whole tree rather than this level's subtree, and that is the point of the
   * control: somebody standing on Day 1 with photographs of Day 3 can say so.
   * Memoised because a `<select>` of two hundred options should not be rebuilt on
   * every keystroke of nothing.
   *
   * **The ministry is one of the rows now** — see `submissionTargets`. That is
   * what makes this list impossible to be empty, which in turn is what removed
   * the early return below: a program with no levels yet used to render no form,
   * and the five ministries in production have no published levels between them,
   * so in practice the upload button existed nowhere at all.
   */
  const rows = useMemo(() => submissionTargets(program, tree), [program, tree]);

  /*
   * Where a file goes unless the sender says otherwise — the priority section,
   * then this page, then the first level. The rule lives in ./submit and is
   * unit-tested: every branch of it produces a form that looks entirely correct
   * and files photographs somewhere nobody chose.
   */
  /*
   * Escape closes the panel, but never over the top of staged files — see
   * `closable` below, which is the same condition the × uses. Declared here with the
   * other hooks rather than beside the panel, because a hook after an early return
   * is a hook that does not always run.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (picked.length === 0 && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, picked.length, busy]);

  /*
   * Where a file goes unless the sender says otherwise.
   *
   * `defaultSubmissionNode` answers "which level" and returns null for a ministry
   * with none; the ministry itself is the answer to that null now rather than a
   * reason to render nothing. The order it applies — priority section, then this
   * page, then the first level — is unchanged, so a ministry that *has* levels
   * preselects exactly what it did before and no reviewer's habits change.
   */
  const fallback = useMemo(
    () =>
      defaultSubmissionNode(tree, program.prioritySubmissionNodeId, node?.id ?? null) ??
      program.id,
    [tree, program.prioritySubmissionNodeId, node, program.id],
  );

  /*
   * Every live thumbnail URL, mirrored in a ref.
   *
   * The unmount cleanup needs the *current* set, and an effect with `[]`
   * dependencies closes over the first render's empty one — so without this the
   * cleanup revokes nothing and every thumbnail leaks. A ref is read when the
   * cleanup actually runs.
   */
  const live = useRef<Set<string>>(new Set());
  useEffect(
    () => () => {
      for (const url of live.current) URL.revokeObjectURL(url);
      live.current.clear();
    },
    [],
  );

  const revoke = useCallback((url: string | null) => {
    if (url === null) return;
    URL.revokeObjectURL(url);
    live.current.delete(url);
  }, []);

  /**
   * Add files to the batch rather than replacing it.
   *
   * The duplicate check is name + size + modified time, which is as close to
   * identity as a browser gives for a `File`. It exists because appending makes
   * picking twice easy, and picking the same album twice is then an easy
   * mistake — and a duplicate is not harmless here: `submissionPath` gives every
   * upload a fresh UUID, so two identical files become two real submissions that
   * an administrator refuses one at a time.
   */
  function add(chosen: FileList | null) {
    if (!chosen || chosen.length === 0) return;
    setNotice(null);

    /*
     * Read out of the `FileList` **now**, before anything else in this function.
     *
     * This is not defensive style, it is a bug that shipped and was caught in the
     * browser. `input.value = ''` at the bottom does not merely reset the
     * control — it empties the very `FileList` object this was handed, in place,
     * same object identity. And `Array.from(chosen)` used to live inside the
     * `setPicked` updater, which React defers to render time. So by the time the
     * updater ran the list had been emptied under it, and picking a second batch
     * added nothing at all while looking like it had worked.
     *
     * Measured in Chrome: after `dispatchEvent`, the captured `FileList` reports
     * `length: 0` and is `===` the input's own.
     */
    const incoming = Array.from(chosen);

    /*
     * The thumbnails, also created eagerly.
     *
     * Same reason plus one more: a state updater must be safe to call twice, and
     * React does exactly that in development to surface impurity. Minting object
     * URLs in there would leak one per file per double-invoke.
     */
    const candidates: Picked[] = incoming.map((file) => {
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      if (preview) live.current.add(preview);
      return {
        id: crypto.randomUUID(),
        file,
        prepared: null,
        target: fallback ?? '',
        state: { kind: 'waiting' } as SubmissionState,
        preview,
      };
    });

    /*
     * Decided out here, against this render's `picked`, for the reason given
     * inside the updater below. It can only disagree with the trim if state
     * changed between the choice and the update — which needs a second batch
     * mid-flight — and being wrong costs a sentence, not a photograph.
     */
    if (picked.length + incoming.length > MAX_FILES_PER_BATCH) {
      setNotice(
        `That is more than ${MAX_FILES_PER_BATCH} photographs at once. The first ${MAX_FILES_PER_BATCH} are below — send those, then choose the rest.`,
      );
    }

    setPicked((previous) => {
      const seen = new Set(previous.map(({ file }) => identity(file)));
      const added: Picked[] = [];

      for (const candidate of candidates) {
        const key = identity(candidate.file);
        if (seen.has(key)) {
          // A duplicate never reaches the list, so nothing else will ever revoke
          // its thumbnail. Idempotent, which is what makes it safe here: React
          // may run this updater twice, and revoking a revoked URL does nothing.
          revoke(candidate.preview);
          continue;
        }
        seen.add(key);
        added.push(candidate);
      }

      /*
       * The cap, applied to the batch as a whole rather than to one pick.
       *
       * Sixty comfortably covers a camp day emptied off a phone. It is here to
       * stop the accident — a whole photo library dragged in by mistake, which
       * would otherwise sit there condensing for ten minutes — rather than to
       * stop an attacker, who is not running this file at all.
       *
       * The message about it is *not* set from in here, and cannot be. React
       * invokes an updater twice in development to surface impurity, so a
       * `setNotice` on this line would be a side effect inside an updater — the
       * same shape of bug that once doubled every cart statistic in the
       * bookstore. Nor can a flag be set here and read after the call: the
       * updater is deferred, so the read happens first and always sees `false`
       * (measured — the trim worked and the message never appeared). The
       * message is decided before the call instead, from the render's own
       * `picked`, which is current at the moment somebody chooses files.
       */
      const room = MAX_FILES_PER_BATCH - previous.length;
      if (added.length > room) {
        for (const extra of added.slice(Math.max(0, room))) revoke(extra.preview);
        added.length = Math.max(0, room);
      }

      return added.length === 0 ? previous : [...previous, ...added];
    });

    /*
     * Condense in the background, one at a time.
     *
     * Sequential rather than `Promise.all`: each of these decodes a full-size
     * photograph onto a canvas, and forty at once on a phone is how you get the
     * tab killed. The rows are already on screen and each one fills in its own
     * note as it finishes, so the wait is visible rather than a frozen form.
     */
    void (async () => {
      for (const candidate of candidates) {
        try {
          const result = await prepare(candidate.file, isProgramAdmin.current);
          patch(candidate.id, {
            prepared: result,
            ...(result.refusal
              ? { state: { kind: 'failed', message: result.refusal } as SubmissionState }
              : {}),
          });
        } catch (error) {
          /*
           * Never silently. `prepare` is written not to throw — every failure
           * inside it returns the original file — so reaching this means
           * something unforeseen, and an unhandled rejection here would leave
           * the row sitting at "ready" forever with no note and no explanation.
           *
           * The row is left with `prepared: null`, which `send` treats as "not
           * condensed yet" and redoes on the spot. So the photograph still goes,
           * just without the saving.
           */
          console.error('[galleries] could not prepare a file for sending:', error);
        }
      }
    })();

    /*
     * Cleared so that choosing the *same* file again is a change event the
     * browser will actually fire. An input still holding `IMG_1.jpg` fires
     * nothing when `IMG_1.jpg` is picked a second time, which reads as the form
     * ignoring the click — and re-adding a file just removed is a thing people
     * do.
     */
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(id: string) {
    setPicked((previous) => {
      revoke(previous.find((one) => one.id === id)?.preview ?? null);
      return previous.filter((one) => one.id !== id);
    });
  }

  function clearAll() {
    setPicked((previous) => {
      for (const one of previous) revoke(one.preview);
      return [];
    });
    setBatch('');
    setNotice(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  /** Patch one row. Functional, so a run of quick changes cannot collapse. */
  function patch(id: string, next: Partial<Pick<Picked, 'state' | 'target' | 'prepared'>>) {
    setPicked((previous) => previous.map((one) => (one.id === id ? { ...one, ...next } : one)));
  }

  async function send() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setNotice(null);

    /*
     * Checked once, against the live document, before anything is uploaded.
     *
     * The page's copy of `submissionsOpen` can be minutes old, and the rule
     * checks the real one — so without this a ministry that stopped collecting
     * this morning still shows the form, accepts forty uploads, and fails on
     * every document write with `permission-denied` after the waiting is done.
     *
     * One read for the batch, whatever mix of levels it is filed across: the flag
     * is on the ministry now, not on the level.
     */
    if (!(await programAcceptsSubmissions(program.id))) {
      setNotice('The church has stopped collecting photographs here.');
      setBusy(false);
      return;
    }

    /*
     * Iterated over a snapshot rather than over `picked`, which is state and is
     * rewritten by `patch` on every file. Rows already sent are skipped, so
     * pressing Send again after a partial failure retries the failures and does
     * not upload the successes twice.
     */
    const queue = picked.filter((one) => one.state.kind !== 'sent');
    const sent: string[] = [];

    for (const one of queue) {
      const target = one.target || fallback;
      if (!target) {
        patch(one.id, {
          state: { kind: 'failed', message: 'There is nowhere to file this yet.' },
        });
        continue;
      }
      patch(one.id, { state: { kind: 'sending' } });
      try {
        /*
         * Condensing normally finished while the sender was choosing levels,
         * but Send is reachable before it has: forty photographs take a moment
         * and nothing stops somebody pressing it immediately. Doing the work
         * here in that case is simpler than disabling the button, and it is the
         * same call — `prepare` is what filled the row in the first place.
         */
        const ready = one.prepared ?? (await prepare(one.file, isProgramAdmin.current));
        await submitOne(ready, { id: target, programId: program.id });
        patch(one.id, { state: { kind: 'sent' } });
        sent.push(one.id);
      } catch (error) {
        console.error('[galleries] submission failed:', error);
        patch(one.id, {
          state: {
            kind: 'failed',
            message: error instanceof Error ? error.message : 'It could not be sent.',
          },
        });
      }
    }

    setBusy(false);

    if (sent.length > 0) {
      /*
       * The sent rows go and the failures stay, with their messages.
       *
       * Clearing everything — which is what this did — threw away the only record
       * of which photographs had *not* arrived, so somebody who sent forty and
       * lost three had no way to find the three. Keeping them makes Send a retry.
       */
      const done = new Set(sent);
      setPicked((previous) => {
        for (const one of previous) if (done.has(one.id)) revoke(one.preview);
        return previous.filter((one) => !done.has(one.id));
      });
      setNotice(
        sent.length === queue.length
          ? 'Thank you. The church will look at these before they appear here.'
          : `${sent.length} of ${queue.length} were sent. The rest are still below — you can try again.`,
      );
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  /*
   * Closed by the parish, and that is now the only thing that hides this form.
   *
   * There was a second return here — `rows.length === 0`, a ministry with no
   * levels to file anything under — on the argument that a form whose every
   * submission the rules would refuse is worse than no form. The argument was
   * sound and the premise stopped being true: the ministry itself is a
   * destination, `firestore.rules` accepts it, and so a program with no levels
   * has somewhere for a photograph to go. What the old return actually did in
   * production was hide the upload button on every gallery on the site, because
   * no ministry has a published level yet.
   */
  if (program.submissionsOpen === false) return null;

  /*
   * Escape closes it, and only when there is nothing half-done.
   *
   * A batch of forty photographs chosen and not yet sent is real work, and a stray
   * Escape throwing it away is the kind of loss nobody forgives. So the key is
   * ignored while files are staged; the × and Cancel are still there, and both say
   * what they will do.
   */
  const closable = picked.length === 0 && !busy;

  const waiting = picked.filter((one) => one.state.kind !== 'sent').length;

  /*
   * The button, and the panel behind it.
   *
   * The button is all that is on the page when the panel is shut, which is what lets
   * the invitation sit above the photographs without pushing them down.
   */
  const form = (
    <div className="submit-panel" role="dialog" aria-modal="true" aria-label="Upload your photos">
      <section className="submit-photos">
        <header className="submit-photos__head">
          <div>
            {/* The same words as the button that opened it: a panel whose heading
                renames the action makes you check you pressed the right thing. */}
            <h2 className="submit-photos__title">Upload your photos</h2>
            <p className="submit-photos__lede">
              Photographs and short films from {program.name} are welcome. Choose the
              part of it each one belongs to. They are reviewed before they appear on
              the site.
            </p>
          </div>
          <button
            type="button"
            className="submit-photos__close"
            aria-label={
              closable
                ? 'Close'
                : `Close, discarding ${picked.length} chosen ${picked.length === 1 ? 'file' : 'files'}`
            }
            disabled={busy}
            onClick={() => {
              // The staged batch goes with the panel. Kept rather than cleared would
              // mean reopening it later to a list somebody has forgotten choosing.
              setPicked([]);
              setNotice(null);
              setOpen(false);
            }}
          >
            ×
          </button>
        </header>

      {/*
        The drop zone is a `label`, so the whole box is the file picker's target —
        no click handler, no `inputRef.click()`, and it works from the keyboard
        because the input inside it is a real focusable control.
      */}
      <label
        className={`submit-drop${dragging ? ' is-over' : ''}`}
        onDragOver={(event) => {
          // `preventDefault` on dragover as well as on drop, and both are
          // required: without it the browser navigates to the dropped file.
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) add(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="submit-drop__input"
          // `image/*,video/*` rather than a list of extensions: a phone offers
          // its camera roll for this and a file picker for a list, and the camera
          // roll is where the photographs are.
          accept="image/*,video/*"
          multiple
          disabled={busy}
          onChange={(event) => add(event.target.files)}
        />
        <span className="submit-drop__face">
          <span className="submit-drop__call">
            {picked.length === 0 ? 'Choose photographs' : 'Add more photographs'}
          </span>
          {/*
            No number for photographs, because there is no longer a limit on
            one — anything too large is condensed and sent, and the row says so
            when it happens. Promising "up to 250MB each", as this did, invited
            somebody to check whether their photograph qualified when the
            answer is that it always does.

            The video figure is stated, because a clip is the one thing that can
            still be refused: a browser cannot re-encode video, so there is
            nothing to condense it down to.
          */}
          <span className="submit-drop__hint">
            or drop them here — any size, large ones are made smaller
            automatically. Video clips up to {formatBytes(VIDEO_MAX_BYTES)}.
          </span>
        </span>
      </label>

      {picked.length > 0 && (
        <>
          <div className="submit-photos__bar">
            <p className="submit-photos__count">
              {picked.length === 1 ? '1 picture' : `${picked.length} pictures`}
              <span className="submit-photos__weight">{sizeOf(picked)}</span>
            </p>

            {/*
              One control for the whole batch. Not a "default" that rows inherit —
              it writes every row when it changes. An inherited default is
              invisible: somebody who sets three rows by hand and then touches
              this cannot tell whether their three survived. Writing all of them is
              at least unambiguous, and the rows are right there to correct.
            */}
            {picked.length > 1 && (
              <label className="submit-photos__all">
                <span>All of these are from</span>
                <LevelSelect
                  rows={rows}
                  value={batch}
                  disabled={busy}
                  placeholder="Choose one for all…"
                  onChange={(nodeId) => {
                    setBatch(nodeId);
                    setPicked((previous) =>
                      previous.map((one) =>
                        one.state.kind === 'sent' ? one : { ...one, target: nodeId },
                      ),
                    );
                  }}
                />
              </label>
            )}

            <button
              type="button"
              className="button button--quiet button--small"
              disabled={busy}
              onClick={clearAll}
            >
              Start again
            </button>
          </div>

          <ul className="submit-list">
            {picked.map((one) => (
              <li key={one.id} className={`submit-list__row is-${one.state.kind}`}>
                <span className="submit-list__thumb" aria-hidden="true">
                  {one.preview ? (
                    <img src={one.preview} alt="" />
                  ) : (
                    <span className="submit-list__glyph">
                      {one.file.type.startsWith('video/') ? 'clip' : 'file'}
                    </span>
                  )}
                </span>

                <span className="submit-list__meta">
                  <span className="submit-list__name" title={one.file.name}>
                    {one.file.name}
                  </span>
                  <StateLabel state={one.state} />
                  {/*
                    Shown only when the file genuinely shrank by a good margin,
                    which in practice means a photograph straight off a phone.

                    Every picture goes through the re-encode, so a note on all
                    of them would be wallpaper nobody reads — and the ones that
                    barely change are exactly the ones nobody needs telling
                    about. Deliberately plain: no warning colour, no icon. It is
                    information, not a problem, and nothing the gallery would
                    have shown is being lost.
                  */}
                  {one.prepared?.note && (
                    <span className="submit-list__note">{one.prepared.note}</span>
                  )}
                </span>

                <LevelSelect
                  rows={rows}
                  value={one.target || fallback || ''}
                  disabled={busy || one.state.kind === 'sent'}
                  label={`Where ${one.file.name} belongs`}
                  onChange={(nodeId) => patch(one.id, { target: nodeId })}
                />

                <button
                  type="button"
                  className="submit-list__drop"
                  aria-label={`Remove ${one.file.name}`}
                  title="Remove"
                  disabled={busy}
                  onClick={() => remove(one.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="submit-photos__go">
        <button className="button" onClick={send} disabled={busy || waiting === 0}>
          {busy
            ? 'Sending…'
            : waiting === 0
              ? 'Send'
              : `Send ${waiting === 1 ? '1 picture' : `${waiting} pictures`}`}
        </button>
      </p>

      {/*
        A live region, because the outcome arrives after an upload the visitor
        cannot see the progress of. Without it somebody using a screen reader
        clicks send and is told nothing at all.
      */}
        <p className="submit-photos__notice" aria-live="polite">
          {notice}
        </p>
      </section>
    </div>
  );

  return (
    <>
      {/*
        The trigger, shaped like "Present this" and sitting beside it.

        The two are the same kind of thing — a page-level action, offered where
        somebody would go looking for it — and the explanation that used to sit under
        the old section's heading is now the panel's own lede, where it has room. A
        line of prose beside a button at the top of a gallery would be the thing
        pushing the photographs down that moving this up was meant to avoid.

        ## "Upload your photos" — the verb is the whole of it

        This went "Send photographs" → "Send us your photographs" → here, and the
        middle step was solving the wrong half. "Send photographs" left two questions
        open — whose, and to whom — and `us` and `your` answered both. But on a page
        already full of the parish's photographs, *send* still reads at least as
        easily as **share these** as it does **give us yours**, because sharing is
        what buttons beside photographs usually do. No amount of qualifying pronouns
        fixes a verb that points both ways.

        **`Upload` only points one way.** It is the word people already scan for when
        they have something on their phone they want to put somewhere, and it names
        the mechanism rather than the intention, so there is nothing left to infer.
        Tommy: *"maybe say upload your photos or something."*

        `photos` and not `photographs`, which is the one place this file steps out of
        the house voice — the counts above it say "20 PHOTOGRAPHS". A button is read
        at a glance by somebody deciding whether it is for them, and the shorter word
        is the one they think in. The panel behind it keeps the longer form.

        The `title` carries the fact a sender actually wants before pressing — that a
        person looks at them first — which is too long for a label and is repeated in
        the panel's own lede for anybody who opens it.
      */}
      <button
        type="button"
        className="button button--ghost submit-invite"
        title="Upload your own photos and short films to the parish. They are reviewed before they appear on the site."
        onClick={() => setOpen(true)}
      >
        <Icon name="photos" size={17} /> Upload your photos
      </button>

      {open && typeof document !== 'undefined' && createPortal(form, document.body)}
    </>
  );
}

/**
 * As close to a file's identity as a browser will give.
 *
 * Not a hash: hashing forty phone photographs to notice a duplicate means reading
 * several hundred megabytes on the main thread, and this is a courtesy rather
 * than a guarantee. Two genuinely different files agreeing on all three of these
 * is a case nobody will meet, and the cost of being wrong is one photograph not
 * added.
 */
function identity(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** The batch's weight, so somebody on a phone connection knows what they started. */
function sizeOf(picked: readonly Picked[]): string {
  const bytes = picked.reduce((total, one) => total + one.file.size, 0);
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  const mb = bytes / 1024 / 1024;
  return mb < 100 ? `${mb.toFixed(1)}MB` : `${Math.round(mb)}MB`;
}

/**
 * Three non-breaking spaces per level of depth.
 *
 * An escape rather than three literal characters, so it survives a linter, a
 * copy-paste, and any editor that trims trailing whitespace — every one of which
 * turns a real U+00A0 back into an ordinary space. A native option list collapses
 * ordinary spaces, so that failure is a tree that silently renders flat, with
 * three identically-named days and no way to tell them apart.
 */
const INDENT = '\u00a0\u00a0\u00a0';

/**
 * The tree as one `<select>`.
 *
 * A native select rather than a custom tree control on purpose: this is a public
 * page and the person using it is as likely to be on a phone as not, where the
 * platform picker is a full-screen wheel that already works with a screen reader
 * and one thumb.
 *
 * Indented with non-breaking spaces, which is the only thing a native option list
 * will hold — `<optgroup>` nests exactly one level where this needs however many
 * the parish has made. The alternative is "Day 1" appearing three times in a
 * ministry with three weeks with nothing to tell them apart.
 */
function LevelSelect({
  rows,
  value,
  onChange,
  disabled,
  label,
  placeholder,
}: {
  rows: readonly SubmissionTarget[];
  value: string;
  onChange: (nodeId: string) => void;
  disabled: boolean;
  label?: string;
  placeholder?: string;
}) {
  return (
    <select
      className="submit-photos__where"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        // The placeholder is not a level. Choosing it again is a no-op rather
        // than a write of the empty string over somebody's real choices.
        if (e.target.value) onChange(e.target.value);
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {rows.map(({ id, title, depth }) => (
        <option key={id} value={id}>
          {INDENT.repeat(depth)}
          {title}
        </option>
      ))}
    </select>
  );
}

function StateLabel({ state }: { state: SubmissionState }) {
  if (state.kind === 'waiting') return <span className="submit-list__state">ready</span>;
  if (state.kind === 'sending') {
    return <span className="submit-list__state is-working">sending…</span>;
  }
  if (state.kind === 'sent') return <span className="submit-list__state is-ok">sent</span>;
  return <span className="submit-list__state is-bad">{state.message}</span>;
}
