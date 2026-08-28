'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  GALLERY_DISPLAY_NAMES,
  SECTION_SCALE_NAMES,
  childrenOf,
  descendantsOf,
  SECTION_COLUMNS,
  SECTION_WIDTH_COLUMNS,
  dockWidths,
  layoutForLook,
  spinFor,
  pagePictures,
  resolveBands,
  resolveSectionLayout,
  subtreeSlideshow,
  childLabelOf,
  summariseChildren,
  trailLabel,
  trailSlugs,
  type DocOf,
  type GalleryBand,
  type GalleryTree,
  type GridPlacement,
  type MediaPlacement,
  type NodeSummary,
  type SectionLayout,
  type SectionWidth,
  type Event,
  type GalleryMedia,
  type Program,
  type ProgramEvent,
} from '@spsm/shared';
import { Prose } from '@/components/Prose';
import { PageBody } from '@/components/PageBody';
import { BackLink } from '@/components/BackLink';
import { Icon } from '@/components/Icon';
import { Grow, Plain } from '@/components/Inline';
import { formatDateSpan, formatEventWhen } from '@/lib/dates';
import {
  getGalleryLevel,
  getLinkedCalendarEvent,
  getProgram,
  type GalleryLevel,
} from './data';
import {
  DEFAULT_PRESENTATION_PACE,
  DEFAULT_PRESENTATION_STYLE,
  isPresenting,
  parseGalleryPath,
  presentationPace,
  presentationStyle,
  programEventHref,
  presentHref,
  withPresentationPace,
  withPresentationStyle,
  withoutPresent,
  type GalleryRoute,
  type PresentationPace,
  type PresentationStyle,
} from './route';
import { AutoClip } from './AutoClip';
import { GallerySection } from './GallerySection';
import { Lightbox } from './Lightbox';
import { Presentation } from './Presentation';
import { MediaPicker } from './MediaPicker';
import { PictureManager } from './PictureManager';
import { SectionDesigner } from './SectionDesigner';
import { useBlockPacking, type BlockPlacement } from './packing';
import { MediaProperties } from './MediaProperties';
import { Disclosure, DisclosureGroup } from './Disclosure';
import {
  SubgroupShelf,
  shelfCover,
  shelfCovers,
  shelfNote,
  type ShelfItem,
} from './SubgroupShelf';
import { BlockFrame as Block } from './BlockFrame';
import { Inspector } from './Inspector';
import { BodyEditingClass, EditModeProvider, EditToggle, useEditMode } from './editMode';
import { togglePick } from './pick';
import { SubmitPhotos } from './SubmitPhotos';
import { SubmissionQueue } from './SubmissionQueue';
/*
 * `setCaption` lives in ./review, beside the approval queue that also writes it.
 * The properties column and the queue are the two places a caption is written,
 * and they write the same field the same way — see the note at the top of
 * ./review.
 */
import { setCaption } from './review';
import {
  MAX_BANDS,
  addBand,
  setPagePicturesHidden,
  setPageShowsAll,
  createProgramEvent,
  deleteProgramEvent,
  moveBand,
  removeBand,
  updateBand,
  listProgramEventsForAdmin,
  moveProgramEvent,
  renameProgramEvent,
  updateProgramEvent,
  moveMediaWithin,
  setMediaFocal,
  setMediaLayout,
  setMediaNode,
  setMediaPlacement,
  reorderMedia,
  setNodeFeatured,
  setHiddenPictures,
  setProgramEventParent,
  setProgramFeatured,
  setSectionLayout,
  MAX_FEATURED,
  type SectionTarget,
} from './adminData';
import { LevelDetails, ProgramDetails } from './Editors';
import { useProgramAdmin } from './useProgramAdmin';
import { galleryPathUrl } from './media';
import { captionOf } from './caption';

/**
 * The one page behind every gallery URL, at every depth.
 *
 * Firebase Hosting rewrites `/events/**` here when nothing matches on disk, so
 * this component is what a visitor gets for `/events/summercamp/2026-week-1/day-1`
 * and every camp created since the last deploy. It reads the address bar,
 * fetches, and renders — routing that the framework would normally do, done
 * here because `output: 'export'` cannot emit a route it has never heard of.
 *
 * The URL is unchanged by a rewrite, so `location.pathname` is the real one.
 *
 * ## One view, not one per level
 *
 * There were two: a ministry page and a gathering page, each with its own header,
 * its own picture block, its own inspector and its own copy of about two hundred
 * lines. That split had to go, and not for tidiness — it was what made a fourth
 * level impossible. A ministry and a week and a day all do the same thing: they
 * show a summary of what is beneath them, and cards for the things beneath them.
 * `LevelView` is that, once, and it does not know or care how deep it is.
 *
 * The only asymmetry left is real: the program is a document in another
 * collection, so `node === null` means "the ministry itself" throughout.
 *
 * Three things this deliberately does *not* do:
 *
 *  - **No `useSearchParams`.** It suspends, and under `output: 'export'` that
 *    forces the whole route to opt out of prerendering. `location.search` is
 *    read directly in an effect instead.
 *  - **No redirect on a bad path.** A stranger who mistypes a camp name should
 *    see "no such gallery" at the URL they typed, not be bounced somewhere that
 *    makes it look like the link worked.
 *  - **No `notFound()`.** That needs a server. This renders its own not-found
 *    state, with a real link back.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | {
      kind: 'level';
      program: DocOf<Program>;
      level: GalleryLevel;
      /** The parish-calendar entry this level is filed against, if any. */
      calendar: DocOf<Event> | null;
    };

/**
 * "Albums" -> "album", for a count of one.
 *
 * `childLabel` is stored plural, because it is written over a list. A count line
 * needs the singular, and asking the parish for both words to satisfy one label
 * is two fields where one will do.
 *
 * Trailing "s" only, which is stated because it is a real limit rather than an
 * oversight: an irregular plural comes out wrong ("children" -> "childre"). The
 * words this actually receives are Albums, Years, Weeks, Days, Sessions and
 * whatever the parish types, and a wrong singular on a count line is a cosmetic
 * fault where a required second field would be a permanent one.
 */
function singularOf(plural: string): string {
  return /s$/i.test(plural) && plural.length > 2 ? plural.slice(0, -1) : plural;
}

export function GalleryShell() {
  const [route, setRoute] = useState<GalleryRoute | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const admin = useProgramAdmin();

  /**
   * Whether this page is being presented rather than read.
   *
   * State rather than a value read at render time, because leaving the
   * presentation has to change it — and `location` is not something React
   * re-reads on its own.
   */
  const [present, setPresent] = useState(false);

  /**
   * Which of the three presentation styles the URL asks for.
   *
   * Beside `present` and read the same way, because it is the same parameter —
   * `?present=notebook` says both *that* the page is presented and *how*. See
   * `PRESENTATION_STYLES` in route.ts for why one parameter carries both.
   */
  const [style, setStyle] = useState<PresentationStyle>(DEFAULT_PRESENTATION_STYLE);

  /** How fast it moves, from `?pace=`. Beside the style for the same reasons. */
  const [pace, setPace] = useState<PresentationPace>(DEFAULT_PRESENTATION_PACE);

  /**
   * Bumped to re-run the fetch below.
   *
   * The view is handed its documents as props, so a write it cannot draw
   * locally — a level added, one renamed, a photograph re-filed — needs the
   * *shell* to read again.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  /*
   * The path, re-read on every navigation.
   *
   * `usePathname` rather than `window.location.pathname` in a mount-only effect,
   * and that is a bug fix rather than a modernisation. Every gallery below the
   * first two segments is served by the *same* route — Hosting rewrites
   * `/events/**` onto this one shell — so a click from `…/sc-2027` to
   * `…/sc-2027/week-1-2027` is a client-side transition **within one route**.
   * Next does not remount for that, the mount-only effect never ran again, and
   * the shell went on rendering the level it had first read: the address bar
   * changed, the heading and the menu did not. Two levels deep it appeared to
   * work only because the level above is served by `/events/[slug]`, so crossing
   * into this route did remount it.
   *
   * `usePathname` is safe under `output: 'export'` in a way `useSearchParams` is
   * not — it does not suspend, so it cannot force this route out of
   * prerendering. That is why `search` is still read straight off `location`
   * below; see the note at the top of the file.
   *
   * `location` does not exist during the export build, so the first paint is
   * still a spinner — the cost decision #2 in docs/program-galleries.md accepted.
   */
  const pathname = usePathname();

  useEffect(() => {
    setRoute(parseGalleryPath(pathname));
    setPresent(isPresenting(window.location.search));
    setStyle(presentationStyle(window.location.search));
    setPace(presentationPace(window.location.search));
  }, [pathname]);

  /**
   * Leaving the presentation, without a navigation.
   *
   * `history.replaceState` rather than `router.push`: the gallery behind the
   * presentation is already fetched and mounted, and a route change would
   * unmount this shell and make every Firestore read again to show a page that
   * is already in memory. It also keeps `Esc` off the back button — somebody who
   * opened a kiosk URL directly has nothing behind it to go back to.
   */
  /**
   * Another style, without a navigation.
   *
   * `replaceState` for the same reason leaving does it that way: the gallery
   * behind the presentation is already fetched and mounted, and a route change
   * would unmount this shell and read every document again to draw a screen that
   * is already in memory. Writing the URL is not decoration — it is what makes
   * the choice survive the kiosk being restarted overnight.
   */
  const choosePresentationStyle = useCallback((next: PresentationStyle) => {
    window.history.replaceState(
      null,
      '',
      withPresentationStyle(window.location.pathname, window.location.search, next),
    );
    setStyle(next);
  }, []);

  /** The same, for the speed. See `withPresentationPace` for the default's URL. */
  const choosePresentationPace = useCallback((next: PresentationPace) => {
    window.history.replaceState(
      null,
      '',
      withPresentationPace(window.location.pathname, window.location.search, next),
    );
    setPace(next);
  }, []);

  const leavePresentation = useCallback(() => {
    window.history.replaceState(
      null,
      '',
      withoutPresent(window.location.pathname, window.location.search),
    );
    setPresent(false);
  }, []);

  useEffect(() => {
    if (route === null) return;

    if (route.kind === 'unknown') {
      setState({ kind: 'missing' });
      return;
    }

    /*
     * Held until we know who is looking.
     *
     * Not a nicety: an administrator's tree includes the drafts, and the trail
     * is resolved against whichever tree we have. Resolving against the public
     * one first would render "no such gallery" for the unpublished week somebody
     * has just created — and then quietly replace it a moment later, which reads
     * as the page having been broken and then fixed itself.
     */
    if (!admin.ready) return;

    // Guards every `setState` below. Without it, a visitor who clicks through
    // to another gallery before the first finishes loading gets whichever
    // request happens to land last — which is not necessarily the page they
    // are now looking at.
    let live = true;

    void (async () => {
      const program = await getProgram(route.programSlug);
      if (!live) return;
      if (!program) {
        setState({ kind: 'missing' });
        return;
      }

      /*
       * The fuller tree, for somebody who may act on it.
       *
       * `getProgramEvents` filters on `published`, and it has to — without the
       * filter the rules deny the query rather than trimming it. So the drafts
       * are fetched separately and only when somebody may see them, rather than
       * making every visitor pay for a second read. A refusal falls back to the
       * public tree, which is the view a visitor gets.
       */
      const nodes = admin.canEditProgram(program.id)
        ? await listProgramEventsForAdmin(program.id).catch(() => undefined)
        : undefined;
      if (!live) return;

      const trail = route.kind === 'program' ? [] : route.trail;
      const level = await getGalleryLevel(program.id, trail, nodes);
      if (!live) return;
      if (!level) {
        setState({ kind: 'missing' });
        return;
      }

      const calendarId = level.node?.calendarEventId ?? null;
      const calendar = calendarId ? await getLinkedCalendarEvent(calendarId) : null;
      if (live) setState({ kind: 'level', program, level, calendar });
    })();

    return () => {
      live = false;
    };
  }, [route, refreshKey, admin.ready, admin.uid]);

  if (state.kind === 'loading') return <GalleryLoading />;
  if (state.kind === 'missing') return <GalleryMissing />;

  const { program, level } = state;

  /*
   * The presentation, of everything beneath the page it was started from.
   *
   * Rendered from the state the ordinary page already loaded rather than
   * fetching again, which is the whole reason it is a query parameter on this
   * URL and not a route of its own. It needs no level in the query any more:
   * "present Day 2", "present Week 1" and "present all of Summercamp" are one
   * operation over three subtrees, and the subtree is the path.
   *
   * Every approved photograph in that subtree is in it. There is no third flag
   * to tick — see `subtreeSlideshow` for why that one came off.
   */
  if (present) {
    const slides = subtreeSlideshow(level.tree, level.node?.id ?? null, level.media);
    /*
     * The name of what is being presented — **this level, not the road to it.**
     *
     * It was `trailLabel`, which is every ancestor joined: "Summercamp · 2026 ·
     * Week 1 · Day 2". On a page that is a breadcrumb and correct; in the corner
     * of a projector it is a line of text that grows with the depth of the tree
     * and whose useful word is at the far end of it. The parish knows which camp
     * it is standing in.
     */
    const label = level.node?.title ?? program.name;
    return (
      <Presentation
        media={slides}
        label={label}
        style={style}
        pace={pace}
        onStyle={choosePresentationStyle}
        onPace={choosePresentationPace}
        onExit={leavePresentation}
      />
    );
  }

  /*
   * The provider wraps the view rather than living inside it, so the toggle, the
   * properties column and every selectable thing on the page share one mode —
   * and so `useProgramAdmin` is consulted once, here, rather than by each of the
   * dozen components that ask whether they are editable.
   */
  return (
    <EditablePage programId={program.id}>
      <LevelView
        program={program}
        level={level}
        calendar={state.calendar}
        refresh={refresh}
      />
    </EditablePage>
  );
}

/**
 * Edit mode for one gallery page, and the class that makes room for its panel.
 *
 * The class goes on `document.body` rather than on a wrapper here, and that is
 * forced rather than preferred: the properties column is `position: fixed`, and
 * the room for it is `padding-right` on the page — but a full-bleed rail measures
 * itself against the *viewport*, so narrowing it needs a selector above the
 * article. `body` is the only element that is reliably above everything.
 */
function EditablePage({
  programId,
  children,
}: {
  programId: string;
  children: React.ReactNode;
}) {
  const admin = useProgramAdmin();
  return (
    <EditModeProvider allowed={admin.canEditProgram(programId)}>
      <BodyEditingClass />
      {children}
    </EditModeProvider>
  );
}

function GalleryLoading() {
  return (
    <PageBody>
      {/*
        `aria-busy` and a live region rather than a bare spinner: a screen
        reader gets no signal at all from a CSS animation, and this page can sit
        here for a moment on a slow connection.
      */}
      <div className="gallery-loading" aria-busy="true" aria-live="polite">
        <span className="visually-hidden">Loading…</span>
        <span className="gallery-loading__spinner" aria-hidden="true" />
      </div>
    </PageBody>
  );
}

function GalleryMissing() {
  return (
    <PageBody>
      <div className="notice">
        <h1>No such gallery</h1>
        <p>
          This link does not lead to one of the church&apos;s programs. It may have been
          renamed, or the address may have a typo in it.
        </p>
        <p>
          <Link href="/events">See what is on</Link>
        </p>
      </div>
    </PageBody>
  );
}

/* -------------------------------------------------------------------------- */
/* One level: what it is, the photographs that summarise it, what is inside.    */
/* -------------------------------------------------------------------------- */

function LevelView({
  program,
  level,
  calendar,
  refresh,
}: {
  program: DocOf<Program>;
  level: GalleryLevel;
  calendar: DocOf<Event> | null;
  /** Re-read the page's documents. For writes this view cannot draw locally. */
  refresh: () => void;
}) {
  const admin = useProgramAdmin();
  const canEdit = admin.canEditProgram(program.id);
  const edit = useEditMode();
  /*
   * Pulled out so the reset effect below can depend on it. `select` is
   * `setSelection` from a `useState` in the provider, which React guarantees is
   * stable for the lifetime of the component — so this dependency never fires the
   * effect on its own.
   */
  const { select } = edit;

  const { tree, trail, node, media } = level;
  const nodeId = node?.id ?? null;

  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** The arrangement as changed here, before the document is read back. */
  const [drafts, setDrafts] = useState<Record<string, SectionLayout>>({});
  /**
   * The chosen sets, held locally so the block above redraws the instant a tile
   * is clicked. `null`/`undefined` means "nobody has touched this, use the
   * document" — a third value rather than initialising from the prop, because an
   * administrator who removes every picture is choosing the empty list, and an
   * empty array that fell back to the document's would silently refuse that.
   */
  const [featured, setFeatured] = useState<string[] | null>(null);
  /** Whether the all-pictures manager is open. Ministry page only. */
  const [managing, setManaging] = useState(false);
  /** "All of them", held locally so the page redraws the instant it is switched. */
  const [allPictures, setAllPictures] = useState<boolean | null>(null);
  /**
   * The ones pressed × on in the page's own blocks, held locally for the same
   * reason. `null` is "nobody has touched this", as above.
   */
  const [pageHidden, setPageHidden] = useState<string[] | null>(null);
  /**
   * Whether the page's own block has been removed, held locally so it disappears
   * on the press rather than after the round trip. `null` is "nobody has touched
   * this, use the document".
   */
  const [picturesOffDraft, setPicturesOffDraft] = useState<boolean | null>(null);
  /**
   * The same two lists for each band, keyed by band id.
   *
   * Local because a band's lists are written with `updateBand`, which is a
   * read-modify-write of the whole `bands` array and therefore needs a round trip
   * *and* a refetch before the page could redraw from the document. Pressing × on
   * a picture and watching it sit there for half a second is the exact complaint
   * this whole panel has been rebuilt four times over — see the note on
   * `BandEditor`.
   */
  const [bandSets, setBandSets] = useState<
    Record<string, { picks: string[] | null; hidden: string[] }>
  >({});
  /** What the effect below last wrote for each band, so it writes each value once. */
  const bandsWritten = useRef<Record<string, string>>({});
  /**
   * Which block's picker is open, if any. One at a time.
   *
   * A page can carry four blocks and each picker is a scrolling grid of every
   * approved photograph beneath this level; two open at once is two of those
   * between a block and the block below it.
   */
  const [picking, setPicking] = useState<string | null>(null);

  /*
   * Dropped when the page changes level. This component is reused across a
   * navigation — same element, different props — so without this, clicking into
   * Day 1 would draw Week 1's chosen pictures over Day 1's photographs.
   *
   * The selection goes with them, and that one is not tidiness: `EditModeProvider`
   * sits above this view and survives the route change, so the panel would carry
   * on describing a photograph or a section belonging to the level somebody just
   * left. Every branch of `inspecting` tolerates a selection it cannot resolve, so
   * the failure was a panel quietly showing the wrong thing rather than a crash —
   * which is worse, not better.
   */
  useEffect(() => {
    setFeatured(null);
    setAllPictures(null);
    setPageHidden(null);
    setPicturesOffDraft(null);
    setBandSets({});
    bandsWritten.current = {};
    setPicking(null);
    setDrafts({});
    setOpen(null);
    select({ kind: 'page' });
  }, [nodeId, select]);

  const children = useMemo(() => childrenOf(tree, nodeId), [tree, nodeId]);
  const summaries = useMemo(
    () => summariseChildren(tree, nodeId, media),
    [tree, nodeId, media],
  );

  /*
   * This level's own choices — never its parent's, and never the ministry's.
   *
   * Written out rather than `node?.x ?? program.x`, which is what these were and
   * which was wrong in a way that only showed up once the panel started stating
   * its own values back. `??` treats a *deliberate* null as absent, so a level
   * whose field was null — which is most of them, most of the time — read the
   * ministry's value and the panel said "chosen" about something nobody had
   * chosen for it. (The clearest case was the card-cover chooser, which opened
   * with the ministry's tile ticked; both of those are gone now, and the fault
   * they exposed is not.)
   *
   * The same shape bit `featuredMediaIds` harder: an empty array is not nullish,
   * so a level created today was fine, but a document written before the field
   * existed has no key at all and read the *program's* curated list as its own.
   *
   * The level and the ministry are two different documents, and which one this
   * page is looking at is `nodeId`, not the emptiness of a field on it.
   */
  const fromDocument = node === null ? program.featuredMediaIds : node.featuredMediaIds;
  const chosen = featured ?? (Array.isArray(fromDocument) ? fromDocument : []);
  /**
   * Whether an *untouched* block on this page draws everything or a selection.
   *
   * The one page-wide fact about content left, and the only setting in the panel
   * that is about photographs at all. It does nothing to a block somebody has
   * picked for — `pagePictures` reads the picks first — which the control says out
   * loud, because a switch that silently does nothing is worse than one that is not
   * offered.
   */
  const showAll =
    allPictures ?? (node === null ? program.showAllPictures : node.showAllPictures);

  /**
   * Whether this page draws its own photographs at all.
   *
   * The page's first block is not in `bands`, so "delete it" cannot mean removing
   * an array member — it is a fact about the page. See
   * `Program.hidePagePictures` for why an empty `featuredMediaIds` could not
   * carry this, and why it governs the "Also from here" strip as well.
   */
  const picturesOff =
    picturesOffDraft ??
    (node === null ? program.hidePagePictures : node.hidePagePictures) === true;

  /**
   * The pictures pressed × on in the page's *own* blocks — its first one, and the
   * "Also from here" strip.
   *
   * Both live in one field, `hiddenMediaIds`, and can because the two blocks draw
   * disjoint sets by construction: "also" is defined as what the first block left
   * out. A band keeps its own list on itself; see `bandSet`.
   */
  const hiddenOnDocument = node === null ? program.hiddenMediaIds : node.hiddenMediaIds;
  const hidden = pageHidden ?? (Array.isArray(hiddenOnDocument) ? hiddenOnDocument : []);

  /**
   * The page's own first block: the pictures it draws.
   *
   * Its two lists are `featuredMediaIds` and `hiddenMediaIds` on the program or the
   * node, because this block is stored in `sectionLayout` rather than in `bands` —
   * a different home for the same pair a band carries. `pagePictures` resolves
   * either identically, so a picked first block and a picked band cannot end up
   * behaving differently.
   */
  const pictures = useMemo(
    () =>
      /*
        Empty rather than unresolved when the block has been removed. Computing the
        set and then declining to draw it would leave `alsoHere` below — which is
        defined as "what the blocks did not show" — believing these were shown, so
        the leftovers strip would keep excluding exactly the photographs that are
        no longer anywhere on the page.
      */
      picturesOff
        ? []
        : pagePictures(tree, nodeId, media, {
            /*
              `null` for an empty list, not the empty list itself. This block's
              picks live in `featuredMediaIds`, where empty has meant "automatic"
              since long before blocks had their own lists — so it has two states
              where a band has three. `pagePictures` distinguishes them by null,
              and the call site is where the difference belongs. The third state a
              band has is `hidePagePictures` here; see `picturesOff`.
            */
            curated: chosen.length > 0 ? chosen : null,
            showAll: showAll === true,
            hidden,
            /*
              What "filed here" means on the ministry page, which has no node of
              its own. Without it a photograph filed on the ministry is in this
              page's read and in no pool it draws from. See `nodeSummary`.
            */
            rootId: program.id,
            max: MAX_FEATURED,
          }),
    [tree, nodeId, media, chosen, showAll, hidden, picturesOff, program.id],
  );

  /**
   * Photographs filed directly here that the summary above did not show.
   *
   * Exists because otherwise they would be invisible on the only page that could
   * show them. A submission arrives filed against the level it was uploaded to
   * and stays there until somebody files it deeper, so on a live gallery this is
   * the common case rather than a rare one — and a level whose summary is a
   * spread across its children has room for only a few of its own.
   *
   * Empty on a leaf by construction: a leaf's summary *is* everything filed on
   * it.
   *
   * **The hidden ones are excluded here too**, and that is a fix rather than
   * tidying. Without it, pressing × on a picture in the first block that happened
   * to be filed on *this* level took it out of that block and — because it was no
   * longer "shown" — dropped it straight into "Also from here", a few hundred
   * pixels further down the same page. The × looked like it had moved the
   * photograph rather than removed it.
   */
  const alsoHere = useMemo(() => {
    /*
      The ministry counts as a level here too, and its "own" id is the program's.
      It was excluded outright, on the reasoning that the root has no documents of
      its own — which is false: filing a photograph on the ministry is what the top
      row of `PictureManager` does, and this strip is the thing that guarantees a
      filed photograph is visible *somewhere*.
    */
    const ownId = nodeId ?? program.id;
    /*
      Gone with the page's own block, and this is the line that makes Delete mean
      what it says. This strip is whatever the blocks above left out, so with the
      first block removed it would otherwise hold *everything* filed on this level:
      one press would take a block away and put more photographs on the page than
      were there before.
    */
    if (picturesOff) return [];
    const shown = new Set(pictures.map((item) => item.id));
    const off = new Set(hidden);
    return media.filter(
      (item) =>
        item.programEventId === ownId &&
        item.placement.onPage &&
        !shown.has(item.id) &&
        !off.has(item.id),
    );
  }, [media, nodeId, pictures, hidden, program.id]);

  /*
   * This level's own layout — never its ministry's.
   *
   * It was `node?.sectionLayout ?? program.sectionLayout`, which is the third time
   * this exact `??` has been wrong here (see the note on `fromDocument` for the
   * cover and the curated list). A level that has never been styled has no
   * `sectionLayout` at all, so every one of them silently inherited the
   * *ministry's* shape — and changing the ministry's block from a grid to an
   * upright wheel quietly turned every untouched gathering into an upright wheel
   * too. Action at a distance, with nothing on screen to explain it.
   *
   * `resolveSectionLayout(undefined)` is a grid, which is the right default for a
   * level nobody has styled. The ministry's own page still reads the ministry's
   * field, because that is its own field.
   */
  const ownLayout = node === null ? program.sectionLayout : node.sectionLayout;
  const summaryLayout = drafts.summary ?? resolveSectionLayout(ownLayout);
  const alsoLayout = drafts.also ?? resolveSectionLayout(ownLayout);

  /**
   * The extra blocks this page carries, beyond its own first one.
   *
   * Read through `resolveBands` because the field is absent from every document
   * written before it existed — and because `picks` and `hidden` are newer still,
   * so a band written last week has neither key and has to read as empty rather
   * than as undefined.
   */
  const bands = useMemo(
    () => resolveBands(node === null ? program.bands : node.bands),
    [node, program.bands],
  );

  /**
   * The twelve-column grid the blocks are children of, for the packer to measure.
   *
   * A ref rather than a query, because there is one of these per level view and a
   * selector would find the wrong one on a page that has navigated.
   */
  const blockGrid = useRef<HTMLDivElement | null>(null);

  /** Which write target this page's own fields and bands belong to. */
  const target: SectionTarget = useMemo(
    () =>
      nodeId === null
        ? { kind: 'program', programId: program.id }
        : { kind: 'node', programEventId: nodeId },
    [nodeId, program.id],
  );

  /**
   * Each band, with its layout and the pictures it actually draws.
   *
   * Every band resolves through the same `pagePictures` as the first block, with
   * its own two lists in place of the page's. A band nobody has picked for has both
   * empty, so it draws exactly what the page's automatic set is — which is what
   * every band did before it had lists at all, and why adding them changed no
   * existing page.
   */
  const bandBlocks = useMemo(
    () =>
      bands.map((band) => {
        const local = bandSets[band.id];
        // `local === undefined` means nothing has been changed here yet, which is
        // not the same as `local.picks === null` — that is somebody having pressed
        // "Back to automatic". Hence the property check rather than `??`.
        const picks = local ? local.picks : band.picks;
        const bandHidden = local?.hidden ?? band.hidden;
        return {
          band,
          layout: drafts[band.id] ?? band.layout,
          picks,
          hidden: bandHidden,
          media: pagePictures(tree, nodeId, media, {
            curated: picks,
            showAll: showAll === true,
            hidden: bandHidden,
            rootId: program.id,
            max: MAX_FEATURED,
          }),
        };
      }),
    [bands, bandSets, drafts, tree, nodeId, media, showAll, program.id],
  );

  /**
   * What each block on this page is drawing, keyed the way `pickerFor` is keyed.
   *
   * Built from the resolved sets rather than from the stored picks, because the
   * question the picker's mark answers is "is this photograph on the screen in
   * front of me" — and an automatic block draws plenty it has never picked.
   */
  const shownByBlock = useMemo(() => {
    const map = new Map<string, readonly string[]>();
    if (!picturesOff) map.set('summary', pictures.map((one) => one.id));
    for (const block of bandBlocks) {
      map.set(block.band.id, block.media.map((one) => one.id));
    }
    return map;
  }, [picturesOff, pictures, bandBlocks]);

  /**
   * Every block's width, in the order the page lays them out.
   *
   * The page's own block first when it is drawn at all, then the bands. This is
   * the list `dockWidths` flows to work out what is left on a row, so it has to be
   * the same order the twelve columns fill in — which is document order, because
   * CSS auto-placement never runs backwards.
   */
  const blockWidths = useMemo(
    () => [
      ...(picturesOff ? [] : [summaryLayout.width]),
      ...bandBlocks.map((block) => block.layout.width),
    ],
    [picturesOff, summaryLayout.width, bandBlocks],
  );

  /** Where a band sits among all of them — the page's own block shifts it by one. */
  const blockIndexOf = (index: number) => (picturesOff ? 0 : 1) + index;

  /**
   * Put a band beside the block before it, narrowing that one if it has to.
   *
   * What the drag on the grip does when it ends in the right-hand side of the
   * block above. Tommy: *"if it is dragged to the same area as the grid the grid
   * should adjust its width."*
   *
   * Two writes at most, and the neighbour goes first: it is the one that makes
   * room, and a refetch landing between them would rather show a page that has room
   * for a block than one with a block in a space that is not there yet. Both are
   * drafted before either is sent, so the pair moves in one frame on screen
   * whatever the round trips do.
   */
  const dockBand = (index: number) => {
    const plan = dockWidths(blockWidths, blockIndexOf(index));
    const dragged = bandBlocks[index];
    if (!plan || !dragged) return;

    const sized = { ...dragged.layout, width: plan.dragged };
    // The neighbour is the block before it: another band, or the page's own — which
    // is the one case where the write is a section rather than a band.
    const asBand = blockIndexOf(index) - 1 - (picturesOff ? 0 : 1);
    const neighbour = asBand >= 0 ? bandBlocks[asBand] : null;
    const narrowed =
      plan.neighbour === null
        ? null
        : {
            ...(neighbour ? neighbour.layout : summaryLayout),
            width: plan.neighbour,
          };
    const neighbourKey = neighbour ? neighbour.band.id : 'summary';

    setDrafts((was) => ({
      ...was,
      ...(narrowed ? { [neighbourKey]: narrowed } : {}),
      [dragged.band.id]: sized,
    }));

    void write(async () => {
      if (narrowed) {
        if (neighbour)
          await updateBand(target, neighbour.band.id, { layout: narrowed }, admin.uid);
        else await setSectionLayout(target, narrowed, admin.uid);
      }
      await updateBand(target, dragged.band.id, { layout: sized }, admin.uid);
      refresh();
    });
  };

  /**
   * One flat list behind the lightbox, and the offset each block starts at.
   *
   * Rebuilt now that each block draws its own set: it was `[...pictures,
   * ...alsoHere]` with every band's click mapping into the first stretch, which was
   * correct only while all of them showed the same photographs. A band with its own
   * picks would have opened the lightbox on whatever happened to be at that index
   * in the *first* block — the right position in the wrong set, which is the kind
   * of wrong nobody reports because it looks like a mis-click.
   *
   * A photograph in two blocks appears twice, and should: the arrow keys walk the
   * page in the order the page is laid out, and two blocks showing it is two places
   * it is on the page.
   */
  const { flat, offsets } = useMemo(() => {
    const list: DocOf<GalleryMedia>[] = [];
    const at = new Map<string, number>();
    at.set('summary', 0);
    list.push(...pictures);
    for (const block of bandBlocks) {
      at.set(block.band.id, list.length);
      list.push(...block.media);
    }
    at.set('also', list.length);
    list.push(...alsoHere);
    return { flat: list, offsets: at };
  }, [pictures, bandBlocks, alsoHere]);

  /**
   * The page draws no photographs anywhere and has no levels inside it.
   *
   * Measured off `flat` — every block's contents, the leftovers strip included —
   * rather than off `pictures` and `alsoHere`. That was the old test, and it was
   * wrong as soon as a band could carry its own set: a leaf with the page's own
   * block removed and a band full of photographs satisfied it, so "No photographs
   * have been added here yet" would print underneath four of them.
   *
   * Unreachable until the page's own block could be removed at all, which is why
   * it was not a bug worth finding before now.
   */
  const showsNothing = flat.length === 0 && children.length === 0;

  /** Where a block's own index `n` sits in `flat`. */
  const openAt = useCallback(
    (key: string, index: number) => setOpen((offsets.get(key) ?? 0) + index),
    [offsets],
  );

  /** Run one write, with the panel's save state around it. */
  const write = useCallback(async (run: () => Promise<void>) => {
    setSaving(true);
    try {
      await run();
    } catch (error) {
      // Logged rather than surfaced: the page has already redrawn, and the
      // realistic failure is `permission-denied` from a grant this person does
      // not hold — in which case the controls should not have been drawn at all.
      console.error('[programs] could not save:', error);
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * A level's name and description, typed on its own card.
   *
   * ## Why the card draws from a local overlay
   *
   * The cards come from `tree`, which the *shell* fetched — so unlike a section's
   * arrangement there is no local copy for this view to redraw from, and waiting
   * for a refetch per keystroke would make the caret jump. So keystrokes land in
   * `levelEdits` and the card reads that first; the write is debounced behind it,
   * and the refetch on the way out reconciles.
   *
   * Same shape as `bandSets` above, and the same reason: *"pressing × on a picture
   * and watching it sit there for half a second is the exact complaint this whole
   * panel has been rebuilt four times over."* A name is no different.
   *
   * One timer per level, so editing two cards does not have the second cancel the
   * first one's write.
   */
  const [levelEdits, setLevelEdits] = useState<
    Record<string, { title?: string; description?: string }>
  >({});
  const levelTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const editLevel = useCallback(
    (id: string, patch: { title?: string; description?: string }) => {
      setLevelEdits((was) => ({ ...was, [id]: { ...was[id], ...patch } }));

      const running = levelTimers.current[id];
      if (running) clearTimeout(running);
      levelTimers.current[id] = setTimeout(() => {
        /*
         * `renameProgramEvent` for a title rather than `updateProgramEvent`,
         * because it is the one that refuses an empty one — a level with no name
         * is a card with nothing to click and a crumb trail with a gap in it.
         * An empty box is a state somebody passes through while retyping, so it
         * is simply not written; the field keeps showing what they typed.
         */
        void write(async () => {
          if (patch.title !== undefined && patch.title.trim()) {
            await renameProgramEvent(id, patch.title, admin.uid);
          }
          if (patch.description !== undefined) {
            await updateProgramEvent(id, { description: patch.description }, admin.uid);
          }
        });
      }, 800);
    },
    [write, admin.uid],
  );

  /* Dropped rather than flushed on the way out, for the reason `ProgramDirectory`
     gives: the usual cause of unmounting is the level having just been removed,
     and a flush would land on a document that no longer exists. */
  useEffect(
    () => () => {
      for (const timer of Object.values(levelTimers.current)) clearTimeout(timer);
    },
    [],
  );

  /*
   * Write behind the redraw, not in the click handler.
   *
   * Two reasons, and the second is the one that made this an effect rather than
   * an `await` in the handler. The first is responsiveness: the picker is used to
   * arrange a page, and an arrangement that waits for a round trip before the
   * picture moves cannot be arranged with. The second is correctness — the click
   * handler applies `togglePick` inside a functional state update, so the value
   * to be written does not exist until React has committed it. Reading it here is
   * the only place it is knowable.
   */
  useEffect(() => {
    if (featured === null) return;
    void write(() =>
      nodeId === null
        ? setProgramFeatured(program.id, featured, admin.uid)
        : setNodeFeatured(nodeId, featured, admin.uid),
    );
  }, [featured, nodeId, program.id, admin.uid, write]);

  /**
   * The page's × list, written the same way and for the same reason.
   *
   * The whole array rather than one member at a time, which is a real
   * trade and worth naming. `arrayUnion` is atomic against a second administrator
   * removing a different photograph at the same moment; a whole-array write is not.
   * But the list here is assembled by functional state updates precisely so that a
   * run of quick ×s accumulates, and writing a member at a time from an effect that
   * only sees the finished list would mean diffing it against the document to work
   * out which member to send. Two people tidying the same page in the same second
   * is a loss of one click; a run of ×s losing all but the last was the actual bug.
   */
  useEffect(() => {
    if (pageHidden === null) return;
    void write(() => setHiddenPictures(target, pageHidden, admin.uid));
  }, [pageHidden, target, admin.uid, write]);

  /**
   * A band's two lists, written once per distinct value.
   *
   * The ref is what stops this looping. `bands` comes from the shell's fetch and is
   * not refetched after one of these writes — there is nothing to refetch *for*,
   * since `bandSets` is already what the page draws — so comparing against the
   * document would find a difference for ever and write on every render. Comparing
   * against what this effect last sent is the honest question: "is this value
   * already saved?"
   */
  useEffect(() => {
    for (const [id, set] of Object.entries(bandSets)) {
      const stamp = JSON.stringify(set);
      if (bandsWritten.current[id] === stamp) continue;
      bandsWritten.current[id] = stamp;
      void write(() =>
        updateBand(target, id, { picks: set.picks, hidden: set.hidden }, admin.uid),
      );
    }
  }, [bandSets, target, admin.uid, write]);

  useEffect(() => {
    if (picturesOffDraft === null) return;
    void write(() => setPagePicturesHidden(target, picturesOffDraft, admin.uid));
  }, [picturesOffDraft, target, admin.uid, write]);

  useEffect(() => {
    if (allPictures === null) return;
    void write(() =>
      setPageShowsAll(
        nodeId === null
          ? { kind: 'program', programId: program.id }
          : { kind: 'node', programEventId: nodeId },
        allPictures,
        admin.uid,
      ),
    );
  }, [allPictures, nodeId, program.id, admin.uid, write]);

  /**
   * Placing one photograph.
   *
   * Not held locally here: `GalleryCanvas` keeps its own overrides so the tile
   * follows the pointer, and this only has to persist. Duplicating that state at
   * two levels is how the canvas and the page end up disagreeing about where a
   * picture is.
   */
  const place = useCallback(
    (mediaId: string, layout: GridPlacement | null) => {
      setSaving(true);
      void setMediaLayout(mediaId, layout, admin.uid)
        .catch((error) =>
          console.error('[programs] could not place the photograph:', error),
        )
        .finally(() => setSaving(false));
    },
    [admin.uid],
  );

  /* ---- one block's pictures --------------------------------------------- */

  /**
   * Change a block's two lists, **inside a functional state update**.
   *
   * Every gesture on a block's pictures goes through here, and the shape is not a
   * style choice. React batches the state updates from a run of quick clicks and
   * re-renders once at the end, so a handler that computed its next list from the
   * value it *rendered* with would have every click in that run start from the same
   * stale list — and the last one would win. Ticking six photographs in the picker
   * would add one.
   *
   * That is not hypothetical: it is the same defect the note above `useEffect` on
   * `featured` describes, and driving the picker from a script found it again the
   * moment this was written the obvious way. `change` is handed the live list and
   * returns the next one, which is the only shape that accumulates.
   *
   * `key` is a band id, or `'summary'` for the page's own first block — which keeps
   * its two lists in `featuredMediaIds`/`hiddenMediaIds` on the program or the node
   * rather than on itself. Two homes, one meaning; see `pagePictures`.
   *
   * The write is not here. For the first block it is the `featured` effect below;
   * for a band it is the effect on `bandSets`. Both exist because the value to be
   * written does not exist until React has committed the update.
   */
  const changeBlock = useCallback(
    (
      key: string,
      /** Given the block's live lists, the ones it should have. */
      change: (was: { picks: string[]; hidden: string[] }) => {
        /** `null` hands the block back to the page. `[]` empties it on purpose. */
        picks: string[] | null;
        hidden: string[];
      },
      /** What its picked list counts as when it has none of its own. */
      seed: readonly string[],
    ) => {
      if (key === 'summary' || key === 'also') {
        /*
         * Two updates, because the first block's two lists live in two separate
         * fields — and each one is handed only the half it is about. That is
         * allowed because every `change` passed in here decides each list from
         * that list alone: taking a picture out subtracts from one and adds to the
         * other, and neither needs to see the other's contents to do it. Reading
         * one state inside the other's updater would be the forbidden thing.
         *
         * `null` collapses to `[]` here, which is this block's two-state story: its
         * picks live in `featuredMediaIds`, where empty already means automatic.
         */
        setFeatured(
          (wasPicks) =>
            change({ picks: wasPicks ?? [...seed], hidden: [] }).picks?.slice(
              0,
              MAX_FEATURED,
            ) ?? [],
        );
        setPageHidden(
          (wasHidden) => change({ picks: [], hidden: wasHidden ?? [...hidden] }).hidden,
        );
        return;
      }
      setBandSets((was) => {
        const band = bands.find((one) => one.id === key);
        const current = was[key] ?? {
          picks: band?.picks ?? null,
          hidden: band?.hidden ?? [],
        };
        // The seed stands in only where there is no list at all. A block that is
        // deliberately empty starts from empty, which is what "add a block, then
        // add pictures to it" has to do.
        const next = change({
          picks: [...(current.picks ?? seed)],
          hidden: [...current.hidden],
        });
        return {
          ...was,
          [key]: {
            picks: next.picks?.slice(0, MAX_FEATURED) ?? null,
            hidden: next.hidden,
          },
        };
      });
    },
    [bands, hidden],
  );

  /**
   * A picture taken out of one block by its own ×.
   *
   * A hide, never a delete — the photograph stays approved, stays in the parish's
   * storage, and stays on the page of the level it is filed under. That is why it
   * needs no confirmation.
   *
   * **It writes both lists, and that is what makes the × behave the same however
   * the block got its pictures.** Off the picked list, so a picked block loses it;
   * onto the × list, so an automatic block loses it too — the automatic case cannot
   * be expressed as a shorter pick list, because a block showing all two hundred
   * photographs of a camp would need a list of a hundred and ninety-nine and the
   * list is capped at twenty-four.
   *
   * Pressing × on the last picked picture leaves a band **empty**, not automatic —
   * `[]` and `null` are two different states, see `GalleryBand.picks`. That is the
   * whole reason they are two: whittling a block down to one photograph and then
   * removing that one used to refill it with twenty-four. The page's own first
   * block has only the two states and does fall back to automatic there, but every
   * picture taken out of it is on the × list, so it comes back minus those rather
   * than as the set that was just whittled down.
   *
   * "Back to automatic" in the footer is the one control that clears both lists.
   */
  const removeFrom = useCallback(
    (key: string, mediaId: string) =>
      changeBlock(
        // "Also from here" has no picked list of its own — it is by definition what
        // the first block left over — so only the × list moves for it. The two
        // blocks share one, and can: their sets are disjoint by construction.
        key,
        (was) => ({
          picks: was.picks.filter((id) => id !== mediaId),
          hidden: was.hidden.includes(mediaId) ? was.hidden : [...was.hidden, mediaId],
        }),
        // No seed: a × never turns an automatic block into a picked one. It goes on
        // the × list, which is what lets a block showing all four hundred
        // photographs of a camp lose one without becoming a list of 399.
        [],
      ),
    [changeBlock],
  );

  /** Back to drawing whatever this level holds, and keeping up on its own. */
  const automaticFor = useCallback(
    (key: string) => changeBlock(key, () => ({ picks: null, hidden: [] }), []),
    [changeBlock],
  );

  /** One photograph ticked or unticked in a block's picker. */
  const togglePicked = useCallback(
    (key: string, mediaId: string, seed: readonly string[]) =>
      changeBlock(
        key,
        (was) => ({
          picks: togglePick([...was.picks], mediaId, 'many', MAX_FEATURED),
          /*
            The × list is cleared by any pick, and that is not tidying:
            `pagePictures` applies it *after* the picks, so a photograph on both
            lists would be picked and then immediately taken out again — and
            re-ticking it in the picker would appear to do nothing at all. The
            ticked set is the whole answer, so it replaces both lists.
          */
          hidden: [],
        }),
        seed,
      ),
    [changeBlock],
  );

  /**
   * A picture dragged to a new place in a wheel.
   *
   * Which order it writes depends on whether the block has one of its own, and the
   * two are genuinely different things:
   *
   *  - **A picked block** has its own order — the list *is* the sequence. So a drag
   *    rewrites that block's list, and touches nothing else on the page.
   *  - **An automatic block** has no order of its own; it is drawn in
   *    `GalleryMedia.order`. So a drag rewrites *that*, which is a change to the
   *    photographs rather than to this block — and correctly so, because there is
   *    nowhere else for the intent to live. Every other automatic block on the page
   *    reorders with it, which is the honest consequence of not having picked.
   */
  const dropInto = useCallback(
    (key: string, picked: boolean, ordered: DocOf<GalleryMedia>[]) => {
      if (picked) {
        const order = ordered.map((one) => one.id);
        // Not through `changeBlock`'s functional form, and it does not need to be:
        // a drag ends with the whole sequence in hand, so there is no earlier value
        // to accumulate onto. `hidden` stays as it was — a reorder is not a removal.
        changeBlock(key, (was) => ({ picks: order, hidden: was.hidden }), order);
        return;
      }
      void write(async () => {
        await reorderMedia(ordered, admin.uid);
        refresh();
      });
    },
    [changeBlock, admin.uid, write, refresh],
  );

  /**
   * The picker for one block, when it is the open one.
   *
   * **It opens with what the block is already showing already ticked**, and that is
   * what makes one control do both jobs. A block of twelve automatic photographs
   * opens as twelve ticks: tick a thirteenth and you have thirteen picked, untick
   * one and you have eleven. There is no separate step where you declare that you
   * are now hand-picking — the first tick is that step, and it never starts from a
   * blank grid you have to refill.
   *
   * The photographs offered are every approved one beneath this level, grouped by
   * the level each is filed under and headed by its whole trail. That is
   * `MediaPicker`'s doing and the reason it takes the subtree rather than fetching:
   * "pick from all the subsections" is a statement about the subtree.
   */
  const pickerFor = (
    key: string,
    title: string,
    shown: readonly DocOf<GalleryMedia>[],
    /** `null` — not `[]` — is "nobody has picked", so the seed stands in. */
    picks: readonly string[] | null,
  ) => {
    if (picking !== key) return null;
    /*
      The seed: what this block draws right now, which is what the picker opens
      ticked. Passed to `togglePicked` as well as shown, so the first click starts
      from exactly the set on screen rather than from an empty list.
    */
    const seed = shown.slice(0, MAX_FEATURED).map((one) => one.id);
    /*
      What the *other* blocks on this page are showing — this one excluded, or every
      picture already ticked would also be marked as being somewhere else, which is
      true of nothing.
    */
    const elsewhere = [
      ...new Set(
        [...shownByBlock]
          .filter(([other]) => other !== key)
          .flatMap(([, ids]) => ids),
      ),
    ];
    return (
      <MediaPicker
        title={title}
        mode="many"
        max={MAX_FEATURED}
        media={media}
        tree={tree}
        selected={picks ?? seed}
        elsewhere={elsewhere}
        onToggle={(id) => togglePicked(key, id, seed)}
        onClose={() => setPicking(null)}
      />
    );
  };

  /* ---- the facts in the header ------------------------------------------- */

  const beneath = useMemo(() => descendantsOf(tree, nodeId), [tree, nodeId]);
  const when = node ? formatDateSpan(node.startAt, node.endAt, node.timeZone) : '';
  const photos = media.filter((item) => item.kind === 'photo').length;
  const clips = media.filter((item) => item.kind === 'video').length;
  const presentable = subtreeSlideshow(tree, nodeId, media);

  const title = node?.title ?? program.name;
  const description = node?.description ?? program.description;
  const published = node?.published ?? program.published;

  /** Where this page's own trail goes, and where its children's do. */
  const hrefOf = useCallback(
    (childId: string) => programEventHref(program.slug, trailSlugs(tree, childId)),
    [program.slug, tree],
  );

  /**
   * The link back up: the parent level, or the ministry, or /events.
   *
   * Its label is the destination's own name rather than "Back", because a
   * visitor three levels into a gallery needs to know whether that arrow returns
   * them to the week or to the ministry.
   */
  const parent = trail.length >= 2 ? trail[trail.length - 2] : undefined;
  const back = parent
    ? { href: hrefOf(parent.id), label: parent.title }
    : node
      ? { href: `/events/${program.slug}`, label: program.name }
      : { href: '/events', label: 'Events' };

  /* ---- what is inside --------------------------------------------------- */

  /*
   * The heading over the cards, and what an empty one says.
   *
   * The word comes from the document now — `childLabel` on whichever of the
   * ministry or the level this page is — because no constant can be right at
   * every depth: the parts of Summercamp are years and the parts of a year are
   * weeks. It was hardcoded "Gatherings", which Tommy's answer to was that it is
   * "just not a thing". See `childLabelOf`.
   */
  const childLabel = childLabelOf(node ?? program);
  const insideTitle = childLabel;
  const insideEmpty = node
    ? 'Nothing is inside this yet, so this page shows every photograph filed here. Add a part to divide them up.'
    : `No ${childLabel.toLowerCase()} of this ministry have been published yet.`;

  /* ---- the properties column --------------------------------------------- */

  /**
   * The controls for one scroll wheel.
   *
   * A local component rather than a top-level one because every one of these
   * writes through the same `write`/`refresh` pair the rest of this view uses, and
   * threading four callbacks plus the target through a separate file would be more
   * plumbing than the thing being plumbed. It is used from two places — the page's
   * own list of rows, and the panel when a wheel is clicked on the page.
   */
  const bandEditor = (band: GalleryBand) => (
    <BandEditor
      band={band}
      onTitle={(title) =>
        void write(async () => {
          await updateBand(target, band.id, { title }, admin.uid);
          refresh();
        })
      }
    />
  );

  /**
   * What the properties column shows, for the current selection.
   *
   * Assembled here rather than inside `Inspector` because only this view knows
   * what a section or a photograph *at this level* means — which levels exist
   * beneath it, where a picture may be re-filed to, what writing a change
   * entails. `Inspector` draws the frame; this fills it.
   */
  const inspecting = (() => {
    // Bound to a local first: narrowing a discriminated union does not survive
    // a property access on `edit`, because TypeScript cannot know the getter
    // returns the same object twice.
    const selection = edit.selection;

    if (selection.kind === 'media') {
      const item = media.find((one) => one.id === selection.id);
      if (item) {
        return {
          kind: item.kind === 'video' ? 'Clip' : 'Photograph',
          title: item.caption || 'Untitled',
          body: (
            <MediaProperties
              item={item}
              tree={tree}
              /*
                Where it may be re-filed to: this level and everything under it.
                Not the whole ministry — a photograph moved to a level this page
                does not show is a change nobody can see the result of, which is
                the same argument that kept the old subgroup control off the
                ministry page.
              */
              places={nodeId === null ? beneath : [node!, ...beneath]}
              busy={saving}
              /*
                Each of these ends with a refresh, and has to. The photograph is
                drawn from `media`, which the *shell* fetched — so unlike a
                section's arrangement or a placement on the canvas, there is no
                local copy for this view to redraw from. Without the refetch the
                write lands in Firestore and the page shows the old value, which
                is the most confusing outcome available: it looks like the control
                did nothing.
              */
              onPlacement={(next: MediaPlacement) =>
                void write(async () => {
                  await setMediaPlacement(item.id, next, admin.uid);
                  refresh();
                })
              }
              onFile={(destination) =>
                void write(async () => {
                  await setMediaNode(item.id, destination, admin.uid);
                  refresh();
                })
              }
              /*
                `?? ''` because `setCaption` in ./review takes a uid it writes to
                `updatedBy`, and this page's `admin.uid` is null until the member
                document has been read. An empty string is wrong to store, so the
                guard is on the call rather than in the helper: a caption edit
                before the session is ready is a click that cannot have happened —
                the panel is not drawn until `canEdit` is true.
              */
              onCaption={(caption) =>
                void write(async () => {
                  await setCaption(item.id, caption, admin.uid ?? '');
                  refresh();
                })
              }
              onFocal={(next) =>
                void write(async () => {
                  await setMediaFocal(item.id, next, admin.uid);
                  refresh();
                })
              }
              /*
                Reordering is scoped to the block the picture is drawn in, which
                is why the list comes from here rather than from a fetch: the same
                photograph sits in a different position in its own level's gallery
                and in its parent's summary, and "earlier" has to mean earlier
                *on screen*.
              */
              {...(() => {
                const block = pictures.some((one) => one.id === item.id)
                  ? pictures
                  : alsoHere.some((one) => one.id === item.id)
                    ? alsoHere
                    : null;
                if (!block) return {};
                const at = block.findIndex((one) => one.id === item.id);
                return {
                  position: { at, of: block.length },
                  onMove: (delta: -1 | 1) =>
                    void write(async () => {
                      await moveMediaWithin(block, item.id, delta, admin.uid);
                      refresh();
                    }),
                };
              })()}
            />
          ),
        };
      }
    }

    if (selection.kind === 'section') {
      /*
       * The target is derived, and a selection that has no target falls through
       * to the level itself rather than being drawn with a broken one.
       *
       * That is reachable, not defensive: selecting the "Also from here" block on
       * a week and then navigating to the ministry page keeps the selection —
       * `edit` is a provider above this view and does not reset on a route change
       * — and the ministry has no such block and no node id to write to. Drawn
       * anyway it would be a designer whose every change tried to patch
       * `programEvents/''`, which throws.
       */
      /*
         A band selected by clicking it on the page opens its own row, not the
         page's arrangement. Without this, clicking a scroll wheel restyled the
         block above it — a control acting on something other than the thing that
         was pressed, which is the worst kind of wrong.
      */
      const band = bands.find((one) => one.id === selection.key);
      if (band) {
        return {
          kind: 'Block',
          title:
            band.title || GALLERY_DISPLAY_NAMES[(drafts[band.id] ?? band.layout).display],
          body: bandEditor(band),
        };
      }

      const key = selection.key === 'also' ? 'also' : 'summary';
      const sectionTarget: SectionTarget | null =
        nodeId !== null
          ? { kind: 'node', programEventId: nodeId }
          : key === 'summary'
            ? { kind: 'program', programId: program.id }
            : null;

      if (sectionTarget) {
        return {
          kind: 'Section',
          title: key === 'also' ? 'Also from here' : 'Photographs',
          body: (
            <SectionDesigner
              layout={key === 'also' ? alsoLayout : summaryLayout}
              saving={saving}
              onClose={() => edit.select({ kind: 'page' })}
              onChange={(next) => {
                setDrafts((was) => ({ ...was, [key]: next }));
                void write(() => setSectionLayout(sectionTarget, next, admin.uid));
              }}
            />
          ),
        };
      }
    }

    if (selection.kind === 'level') {
      const child = tree.byId.get(selection.id);
      if (child) {
        /*
         * A level *inside* this page, selected from its card or from the list.
         *
         * **No rows at all — one panel.** It had three (Its card picture, Where it
         * sits, Its details), which is three clicks to reach three short controls
         * about one thing. A list of one collapsible section is a list that only
         * ever costs you a click, and three was not far off it. The card picture
         * is gone entirely now — see `summariseChildren`; a card cycles through
         * what is beneath it and there is nothing to choose.
         *
         * What is *not* here is deliberate rather than a saving: its own
         * photographs and how they are arranged belong to *its* page, where the
         * result can be seen. Choosing them from here would be arranging something
         * off screen.
         */
        return {
          kind: 'Inside this',
          title: child.title,
          body: (
            <div className="inspector__body">
              <LevelDetails
                programId={program.id}
                node={child}
                onChanged={refresh}
                onRemoved={refresh}
              />

              {/*
                Moving a level, which the fixed three levels made impossible.
                Somebody who added "Day 1" to the ministry instead of to the week
                had, before this, no way out but to delete it — losing every
                photograph's filing with it.
              */}
              <label className="inspector__field">
                <span>Inside</span>
                <select
                  value={child.parentId ?? ''}
                  disabled={saving}
                  onChange={(change) =>
                    void write(async () => {
                      await setProgramEventParent(
                        [...tree.byId.values()],
                        child.id,
                        change.target.value === '' ? null : change.target.value,
                        admin.uid,
                      );
                      refresh();
                    })
                  }
                >
                  <option value="">{program.name}, directly</option>
                  {[...tree.byId.values()]
                    /*
                      Itself and its own descendants are absent from the list, not
                      merely refused on submit. A level inside itself is a cycle,
                      and every walk in gallery/tree.ts would then run into its
                      depth guard — a page drawn in the wrong place rather than a
                      hung tab, but still nothing anybody wanted.
                    */
                    .filter(
                      (one) =>
                        one.id !== child.id &&
                        !descendantsOf(tree, child.id).some(
                          (under) => under.id === one.id,
                        ),
                    )
                    .map((one) => (
                      <option key={one.id} value={one.id}>
                        {trailLabel(tree, one.id)}
                      </option>
                    ))}
                </select>
                <span className="inspector__note">
                  Its photographs go with it, and its address changes to match.
                </span>
              </label>
            </div>
          ),
        };
      }
    }

    /*
     * The level itself. **Two rows, and the first one is now a single question.**
     *
     * This panel has been rebuilt five times and every version before the last was
     * the same mistake in a different arrangement: the controls for the *page* and
     * the controls for the *things on the page* were all in here together.
     *
     * The fourth rebuild moved every gesture out — moving a block, reshaping it,
     * throwing it away, reordering photographs — and left the panel with the one
     * thing that was not a gesture: a three-way choice for which photographs the
     * page drew on. Tommy, on that: *"the settings in the editing are still getting
     * pretty confusing … for each section I want an add button that lets the admin
     * pick from all subsections."*
     *
     * He was right, and the reason is that "the ones I pick" was never a *setting*.
     * It was a mode you had to be in before you were allowed to pick, on a page
     * where the picking is the thing you came to do. It is a button on each block
     * now — see `BlockFrame`'s footer — and the picker opens with that block's
     * photographs already ticked, so there is no mode to enter and nothing to
     * understand first.
     *
     * What is left in here is what a panel is actually good for: **one decision that
     * has no thing to put it on** (whether an untouched block summarises this level
     * or shows all of it, which is true of the page rather than of any one block)
     * and **text in fields** (its name, its dates, whether anyone can see it).
     */
    return {
      kind: node ? 'Level' : 'Ministry',
      title,
      body: (
        <DisclosureGroup
          key={nodeId ?? 'program'}
          /*
            Open on the details, not on nothing.
            
            It defaulted to `null`, so the column landed on two collapsed rows and
            a line of idle text — and everything real, including the field that
            names what is inside this level, was one more click down. Tommy, twice:
            the panel looked useless, and then *"there's still no section to name
            the subcollections."* There was; it was behind a closed row.
            
            `details` rather than `pictures` because it holds the things that are
            *facts* about the page — its name, its dates, whether anyone can see it,
            what its parts are called. The photographs choice is one switch and it
            is one click away.
          */
          defaultOpen="details"
        >
          <Disclosure
            id="pictures"
            label="Photographs"
            value={
              children.length === 0
                ? 'all of them'
                : showAll === true
                  ? 'all of them'
                  : 'a selection'
            }
          >
            {children.length === 0 ? (
              <p className="inspector__note">
                Nothing is inside this level, so every block on it starts from all the
                photographs filed here — there is nothing to summarise. Add a part in the
                shelf and this becomes a choice.
              </p>
            ) : (
              <>
                <div className="designer__row">
                  <p className="designer__label">A block you have not picked for shows</p>
                  <div className="chips" role="group" aria-label="Photographs">
                    {(
                      [
                        [false, 'A selection of what is inside'],
                        [true, 'Every photograph inside'],
                      ] as const
                    ).map(([option, label]) => (
                      <button
                        key={String(option)}
                        type="button"
                        className={`chip${(showAll === true) === option ? ' is-on' : ''}`}
                        aria-pressed={(showAll === true) === option}
                        onClick={() => setAllPictures(option)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {showAll === true && (
                  <p className="inspector__note">
                    Every approved photograph inside this level, however deep, and it
                    keeps up on its own as more are approved. That is a lot for a grid —
                    turn a block into a wheel and it holds the lot comfortably.
                  </p>
                )}

                {/*
                  Stated rather than left to be discovered. A block somebody has
                  picked for ignores this control entirely — `pagePictures` reads the
                  picks first — and a switch that silently does nothing is the single
                  most confusing thing a panel can contain. It was, in the version
                  before this one.
                */}
                <p className="inspector__note">
                  A block you <em>have</em> picked for is not affected — it shows exactly
                  what you picked. <strong>Back to automatic</strong> under that block
                  brings it back here.
                </p>
              </>
            )}
          </Disclosure>

          <Disclosure
            id="details"
            label={node ? 'This page' : 'This ministry'}
            value={published ? (node && when ? when : 'visible') : 'draft'}
          >
            {node ? (
              <LevelDetails
                programId={program.id}
                node={node}
                onChanged={refresh}
                /*
                  A reload, not a refetch: the level being looked at no longer
                  exists, and there is nothing at this URL to re-read.
                */
                onRemoved={() => window.location.reload()}
              />
            ) : (
              <>
                <ProgramDetails
                  program={program}
                  onChanged={refresh}
                  onRemoved={() => window.location.reload()}
                />

                {/*
                  Every picture in the ministry, in one screen.

                  Here and on no level below, for the reason `PictureManager` gives:
                  a level's page only has its own subtree to offer, so a manager
                  there could only file a picture *deeper*, and the mis-filing this
                  fixes is nearly always a picture that is too shallow.

                  A button rather than the screen itself: it is a full-screen
                  modal, and one that renders because a panel row happens to be
                  open is one nobody asked for.
                */}
                <div className="inspector__group">
                  {/*
                    ## The label, which was wrong twice before it was too long

                    It said "Move or delete pictures…", and *move* was the problem:
                    dragging a picture means reordering it everywhere else in this
                    editor, so the button read as one more way to arrange a page.
                    Then "Re-file or delete pictures…", and *re-file* was the
                    parish's filing-cabinet verb rather than a volunteer's — Tommy:
                    "very missable and not very clear what it does". The fix for
                    that named the whole outcome, "Put a photograph on a different
                    page, or delete it…", which is accurate and is a sentence to
                    read rather than a button to press.

                    So: two plain words, and the line under them does the
                    explaining. That is the division of labour this shape exists
                    for — a `strong` you can recognise without reading, and a
                    `small` that says what happens next. The legend above it went
                    with the long label; it was a third statement of the same fact.

                    ## The explanation stays inside the control

                    It used to be an `inspector__note` *under* a `button--quiet
                    button--small` — a footnote under the quietest thing in the
                    panel. See `.inspector__action`.
                  */}
                  <button
                    type="button"
                    className="inspector__action"
                    onClick={() => setManaging(true)}
                  >
                    <Icon name="photos" size={20} />
                    <span>
                      <strong>Edit photos…</strong>
                      <small>
                        Every photograph in the ministry at once. Drag one onto a
                        different page to put it there, or delete it for good.
                      </small>
                    </span>
                  </button>
                </div>
              </>
            )}

            {/*
              "Picture on its card" was here — a chooser for the one photograph a
              level's card opened its cycle on, at Tommy's direction removed.

              A card already cycles through what is beneath it, and the pick only
              decided which lap it started on: a setting whose whole effect was
              invisible after four seconds of cross-fade. Two of these existed —
              this one for the level being looked at, one more for a child
              selected from its card — so the same question was asked in two
              places to move a picture to the front of a rotation nobody was
              watching from the top.

              The ministry's own version went earlier, for a related reason: the
              tile never read it at all. See `Program.coverMediaId` in the schema
              for that one, and `summariseChildren`, which is now the only thing
              that decides a card's pictures — the subtree's own, in filing order.
            */}
          </Disclosure>
        </DisclosureGroup>
      ),
    };
  })();

  /**
   * What is inside this level, as a shelf in the corner of the page.
   *
   * Built from the tree rather than from what the page drew, and that matters: a
   * level with no photographs in it has no card worth clicking, so a shelf built
   * from the page would not list the one thing an administrator most needs to
   * reach — the empty part they just created.
   *
   * It was a permanent list at the top of the properties column. The panel is a
   * third of the screen along the bottom now, and a short wide strip has no room
   * for two lists side by side — so the navigation moved out to the page and the
   * properties kept the panel. See `SubgroupShelf`.
   */
  /*
   * The same shelf, for everybody else.
   *
   * Built separately rather than by passing `readOnly` to the one below, because
   * the two differ in more than a flag: this one has no callbacks to give — a
   * visitor cannot rename or reorder anything — and its tiles carry an `href`
   * and a set of pictures to cycle, which the editing shelf has no use for.
   * Sharing one item list would mean every no-op callback existing so that the
   * read-only branch could ignore it.
   *
   * The cards at the foot of the page are removed when this is shown; that is
   * why it opens by default. See the header of `SubgroupShelf`.
   */
  const visitorShelf = (
    <SubgroupShelf
      readOnly
      legend={childLabel}
      addLabel=""
      onAdd={() => undefined}
      empty=""
      items={children.map((child): ShelfItem => {
        const summary = summaries.get(child.id);
        const count = (summary?.photos ?? 0) + (summary?.videos ?? 0);
        const inside = summary?.children ?? 0;
        return {
          id: child.id,
          label: child.title,
          href: hrefOf(child.id),
          coverPath: shelfCover(summary?.cover),
          coverPaths: shelfCovers(summary?.covers),
          note: shelfNote(child, inside, count),
          selected: false,
          onSelect: () => undefined,
          onRename: () => undefined,
          onMove: () => undefined,
          onRemove: () => undefined,
          removeWarning: '',
        };
      })}
    />
  );

  const shelf = (
    <SubgroupShelf
      inline
      legend={childLabel}
      busy={saving}
      addLabel={`Add to ${childLabel.toLowerCase()}…`}
      empty={
        node
          ? 'Nothing inside this yet. Add a part — “Day 1”, “Chapel”, “The hike” — and it gets its own page.'
          : `No ${childLabel.toLowerCase()} yet. Add one — a camp, a week, a year — and its photographs go inside it.`
      }
      items={children.map((child): ShelfItem => {
        const summary = summaries.get(child.id);
        const count = (summary?.photos ?? 0) + (summary?.videos ?? 0);
        const inside = summary?.children ?? 0;
        return {
          id: child.id,
          label: child.title,
          coverPath: shelfCover(summary?.cover),
          note: shelfNote(child, inside, count),
          selected: edit.isSelected({ kind: 'level', id: child.id }),
          onSelect: () => edit.select({ kind: 'level', id: child.id }),
          onRename: (name) =>
            void write(async () => {
              await renameProgramEvent(child.id, name, admin.uid);
              refresh();
            }),
          onMove: (delta) =>
            void write(async () => {
              await moveProgramEvent([...tree.byId.values()], child.id, delta, admin.uid);
              refresh();
            }),
          onRemove: () =>
            void write(async () => {
              await deleteProgramEvent(child.id, program.id, admin.uid);
              refresh();
            }),
          removeWarning:
            inside > 0
              ? `“${child.title}” has ${inside} level${inside === 1 ? '' : 's'} inside it. Remove those first.`
              : `Remove “${child.title}”? Its photographs move to ${program.name} and can be filed again from there.`,
        };
      })}
      onAdd={(name) =>
        void write(async () => {
          await createProgramEvent(program.id, nodeId, {
            title: name,
            description: '',
            startAt: null,
            endAt: null,
            // Open, and unpublished. A level is made in order to collect
            // photographs of it, and it should not be public before it has any.
            submissionsOpen: true,
            published: false,
          });
          refresh();
        })
      }
    />
  );

  /*
   * Whether the visitor's side menu is on screen, which the head has to know:
   * the menu is `position: fixed` in the top-right corner and the head's own
   * action sits in that corner too, so without this the menu is drawn over
   * "Present this" on the first screen.
   */
  const sideMenu = !edit.on && children.length > 0;

  /**
   * Every block on the page, as a node and the width it takes, in page order.
   *
   * Built as a list rather than written straight into the JSX because of what
   * sits between it and the page now: `useBlockPacking`, which measures each one
   * and hands the heights to the packer. A block cannot be measured until it is
   * a real element, and it cannot be placed until every one of them has been, so
   * building them and drawing them are two steps with a measurement between.
   */
  const blocks: {
    width: SectionWidth;
    node: (spot: BlockPlacement | null) => React.ReactNode;
  }[] = [];

  if (!picturesOff && (pictures.length > 0 || edit.on)) {
    blocks.push({
      width: summaryLayout.width,
      node: (spot) => (
        /*
                The page's own block, and the first of however many it carries.

                Its controls are *on it* while editing — grab it, change its shape,
                and (for the ones below) throw it away. See `BlockFrame`: moving a
                block is a gesture, and no arrangement of a settings list makes a
                gesture out of a button labelled "Move up the page".

                This one has no grip, because it is the page's own block — stored in
                `sectionLayout` rather than in `bands`, so there is no order for it to
                have a position in. It does have a bin: Tommy asked to be able to remove
                every section of pictures and leave a page empty, and this was the one
                block that refused. Its Delete writes `hidePagePictures` rather than
                splicing an array, and takes the "Also from here" strip with it.

                Drawn while editing **even when it is empty**, which it was not. Somebody
                who presses × on the last photograph in it would otherwise watch the
                whole block vanish, footer and all — taking with it the one control that
                puts the photographs back.

                `frozen` while editing: a rail drifting under a hand is one that moves
                the very tiles being aimed at.
              */
        <Block
          key="summary"
          place={spot}
          display={summaryLayout.display}
          label="the first block"
          busy={saving}
          onShape={(next) => {
            const layout = layoutForLook(
              next,
              // `fit` is the upright wheel's size alone, so a block leaving `column`
              // rejoins the fixed ladder rather than keeping a height it cannot have.
              next === 'column' || summaryLayout.scale !== 'fit'
                ? summaryLayout.scale
                : 'large',
              summaryLayout.width,
              // Carried, or changing the shape would silently throw away the
              // caption choice. Same reasoning as `scale` and `width`.
              summaryLayout.caption.placement,
              summaryLayout.spin,
              summaryLayout.fit,
            );
            setDrafts((was) => ({ ...was, summary: layout }));
            void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          /* `spinFor`, not the raw field: a wheel holding a direction from the other
             axis must show the one it is actually travelling. */
          spin={spinFor(summaryLayout)}
          onSpin={(spin) => {
            const layout = { ...summaryLayout, spin };
            setDrafts((was) => ({ ...was, summary: layout }));
            void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          fit={summaryLayout.fit}
          onFit={(fit) => {
            const layout = { ...summaryLayout, fit };
            setDrafts((was) => ({ ...was, summary: layout }));
            void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          captions={summaryLayout.caption.placement !== 'hidden'}
          onCaptions={(on) => {
            const layout = layoutForLook(
              summaryLayout.display,
              summaryLayout.scale,
              summaryLayout.width,
              /*
                      `over` for on, whatever the shape. `below` is the schema's third
                      value and has no control: it is a grid look, and offering three
                      states for "show the words or not" is a menu where a switch will
                      do. It stays honoured on read for anything already set to it.
                    */
              on ? 'over' : 'hidden',
              summaryLayout.spin,
              summaryLayout.fit,
            );
            setDrafts((was) => ({ ...was, summary: layout }));
            void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          /*
                  The page's own block can be resized like any other, so a wheel
                  added under it can sit beside it rather than below it. Its width
                  lives in `sectionLayout` where the rest of its arrangement does.

                  Drafted before it is written, for the reason every other control
                  here is: the write is a round trip, and a block that snaps back to
                  its old width for half a second reads as the drag having failed.
                */
          width={summaryLayout.width}
          onWidth={(next) => {
            const layout = { ...summaryLayout, width: next };
            setDrafts((was) => ({ ...was, summary: layout }));
            void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          /*
                  How long it is, when it is a wheel — the handle on its bottom edge.

                  The draft is what draws the drag: `summaryLayout` reads through
                  `drafts` first, so setting one on every step of the gesture is what
                  makes the wheel grow under the pointer. Only the last step writes,
                  or a drag across four sizes would be four round trips.
                */
          scale={summaryLayout.scale}
          onHeight={(next, live) => {
            const layout = { ...summaryLayout, scale: next };
            setDrafts((was) => ({ ...was, summary: layout }));
            if (!live) void write(() => setSectionLayout(target, layout, admin.uid));
          }}
          {...(edit.on
            ? {
                /*
                        Nothing is destroyed by it — `featuredMediaIds`, the hidden list
                        and the arrangement all stay exactly as they are, and the way
                        back is one press in the row below. Same reason the bin on a band
                        needs no confirmation.
                      */
                onRemove: () => setPicturesOffDraft(true),
                removeTitle: 'Take the page\u2019s own pictures off this page',
                pictures: {
                  count: pictures.length,
                  picked: chosen.length > 0,
                  onAdd: () => setPicking(picking === 'summary' ? null : 'summary'),
                  ...(chosen.length > 0 || hidden.length > 0
                    ? { onAutomatic: () => automaticFor('summary') }
                    : {}),
                },
                picker: pickerFor(
                  'summary',
                  'The pictures in the first block',
                  pictures,
                  chosen.length > 0 ? chosen : null,
                ),
              }
            : {})}
        >
          <GallerySection
            id="summary"
            /*
                    No heading. It was a hardcoded "Photographs" over the first block of
                    every gallery in the parish, at Tommy's direction to remove it — and
                    it was the only heading on the site that named the medium rather
                    than the thing: the page is already titled "Day 2" and everything
                    under it is photographs of Day 2, so the word bought a line of
                    display type and no information.

                    `label` is what remains: the block's accessible name, and the wording
                    on the little tab an administrator clicks to select it. A heading
                    nobody needs and a name every screen reader does are different
                    things, which is exactly the split `GallerySection` draws.
                  */
            title=""
            label="Photographs"
            layout={summaryLayout}
            media={pictures}
            onSelect={(at) => openAt('summary', at)}
            onPlace={place}
            frozen={edit.on}
            empty={
              <p className="gallery-empty">
                Nothing in this block. Press <strong>Add pictures</strong> to choose some,
                or <strong>Back to automatic</strong> to show what this level holds.
              </p>
            }
            onDropPicture={(ordered) => dropInto('summary', chosen.length > 0, ordered)}
            onRemovePicture={(mediaId) => removeFrom('summary', mediaId)}
          />
        </Block>
      ),
    });
  }

  {
    /*
          The rest of the blocks, straight after the first.

          They sat *below* the cards once, on the reasoning that a block was the
          archive and the cards were the way to one particular day. That reasoning
          went when the blocks became a set of ways to look at one level's
          photographs: a grid and a wheel are two halves of one thing to look at,
          and putting the navigation between them separates them for no reason.
        */
  }
  bandBlocks.forEach(({ band, layout, picks, media: shown }, index) => {
    blocks.push({
      width: layout.width,
      node: (spot) => (
        <Block
          key={band.id}
          place={spot}
          display={layout.display}
          label={`block ${index + 2}`}
          busy={saving}
          onShape={(next) => {
            const shaped = layoutForLook(
              next,
              next === 'column' || layout.scale !== 'fit' ? layout.scale : 'large',
              layout.width,
              layout.caption.placement,
              layout.spin,
              layout.fit,
            );
            setDrafts((was) => ({ ...was, [band.id]: shaped }));
            void write(async () => {
              await updateBand(target, band.id, { layout: shaped }, admin.uid);
              refresh();
            });
          }}
          spin={spinFor(layout)}
          onSpin={(spin) => {
            const spun = { ...layout, spin };
            setDrafts((was) => ({ ...was, [band.id]: spun }));
            void write(async () => {
              await updateBand(target, band.id, { layout: spun }, admin.uid);
              refresh();
            });
          }}
          fit={layout.fit}
          onFit={(fit) => {
            const fitted = { ...layout, fit };
            setDrafts((was) => ({ ...was, [band.id]: fitted }));
            void write(async () => {
              await updateBand(target, band.id, { layout: fitted }, admin.uid);
              refresh();
            });
          }}
          captions={layout.caption.placement !== 'hidden'}
          onCaptions={(on) => {
            const shaped = layoutForLook(
              layout.display,
              layout.scale,
              layout.width,
              on ? 'over' : 'hidden',
              layout.spin,
              layout.fit,
            );
            setDrafts((was) => ({ ...was, [band.id]: shaped }));
            void write(async () => {
              await updateBand(target, band.id, { layout: shaped }, admin.uid);
              refresh();
            });
          }}
          width={layout.width}
          onWidth={(next) => {
            const sized = { ...layout, width: next };
            setDrafts((was) => ({ ...was, [band.id]: sized }));
            void write(async () => {
              await updateBand(target, band.id, { layout: sized }, admin.uid);
              refresh();
            });
          }}
          /*
                  Its length, when it is a wheel. The draft is what draws the drag —
                  see the same pair on the first block — and only the last step of a
                  gesture is written.
                */
          scale={layout.scale}
          onHeight={(next, live) => {
            const sized = { ...layout, scale: next };
            setDrafts((was) => ({ ...was, [band.id]: sized }));
            if (live) return;
            void write(async () => {
              await updateBand(target, band.id, { layout: sized }, admin.uid);
              refresh();
            });
          }}
          /*
                  Absent when there is nothing to dock against, or when the block
                  before it is already sharing its row — `dockWidths` is what decides
                  that, and the handle draws no hint for a gesture that would do
                  nothing.
                */
          onDock={
            dockWidths(blockWidths, blockIndexOf(index))
              ? () => dockBand(index)
              : undefined
          }
          onMove={(delta) =>
            void write(async () => {
              await moveBand(target, band.id, delta, admin.uid);
              refresh();
            })
          }
          onRemove={() =>
            void write(async () => {
              await removeBand(target, band.id, admin.uid);
              refresh();
            })
          }
          {...(edit.on
            ? {
                pictures: {
                  count: shown.length,
                  picked: picks !== null,
                  onAdd: () => setPicking(picking === band.id ? null : band.id),
                  ...(picks !== null || band.hidden.length > 0
                    ? { onAutomatic: () => automaticFor(band.id) }
                    : {}),
                },
                picker: pickerFor(
                  band.id,
                  `The pictures in ${band.title || `block ${index + 2}`}`,
                  shown,
                  picks,
                ),
              }
            : {})}
        >
          <GallerySection
            id={band.id}
            /*
                    An empty title draws no heading, which is the ordinary case: a
                    second block under a page that already says "Photographs" rarely
                    wants one. `label` is what it is called when it has none — its
                    accessible name.
                  */
            title={band.title}
            label={`${GALLERY_DISPLAY_NAMES[layout.display]} of photographs`}
            layout={layout}
            media={shown}
            onPlace={place}
            frozen={edit.on}
            empty={
              <p className="gallery-empty">
                Nothing in this block. Press <strong>Add pictures</strong> to choose some.
              </p>
            }
            onDropPicture={(ordered) => dropInto(band.id, picks !== null, ordered)}
            onRemovePicture={(mediaId) => removeFrom(band.id, mediaId)}
            /*
                    Into its own stretch of the flat list, which it needs now that it
                    draws its own set — so the arrow keys in the lightbox walk the page
                    rather than jumping into whatever sits at that index in the block
                    above.
                  */
            onSelect={(at) => openAt(band.id, at)}
          />
        </Block>
      ),
    });
  });

  /**
   * Whether the row that adds a block is drawn, which the packer has to know
   * about: it is a child of the same grid and takes the whole width, so it is
   * placed with everything else rather than appended underneath.
   */
  const addRow = edit.on && (picturesOff || bands.length < MAX_BANDS);

  /**
   * Where every one of them goes.
   *
   * Measured, because a block's height is whatever is inside it — see
   * `useBlockPacking`. Null until the first measurement and on a phone, and the
   * blocks fall back to ordinary flow, which is also what a reader with no
   * JavaScript keeps.
   */
  const placements = useBlockPacking(blockGrid, [
    ...blocks.map((one) => SECTION_WIDTH_COLUMNS[one.width]),
    ...(addRow ? [SECTION_COLUMNS] : []),
  ]);

  return (
    <article className={sideMenu ? 'gallery gallery--side-menu' : 'gallery'}>
      {/* `wide`: the photographs are the page here, so it is not held to the
          80rem measure the prose pages use. See `.page-body--wide`. */}
      <PageBody flush wide>
        {/*
          Back link, then the name and its facts, then the one action — with the
          action on the *same row* as the title on a wide screen rather than
          stacked under it.

          Stacked, the header was four left-aligned blocks of wildly different
          weight (a 60px headline, a 15px meta line, a small button) at eight
          pixels apart, which read as a pile rather than a masthead. A title
          block on the left and its action on the right is the arrangement every
          publication uses for this, and it buys back the vertical space that was
          pushing the photographs down the page.
        */}
        <header className="gallery-head">
          <BackLink href={back.href} label={back.label} />

          {/*
            The whole trail, when there is more than one level of it.

            Not decoration: the tree is arbitrarily deep now, and a page titled
            "Day 1" with a single arrow back to "Week 1" tells a visitor who
            arrived from a bulletin link nothing about which camp they are looking
            at. Drawn only from the second level down, because at the first the
            back link already says everything a crumb trail would.
          */}
          {trail.length >= 2 && (
            <nav className="gallery-crumbs" aria-label="Where this is">
              <Link href={`/events/${program.slug}`}>{program.name}</Link>
              {trail.slice(0, -1).map((step) => (
                <Link key={step.id} href={hrefOf(step.id)}>
                  {step.title}
                </Link>
              ))}
            </nav>
          )}

          <div className="gallery-head__row">
            <div className="gallery-head__titles">
              <h1>{title}</h1>

              {/*
                No icons in this line, deliberately, though the cards have them.
                Three gold glyphs in a row of 15px grey type is a dashboard
                readout; the same facts as plain small caps with a middot between
                them is a masthead. The separators are drawn in CSS so a missing
                fact cannot leave an orphaned one behind.

                Every count here is of the *subtree*. "Week 1 2026 — 0
                photographs" was what a per-document count said about a week whose
                four days held fifty each, and it read as an empty camp.
              */}
              <p className="gallery-head__facts">
                {when && <span>{when}</span>}
                {children.length > 0 && (
                  <span>
                    {children.length}{' '}
                    {children.length === 1
                      ? singularOf(childLabel).toLowerCase()
                      : childLabel.toLowerCase()}
                  </span>
                )}
                {/*
                  Not drawn when the page shows nothing and leads nowhere.

                  The counts are of the subtree, which stays true and useful while
                  there are levels inside to reach the photographs through. On a
                  leaf whose own block has been removed there is no such route, so
                  the masthead would advertise "3 photographs" directly above "No
                  photographs have been added here yet" — two true statements that
                  read as one contradiction.
                */}
                {photos > 0 && !showsNothing && (
                  <span>
                    {photos} {photos === 1 ? 'photograph' : 'photographs'}
                  </span>
                )}
                {clips > 0 && !showsNothing && (
                  <span>
                    {clips} {clips === 1 ? 'clip' : 'clips'}
                  </span>
                )}
                {canEdit && !published && (
                  <span className="badge badge--draft">Draft</span>
                )}
              </p>
            </div>

            {/*
              The presentation, offered where somebody would go looking for it —
              at the top, beside the name. It was a small button under the last
              photograph of one gallery, which is the one place nobody setting up
              a screen in the hall would think to scroll to.

              Public rather than admin-only, and that is a choice worth stating:
              the screen in the hall is often driven by whoever is nearest a
              laptop, not by somebody with an account. Nothing it shows is
              anything a visitor cannot already see on these pages.
            */}
            {/*
              Two page-level actions at the top, and the row exists for either.

              `SubmitPhotos` is a button here now rather than a section at the foot of
              the page — Tommy: *"I want the add photos section to be on the top and I
              want it to be a button that opens a panel."* It renders nothing at all
              when the parish has stopped collecting or the ministry has no levels
              yet, so the row can be unconditional without ever being empty of both.
            */}
            <p className="gallery-head__actions">
              {presentable.length > 0 && (
                <a
                  className="button button--ghost"
                  href={presentHref(program.slug, node ? trailSlugs(tree, node.id) : [])}
                >
                  <Icon name="present" size={17} /> Present this
                </a>
              )}
              <SubmitPhotos program={program} tree={level.tree} node={node} />
            </p>
          </div>
        </header>

        {/*
          The menu, directly after the head.
          
          Its **position in the document matters only on a phone.** From 40rem up
          it is `position: fixed` in the top-right corner and could be written
          anywhere; below that there is no width to float 13rem beside a title, so
          it returns to the flow — and the flow has to put it here, under the
          name of the thing it lists, rather than at the foot of the page where it
          used to live. See `.subshelf--reading`.

          A visitor gets the read-only one, and only when there is something in
          it: a label reading "Albums" over nothing is furniture.
        */}
        {/*
          Only the visitor's menu is here now. The editing shelf moved into the
          right-hand column — see `Inspector`'s `aside` — because navigation in one
          corner and properties in another meant looking in two places to do one
          job.
        */}
        {!edit.on && sideMenu && visitorShelf}

        {/*
          The calendar entry, when an administrator has filed this level against
          one.

          Only ever *this* direction. `ProgramEvent.calendarEventId` is
          one-directional by design — "the calendar knows nothing about the
          gallery" — so a visitor reaches the date from the pictures and not the
          other way round. The events admin is what writes the pointer.
        */}
        {calendar && (
          <p className="gallery-calendar">
            <Icon name="calendar" size={16} />{' '}
            <Link href={`/events/${calendar.slug}`}>{calendar.title}</Link>{' '}
            <span className="meta">
              {formatEventWhen(
                calendar.startAt,
                calendar.endAt,
                calendar.allDay,
                calendar.timeZone,
              )}
            </span>
          </p>
        )}

        {description && <Prose>{description}</Prose>}

        {/* ---- the photographs that summarise this level -------------------- */}

        {/*
          Every block on the page, in one twelve-column grid.

          The wrapper is what makes a width mean anything. Blocks were children of
          `.page-body` and each took the whole measure, so "half" had no room to be
          half *of* — two of them would have stacked exactly as two full ones did.
          Here they flow into twelve columns in their own order and a pair that
          fits shares a row: a grid beside an upright wheel, which is the whole
          reason `SectionLayout.width` exists.

          Nothing pairs them and there is no row object. Auto-placement never runs
          backwards, so the order blocks are written in — and dragged into — is the
          order they appear in, and a block that does not fit starts a new row.

          The Add row is inside rather than after, so it lands in the flow beneath
          the blocks it adds to rather than after a grid it is not part of. It
          spans all twelve; see `.blocks > .addblock`.
        */}
        <div className={`blocks${placements ? ' blocks--packed' : ''}`} ref={blockGrid}>
          {/*
            Every block, in the page's own order, each one where the packer put it.
            A block with no placement — before the first measurement, or on a phone
            — draws itself in ordinary flow instead. See `BlockFrame`.
          */}
          {blocks.map((one, at) => one.node(placements?.[at] ?? null))}

          {/*
            Add another block, right under the ones already there.

            On the page rather than in the panel, for the same reason the grip and the
            bin are: what it makes appears right here, and a button that makes a thing
            belongs next to where the thing lands. It was a row in the properties
            panel whose entire body was these buttons — a click spent to reveal a
            click.
          */}
          {addRow && (
            /*
              The last child of the same grid, so the packer places it like
              everything else — under whatever is tallest, across the full width.
              Left to flow it would have sat in the first hole it fitted, which for
              a full-width row is the same place; given a placement it is also
              given a row *span*, without which a grid of half-rem rows would hand
              it exactly one of them.
            */
            <div
              className="addblock"
              style={
                placements?.[blocks.length]
                  ? {
                      gridColumn: '1 / -1',
                      gridRow: `${placements[blocks.length]?.row} / span ${placements[blocks.length]?.rows}`,
                    }
                  : undefined
              }
            >
              {/*
                It said "Show the same photographs again, as", which was true when every
                block drew the page's one set and is not now: a new block starts on the
                page's photographs and stops the moment somebody presses Add on it.
              */}
              <p className="addblock__legend">
                {picturesOff && bands.length === 0
                  ? 'Add a block of pictures'
                  : 'Add another block'}
              </p>

              {/*
                The way back from having removed the page's own block.

                Here rather than in the properties panel, and first in the row: this is
                the one entry that puts something back rather than making something new,
                and somebody looking for it has just pressed a bin a few pixels above.
                A switch in a panel would be a control you have to go looking for after
                an action you took on the page.

                It is drawn whatever the band count, unlike the three below — the row
                itself now renders when the page's block is off even at `MAX_BANDS`,
                because otherwise a page with four bands and no first block would have
                removed it permanently.
              */}
              {picturesOff && (
                <p className="addblock__choices">
                  <button
                    type="button"
                    className="addblock__button addblock__button--restore"
                    disabled={saving}
                    onClick={() => setPicturesOffDraft(false)}
                  >
                    <Icon name="photos" size={15} />
                    The page&apos;s own pictures
                  </button>
                </p>
              )}

              {bands.length < MAX_BANDS && (
                <p className="addblock__choices">
                  {(
                    [
                      ['grid', 'A grid'],
                      ['rail', 'A sideways wheel'],
                      ['column', 'An upright wheel'],
                    ] as const
                  ).map(([display, label]) => (
                    <button
                      key={display}
                      type="button"
                      className="addblock__button"
                      disabled={saving}
                      onClick={() =>
                        void write(async () => {
                          await addBand(target, display, admin.uid);
                          refresh();
                        })
                      }
                    >
                      <span
                        className={`block__glyph block__glyph--${display}`}
                        aria-hidden="true"
                      >
                        <span />
                        <span />
                        <span />
                      </span>
                      {label}
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- what is inside ---------------------------------------------- */}

        {/*
          Hidden from a visitor when there is nothing inside, shown to an
          administrator always — the same rule an empty subgroup followed before
          every level became a page.

          Hidden, because a heading with nothing under it is not content, and the
          deepest level of any branch is a leaf: on the old fixed three levels
          only the last one could be childless, and now every trail ends in one.
          An empty "Inside The hike" under every leaf in the parish is a lot of
          nothing.

          Shown while editing, because otherwise adding the first level inside
          something appears to do nothing at all.
        */}
        {/*
          Editing only, now that a visitor has the shelf.

          Tommy: *"the subgroups for the regular user is still on the bottom."*
          They were the visitor's route in and are now the administrator's — the
          cards are what a level is *selected* from, and there is nowhere else to
          click to put one in the properties panel.
        */}
        {edit.on && (
          <section className="gallery-section" aria-labelledby="level-inside">
            <h2 id="level-inside" className="gallery-title gallery-title--small">
              {insideTitle}
            </h2>

            {children.length === 0 && <p className="gallery-empty">{insideEmpty}</p>}

            {children.length > 0 && (
              <ul className="gathering-grid">
                {children.map((child) => (
                  <li key={child.id}>
                    {/*
                    Selecting a card puts its properties in the column. The Edit
                    and Cover buttons that used to sit under every one are gone —
                    two controls per card, on a page that may have twelve.

                    A badge still shows for a draft or an open submission window,
                    because those are *states of the thing* rather than actions on
                    it: an administrator needs to see at a glance which levels are
                    not yet public, without clicking each one.
                  */}
                    <div
                      className={`gathering-slot${
                        edit.on && edit.isSelected({ kind: 'level', id: child.id })
                          ? ' is-selected'
                          : ''
                      }`}
                      onClickCapture={(click) => {
                        if (!edit.on) return;
                        /*
                        The card is a link; in edit mode a click selects the level
                        instead, or navigating away would be the cost of choosing
                        something to edit.

                        Except when the click landed in one of the card's own
                        fields: `preventDefault` on that stops the caret being
                        placed, so clicking into the middle of a word put the
                        cursor at the end of it. It still selects — a field belongs
                        to its level — but the click goes through.
                      */
                        const onAField =
                          click.target instanceof HTMLElement &&
                          click.target.closest('input, textarea');

                        if (!onAField) {
                          click.preventDefault();
                          click.stopPropagation();
                        }
                        edit.select({ kind: 'level', id: child.id });
                      }}
                    >
                      <LevelCard
                        href={hrefOf(child.id)}
                        node={{
                          ...child,
                          // The local overlay wins, so a keystroke shows without
                          // waiting for the refetch. See `editLevel`.
                          ...(levelEdits[child.id] ?? {}),
                        }}
                        summary={summaries.get(child.id)}
                        editing={edit.on}
                        onTitle={(title) => editLevel(child.id, { title })}
                        onDescription={(description) =>
                          editLevel(child.id, { description })
                        }
                      />
                      {canEdit &&
                        (!child.published ||
                          child.id === program.prioritySubmissionNodeId) && (
                          <p className="gathering-card__admin">
                            {!child.published && (
                              <span className="badge badge--draft">Draft</span>
                            )}
                            {/*
                            Was "Collecting", read off the level's own
                            `submissionsOpen`. That flag governs nothing now — one
                            flag on the ministry decides whether the parish is
                            collecting — so the badge was describing a field
                            nobody reads, which is worse than no badge.

                            What is worth a badge in its place is where uploads
                            are going. It is set from the queue on the ministry
                            page and there is otherwise nothing on the level it
                            points at to show that it was chosen.
                          */}
                            {child.id === program.prioritySubmissionNodeId && (
                              <span className="badge">Photographs go here</span>
                            )}
                          </p>
                        )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* ---- anything filed here that the summary did not show ----------- */}

        {alsoHere.length > 0 && (
          <GallerySection
            id="also"
            /*
              Not "Unfiled" or "Other": this is a public page, and a heading that
              names an administrator's filing state tells a parishioner looking
              for a photograph of their child nothing at all.
            */
            title="Also from here"
            layout={alsoLayout}
            media={alsoHere}
            onPlace={place}
            frozen={edit.on}
            /*
              A × here too, because "every picture" means every picture — and this
              block holds the ones a visitor is most likely to be looking at, since
              a submission sits here until somebody files it deeper.

              No Add button and no footer: this block *is* what the blocks above
              left over, so there is nothing to add to it. Its × writes the same
              list the first block's does, and the first block's "Back to automatic"
              is what puts these back.
            */
            onDropPicture={(ordered) => dropInto('also', false, ordered)}
            onRemovePicture={(mediaId) => removeFrom('also', mediaId)}
            onSelect={(at) => openAt('also', at)}
          />
        )}

        {showsNothing && (
          <p className="gallery-empty">No photographs have been added here yet.</p>
        )}

        {/*
          `SubmitPhotos` used to be a whole section here, below the gallery, on the
          argument that somebody arriving from a link came to look at the photographs
          and the invitation made sense after them. It is a button in the head now —
          see the note there. The argument was right about a *section* and is what
          made a section the wrong shape: at the top it pushed the pictures down, at
          the bottom nobody sending photographs could find it.

          It still renders on every level and on the ministry page, still nothing when
          the parish has stopped collecting (`Program.submissionsOpen`, one flag for
          the whole tree) and nothing in a ministry with no levels yet.
        */}

        {/*
          The approval queue, on the ministry page only, and only for somebody
          who administers it.

          Last on the page and outside edit mode both, deliberately. It is not a
          property of what the page shows — it is the parish's inbox — so it does
          not belong in the properties column, and hiding it behind the edit
          toggle would mean photographs waiting unseen for however long it takes
          somebody to press a button they had no reason to press.

          `refresh` rather than a local insert: an approved photograph's file does
          not exist at the moment of approval, because the Function has not copied
          it yet. Re-reading is what eventually draws it.
        */}
        {node === null && (
          <SubmissionQueue program={program} tree={level.tree} onDecided={refresh} />
        )}
      </PageBody>

      {open !== null && (
        <Lightbox
          media={flat}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}

      <EditToggle />

      {/*
        One panel, whatever is selected. The `title`/`kind` pair is what stops the
        panel changing shape from reading as inconsistency — it says which of four
        different things it is describing.
      */}

      {edit.on && (
        <Inspector
          title={inspecting.title}
          kind={inspecting.kind}
          saving={saving}
          /*
            The list of what is inside, in the column under the properties. It is
            what makes an always-present column worth its space when nothing in
            particular is selected: page settings above, somewhere to go below.
          */
          aside={shelf}
        >
          {inspecting.body}
        </Inspector>
      )}

      {/*
        The all-pictures manager. A portal, so it is mounted here rather than inside
        the panel row that opens it — a fixed overlay inside the editing column would
        be clipped by the column's own scroll area.

        `node === null` is belt as well as braces: the button that sets this is only
        rendered on the ministry's own page, and the guard means a stale `true` after
        navigating into a level cannot put a manager on a page whose tree is a subtree.
      */}
      {edit.on && managing && node === null && (
        <PictureManager
          programId={program.id}
          programName={program.name}
          tree={tree}
          media={media}
          onChanged={refresh}
          onClose={() => setManaging(false)}
        />
      )}
    </article>
  );
}

/**
 * The controls for one scroll wheel.
 *
 * ## Why this is a top-level component and not a closure
 *
 * It was `const BandRows = ({ band }) => …` **inside** `LevelView`, which is a new
 * function identity on every render — so React saw a different component *type*
 * each time and unmounted and remounted the whole subtree.
 *
 * That is what "the scroll wheel edits seem like they're not doing anything" was.
 * Every write flips `saving`, `saving` re-renders `LevelView`, and the re-render
 * threw away the control being used and built a fresh one from props that had not
 * caught up yet — so a heading typed and blurred flashed back to the old text, and
 * a changed dropdown snapped back to its old option, before the refetch landed.
 * The write was going through the whole time. It just looked like it had not.
 *
 * Declared out here, the identity is stable, React updates in place, and a control
 * keeps its own state across a save.
 *
 * ## The heading is held locally
 *
 * Committed on blur and on Enter, like every other text field in this panel — and
 * re-seeded from the prop when the band changes, which is what stops one wheel's
 * heading appearing over another's after a switch. `defaultValue` was doing that
 * job and could not: it is read once at mount, so it was only ever correct because
 * the component was remounting, which was the bug.
 */
function BandEditor({
  band,
  onTitle,
}: {
  band: GalleryBand;
  onTitle: (title: string) => void;
}) {
  const [title, setTitle] = useState(band.title);
  useEffect(() => setTitle(band.title), [band.id, band.title]);

  return (
    <div className="inspector__body">
      <label className="inspector__field">
        <span>Heading</span>
        <input
          type="text"
          value={title}
          placeholder="Leave empty for no heading"
          onChange={(change) => setTitle(change.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next !== band.title) onTitle(next);
          }}
          onKeyDown={(key) => {
            if (key.key === 'Enter') (key.target as HTMLInputElement).blur();
            if (key.key === 'Escape') setTitle(band.title);
          }}
        />
        <span className="inspector__note">
          Its shape, its position, whether it stays and which photographs are in it are
          all on the block itself — the controls in its corner and the row under it. This
          is the only thing about it that is words.
        </span>
      </label>
    </div>
  );
}

/**
 * One level inside another, as a card with a picture on it.
 *
 * The whole card is the link, via `.card--link`'s stretched anchor — the title
 * alone was the hit target before, which on a phone is a few words in a 300px
 * box.
 *
 * A level with no photographs keeps the card's shape rather than collapsing to a
 * text box: a row where some cards have pictures and others are half the height
 * reads as a rendering fault. The empty state is the paper ground with the
 * parish's ornament, which is the same thing an empty ministry tile shows.
 *
 * Its counts are of everything beneath it, and it says how many levels that is.
 * "4 parts · 214 photographs" is the fact somebody wants before they click.
 */
/**
 * One card for a level inside this one — an album, a year, a week, a day.
 *
 * ## Two shapes, the same argument as `ProgramTile`
 *
 * Read, it is a `Link` into the level. **Edited, it is a `div`**, because an
 * `<input>` inside an `<a>` is invalid HTML and behaves like it: the anchor eats
 * the first click, so the caret lands somewhere unpredictable and dragging to
 * select a word starts a link drag.
 *
 * Tommy asked for the ministry tiles' arrangement to reach down here: *"I prefer
 * the options for editing each ministry how it is done here I want the same to be
 * applied to the lower levels I should be able to change the name of the albumns."*
 * So the name and the description are the card's own fields, and everything else
 * about a level — its dates, whether it is public, what its parts are called,
 * removing it — stays in the panel, which is where a switch belongs.
 *
 * Renaming is safe to do in place: a level's `slug` is set when it is created and
 * `renameProgramEvent` never touches it, so the title is what it is *called* and
 * never where it lives. `LevelDetails` says so in the panel.
 */
function LevelCard({
  href,
  node,
  summary,
  editing = false,
  onTitle,
  onDescription,
}: {
  href: string;
  node: DocOf<ProgramEvent>;
  summary: NodeSummary<DocOf<GalleryMedia>> | undefined;
  /** Draw the words as fields. False for every visitor. */
  editing?: boolean;
  onTitle?: ((title: string) => void) | undefined;
  onDescription?: ((description: string) => void) | undefined;
}) {
  const cover = summary?.cover ?? null;
  /*
   * A clip cover plays; a photograph cover is a photograph.
   *
   * `posterPath` is still what the plate falls back to while the clip loads, and
   * what it shows if the clip will not play at all — it is a frame of the same
   * material, so the card keeps its shape either way.
   */
  const clip = cover?.kind === 'video' ? cover.renditionPath : null;
  const path =
    cover?.kind === 'video' ? cover.posterPath : (cover?.renditionPath ?? null);
  const when = formatDateSpan(node.startAt, node.endAt, node.timeZone);
  const photos = summary?.photos ?? 0;
  const clips = summary?.videos ?? 0;
  const inside = summary?.children ?? 0;

  const cardInner = (
    <>
      <span
        className={`gathering-card__cover${path || clip ? '' : ' gathering-card__cover--empty'}`}
        aria-hidden="true"
      >
        {clip ? (
          <AutoClip
            src={galleryPathUrl(clip)}
            poster={path ? galleryPathUrl(path) : null}
          />
        ) : (
          path && (
            <img src={galleryPathUrl(path)} alt="" loading="lazy" decoding="async" />
          )
        )}
      </span>

      <span className="gathering-card__body">
        {when && <span className="gathering-card__when">{when}</span>}

        {editing && onTitle ? (
          <span className="gathering-card__name">
            <Plain
              name={`level-name-${node.id}`}
              label={`The name of ${node.title || 'this level'}`}
              value={node.title}
              placeholder="Name this one"
              onChange={onTitle}
            />
          </span>
        ) : (
          <span className="gathering-card__name">{node.title}</span>
        )}

        {editing && onDescription ? (
          /*
            The whole description, not `captionOf`'s 110 characters — a field
            showing a truncation would edit the truncation, and the first keystroke
            would discard everything past the cut. The card grows for it; these
            cards are in a grid, not a drifting rail, so an uneven row is only
            uneven.
          */
          <span className="gathering-card__blurb gathering-card__blurb--editing">
            <Grow
              name={`level-blurb-${node.id}`}
              className="ee-plain"
              value={node.description}
              minRows={2}
              aria-label={`What ${node.title || 'this level'} was`}
              placeholder="What this was. Shown above its photographs."
              onChange={onDescription}
            />
          </span>
        ) : (
          node.description && (
            <span className="gathering-card__blurb">
              {captionOf(node.description, 110)}
            </span>
          )
        )}
        <span className="gathering-card__counts">
          {inside > 0 && (
            <span>
              <Icon name="expand" size={14} /> {inside} {inside === 1 ? 'part' : 'parts'}
            </span>
          )}
          {photos > 0 && (
            <span>
              <Icon name="photos" size={14} /> {photos}
            </span>
          )}
          {clips > 0 && (
            <span>
              <Icon name="film" size={14} /> {clips}
            </span>
          )}
          {photos === 0 && clips === 0 && inside === 0 && <span>No photographs yet</span>}
        </span>
      </span>
    </>
  );

  if (editing) {
    return <div className="gathering-card gathering-card--editing">{cardInner}</div>;
  }

  return (
    <Link className="gathering-card" href={href}>
      {cardInner}
    </Link>
  );
}
