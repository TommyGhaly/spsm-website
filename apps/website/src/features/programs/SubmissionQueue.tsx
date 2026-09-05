'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  filingFor,
  filingsFor,
  keepPresent,
  keepPresentFilings,
  type Filings,
} from './queueSelection';
import {
  approveInto,
  approveMany,
  refuseAndDelete,
  refuseMany,
  reviewUrl,
  setCaption,
  watchPendingForProgram,
  type ReviewItem,
} from './review';
import { useProgramAdmin } from './useProgramAdmin';
import { Icon } from '@/components/Icon';

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
 * ## It is live
 *
 * A listener, not a read. Two people work this screen at once during a camp —
 * one emptying a phone, one clearing the queue — and a list that only tells the
 * truth when reloaded makes the second person work from something wrong in both
 * directions. Rows appear as they are uploaded and leave as they are decided,
 * whoever decided them.
 *
 * The listener is opened only for somebody who may read it. A visitor opens
 * none, which matters because this is a public page: a listen that is refused
 * still costs a round trip and logs a permission denial for every stranger who
 * looks at the ministry.
 *
 * ## What approving and refusing actually do
 *
 * Approving writes the decision and the filing in one update. The bytes are
 * copied into the public bucket by `onGalleryMediaReviewed`, never from here — a
 * client that could write `renditionPath` could publish any object in the bucket.
 *
 * Refusing deletes the document, and `onGalleryMediaDeleted` takes the files with
 * it — including the ones under `galleries/`, which no browser may delete. It
 * cannot be undone and the button says so. See `refuseAndDelete`.
 *
 * Neither is done to a selection without the same protections: "Decline" in the
 * bar arms exactly as a row's does, and says how many it is about to destroy.
 *
 * ## Where a photograph is going is not saved until it is approved
 *
 * `filings` holds every re-pointing anybody has made on this screen and never
 * writes one. Move six photographs to Week 2, close the tab, and all six are
 * back where their senders put them — the choice was an intention, and only
 * approving turns it into a fact. See queueSelection.ts, which is where that
 * rule lives and is tested.
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
  const canReview = admin.ready && admin.canEditProgram(program.id);

  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ids currently being written, so a second click cannot double-submit. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  /** Ticked rows. A working set; means nothing outside this screen. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  /** Re-pointings made here and not yet approved. Never written. */
  const [filings, setFilings] = useState<Filings>(EMPTY_FILINGS);
  /** Whether a whole selection is being written, and which way. */
  const [bulk, setBulk] = useState<'idle' | 'approving' | 'declining'>('idle');
  /** Whether the bar's Decline has been armed. See the row's own comment. */
  const [arming, setArming] = useState(false);
  /**
   * The one being looked at full-size, by media id. Null when nothing is.
   *
   * An id rather than an index, because the queue is a live listener: a
   * photograph decided by somebody else at the next table shortens the list
   * underneath this, and an index would then be pointing at a different picture
   * than the one on screen — which on a screen whose two buttons are "publish"
   * and "destroy" is the worst possible kind of quiet.
   */
  const [viewing, setViewing] = useState<string | null>(null);

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

  /*
   * Every snapshot reconciles the two local maps against what is actually in the
   * queue. Both keep their identity when nothing was dropped, so the ordinary
   * snapshot — somebody else uploading a photograph — does not re-render every
   * row of a screen being worked.
   */
  const receive = useCallback((next: ReviewItem[]) => {
    const present = new Set(next.map((item) => item.media.id));
    setItems(next);
    setSelected((previous) => keepPresent(previous, present));
    setFilings((previous) => keepPresentFilings(previous, present));
  }, []);

  useEffect(() => {
    if (!canReview) return;
    return watchPendingForProgram(program.id, receive, (caught) => {
      console.error('[galleries] could not read the queue:', caught);
      setError(
        'The queue could not be read. If this keeps happening, the composite index for ' +
          'pending photographs may not be deployed.',
      );
    });
  }, [canReview, program.id, receive]);

  /** Tick or untick one row, disarming the bar — a changed set is a changed act. */
  const toggle = useCallback((mediaId: string) => {
    setArming(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(mediaId)) next.add(mediaId);
      return next;
    });
  }, []);

  /** Point one row somewhere else. Local until it is approved. */
  const refile = useCallback((mediaId: string, programEventId: string) => {
    setFilings((previous) => new Map(previous).set(mediaId, programEventId));
  }, []);

  async function act(item: ReviewItem, decision: 'approve' | 'refuse', target: string) {
    const mediaId = item.media.id;
    if (!uid || busy.has(mediaId)) return;
    setBusy((previous) => new Set(previous).add(mediaId));
    try {
      if (decision === 'approve') await approveInto(mediaId, target, uid);
      else await refuseAndDelete(item.media);
      // Not removed from the list by hand any more. The write lands in the local
      // cache first, so the listener drops the row before the server has even
      // answered — and doing it here as well would fight the snapshot.
      if (decision === 'approve') onDecided();
    } catch (caught) {
      console.error(`[galleries] could not ${decision} ${mediaId}:`, caught);
      setError(REFUSED_MESSAGE);
    } finally {
      setBusy((previous) => {
        const next = new Set(previous);
        next.delete(mediaId);
        return next;
      });
    }
  }

  async function approveSelected() {
    if (!uid || bulk !== 'idle' || selected.size === 0) return;
    const filed = filingsFor(items ?? [], selected, filings);
    if (filed.length === 0) return;
    setBulk('approving');
    try {
      await approveMany(filed, uid);
      setSelected(EMPTY_SELECTION);
      onDecided();
    } catch (caught) {
      console.error('[galleries] could not approve the selection:', caught);
      setError(REFUSED_MESSAGE);
    } finally {
      setBulk('idle');
    }
  }

  async function declineSelected() {
    if (bulk !== 'idle') return;
    const chosen = (items ?? [])
      .filter((item) => selected.has(item.media.id))
      .map((item) => item.media);
    if (chosen.length === 0) return;
    setArming(false);
    setBulk('declining');
    try {
      await refuseMany(chosen);
      setSelected(EMPTY_SELECTION);
    } catch (caught) {
      /*
       * Unlike approving, this is not all-or-nothing — see `refuseMany`. Some of
       * the selection is gone and some is not, and the queue itself is the
       * record of which: the listener has already removed whatever went.
       */
      console.error('[galleries] could not refuse all of the selection:', caught);
      setError(
        'Some of those could not be deleted. Whatever is still below was not ' +
          'touched — you can try again.',
      );
    } finally {
      setBulk('idle');
    }
  }

  /*
   * Nothing at all until we know who is looking, and nothing for a visitor.
   *
   * `useProgramAdmin` is not a security boundary — firestore.rules is — but a
   * queue heading that flashes onto a public page before the answer arrives is
   * still wrong, and it is the kind of wrong that gets reported as a leak.
   */
  if (!canReview) return null;

  const pending = items?.length ?? 0;
  const working = bulk !== 'idle';

  /* ---- the one being looked at full-size ------------------------------- */

  const shown = items ?? [];
  const at = viewing === null ? -1 : shown.findIndex((one) => one.media.id === viewing);
  /*
   * Gone from under the viewer — decided here, or by the other person working
   * the queue. Closing is the honest answer: there is no "the next one" when the
   * list has been rewritten, and silently showing a different photograph beside
   * an Approve button is how the wrong thing gets published.
   *
   * The ordinary case of deciding from *inside* the viewer never reaches this,
   * because `stepFrom` moves before the write.
   */
  const viewed = at >= 0 ? shown[at] : null;
  if (viewing !== null && at < 0 && items !== null) setViewing(null);

  /** Wrapping, so → on the last picture goes back to the first rather than dying. */
  function stepFrom(index: number, delta: number) {
    if (shown.length === 0) return null;
    return shown[(index + delta + shown.length) % shown.length]?.media.id ?? null;
  }

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
          ministry. Your own go straight into the gallery.
        </p>
      )}

      {items !== null && pending > 0 && (
        <>
          <p className="review-panel__note">
            Nothing here is visible anywhere on the site until it is approved.
            Approving files it where the box says. Refusing deletes it, and that
            cannot be undone. Tick several to decide them together — where you
            have moved them to is not saved until you approve.
          </p>

          <SelectionBar
            total={pending}
            chosen={selected.size}
            arming={arming}
            bulk={bulk}
            onAll={() => {
              setArming(false);
              setSelected(new Set((items ?? []).map((item) => item.media.id)));
            }}
            onNone={() => {
              setArming(false);
              setSelected(EMPTY_SELECTION);
            }}
            onApprove={() => void approveSelected()}
            onArm={() => setArming(true)}
            onDecline={() => void declineSelected()}
          />

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
                busy={busy.has(item.media.id) || working}
                target={filingFor(item.media, filings)}
                onTarget={(value) => refile(item.media.id, value)}
                selected={selected.has(item.media.id)}
                onSelect={() => toggle(item.media.id)}
                onApprove={(target) => void act(item, 'approve', target)}
                onRefuse={() => void act(item, 'refuse', item.media.programEventId)}
                onOpen={() => setViewing(item.media.id)}
              />
            ))}
          </ul>
        </>
      )}

      {viewed && (
        <ReviewViewer
          item={viewed}
          position={at + 1}
          count={shown.length}
          busy={busy.has(viewed.media.id) || working}
          target={filingFor(viewed.media, filings)}
          targets={targets}
          onStep={(delta) => setViewing(stepFrom(at, delta))}
          onClose={() => setViewing(null)}
          onApprove={() => {
            /*
             * Moved before the write, not after it. The queue is a live
             * listener, so this item vanishes from the list a moment after the
             * decision lands — stepping first means the viewer is already
             * somewhere else when that happens, instead of being closed out
             * from under somebody halfway through a camp's worth of pictures.
             */
            setViewing(shown.length > 1 ? stepFrom(at, 1) : null);
            void act(viewed, 'approve', filingFor(viewed.media, filings));
          }}
          onRefuse={() => {
            setViewing(shown.length > 1 ? stepFrom(at, 1) : null);
            void act(viewed, 'refuse', viewed.media.programEventId);
          }}
        />
      )}
    </section>
  );
}

/** Shared identities, so an unchanged reconciliation is genuinely a no-op. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const EMPTY_FILINGS: Filings = new Map();

/** The one refusal both paths produce, and the one thing it is ever about. */
const REFUSED_MESSAGE =
  'That could not be saved. Approving a photograph needs a grant on this ministry — ' +
  'being staff is not enough on its own.';

/**
 * Select all, approve the selection, delete the selection.
 *
 * It sits above the rows rather than floating over them. A bar pinned to the
 * foot of the window is the fashionable answer and is wrong here: this section
 * lives at the bottom of a long public page, so a floating bar would hang over
 * the gallery while somebody scrolled it, and the queue is short enough that the
 * controls are on screen with the first rows anyway.
 *
 * ## Everything is stated as a count
 *
 * "Approve 12", not "Approve selected". The number is the only thing that makes
 * a bulk action checkable before it happens — the difference between clearing an
 * evening and clearing a camp is one stray click on "select all", and a button
 * that says the same words either way hides it.
 */
function SelectionBar({
  total,
  chosen,
  arming,
  bulk,
  onAll,
  onNone,
  onApprove,
  onArm,
  onDecline,
}: {
  total: number;
  chosen: number;
  arming: boolean;
  bulk: 'idle' | 'approving' | 'declining';
  onAll: () => void;
  onNone: () => void;
  onApprove: () => void;
  onArm: () => void;
  onDecline: () => void;
}) {
  const all = useRef<HTMLInputElement>(null);
  const some = chosen > 0 && chosen < total;

  /*
   * `indeterminate` is a property, not an attribute, so React cannot set it from
   * JSX and this is the only way to draw the third state a "select all" box
   * genuinely has. Without it a partial selection shows an empty box, and the one
   * click it invites is the one that discards the selection.
   */
  useEffect(() => {
    if (all.current) all.current.indeterminate = some;
  }, [some]);

  const working = bulk !== 'idle';

  return (
    <div className="review-bar">
      <label className="review-bar__all">
        <input
          ref={all}
          type="checkbox"
          checked={chosen > 0 && chosen === total}
          disabled={working}
          onChange={() => (chosen === total ? onNone() : onAll())}
        />
        <span>
          {chosen === 0 ? `Select all ${total}` : `${chosen} of ${total} selected`}
        </span>
      </label>

      {chosen > 0 && (
        <div className="review-bar__actions">
          <button
            className="button button--small review-queue__approve"
            onClick={onApprove}
            disabled={working}
          >
            {bulk === 'approving' ? 'Approving…' : `Approve ${chosen}`}
          </button>

          {/*
            Armed in two clicks, exactly as a single row is, and for a much
            better reason: this one destroys everything ticked at once. The armed
            label names the number rather than saying "these", because "these" is
            what somebody reads when they have forgotten they pressed select all.
          */}
          {arming ? (
            <button
              className="button button--small review-queue__confirm"
              onClick={onDecline}
              disabled={working}
            >
              {bulk === 'declining' ? 'Deleting…' : `Delete ${chosen} permanently`}
            </button>
          ) : (
            <button
              className="button button--quiet button--small review-queue__refuse"
              onClick={onArm}
              disabled={working}
            >
              Decline {chosen}
            </button>
          )}
        </div>
      )}
    </div>
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
  target,
  onTarget,
  selected,
  onSelect,
  onApprove,
  onRefuse,
  onOpen,
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
  /**
   * Where this one will be filed. Held by the panel above rather than here, and
   * for a reason that is not tidiness: the bar has to be able to approve twelve
   * of these at once, so it needs their destinations — and a queue that is live
   * re-renders rows whenever anybody uploads anything, which would drop state
   * held in a row that unmounted.
   */
  target: string;
  onTarget: (programEventId: string) => void;
  selected: boolean;
  onSelect: () => void;
  onApprove: (target: string) => void;
  onRefuse: () => void;
  /** Open it full-size. The card is too small to decide from — see `ReviewViewer`. */
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [caption, setCaptionText] = useState(item.media.caption);
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
   *
   * Note that this *is* written straight away, unlike the filing beside it. The
   * two are different kinds of thing: a caption is a description of the
   * photograph and is worth keeping whatever is decided about it, and a
   * half-written one surviving a refusal costs nothing. Where a photograph goes
   * only means anything at the moment it is published.
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
    <li
      className={`review-queue__item${busy ? ' is-busy' : ''}${selected ? ' is-picked' : ''}`}
    >
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
          The whole picture is the way in, as a button laid over it rather than
          as one wrapped around it: the frame already holds the tick and the
          "sent to" chip, and a `<button>` containing a checkbox is invalid and
          swallows its clicks. Both of those sit above this in the stack, so
          they still work.

          Only for photographs. A `<video>` in the card has the browser's own
          controls on it, and a transparent button over them would eat the play
          button — the clip is opened from the expand corner instead, which is
          the one place those controls are not.

          It carries a real label rather than a title attribute, because this is
          the only route to seeing the photograph at a size anybody can judge and
          a screen reader must be told it exists.
        */}
        {url !== null && item.media.kind !== 'video' && (
          <button
            type="button"
            className="review-queue__open"
            onClick={onOpen}
            aria-label="Open this photograph full-size"
          >
            <span className="review-queue__openMark" aria-hidden="true">
              <Icon name="expand" size={15} />
              See it big
            </span>
          </button>
        )}
        {url !== null && item.media.kind === 'video' && (
          <button
            type="button"
            className="review-queue__open review-queue__open--corner"
            onClick={onOpen}
            aria-label="Open this clip full-size"
          >
            <span className="review-queue__openMark" aria-hidden="true">
              <Icon name="expand" size={15} />
              See it big
            </span>
          </button>
        )}

        {/*
          The tick, on the picture rather than beside the buttons.

          It has to be somewhere the eye already is: this is the corner somebody
          is looking at while they decide, and a checkbox down among the controls
          would be a fourth thing in a row that already has three. It carries its
          own visible label rather than an `aria-label` alone, because "Choose"
          on a card is also what tells a first-time reviewer that deciding
          several at once is possible at all.
        */}
        <label className="review-queue__pick">
          <input type="checkbox" checked={selected} disabled={busy} onChange={onSelect} />
          <span>{selected ? 'Chosen' : 'Choose'}</span>
        </label>

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
          <select value={target} disabled={busy} onChange={(e) => onTarget(e.target.value)}>
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

/**
 * One submission, filling the screen, with the decision on it.
 *
 * ---------------------------------------------------------------------------
 * The queue draws every photograph into a 4:3 card a few hundred pixels wide.
 * That is the right shape for scanning forty of them and the wrong one for
 * *deciding* about any: a face is thirty pixels across, a blurred frame and a
 * sharp one are indistinguishable, and whether somebody's child is recognisable
 * — which is the actual question being asked — cannot be answered at that size.
 * Tommy: *"make sure the admin can click a requested image and it opens big for
 * them to see if they want."*
 *
 * ## The decision comes with it
 *
 * Approve and Refuse are here rather than only on the card behind, because
 * "open it, look at it, go back, find the row again, press the button" is four
 * steps of which three are bookkeeping. Approving steps to the next photograph
 * instead of closing, so a queue can be worked through entirely from here.
 *
 * The step is taken *before* the write rather than after it. The queue is a live
 * listener, so the item being decided disappears from underneath this component
 * a moment later; moving first means the viewer is already somewhere else when
 * that happens, rather than finding itself pointed at a photograph that no
 * longer exists.
 *
 * ## Why it does not reuse `Lightbox`
 *
 * That one resolves its own URLs through `galleryPosterUrl`, which builds the
 * unauthenticated `?alt=media` form — and this prefix is the one place on the
 * bucket where reads are gated, so those URLs 403 by design. A pending
 * submission can only be fetched through `getDownloadURL`. Sharing the component
 * would mean teaching it both, for two screens that also want different
 * furniture on top of the picture.
 * ---------------------------------------------------------------------------
 */
function ReviewViewer({
  item,
  position,
  count,
  busy,
  target,
  targets,
  onStep,
  onClose,
  onApprove,
  onRefuse,
}: {
  item: ReviewItem;
  /** Which of the queue this is, one-based, for the counter. */
  position: number;
  count: number;
  busy: boolean;
  target: string;
  targets: readonly { id: string; title: string; depth: number }[];
  onStep: (delta: number) => void;
  onClose: () => void;
  onApprove: () => void;
  onRefuse: () => void;
}) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  /** Armed once, the same two-click rule the card behind uses. */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    setResolving(true);
    setUrl(null);
    setConfirming(false);
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
   * The keyboard and the scroll lock, together, because they have to be undone
   * together — a cleanup that misses the second leaves the page underneath
   * unscrollable after this has gone.
   *
   * Enter is deliberately *not* approve. This is the one screen on the site
   * where the fast key would delete somebody's photograph if the focus were a
   * row behind, and the arrows plus a click are quick enough.
   */
  useEffect(() => {
    const opener = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    frame.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onStep(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onStep(-1);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose, onStep]);

  const where = targets.find((one) => one.id === target)?.title ?? 'this ministry';

  return (
    /*
      The backdrop closes on a click, and the panel inside stops it. `onMouseDown`
      rather than `onClick`: a click whose press began on the picture and whose
      release landed on the backdrop — which is what dragging to select or
      flicking a photograph does — would otherwise close the viewer.
    */
    <div
      className="review-view"
      role="dialog"
      aria-modal="true"
      aria-label={`Photograph ${position} of ${count}, sent to ${item.eventTitle}`}
      onMouseDown={onClose}
    >
      <div
        className="review-view__panel"
        ref={frame}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="review-view__stage">
          {resolving && <p className="review-view__note">Loading the full picture…</p>}
          {!resolving && url === null && (
            <p className="review-view__note">
              This one cannot be shown. Either the transcode failed or it is a video in a
              format this browser will not play — you can still decide about it, and
              approving publishes the file exactly as it arrived.
            </p>
          )}
          {url !== null &&
            (item.media.kind === 'video' ? (
              <video src={url} controls autoPlay playsInline />
            ) : (
              <img src={url} alt="" />
            ))}

          {count > 1 && (
            <>
              <button
                type="button"
                className="review-view__step review-view__step--back"
                onClick={() => onStep(-1)}
                aria-label="Previous photograph"
              >
                <Icon name="prev" size={22} />
              </button>
              <button
                type="button"
                className="review-view__step review-view__step--on"
                onClick={() => onStep(1)}
                aria-label="Next photograph"
              >
                <Icon name="next" size={22} />
              </button>
            </>
          )}

          <button
            type="button"
            className="review-view__close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="review-view__foot">
          <p className="review-view__said">
            {/*
              The caption as written, or the plain fact that there is not one.
              A reviewer deciding from a full-size picture is the person most
              likely to write the first one, and a blank line here reads as a
              rendering fault rather than as an absence.
            */}
            {item.media.caption || <span className="meta">No caption yet.</span>}
          </p>
          <p className="review-view__where">
            {count > 1 && <span className="review-view__count">{position} of {count}</span>}
            Filing under <strong>{where}</strong>
          </p>
          <div className="review-view__acts">
            <button
              type="button"
              className="button button--small"
              onClick={onApprove}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Approve'}
            </button>
            {confirming ? (
              <button
                type="button"
                className="button button--small review-queue__confirm"
                onClick={onRefuse}
                disabled={busy}
              >
                Delete permanently
              </button>
            ) : (
              <button
                type="button"
                className="button button--quiet button--small"
                onClick={() => setConfirming(true)}
                disabled={busy}
              >
                Refuse
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
