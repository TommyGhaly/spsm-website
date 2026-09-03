'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  flattenGalleryTree,
  submissionTargets,
  type DocOf,
  type GalleryTree,
  type Program,
  type ProgramEvent,
  type SubmissionTarget,
} from '@spsm/shared';
import { updateProgram } from './adminData';
import {
  approveInto,
  listPendingForProgram,
  refuseAndDelete,
  reviewUrl,
  setCaption,
  type ReviewItem,
} from './review';
import { useProgramAdmin } from './useProgramAdmin';

/**
 * The photographs parishioners have sent to this ministry, awaiting a decision.
 *
 * Rendered on a ministry's own page — `/events/summercamp` — and only for
 * somebody who administers it. Tommy asked for it there rather than on a screen
 * of its own: *"at the programs top level will have the photo requests for the
 * admins"*. There is no `/admin` any more and this section is edited in place, so
 * a queue anywhere else would be the one exception.
 *
 * That placement is also what makes the query legal for a volunteer rather than
 * only for a superadmin — see the note at the top of review.ts. A queue scoped to
 * a ministry is one `where('programId','==',…)`, which is the thing
 * `firestore.rules` can prove; an unfiltered pending list is provable only by
 * `isSuper()` and is refused outright for everybody else.
 *
 * ## Who does not get one
 *
 * `canEditProgram` is the superadmin or a **program** grant. Somebody holding a single
 * level — `programAdmin.events`, the volunteer who helps with one week — sees no
 * queue, here or anywhere.
 *
 * Stated because it looks like an oversight and is the same trade the deleted
 * queue made deliberately: the rules would refuse them this query (their grant
 * cannot prove a list scoped to the whole ministry), so serving them would mean a
 * query per granted level, which is an unbounded fan-out on a public page. They
 * can still be *given* the program if they are meant to review it. What they must
 * not get is a screen that renders and then fails.
 *
 * ## What approving and refusing actually do
 *
 * Approving writes the decision and the filing in one update. The bytes are
 * copied into the public bucket by `onGalleryMediaReviewed`, never from here — a
 * client that could write `renditionPath` could publish any object in the bucket.
 *
 * Refusing deletes: the files, then the document, with nothing kept. It cannot
 * be undone and the button says so. See `refuseAndDelete`.
 *
 * ## The priority section sits above the queue
 *
 * The same person sets it and works the queue, and it is the control that empties
 * the queue of pointless work: with "Week 1 · Day 2" set as the priority, an
 * evening's uploads arrive already filed and every row is one click. It lives
 * here rather than in the editing panel because it is not a property of the
 * page — nothing on the public side changes when it moves — it is an instruction
 * to the upload form.
 */
export function SubmissionQueue({
  program,
  tree,
  onDecided,
}: {
  program: DocOf<Program>;
  tree: GalleryTree<DocOf<ProgramEvent>>;
  /**
   * Re-read the page. An approved photograph belongs in the gallery above this
   * queue, and nothing here can draw it — the file does not exist yet at the
   * moment of approval, because the Function has not copied it.
   */
  onDecided: () => void;
}) {
  const admin = useProgramAdmin();
  const uid = admin.uid;

  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ids currently being written, so a second click cannot double-submit. */
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const rows = useMemo(() => flattenGalleryTree(tree), [tree]);

  /*
   * Where a reviewer may file one, which is **not** the same list as `rows`.
   *
   * `rows` is levels, and the priority control below needs exactly that — a
   * priority that named the ministry would not resolve in the tree and would read
   * as "no priority" forever. This list carries the ministry as well, because a
   * photograph may arrive filed on it: the upload form offers it, and so does
   * dropping one on the top row of `PictureManager`. Without it the `<select>`
   * below would be rendered holding a value it does not contain, which snaps
   * silently to the first option — so opening the queue would quietly re-file
   * every ministry-level submission under the newest week.
   */
  const targets = useMemo(() => submissionTargets(program, tree), [program, tree]);

  const load = useCallback(async () => {
    try {
      setItems(await listPendingForProgram(program.id));
      setError(null);
    } catch (caught) {
      console.error('[galleries] could not load the queue:', caught);
      setError(
        'The queue could not be read. If this keeps happening, the composite index for ' +
          'pending photographs may not be deployed.',
      );
    }
  }, [program.id]);

  useEffect(() => {
    if (!admin.ready) return;
    void load();
  }, [admin.ready, load]);

  async function act(item: ReviewItem, decision: 'approve' | 'refuse', target: string) {
    const mediaId = item.media.id;
    if (!uid || busy.has(mediaId)) return;
    setBusy((previous) => new Set(previous).add(mediaId));
    try {
      if (decision === 'approve') await approveInto(mediaId, target, uid);
      else await refuseAndDelete(item.media);
      // Dropped from the list rather than reloaded: the write has succeeded and
      // the document no longer matches `status == pending`, so a refetch would
      // cost a round trip to learn something already known.
      setItems((previous) => previous?.filter((row) => row.media.id !== mediaId) ?? null);
      // The page above, though, does need re-reading — an approved photograph
      // has just joined the gallery.
      if (decision === 'approve') onDecided();
    } catch (caught) {
      console.error(`[galleries] could not ${decision} ${mediaId}:`, caught);
      setError(
        'That could not be saved. Approving a photograph needs a grant on this ' +
          'ministry — being staff is not enough on its own.',
      );
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(mediaId);
        return next;
      });
    }
  }

  /*
   * Nothing at all until we know who is looking, and nothing for a visitor.
   *
   * `useProgramAdmin` is not a security boundary — firestore.rules is — but a
   * queue heading that flashes onto a public page before the answer arrives is
   * still wrong, and it is the kind of wrong that gets reported as a leak.
   */
  if (!admin.ready || !admin.canEditProgram(program.id)) return null;

  const pending = items?.length ?? 0;

  return (
    <section className="review-panel" aria-labelledby="queue-title">
      <div className="review-panel__head">
        <h2 id="queue-title" className="gallery-title gallery-title--small">
          Photographs sent to {program.name}
        </h2>
        {/*
          The count as a badge rather than only in the sentence below, because it
          is the one number somebody opening this page came for. Zero keeps the
          badge and drops the colour — the same field reading nothing, rather than
          a different layout that has to be recognised as the empty case.
        */}
        {items !== null && (
          <span className={`review-panel__badge${pending === 0 ? ' is-clear' : ''}`}>
            {pending === 0 ? 'none waiting' : `${pending} waiting`}
          </span>
        )}
      </div>

      <PrioritySection program={program} rows={rows} uid={uid} />

      {error && <p className="notice">{error}</p>}

      {items === null && <p className="review-panel__note">Reading the queue…</p>}

      {items !== null && pending === 0 && (
        <p className="review-panel__note">
          Photographs appear here when somebody sends them from any page of this
          ministry.
        </p>
      )}

      {items !== null && pending > 0 && (
        <>
          <p className="review-panel__note">
            Nothing here is visible anywhere on the site until it is approved.
            Approving files it where the box says. Refusing deletes it, and that
            cannot be undone.
          </p>
          <ul className="review-queue">
            {items.map((item) => (
              <ReviewRow
                key={item.media.id}
                item={item}
                targets={targets}
                sentTo={
                  item.media.programEventId === program.id ? program.name : item.eventTitle
                }
                uid={uid}
                busy={busy.has(item.media.id)}
                onApprove={(target) => void act(item, 'approve', target)}
                onRefuse={() => void act(item, 'refuse', item.media.programEventId)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Where uploads land unless the sender says otherwise, and whether the parish is
 * collecting at all.
 *
 * Two controls, one document, one write each. Optimistic in local state and
 * saved immediately — there is no Save button anywhere in this section, and
 * adding one here for two fields would be the only one.
 *
 * Neither write asks the page to re-read itself. Neither changes anything that is
 * rendered — the upload form takes both from the same `program` document this was
 * handed, and picks them up on the next load. The alternative is re-fetching a
 * whole level's photographs to move a dropdown.
 */
function PrioritySection({
  program,
  rows,
  uid,
}: {
  program: DocOf<Program>;
  rows: { node: DocOf<ProgramEvent>; depth: number }[];
  uid: string | null;
}) {
  /*
   * A stale priority is shown as "no priority" rather than as a blank select
   * with an unknown value: the level it names can have been deleted since. See
   * `Program.prioritySubmissionNodeId`.
   */
  const stored = program.prioritySubmissionNodeId ?? '';
  const known = rows.some(({ node }) => node.id === stored);

  const [priority, setPriority] = useState(known ? stored : '');
  const [open, setOpen] = useState(program.submissionsOpen !== false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(patch: { prioritySubmissionNodeId?: string | null; submissionsOpen?: boolean }) {
    setSaving(true);
    setFailed(false);
    try {
      await updateProgram(program.id, patch, uid);
    } catch (error) {
      console.error('[galleries] could not save the submission settings:', error);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="review-panel__settings">
      <label className="review-panel__field">
        <span>Photographs go to</span>
        <select
          value={priority}
          disabled={saving || rows.length === 0}
          onChange={(e) => {
            const value = e.target.value;
            setPriority(value);
            // Empty means "no priority", which is a real state and has to be
            // stored as null rather than as the empty string — `tree.byId.has('')`
            // is false either way, but a stray '' in Firestore reads as a
            // corrupted id to anybody looking at the document.
            void save({ prioritySubmissionNodeId: value || null });
          }}
        >
          <option value="">Wherever they are sent from</option>
          {rows.map(({ node, depth }) => (
            <option key={node.id} value={node.id}>
              {INDENT.repeat(depth)}
              {node.title}
            </option>
          ))}
        </select>
      </label>

      <label className="review-panel__field review-panel__field--check">
        <input
          type="checkbox"
          checked={open}
          disabled={saving}
          onChange={(e) => {
            const value = e.target.checked;
            setOpen(value);
            void save({ submissionsOpen: value });
          }}
        />
        <span>Collecting photographs</span>
      </label>

      {failed && (
        <p className="review-panel__failed">
          That could not be saved. It may need a grant on this ministry.
        </p>
      )}
    </div>
  );
}

/**
 * See the note on `INDENT` in SubmitPhotos: a native option list collapses
 * ordinary spaces, so the indentation has to be non-breaking — and it is written
 * as an escape so that nothing trims it back into one.
 */
const INDENT = '\u00a0\u00a0\u00a0';

function ReviewRow({
  item,
  targets,
  sentTo,
  uid,
  busy,
  onApprove,
  onRefuse,
}: {
  item: ReviewItem;
  targets: readonly SubmissionTarget[];
  /**
   * What the sender chose, named. `ReviewItem.eventTitle` falls back to the raw
   * id, and the one id it cannot look up is the ministry's own — that is a
   * `programs` document and it queries `programEvents` — so the caller resolves
   * it and this renders whatever it is handed.
   */
  sentTo: string;
  uid: string | null;
  busy: boolean;
  onApprove: (target: string) => void;
  onRefuse: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [caption, setCaptionText] = useState(item.media.caption);
  /** Where this one will be filed. Starts on the level its sender chose. */
  const [target, setTarget] = useState(item.media.programEventId);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    void reviewUrl(item.media).then((resolved) => {
      if (!live) return;
      setUrl(resolved);
      setResolving(false);
    });
    return () => {
      live = false;
    };
  }, [item.media]);

  /*
   * A caption is saved on blur rather than behind its own button.
   *
   * The reviewer's hands are already on approve and refuse; a third button per
   * row is one more thing to forget. Saved before the decision is taken, so
   * approving immediately after typing does not lose the words.
   */
  async function saveCaption() {
    if (!uid || caption === item.media.caption) return;
    try {
      await setCaption(item.media.id, caption, uid);
    } catch (error) {
      console.error('[galleries] could not save the caption:', error);
    }
  }

  const moved = target !== item.media.programEventId;

  return (
    <li className={`review-queue__item${busy ? ' is-busy' : ''}`}>
      <div className="review-queue__frame">
        {/*
          The same photograph again, blurred, filling the mat behind it.

          The frame holds the picture `contain`ed — a reviewer has to see all of
          it — and a contained portrait on a flat near-black ground is two wide
          black bars, which is what made this screen look like a media player
          from 2009. Filling those bars with the picture's own colours, thrown out
          of focus, is the treatment every photo tool uses now and it costs one
          more `<img>` off the same object URL: no second download, nothing to
          resolve, and it disappears by itself when there is no preview to show.

          Videos are excluded — a `<video>` cannot be reused this way, and the
          poster is not resolved here.
        */}
        {url !== null && item.media.kind !== 'video' && (
          <img className="review-queue__wash" src={url} alt="" aria-hidden="true" />
        )}

        {resolving && <span className="meta">loading…</span>}
        {!resolving && url === null && (
          /*
            No preview. Either the transcode failed, or this is a video — which
            nothing transcodes — or the reader's role is below `staff`, which is
            what gates reads of the quarantine prefix. Approving is still allowed,
            and the Function falls back to publishing the original, but the
            reviewer is told plainly that they are deciding without having seen it.
          */
          <span className="meta">
            No preview{item.media.kind === 'video' ? ' — videos are not previewed' : ''}.
          </span>
        )}
        {url !== null &&
          (item.media.kind === 'video' ? (
            <video src={url} controls preload="metadata" />
          ) : (
            // `alt=""` because the caption below is the accessible name once one
            // is written, and an un-captioned pending photograph has no honest
            // description to give.
            <img className="review-queue__shot" src={url} alt="" />
          ))}

        {/*
          The level the sender chose, named before the control that overrides it.
          A `<select>` alone would show where it is going and hide where it came
          from, and "somebody thought this was Day 3" is the only information in
          the row that an administrator cannot work out for themselves.

          It is a chip on the corner of the picture rather than a line of grey
          caps above the fields. It belongs to the photograph — it is a fact about
          where this one arrived — and moving it there leaves the panel below as
          two labelled controls and a decision, which is the whole of the work.
        */}
        <p className="review-queue__from">
          Sent to {sentTo}
          {moved && <span className="review-queue__moved"> · being moved</span>}
        </p>
      </div>

      <div className="review-queue__detail">
        {/*
          Both fields carry a visible label now rather than a hidden one. They had
          `visually-hidden` labels and a placeholder each, which is correct for a
          screen reader and leaves a sighted reviewer with two unmarked boxes —
          and a placeholder disappears the moment anything is typed, so the field
          holding the parish's alt text was unlabelled exactly when it had
          content.
        */}
        <label className="review-queue__field review-queue__where">
          <span>File it under</span>
          <select value={target} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
            {targets.map(({ id, title, depth }) => (
              <option key={id} value={id}>
                {INDENT.repeat(depth)}
                {title}
              </option>
            ))}
          </select>
        </label>

        <label className="review-queue__field review-queue__caption">
          <span>Caption</span>
          <input
            type="text"
            value={caption}
            placeholder="What is happening in this picture"
            maxLength={300}
            disabled={busy}
            onChange={(e) => setCaptionText(e.target.value)}
            onBlur={saveCaption}
          />
        </label>

        <div className="review-queue__actions">
          <button
            className="button button--small review-queue__approve"
            onClick={() => onApprove(target)}
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
          {/*
            Two clicks, because this one cannot be taken back — the document and
            the file are both gone. Not a `window.confirm`: a modal dialog on a
            page being worked through a hundred rows at a time is a hundred
            dialogs, and the second click is in the same place as the first.
          */}
          {confirming ? (
            <button
              className="button button--small review-queue__confirm"
              onClick={onRefuse}
              disabled={busy}
            >
              Delete permanently
            </button>
          ) : (
            <button
              className="button button--quiet button--small review-queue__refuse"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              Refuse
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
