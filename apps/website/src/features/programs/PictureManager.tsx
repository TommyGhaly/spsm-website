'use client';

/**
 * Every photograph in a ministry, in one place, with somewhere to put it.
 *
 * ## Why this exists and why it is only on the parent-most node
 *
 * Tommy: *"I want the ability, in the parent most node of each program, to edit and
 * delete all of the pictures in the children meaning move them to different nodes
 * with drag and drop or permanently delete (with caution)."*
 *
 * The two operations were both already possible and neither was reachable. Filing
 * was a `<select>` on one selected photograph — fine for correcting one, useless
 * for the case that actually happens, which is forty pictures of Week 1 filed onto
 * the ministry because that is what the upload form offered when they were sent.
 * Deleting was not offered at all outside the submission queue: once a photograph
 * was approved the only way to remove it from the parish's data was the Firestore
 * console.
 *
 * **The ministry's own page, and no lower.** A level's page shows a level's
 * subtree, so a manager there could only ever move a picture *deeper* — and the
 * mistake being corrected is nearly always a picture that is too shallow. Opening
 * it at the root means every level in the ministry is a destination, which is the
 * only place the full set of moves exists.
 *
 * ## The shape: destinations down the left, pictures on the right
 *
 * Deliberately the same shape as `MediaPicker`, because it is the same problem —
 * "several hundred photographs, filed under a tree, and I need to find some" — and
 * a second layout for it would be a second thing to learn. The difference is what
 * the left column *is*: in the picker it filters, here it filters **and receives**.
 * A level you can drop onto is a level you can also click to see, which is one
 * mechanism doing both jobs rather than a filter list beside a target list.
 *
 * ## The drag is pointer-based, not HTML5 drag-and-drop
 *
 * `draggable` plus `dragover` would be less code and it is the wrong trade twice
 * over. It cannot be verified in this project's preview pane — the synthetic drag
 * events a test can dispatch are not the ones the browser's own drag machinery
 * responds to — and it gives no control over the ghost, so a 200px photograph
 * follows the cursor as a browser-drawn translucent bitmap that covers the
 * destination list you are aiming at.
 *
 * So it is `setPointerCapture` and a transform, the same mechanism `PictureStrip`
 * uses for reordering a wheel, and the destination is found the same way: from the
 * live boxes of the level rows at the moment of release. See that file's note.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  UNFILED_PROGRAM_ID,
  childrenOf,
  descendantsOf,
  focalPosition,
  type DocOf,
  type GalleryMedia,
  type GalleryTree,
  type ProgramEvent,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';
import { galleryPosterUrl } from './media';
import { adoptUnfiledMedia, setMediaNode } from './adminData';
import { getUnfiledMedia } from './data';
import { deleteMediaForever } from './review';

/** How far the pointer travels before a press becomes a drag. */
const DRAG_SLOP = 6;

type Busy =
  | { kind: 'no' }
  | { kind: 'moving'; id: string }
  | { kind: 'deleting'; id: string };

export function PictureManager({
  programId,
  programName,
  tree,
  media,
  onChanged,
  onClose,
}: {
  programId: string;
  programName: string;
  tree: GalleryTree<DocOf<ProgramEvent>>;
  /** Every approved item in the ministry. This screen is about all of them. */
  media: readonly DocOf<GalleryMedia>[];
  /** Something was moved or deleted; the page owns the re-read. */
  onChanged: () => void;
  onClose: () => void;
}) {
  /**
   * `null` is "everything". Otherwise one level's id — the same as the picker —
   * or `UNFILED_PROGRAM_ID` for the parish's rogue pictures, which is a document
   * id no level can have.
   */
  const [level, setLevel] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>({ kind: 'no' });
  const [error, setError] = useState<string | null>(null);

  /**
   * Photographs whose ministry was deleted, from every ministry in the parish.
   *
   * Held here rather than passed in, because they are not this ministry's and
   * the page that owns `media` has no business reading them. Every manager shows
   * the same list and any of them can claim from it — see `getUnfiledMedia`.
   *
   * Empty is the ordinary state and renders as nothing at all: no row, no
   * heading. A permanently empty "Not in any ministry" would be a standing
   * question about a thing that has never happened.
   */
  const [unfiled, setUnfiled] = useState<readonly DocOf<GalleryMedia>[]>([]);
  const loadUnfiled = useCallback(() => {
    void getUnfiledMedia().then((found) => {
      setUnfiled(found);
      // Taking in the last one removes the row that is currently selected, which
      // would leave the grid empty under a selection nothing points at. Back to
      // everything, which is where the screen opens.
      if (found.length === 0) setLevel((at) => (at === UNFILED_PROGRAM_ID ? null : at));
    });
  }, []);
  useEffect(loadUnfiled, [loadUnfiled]);

  /**
   * The photograph whose delete has been asked for but not confirmed.
   *
   * The whole of "with caution". A single press cannot destroy anything: the first
   * turns the tile's × into the words "Delete for ever", and only that second,
   * differently-worded, differently-placed press does it. Clicking anywhere else
   * cancels, which is what makes the dangerous state hard to stay in by accident.
   */
  const [confirming, setConfirming] = useState<string | null>(null);

  /* ---- the destinations -------------------------------------------------- */

  /**
   * Every level in the ministry, flattened, each with what is filed *directly* on
   * it.
   *
   * Directly, not in its subtree, and that is the number this screen is about: a
   * subtree count answers "how much is under here", which the shelf on the page
   * already says, where this has to answer "how much is filed exactly here" —
   * because that is the thing a move changes and the thing a mis-filed batch shows
   * up in.
   */
  const levels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of media) {
      counts.set(item.programEventId, (counts.get(item.programEventId) ?? 0) + 1);
    }

    const out: { id: string; label: string; depth: number; count: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const child of childrenOf(tree, parent)) {
        out.push({
          id: child.id,
          label: child.title,
          depth,
          count: counts.get(child.id) ?? 0,
        });
        walk(child.id, depth + 1);
      }
    };
    walk(null, 0);

    /*
     * The ministry itself is a destination too, and it is first.
     *
     * `programEventId === programId` is how a photograph filed on the ministry
     * rather than on any level is stored — see `submit.ts` — so it is a real place
     * with real contents, and without a row for it those pictures could be moved
     * away and never moved back.
     */
    return [
      { id: programId, label: programName, depth: 0, count: counts.get(programId) ?? 0 },
      ...out,
    ];
  }, [tree, media, programId, programName]);

  /*
   * "Everything" means everything in *this ministry*, and deliberately excludes
   * the rogue pictures. They are not filed here — that is what makes them rogue
   * — and folding them into the ministry's own grid would make the count above
   * the levels wrong and put pictures from a deleted ministry in among Week 1's.
   */
  const shown = useMemo(
    () =>
      level === null
        ? media
        : level === UNFILED_PROGRAM_ID
          ? unfiled
          : media.filter((item) => item.programEventId === level),
    [media, unfiled, level],
  );

  /**
   * The name of the level a photograph is filed on.
   *
   * Off the `levels` list rather than the tree, so it agrees exactly with the row
   * this tile could be dropped onto — including the ministry's own row, which is not
   * a node and has no title of its own.
   *
   * A rogue picture says so in words. Its `programEventId` is the sentinel, which
   * as a raw string on a tile would read as a bug.
   *
   * Anything else unrecognised falls back to the raw id. That should no longer
   * happen — `deleteProgramEvent` moves a level's pictures to the ministry before
   * removing it, and `getGalleryLevel` reads an older orphan as the ministry's —
   * so an id showing through here means a document arrived by some route neither
   * of those covers, and showing it plainly is how somebody finds it.
   */
  const whereOf = useCallback(
    (id: string) =>
      id === UNFILED_PROGRAM_ID
        ? 'Not in any ministry'
        : (levels.find((one) => one.id === id)?.label ?? id),
    [levels],
  );

  /** Where each row is, read at release. Live boxes, not remembered ones. */
  const rows = useRef(new Map<string, HTMLElement>());

  /* ---- the two writes ---------------------------------------------------- */

  /**
   * Two writes behind one gesture, and the difference is which one is allowed.
   *
   * Dragging inside the ministry is `setMediaNode`, which will not write
   * `programId` on purpose. Dragging *in* from the rogue row has to write it —
   * the picture's ministry was deleted — so it goes through `adoptUnfiledMedia`,
   * which only a full administrator may do. See both for why the capability is
   * split rather than shared.
   *
   * The gesture is identical either way, and it should be: "this picture belongs
   * in Week 1" is one thought. What differs is only whether the parish or the
   * ministry owned it a moment ago.
   */
  const move = useCallback(
    async (item: DocOf<GalleryMedia>, destination: string) => {
      const rogue = item.programId === UNFILED_PROGRAM_ID;
      if (destination === item.programEventId && !rogue) return;
      setBusy({ kind: 'moving', id: item.id });
      setError(null);
      try {
        if (rogue) {
          await adoptUnfiledMedia(item.id, { programId, programEventId: destination }, null);
          loadUnfiled();
        } else {
          await setMediaNode(item.id, destination, null);
        }
        onChanged();
      } catch (caught) {
        console.error('[galleries] could not refile:', caught);
        setError(
          rogue
            ? 'That picture could not be taken in. Only a parish administrator can ' +
                'give a loose picture a ministry.'
            : 'That picture could not be moved. You may not have permission here.',
        );
      } finally {
        setBusy({ kind: 'no' });
      }
    },
    [onChanged, programId, loadUnfiled],
  );

  const destroy = useCallback(
    async (item: DocOf<GalleryMedia>) => {
      setBusy({ kind: 'deleting', id: item.id });
      setError(null);
      try {
        await deleteMediaForever(item);
        setConfirming(null);
        // A rogue picture is not in `media`, so the page's re-read cannot take it
        // off this screen. Its own list has to be read again.
        if (item.programId === UNFILED_PROGRAM_ID) loadUnfiled();
        onChanged();
      } catch (caught) {
        console.error('[galleries] could not delete:', caught);
        setError('That picture could not be deleted. You may not have permission here.');
      } finally {
        setBusy({ kind: 'no' });
      }
    },
    [onChanged, loadUnfiled],
  );

  /* ---- the drag ---------------------------------------------------------- */

  const [dragging, setDragging] = useState<string | null>(null);
  /** The row the pointer is over, so it can say so before the release. */
  const [over, setOver] = useState<string | null>(null);
  /**
   * The same value, in a ref, and the ref is the one the drop reads.
   *
   * `over` is state because a row has to *look* like the target; the release
   * cannot read it, because the handler that runs on release closed over whatever
   * `over` was when the pointer went **down**, which is always `null`. A stale
   * closure here is not a dropped highlight, it is every drop silently doing
   * nothing — so the two are kept together deliberately rather than one being
   * derived from the other.
   */
  const overRef = useRef<string | null>(null);
  const aimAt = useCallback((id: string | null) => {
    overRef.current = id;
    setOver(id);
  }, []);

  const grab = useCallback(
    (event: React.PointerEvent<HTMLElement>, item: DocOf<GalleryMedia>) => {
      // Left button only, and never on a control — that is a press, not a drag.
      if (event.button !== 0) return;

      /*
       * The second half of that sentence was a comment and not a check, and the
       * cost was the whole of delete.
       *
       * `setPointerCapture` below retargets the *click* as well as the pointer
       * events: with the tile holding the capture, the click that follows is
       * dispatched at the tile rather than at whatever was actually under the
       * pointer. So a press on the delete pill captured the pointer for the tile,
       * the pill's own `onClick` never ran, and `confirming` was never set — the
       * confirmation never appeared and a photograph could not be deleted at all,
       * on any tile. Dragging was unaffected, because it reads `pointermove` and
       * `pointerup` and never needs a click, which is why the screen looked
       * half-working rather than broken.
       *
       * `closest('button')` rather than a class: the delete pill, its confirmation
       * and anything else this tile grows are all controls, and the rule is the
       * same for each — a press on one is that button's, not the tile's. It
       * catches the `svg` inside the pill too, which is what `event.target`
       * usually is.
       *
       * `PictureStrip` has the same drag and not this bug, and the difference is
       * structural: there the capture is on a `.pstrip__grab` button that wraps
       * only the photograph, and its × is a *sibling*. Here one div carries the
       * picture and the buttons, so the guard has to be explicit.
       */
      if (event.target instanceof Element && event.target.closest('button')) return;

      const tile = event.currentTarget;
      const from = { x: event.clientX, y: event.clientY };
      let started = false;

      /*
       * `setPointerCapture` throws on a pointerId the browser never issued, which
       * is exactly what a synthetic drag in a test dispatches. Guarded rather than
       * relied on: capture is an improvement — it keeps the moves coming when the
       * pointer leaves the tile — not a requirement, because the listeners below
       * are on `window`.
       */
      try {
        tile.setPointerCapture(event.pointerId);
      } catch {
        /* A synthetic pointer. The window listeners still see the moves. */
      }

      const onMove = (moved: PointerEvent) => {
        const dx = moved.clientX - from.x;
        const dy = moved.clientY - from.y;
        if (!started) {
          if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
          started = true;

          /*
           * Out of the scrolling pane, pinned where it already is.
           *
           * `.picker__pictures` scrolls, and a box that scrolls clips — so a tile
           * translated towards the levels column disappeared at the pane's left
           * edge, half a second before it reached the row it was being carried to.
           * The drop still worked and the highlight still moved; the picture was
           * simply gone while you aimed it, which is the worst possible moment for
           * it to be gone.
           *
           * `position: fixed` leaves the clip behind. The box is nailed to the
           * viewport coordinates it currently occupies, so the switch is invisible
           * — nothing moves until the transform below moves it — and `<li>` keeps
           * a square hole where it came from, because the grid's cells carry their
           * own `aspect-ratio` for exactly this.
           */
          const box = tile.getBoundingClientRect();
          tile.style.position = 'fixed';
          tile.style.left = `${box.left}px`;
          tile.style.top = `${box.top}px`;
          tile.style.width = `${box.width}px`;
          tile.style.height = `${box.height}px`;
          setDragging(item.id);
        }
        tile.style.transform = `translate(${dx}px, ${dy}px)`;

        /*
         * Which row the pointer is inside, from its box right now. The list is
         * short and scrollable, so a position remembered at grab time would be
         * wrong the moment it scrolled.
         */
        let found: string | null = null;
        for (const [id, element] of rows.current) {
          const box = element.getBoundingClientRect();
          if (
            moved.clientX >= box.left &&
            moved.clientX <= box.right &&
            moved.clientY >= box.top &&
            moved.clientY <= box.bottom
          ) {
            found = id;
            break;
          }
        }
        aimAt(found);
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        tile.style.transform = '';
        tile.style.position = '';
        tile.style.left = '';
        tile.style.top = '';
        tile.style.width = '';
        tile.style.height = '';
        const target = overRef.current;
        setDragging(null);
        aimAt(null);
        // `started` distinguishes a drag from a click; a click does nothing here,
        // because there is nothing to select.
        if (started && target !== null) void move(item, target);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [move, aimAt],
  );

  /* ---- the screen -------------------------------------------------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape backs out of the confirmation first, then out of the screen. Two
      // presses to leave while something dangerous is on offer.
      if (confirming !== null) setConfirming(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="picker" role="dialog" aria-modal="true" aria-label="Every picture">
      {/*
        The head is one grid row — `.picker` is `auto minmax(0, 1fr)` — so the hint
        and any error live *inside* it rather than as rows of their own. A third row
        here would take the body's track and leave the pictures unscrollable.
      */}
      <header className="picker__head">
        <div className="picker__title">
          <p className="picker__kind">Where the pictures are filed</p>
          <h3>{programName}</h3>
        </div>

        {/* One line. The controls say the rest themselves. */}
        <p className="picker__hint">
          {error ? (
            <strong className="manager__error" role="alert">
              {error}
            </strong>
          ) : level === UNFILED_PROGRAM_ID ? (
            <>
              These are from a ministry that was deleted. Drag one onto a level to take it
              into {programName}.
            </>
          ) : (
            <>Drag a picture onto a level to file it there. Delete is permanent.</>
          )}
        </p>

        <button type="button" className="button picker__done" onClick={onClose}>
          Done
        </button>
      </header>

      <div className="picker__body">
        {/*
          The destinations, and the filter. One list doing both, which is what makes
          "put this in Week 2" and "show me Week 2" the same gesture at the same
          place rather than two lists to keep straight.
        */}
        <nav className="picker__folders manager__folders" aria-label="Levels">
          <p className="manager__legend">Levels</p>

          <button
            type="button"
            className={`picker__folder${level === null ? ' is-on' : ''}`}
            onClick={() => setLevel(null)}
          >
            <span>Everything</span>
            <b>{media.length}</b>
          </button>

          {levels.map((one) => (
            <button
              key={one.id}
              type="button"
              ref={(element) => {
                if (element) rows.current.set(one.id, element);
                else rows.current.delete(one.id);
              }}
              className={[
                'picker__folder',
                level === one.id ? 'is-on' : '',
                over === one.id ? 'is-target' : '',
              ]
                .join(' ')
                .trim()}
              style={{ paddingInlineStart: `${0.7 + one.depth * 0.8}rem` }}
              onClick={() => setLevel(one.id)}
            >
              <span>{one.label}</span>
              <b>{one.count}</b>
            </button>
          ))}

          {/*
            The parish's loose pictures, under the ministry's own levels and ruled
            off from them.

            Below rather than above, and only when there are any. It is the least
            common thing on this screen and it is not part of this ministry — a
            row at the top would put "a ministry somebody deleted" in front of
            "Week 1" every time anybody opened the manager to move one picture.

            Not registered in `rows`, so it cannot be dropped *onto*. Filing works
            one way here: a rogue picture can be taken into a ministry, and a
            ministry's picture cannot be pushed out into limbo. There is no reason
            to want the second, and it would be a way to lose a photograph with
            one careless drag.
          */}
          {unfiled.length > 0 && (
            <button
              type="button"
              className={`picker__folder manager__rogue${level === UNFILED_PROGRAM_ID ? ' is-on' : ''}`}
              onClick={() => setLevel(UNFILED_PROGRAM_ID)}
            >
              <span>Not in any ministry</span>
              <b>{unfiled.length}</b>
            </button>
          )}
        </nav>

        <div className="picker__pictures">
          {shown.length === 0 ? (
            <p className="picker__hint">Nothing is filed here.</p>
          ) : (
            <ul className="picker__grid">
              {shown.map((item) => {
                const poster = galleryPosterUrl(item);
                const isConfirming = confirming === item.id;
                const working =
                  (busy.kind === 'moving' || busy.kind === 'deleting') && busy.id === item.id;

                return (
                  <li key={item.id}>
                    <div
                      className={[
                        'manager__tile',
                        dragging === item.id ? 'is-dragging' : '',
                        working ? 'is-working' : '',
                      ]
                        .join(' ')
                        .trim()}
                      onPointerDown={(event) => {
                        if (isConfirming || working) return;
                        grab(event, item);
                      }}
                    >
                      {poster ? (
                        <img
                          src={poster}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          style={{ objectPosition: focalPosition(item.focal) }}
                        />
                      ) : (
                        <span className="picker__tile-blank">Processing…</span>
                      )}

                      {item.kind === 'video' && (
                        <span className="picker__tile-kind" aria-hidden="true">
                          <Icon name="film" size={14} />
                        </span>
                      )}

                      {/*
                        The mark that says this can be picked up. `cursor: grab` was
                        the only sign, and a cursor is invisible until the pointer is
                        already on the tile and says nothing at all on a touch screen.

                        `aria-hidden` because the drag is a pointer gesture with no
                        keyboard equivalent, and a label promising one is worse than
                        silence.
                      */}
                      <span className="manager__grip" aria-hidden="true">
                        <Icon name="grip" size={13} />
                      </span>

                      {/*
                        Where it is filed now, on the tile. Without it "move this
                        somewhere else" is a decision made blind — and while the
                        list shows Everything, half of these are already where they
                        belong.

                        The level's **own** name, not its trail. A trail is the right
                        answer to "where is this" and the wrong string for a 160px
                        tile: every one of them starts with the ministry and the
                        year, so twenty tiles all read "Summercamp 2027 · Week…" and
                        clip before the part that differs. The hierarchy is already
                        down the left; what the tile has to say is the leaf.
                      */}
                      <span className="manager__where" title={whereOf(item.programEventId)}>
                        {whereOf(item.programEventId)}
                      </span>

                      {isConfirming ? (
                        <button
                          type="button"
                          className="manager__confirm"
                          disabled={working}
                          onClick={() => void destroy(item)}
                        >
                          {working ? 'Deleting…' : 'Delete for ever'}
                        </button>
                      ) : (
                        /*
                          A red pill with the word on it, on every tile, always.
                          Not a bare icon and not revealed on hover: the two things
                          asked of this control are that it is impossible to miss
                          and that what it does needs no working out.

                          A bin rather than an ×, because the × on a picture means
                          "take it off this page and keep the photograph" in every
                          other part of this editor — see `PictureStrip`.
                        */
                        <button
                          type="button"
                          className="manager__delete"
                          aria-label={`Delete ${item.caption || 'this picture'} for ever`}
                          disabled={working}
                          onClick={() => setConfirming(item.id)}
                        >
                          <Icon name="trash" size={12} />
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Levels that exist at all, so the caller can decide whether to offer this. */
export function hasLevels(tree: GalleryTree<DocOf<ProgramEvent>>): boolean {
  return descendantsOf(tree, null).length > 0;
}
