'use client';

import { useCallback, useEffect, useState } from 'react';
import { type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import {
  COVER_WINDOW,
  getProgramMedia,
  getProgramPageMedia,
  getPrograms,
  pickProgramCover,
  programTileMedia,
} from './data';
import { createProgram, listProgramsForAdmin, reorderPrograms } from './adminData';
import { ProgramDetails } from './Editors';
import { BodyEditingClass, EditModeProvider, EditToggle, useEditMode } from './editMode';
import { Inspector } from './Inspector';
import { SubgroupShelf, shelfCover, type ShelfItem } from './SubgroupShelf';
import { useProgramAdmin } from './useProgramAdmin';
import { CYCLE_MAX, CYCLE_MS, ProgramTile } from './ProgramTile';
import { DragRail } from '@/components/DragRail';

/**
 * The parish's standing programs. This is the whole of `/events`.
 *
 * There is no upcoming-events list here, deliberately and at the parish's
 * direction: the calendar entries were inaccurate, and a page listing the wrong
 * dates is worse than a page that does not list any. `/calendar` still renders
 * the month grid over that collection for anyone who wants it. **Do not
 * reintroduce the list here.**
 *
 * Client-rendered because a program created after the last deploy has to appear
 * without one — see docs/program-galleries.md §2. That makes the three states
 * below real rather than defensive: this page has nothing at all until a
 * network round trip finishes.
 */


/**
 * The top level of the tree, editable the same way as the two below it.
 *
 * `/events` had its own arrangement of admin controls — an Edit button and two
 * reorder arrows on every tile of a drifting rail, a "+ New ministry" bar under
 * it, and a form that opened below — because it was built before there was
 * anywhere else to put them. Three levels of one tree with three different editing
 * surfaces is the confusion this removes: same toggle, same properties column,
 * same side menu.
 */
export function ProgramDirectory() {
  const admin = useProgramAdmin();

  return (
    <EditModeProvider allowed={admin.canManagePrograms}>
      <BodyEditingClass />
      <ProgramRail />
    </EditModeProvider>
  );
}

function ProgramRail() {
  const [programs, setPrograms] = useState<DocOf<Program>[] | null>(null);
  /** program id → the pictures its tile cycles through, in order. */
  const [covers, setCovers] = useState<Record<string, DocOf<GalleryMedia>[]>>({});
  /**
   * Which picture each tile is showing, as one counter for the whole rail.
   *
   * One timer rather than one per tile, and one number rather than one per
   * program: the tiles change together, which reads as the page turning rather
   * than as five things fidgeting independently. It also means the copies the
   * loop renders are in step for free — they are the same React element, so
   * whatever the counter says applies to all of them, and a per-tile timer
   * inside a duplicated subtree would have had them drift apart.
   */
  const [shot, setShot] = useState(0);
  const [failed, setFailed] = useState(false);
  const admin = useProgramAdmin();
  const edit = useEditMode();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  const [saving, setSaving] = useState(false);

  /*
   * An administrator reads a different query from a visitor.
   *
   * `getPrograms` filters on `published`, which it must — the rules judge a list
   * by what it could return, so an unfiltered public query is denied outright.
   * That same filter would hide a draft from the person who just created it,
   * which is the one view where a draft has to be visible. So the read is picked
   * from the reader, and the effect waits for `admin.ready` rather than
   * fetching twice.
   */
  const asAdmin = admin.ready && admin.canManagePrograms;

  useEffect(() => {
    if (!admin.ready) return;
    let live = true;

    void (async () => {
      const found = asAdmin ? await listProgramsForAdmin() : await getPrograms();
      if (!live) return;
      setPrograms(found);

      /*
       * One cover each, in parallel. A loop with `await` inside it would be
       * five sequential round trips on the page's only content.
       *
       * `pickProgramCover` decides which one, and it is worth reading: it
       * honours `Program.coverMediaId` — the ministry page now has a control
       * that writes it, so a reader that ignored the field would make that
       * control do nothing — and it skips an approved photograph whose transcode
       * has not finished, which is what made Summercamp's tile blank while the
       * ministry had a dozen photographs behind it.
       *
       * A small window rather than one item, for that second reason.
       */
      const found_covers = await Promise.all(
        found.map(async (program) => {
          /*
           * Two window sizes, chosen per program by whether anybody has curated
           * it.
           *
           * `featuredMediaIds` are picked by hand from *anywhere* under the
           * ministry — a photograph from a camp four years ago is a perfectly
           * ordinary choice — so resolving them against the newest twelve items
           * would silently drop most of a curated set and make the editor look
           * broken. Those programs get the same read the ministry page does.
           *
           * A program nobody has curated needs no such thing: automatic mode
           * takes the newest showcase pictures, and twelve is already more than
           * the five this tile shows. That is most programs, so the expensive
           * read is the exception rather than the rule.
           */
          const curated =
            Array.isArray(program.featuredMediaIds) && program.featuredMediaIds.length > 0;
          const media = curated
            ? await getProgramPageMedia(program.id)
            : await getProgramMedia(program.id, COVER_WINDOW);

          /*
           * A curated ministry's tile cycles through exactly the pictures
           * opening it would show, in the same order, which is the point of it
           * being a preview. An uncurated one previews the same pool without
           * reading the ministry's whole tree to do it — see
           * `programTileMedia` for why that trade is made here and not there.
           *
           * The fallback matters more than it looks. `programTileMedia` can
           * return nothing where `pickProgramCover` would still find something:
           * a curated id that no longer resolves, or an automatic set whose
           * every candidate is mid-transcode. Falling back to the cover keeps
           * the tile showing what it showed before this change rather than
           * going blank, which is the worse failure of the two.
           */
          const featured = programTileMedia(program, media, CYCLE_MAX);
          if (featured.length > 0) return [program.id, featured] as const;

          const cover = pickProgramCover(program, media);
          return [program.id, cover ? [cover] : []] as const;
        }),
      );

      if (!live) return;
      setCovers(Object.fromEntries(found_covers.filter(([, list]) => list.length > 0)));
    })().catch(() => {
      if (live) setFailed(true);
    });

    return () => {
      live = false;
    };
  }, [admin.ready, asAdmin, reloadKey]);

  /*
   * The cycle.
   *
   * Guarded on there being something to cycle: a parish with one photograph per
   * ministry gets no timer at all, rather than a timer that re-renders the whole
   * rail every five seconds to show the same picture. `Math.max` over the sets
   * rather than `.some(...)` because the counter is shared — one ministry with
   * four pictures is reason enough for it to keep counting, and a tile with two
   * takes the counter modulo its own length.
   *
   * Reduced motion switches it off and leaves the first picture up. A slideshow
   * is exactly the kind of unattended movement that setting is asking about, and
   * the first of the featured pictures is the one an administrator chose first.
   */
  const longest = Math.max(0, ...Object.values(covers).map((list) => list.length));

  useEffect(() => {
    if (longest < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => setShot((n) => n + 1), CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [longest]);

  /**
   * Move a tile and persist the result.
   *
   * The list is reordered locally *first* and drawn immediately — a control that
   * waits for a round trip before the tile moves feels broken, and the write is
   * a batch that either lands or does not. If it fails the reload puts the old
   * order back, which is the honest outcome and the one the server believes.
   *
   * Called from the arrows in the properties column, not from a drag on the tile.
   * Tile dragging was mouse-only — HTML5 drag does not fire for touch — and it
   * fought the rail it was inside, since dragging a tile that is drifting away is
   * not usable. Two buttons in a menu work by thumb and by keyboard, and need
   * nothing to hold still.
   */
  const move = useCallback(
    async (from: number, to: number) => {
      if (programs === null || from === to) return;
      if (to < 0 || to >= programs.length) return;

      const next = [...programs];
      const [lifted] = next.splice(from, 1);
      if (!lifted) return;
      next.splice(to, 0, lifted);

      setPrograms(next);
      setSaving(true);
      try {
        await reorderPrograms(next, admin.uid);
      } catch (error) {
        console.error('[programs] could not save the order:', error);
        setReloadKey((n) => n + 1);
      } finally {
        setSaving(false);
      }
    },
    [programs, admin.uid],
  );

  if (programs === null && !failed) {
    return (
      <div className="gallery-loading" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading…</span>
        <span className="gallery-loading__spinner" aria-hidden="true" />
      </div>
    );
  }

  /*
   * Two different silences, said differently.
   *
   * "Nothing is published yet" is a content gap the parish can close. "We could
   * not reach the server" is not, and telling somebody the parish runs no
   * programs because their connection dropped is a lie the page should not
   * tell.
   */
  if (failed) {
    return (
      <div className="notice">
        <h2>This could not be loaded</h2>
        <p>The programs are fetched when the page opens, and that request did not
        complete. Refreshing usually settles it.</p>
      </div>
    );
  }

  const nextOrder = (programs?.reduce((max, p) => Math.max(max, p.order), 0) ?? 0) + 1;

  /**
   * The ministries, as a shelf in the corner of the page.
   *
   * The same component the gathering pages use, so an administrator learns one
   * thing. It moved out of the properties panel when the panel moved to the bottom
   * third of the screen — a short wide strip has no room for two lists side by
   * side, so the navigation went to the page and the properties kept the panel.
   *
   * No rename and no remove here. A ministry's name *is* its URL — the slug is the
   * document id, and the parish puts `/events/summercamp` in a bulletin — so
   * renaming is a form that can say so, and deleting refuses while any gatherings
   * remain. Both are one click away in the panel.
   */
  const shelf = (
    <SubgroupShelf
      legend="Ministries"
      busy={saving}
      addLabel="Add a ministry…"
      empty="No ministries yet."
      items={(programs ?? []).map(
        (program, index): ShelfItem => ({
          id: program.id,
          label: program.name,
          coverPath: shelfCover(covers[program.id]?.[0] ?? null),
          note: program.published ? undefined : 'draft',
          selected: edit.isSelected({ kind: 'program', id: program.id }),
          onSelect: () => edit.select({ kind: 'program', id: program.id }),
          onMove: (delta) => void move(index, index + delta),
          /*
            Renaming and removing are absent, so these two are the shelf's
            no-ops rather than an omission the type would let through. The panel
            is where both live, for the reason above.
          */
          onRename: () => undefined,
          onRemove: () => undefined,
          removeWarning: '',
        }),
      )}
      onAdd={(name) =>
        void (async () => {
          setSaving(true);
          try {
            await createProgram({ name, description: '', order: nextOrder, published: false });
            reload();
          } catch (error) {
            console.error('[programs] could not create the ministry:', error);
          } finally {
            setSaving(false);
          }
        })()
      }
    />
  );

  const inspecting = (() => {
    const selection = edit.selection;

    if (selection.kind === 'program') {
      const program = (programs ?? []).find((one) => one.id === selection.id);
      if (program) {
        return {
          kind: 'Ministry',
          title: program.name,
          body: (
            <div className="inspector__body">
              <ProgramDetails
                program={program}
                onChanged={reload}
                /*
                  A reload, not a refetch: the ministry being edited no longer
                  exists, and this rail is the page it was being edited from.
                */
                onRemoved={reload}
              />
              <p className="inspector__note">
                Its pictures, its gatherings and how they are laid out are edited on the
                ministry&apos;s own page — open it with editing off.
              </p>
            </div>
          ),
        };
      }
    }

    return {
      kind: 'Page',
      title: 'Our activities',
      body: (
        <div className="inspector__body">
          <p className="inspector__note">
            Choose a ministry from the list above to edit it, or add one. Reorder them with
            the arrows — that is the order they appear in on this page.
          </p>
        </div>
      ),
    };
  })();

  if (programs === null || programs.length === 0) {
    return (
      <>
      <div className="notice">
        <h2>Nothing here yet</h2>
        <p>No programs have been published. They appear here as soon as one is.</p>
        {/* The one place this page can act rather than only report. Without it
            an administrator looking at an empty parish has nowhere to start. */}
        {admin.canManagePrograms && (
          <p className="inspector__note">
            Press <strong>Edit this page</strong> to add the first one.
          </p>
        )}
      </div>
      {/*
        The toggle and the panel belong to this branch as well. Without them a
        parish with no ministries yet has a page that says "nothing here" and no
        way at all to change that — which is the one state where the editor matters
        most.
      */}
      <EditToggle />
      {edit.on && shelf}
      {edit.on && (
        <Inspector title={inspecting.title} kind={inspecting.kind} saving={saving}>
          {inspecting.body}
        </Inspector>
      )}
      </>
    );
  }

  return (
    /*
      One rail for everybody.

      There were two — a motionless one for administrators and a looping one for
      visitors — because dragging a tile that is sliding away is not usable. That
      split is gone: pressing the rail stops it under the finger and it stays
      stopped until a moment after the hand leaves, so by the time a drag begins
      it is already still. Same markup for both, one thing to reason about.

      Everything about the movement — the loop, the duplicate copies, the drag,
      the hidden scrollbar — is `DragRail`, which the shelf and the clergy on the
      homepage use too. What is left here is the ministries themselves.

      `frozen` while the editor is open: a form is on screen and a rail sliding
      along behind it is nothing but distraction.
    */
    <>
      {/*
        Three times the site's default drift, for this rail only.

        Asked for directly, and it is the rail that needed it: `speed` is in
        pixels per second, and these plates are now 889px wide where the shelf's
        books are 176. At the shared 75px/s a ministry took twelve seconds to
        cross — the same number that reads as a gentle drift on a strip of book
        covers reads as barely moving on a strip of photographs this size. 225
        crosses one in about four.

        This is what the `speed` prop is for, and why it is a prop rather than a
        second constant in `useDragRail`: the shelf, the clergy and the shop's
        strips are unchanged.
      */}
      <DragRail
        className="rail--programs rail--bleed"
        speed={225}
        frozen={edit.on}
      >
        {/*
          No drag handlers. Reordering the ministries is two buttons per row in
          the properties column — see the note on `move`.
        */}
        <ul className="program-rail">
          {programs.map((program, index) => (
            <li key={program.id}>
              {(
                <div
                  className={`program-card__slot${
                    edit.on && edit.isSelected({ kind: 'program', id: program.id })
                      ? ' is-selected'
                      : ''
                  }`}
                  onClickCapture={(click) => {
                    if (!edit.on) return;
                    // The tile is a link. While editing, a click selects the
                    // ministry instead — otherwise choosing one to edit would
                    // leave the page it is being edited on.
                    click.preventDefault();
                    click.stopPropagation();
                    edit.select({ kind: 'program', id: program.id });
                  }}
                >
                  <ProgramTile
                    program={program}
                    shots={covers[program.id] ?? []}
                    shot={shot}
                  />

                  {/*
                    A draft badge, and nothing else.

                    The Edit button and the two reorder arrows that used to sit
                    here are gone: the ministries are listed in the properties
                    column while editing, where reordering is two buttons in a menu
                    rather than two buttons on every tile of a drifting rail. The
                    badge stays because it is a *state of the thing* rather than an
                    action on it — an administrator needs to see which ministries
                    are not yet public without clicking each one.
                  */}
                  {edit.on && !program.published && (
                    <div className="program-card__admin">
                      <span className="badge badge--draft" title="Only you can see this">
                        Draft
                      </span>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}

        </ul>
      </DragRail>

      {/*
        No admin bar and no editor panel below the rail.

        Both are in the properties column now — the one an administrator opens with
        *Edit this page*, the same control and the same panel as a ministry page and
        a gathering. Three levels of the same tree used to have three different
        editing surfaces; the reason this one had a bar under the rail at all was
        that there was nowhere else to put it.
      */}
      <EditToggle />
      {edit.on && shelf}

      {edit.on && (
        <Inspector title={inspecting.title} kind={inspecting.kind} saving={saving}>
          {inspecting.body}
        </Inspector>
      )}
    </>
  );
}

