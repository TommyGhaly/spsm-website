'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { type DocOf, type GalleryMedia, type Program } from '@spsm/shared';
import {
  COVER_WINDOW,
  getProgramMedia,
  getProgramPageMedia,
  getPrograms,
  programFallbackShot,
  programTileMedia,
} from './data';
import {
  createProgram,
  deleteProgram,
  listProgramsForAdmin,
  reorderPrograms,
  updateProgram,
} from './adminData';
import { ProgramDetails } from './Editors';
import { BodyEditingClass, EditModeProvider, EditToggle, useEditMode } from './editMode';
import { Inspector } from './Inspector';
import { MainSectionField } from './MainSection';
import { EditTabPanel, EditTabs } from '@/components/EditTabs';
import { SubgroupShelf, shelfCover, type ShelfItem } from './SubgroupShelf';
import { useProgramAdmin } from './useProgramAdmin';
import { CYCLE_MAX, CYCLE_MS, ProgramTile } from './ProgramTile';
import { DragRail } from '@/components/DragRail';
import { Icon } from '@/components/Icon';

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
  /* The page column's tab: the ministries, or the one page-wide setting. */
  const [pageTab, setPageTab] = useState<'ministries' | 'settings'>('ministries');

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
       * One picture set each, in parallel. A loop with `await` inside it would be
       * five sequential round trips on the page's only content.
       *
       * A small window rather than one item, because an approved photograph whose
       * transcode has not finished has no file to draw — which is what made
       * Summercamp's tile blank while the ministry had a dozen photographs behind
       * it. Both readers below skip those.
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
           * return nothing where `programFallbackShot` still finds something: a
           * curated id that no longer resolves, an automatic set whose every
           * candidate is mid-transcode, or a ministry whose photographs are all
           * approved but none cleared for a page. Drawing one of those beats a
           * blank plate, which is the worse failure of the two.
           */
          const featured = programTileMedia(program, media, CYCLE_MAX);
          if (featured.length > 0) return [program.id, featured] as const;

          const fallback = programFallbackShot(media);
          return [program.id, fallback ? [fallback] : []] as const;
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

  /**
   * The name and the description, written a moment after typing stops.
   *
   * ## Why the local copy comes first
   *
   * The tile draws from `programs`, so the field has to be the document's value
   * or typing would not appear. Waiting for the round trip to redraw means every
   * keystroke lands a frame late and the caret jumps; so the list is updated
   * locally on each keystroke and the write is debounced behind it. Same shape as
   * `move` above, and the same reasoning.
   *
   * ## Why a debounce rather than write-on-blur
   *
   * Because there is nothing to blur *to*. The tile has no Save and no form
   * around it — the events editor set the pattern that typing is the save, and a
   * ministry's name behaving differently from an event's title is one more thing
   * to remember. `updatedAt` on every pause is the cost, and it is a field nobody
   * reads on a program.
   *
   * The timer is per ministry, so editing two tiles does not have the second one
   * cancel the first one's write.
   */
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const edited = useCallback(
    (id: string, patch: { name?: string; description?: string }) => {
      setPrograms((was) =>
        was === null ? was : was.map((one) => (one.id === id ? { ...one, ...patch } : one)),
      );

      const running = timers.current[id];
      if (running) clearTimeout(running);
      timers.current[id] = setTimeout(() => {
        void (async () => {
          try {
            await updateProgram(id, patch, admin.uid);
          } catch (error) {
            console.error('[programs] could not save the ministry:', error);
            // Put the document's own value back, so the tile never shows words
            // that are not stored.
            setReloadKey((n) => n + 1);
          }
        })();
      }, 800);
    },
    [admin.uid],
  );

  /*
   * Pending writes are **dropped** when this unmounts, not flushed.
   *
   * Firing them would be the obvious choice and is the wrong one: the write
   * targets a document by id, and the most common reason this unmounts is the
   * ministry having just been removed — so the flush would land on something that
   * no longer exists and report `NOT_FOUND` about a name nobody recognises. The
   * cost of dropping is the last 800ms of typing before a navigation, and the
   * field is a ministry's name.
   */
  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) clearTimeout(timer);
    },
    [],
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
      inline
      addFirst
      legend="Ministries"
      busy={saving}
      addLabel="New ministry name…"
      empty="No ministries yet."
      /* `move` is already "take the one at `from` and put it at `to`", which is
         exactly what a dropped row means. */
      onReorder={(from, to) => void move(from, to)}
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
            Renaming and removing, wired.
            
            These were `() => undefined` — deliberate no-ops, on the reasoning that
            the panel owned both. The shelf draws a rename and a bin on every row
            regardless, so what that actually produced was two buttons that opened a
            field and a confirmation and then silently did nothing. Tommy asked for
            the names in this list to be editable, which they now are; the bin is
            wired with them because a dead button beside a live one is worse than
            either.
          */
          onRename: (name) => edited(program.id, { name }),
          onRemove: () =>
            void (async () => {
              setSaving(true);
              try {
                await deleteProgram(program.id, admin.uid);
                reload();
              } catch (error) {
                console.error('[programs] could not remove the ministry:', error);
              } finally {
                setSaving(false);
              }
            })(),
          /*
            `deleteProgram` refuses while any gatherings remain beneath it — a
            client-side cascade that stops halfway leaves galleries pointing at a
            ministry that is gone. Said here so the confirmation is honest about
            when it will not work.
          */
          removeWarning:
            'Its albums have to be removed first. Nothing else about the church changes.',
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
              {/*
                First, not last. It sat under `ProgramDetails`, which ends in the
                Remove button — so a line of orientation was printed *after* the
                one destructive action in the panel, and got clipped by the scroll
                besides. Nothing explanatory belongs below a delete.
              */}
              <p className="inspector__note">
                Photographs and albums are edited on{' '}
                <a href={`/events/${program.slug}`}>the ministry&apos;s own page</a>.
              </p>
              <ProgramDetails
                program={program}
                onChanged={reload}
                /*
                  A reload, not a refetch: the ministry being edited no longer
                  exists, and this rail is the page it was being edited from.
                */
                onRemoved={reload}
              />
            </div>
          ),
        };
      }
    }

    /*
     * Nothing selected draws the one setting that belongs to the *parish* rather
     * than to a ministry.
     *
     * This was `body: null`, on the argument that there is genuinely nothing
     * page-wide to edit here — a ministry's settings belong to the ministry, and
     * the order belongs to the shelf. That argument held until there was a
     * setting whose subject is this page: the main section, which is a pointer at
     * one level of one ministry and is read by the NFC routes rather than by
     * anything on screen. It is not a property of Summercamp, so it cannot live on
     * Summercamp's panel. See `MainSectionField`.
     *
     * What still is not here: instructions. The paragraph this used to hold —
     * "choose a ministry above to edit it" — was a panel whose entire contents
     * told you to use a different control. What tells somebody what to do is the
     * page: the tiles gain fields, and the last plate says "New ministry".
     */
    return {
      kind: 'Page',
      title: 'Our activities',
      body: (
        <div className="inspector__body">
          <EditTabs
            tabs={[
              { id: 'ministries', label: `Ministries (${(programs ?? []).length})` },
              { id: 'settings', label: 'Settings' },
            ]}
            value={pageTab}
            onChange={setPageTab}
            label="Our activities"
            idPrefix="evpage"
          />
          <EditTabPanel idPrefix="evpage" value={pageTab}>
            {pageTab === 'ministries' ? (
              <div className="evpage-list">
                {shelf}
                <p className="inspector__note">Click a ministry to edit it. Drag the handle to reorder.</p>
              </div>
            ) : (
              <MainSectionField />
            )}
          </EditTabPanel>
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
      {edit.on && (
        <Inspector
          title={inspecting.title}
          kind={inspecting.kind}
          saving={saving}
          backLabel="All ministries"
        >
          {inspecting.body}
        </Inspector>
      )}
      </>
    );
  }

  /*
   * The plates, built once and rendered by whichever rail is in use.
   *
   * Extracted when the rail split in two — the reading one loops, the editing one
   * does not. Two copies of this JSX is two places to add a prop to the tile and
   * one place to forget.
   */
  const tiles = (
    <>
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
                    /*
                      Selecting the ministry, except when the click was aimed at
                      one of the tile's own fields.
                  
                      The guard is load-bearing now that the name and the blurb are
                      inputs: `preventDefault` on a click that landed in a text
                      field stops the caret being placed, so clicking into the
                      middle of a word put the cursor at the end of it. It still
                      selects — a field belongs to its ministry — but it lets the
                      click through.
                    */
                    const onAField =
                      click.target instanceof HTMLElement &&
                      click.target.closest('input, textarea');

                    if (!onAField) {
                      click.preventDefault();
                      click.stopPropagation();
                    }
                    edit.select({ kind: 'program', id: program.id });
                  }}
                >
                  <ProgramTile
                    program={program}
                    shots={covers[program.id] ?? []}
                    shot={shot}
                    editing={edit.on}
                    onName={(name) => edited(program.id, { name })}
                    onDescription={(description) => edited(program.id, { description })}
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

          {/*
            The last plate, while editing: make another one.

            On the rail rather than in the shelf, at Tommy's direction. What it
            makes appears exactly here, and a control that makes a thing belongs
            next to where the thing lands — the same reasoning as the galleries'
            add-a-block row.

            It asks for the name before it creates anything, which is not a form
            for the sake of one: a program's slug **is** its Firestore document id,
            so the name chosen here is the URL for good. A plate that created
            "New ministry" and let you rename it afterwards would leave every
            ministry in the parish living at /events/new-ministry.
          */}
          {edit.on && (
            <li>
              <NewMinistryPlate
                busy={saving}
                onCreate={async (name) => {
                  setSaving(true);
                  try {
                    const id = await createProgram({
                      name,
                      description: '',
                      order: nextOrder,
                      published: false,
                    });
                    reload();
                    // Selected on arrival, so its panel is already open at the
                    // one thing a new ministry needs: making it public.
                    edit.select({ kind: 'program', id });
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            </li>
          )}
    </>
  );

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
        Well over twice the site's default drift, for this rail only.

        Asked for directly, and it is the rail that needed it: `speed` is in
        pixels per second, and these plates are now 889px wide where the shelf's
        books are 176. At the shared 75px/s a ministry took twelve seconds to
        cross — the same number that reads as a gentle drift on a strip of book
        covers reads as barely moving on a strip of photographs this size.

        225, then 180, now 144, all three at Tommy's direction and each a fifth
        off the last. 225 crossed a plate in about four seconds, which is quick
        enough that a photograph is gone before it has been looked at; 144
        crosses one in about six and still reads as going somewhere rather than
        as a rail that has stopped. Do not tune this from a screenshot; it is a
        speed, and it only exists in motion.

        This is what the `speed` prop is for, and why it is a prop rather than a
        second constant in `useDragRail`: the shelf, the clergy and the shop's
        strips are unchanged.
      */}
      {/*
        Two rails, and only one of them at a time.
        
        Read, it is the looping `DragRail` — the drifting wall of plates the page
        exists for. **Edited, it is a plain scrolling strip**, because `DragRail`
        renders its children two or three times to hide the seam, and `frozen`
        only stops the drift: `copies` is measured off the content and stays at two
        or more however still the rail is. Five ministries came out as ten editable
        tiles, two of every name, and a second "New ministry" plate further along.
        
        Duplicates are harmless for the read-only tile — every handler is keyed by
        id, so a copy navigates to the same page — and that is exactly the note in
        `DragRail`'s own header. They stop being harmless the moment the tile holds
        a *field*: two inputs for one ministry, and an add-plate whose open/closed
        state is per copy.
        
        `PictureStrip` made the same call for the gallery wheels and for the same
        reason, which is the precedent this follows rather than a new idea.
      */}
      {edit.on ? (
        <div className="rail-wrap rail--programs rail--bleed">
          <div className="rail program-rail__still scroller">
            <ul className="program-rail">
            {tiles}
            </ul>
          </div>
        </div>
      ) : (
        <DragRail className="rail--programs rail--bleed" speed={144}>
          <ul className="program-rail">{tiles}</ul>
        </DragRail>
      )}

      {/*
        No admin bar and no editor panel below the rail.

        Both are in the properties column now — the one an administrator opens with
        *Edit this page*, the same control and the same panel as a ministry page and
        a gathering. Three levels of the same tree used to have three different
        editing surfaces; the reason this one had a bar under the rail at all was
        that there was nowhere else to put it.
      */}
      <EditToggle />
      {edit.on && (
        <Inspector
          title={inspecting.title}
          kind={inspecting.kind}
          saving={saving}
          backLabel="All ministries"
        >
          {inspecting.body}
        </Inspector>
      )}
    </>
  );
}


/**
 * The last plate on the rail while editing: a new ministry.
 *
 * Two states rather than a prompt, because of what a program's slug is. The slug
 * is the Firestore document id (see `createProgram`), and `updateProgram` refuses
 * to change it — so the name typed here is the ministry's URL for as long as the
 * parish has a website. A plate that made one immediately and let you rename it
 * would put every ministry at `/events/new-ministry`.
 *
 * So: press it, and the plate becomes one field. It is still on the page, still
 * one thing to fill in, and it gets the address right.
 *
 * Its own component, and not a closure inside `ProgramRail`: a function defined
 * in a render body is a new component *type* on every render, which unmounts and
 * remounts the subtree — the bug that made the gallery band editors appear not to
 * work. See the note at the top of `BandRows`.
 */
function NewMinistryPlate({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState('');
  const [failed, setFailed] = useState<string | null>(null);

  const ready = name.trim().length > 0;

  async function create() {
    if (!ready) return;
    setFailed(null);
    try {
      await onCreate(name.trim());
      setName('');
      setAsking(false);
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : 'Could not make the ministry.',
      );
    }
  }

  if (!asking) {
    return (
      <button type="button" className="program-new" onClick={() => setAsking(true)}>
        <span className="program-new__mark" aria-hidden="true">
          <Icon name="plus" size={22} />
        </span>
        <span className="program-new__label">New ministry</span>
      </button>
    );
  }

  return (
    <div className="program-new program-new--asking">
      <label className="program-new__field">
        <span>What is it called?</span>
        <input
          name="newMinistry"
          size={1}
          value={name}
          autoFocus
          placeholder="Mother of Mercy"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && ready) void create();
            if (event.key === 'Escape') {
              setAsking(false);
              setName('');
            }
          }}
        />
      </label>

      {/* Said before it is typed, not after it is too late: this is the one field
          on the site whose value cannot be changed afterwards. */}
      <p className="program-new__note">
        This also sets its web address, which cannot be changed later.
      </p>

      {failed && (
        <p className="program-new__bad" role="alert">
          {failed}
        </p>
      )}

      <div className="program-new__actions">
        <button
          type="button"
          className="button button--small"
          disabled={!ready || busy}
          onClick={() => void create()}
        >
          {busy ? 'Making…' : 'Make it'}
        </button>
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => {
            setAsking(false);
            setName('');
            setFailed(null);
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
