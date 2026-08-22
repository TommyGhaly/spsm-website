import type { AuditFields, Publishable, Timestamped } from './common.js';
import type { GalleryBand, SectionLayout } from './sectionLayout.js';

/**
 * The parish's standing programs, and the photographs the parish takes of them.
 *
 * **A tree of arbitrary depth, not three fixed levels.** A program is the root;
 * beneath it every node is a `ProgramEvent` that may have children, and the
 * parish decides how deep that goes. Summercamp → Week 1 2026 → Day 1 → The
 * hike is four levels, and nothing in the model stops a fifth.
 *
 * That replaced program → event → inline `groups`, where the third level had no
 * page of its own and there was no fourth. The reason it had to change is what
 * every level is *for*: a level summarises everything beneath it. Summercamp
 * shows pictures drawn from every year of camp; Week 1 2026 shows pictures drawn
 * from each of its days; Day 1 shows Day 1. Which pictures is an editorial
 * choice at each level — `featuredMediaIds` — and the automatic fallback spreads
 * the summary across the children rather than taking the first twenty of one
 * day. See `summariseNode` in gallery/tree.ts.
 *
 * Deliberately not the same collection as `events`. That one answers *what is
 * coming up* and a Wednesday Liturgy belongs to it; this answers *what we did*
 * and is mostly pictures. They share an entrance (`/events`) and nothing else.
 */

/**
 * One standing program — Summercamp, St. Simon for Seniors, and so on.
 *
 * The root of a tree. Data rather than a constant, so a superadmin can add the
 * sixth program in 2029 without a developer. The five the parish runs today are
 * seeded, not hardcoded.
 */
export interface Program extends AuditFields, Publishable {
  slug: string;
  name: string;
  /**
   * Markdown. What the program is, when it meets, how somebody joins.
   *
   * Seeded from `content/ministries/*.md`, which is retired once this lands —
   * those three files are unpublished drafts and this is where their text goes.
   */
  description: string;
  /** `galleryMedia` id shown on the program's card. Null ⇒ newest approved. */
  coverMediaId: string | null;

  /**
   * The photographs shown on the program's own page, in this order — the
   * program's summary of everything beneath it.
   *
   * A ministry page used to be prose and a list of links, which is the one page
   * in this section with no pictures on it — an odd thing for the entrance to a
   * gallery. These are the pictures it shows.
   *
   * **Ids, chosen by hand, and drawn from anywhere under the program.** Not a
   * flag on the media documents, and that is the requirement rather than an
   * implementation preference: an administrator picks from every photograph in
   * every gathering and every subgroup of the ministry, and the *order* they
   * pick them in is the order the page shows them. A boolean per document
   * cannot express an order, and a fourth `placement` flag would have made
   * "which ministry page" ambiguous for a photograph that could only ever
   * belong to one.
   *
   * Empty is the ordinary state and means *summarised automatically* — a
   * ministry nobody has curated still shows its recent photographs rather than
   * nothing, drawn evenly from its gatherings rather than all from the newest.
   * See `summariseNode` in gallery/tree.ts.
   *
   * Ids rather than paths, because a rendition path changes when a file is
   * re-transcoded and an id never does. Ids that no longer resolve are dropped
   * on read rather than cleaned up on write: a photograph can be rejected or
   * deleted long after it was featured, and a ministry page must not go blank
   * because one of six pictures went away.
   */
  featuredMediaIds: string[];

  /**
   * How the ministry page presents those pictures — grid, sideways rail, or
   * drifting column, at what size, with the title and captions set how.
   *
   * Absent on every document written before this existed, which is why nothing
   * reads it directly: `resolveSectionLayout` fills it in. See
   * schema/sectionLayout.ts.
   */
  sectionLayout?: SectionLayout;

  /**
   * The other blocks on this page, in the order they appear.
   *
   * **Each one carries its own pictures.** A block is a set of photographs and a
   * way of showing it: the block above (this document's `featuredMediaIds` and
   * `hiddenMediaIds`) plus these, each with the same pair on itself. A band that
   * has never been picked for follows the page. See `GalleryBand`.
   *
   * Read through `resolveBands`, never directly.
   */
  bands?: GalleryBand[];

  /**
   * Whether this page shows *every* photograph beneath it rather than a selection.
   *
   * Three states between this and a block's picked list, and they are exclusive:
   * the picked list wins, then this, then the automatic summary. See
   * `pagePictures`.
   *
   * It stayed on the page when the picks moved onto the blocks, because of what it
   * is for: "this camp's page should show all four hundred photographs, not a
   * summary of them" is a statement about the page, and per-block it was the thing
   * that let one wheel disagree with the grid above it. It applies to every block
   * nobody has picked for, and to no block anybody has. It wants a scroll wheel to
   * be usable: four hundred pictures in a grid is a page nobody reaches the bottom
   * of.
   */
  showAllPictures?: boolean;
  /**
   * Photographs taken off *this page* by hand, without deleting them.
   *
   * The × on a picture while editing. It is a **hide, not a delete**, and it is a
   * separate list rather than a rewrite of `featuredMediaIds` for one concrete
   * reason: a page in "all of them" can be showing two hundred photographs, and
   * `featuredMediaIds` is capped. Expressing "these two hundred minus one" as a
   * curated list would silently throw away a hundred and seventy-five of them.
   *
   * As its own list it composes with all three modes and changes none of them:
   * removing a picture from an automatic block leaves it automatic, which is also
   * far less surprising than a block that quietly stops being automatic because
   * somebody tidied one photograph off it.
   *
   * This pair belongs to the page's **own** blocks — its first one, and the "Also
   * from here" strip. Those two draw disjoint sets by construction, so one list
   * serves both. Every other block keeps its own; see `GalleryBand.hidden`.
   *
   * The photograph itself is untouched — still approved, still in the parish's
   * storage, still on the page of the level it is filed under. `pagePictures`
   * applies this last.
   */
  hiddenMediaIds?: string[];

  /** Manual order in the programs strip. Lower sorts first. */
  order: number;
}

/**
 * One node of a program's tree — "Summercamp Week 1 2027", or "Day 1" inside it.
 *
 * This is the thing that gets a page, a gallery, and a submission queue, and it
 * gets those at *every* depth. "Week 1 2026" and "Day 1" are the same kind of
 * document; the only difference between them is that one names the other as its
 * parent.
 *
 * The word "gathering" survives in the interface and in what the parish reads on
 * screen, because that is what a volunteer calls the level they are looking at.
 * Nothing in the model privileges the first level over the third.
 */
export interface ProgramEvent extends AuditFields, Publishable {
  programId: string;

  /**
   * The node above this one, or `null` for a direct child of the program.
   *
   * **The only thing that records the shape of the tree.** There is deliberately
   * no stored `path` or `depth` beside it, though both would make some reads
   * shorter: they are derived facts, and a derived fact stored on every
   * descendant has to be rewritten for all of them when a node moves. That is an
   * unbounded client-side cascade that can stop halfway, and the half that
   * survives is a tree that disagrees with itself about where a camp lives.
   * `parentId` alone cannot be half-right.
   *
   * The cost is that resolving `/events/summercamp/2026-week-1/day-1` needs the
   * program's nodes in memory rather than one lookup per segment. Which is not
   * really a cost: every page here already reads the whole tree, because a page
   * that summarises what is beneath it has to know what is beneath it.
   *
   * Absent on every document written before the tree existed, which reads as
   * `undefined` rather than `null` — `parentOf` in gallery/tree.ts normalises
   * both to "a child of the program".
   */
  parentId?: string | null;

  /** Unique among its *siblings*. One segment of the URL, not the whole path. */
  slug: string;
  title: string;
  /** Markdown, shown above the gallery. */
  description: string;

  startAt: Timestamped | null;
  endAt: Timestamped | null;
  timeZone: string;

  /**
   * Manual position among its siblings. Lower sorts first; 0 means "unset".
   *
   * Needed because the levels sort differently and both ways are right. Weeks
   * and years want their dates, newest first, and get that for free from
   * `startAt`. Days want the order somebody typed them in — "Day 1" before "Day
   * 10" is not a date, not alphabetical, and not something a machine can infer —
   * so a number an administrator moves with the arrows in the side menu is the
   * only thing that can express it.
   *
   * `compareNodes` therefore reads this first and falls back to the date, which
   * means a level nobody has reordered behaves exactly as it did before this
   * field existed: every sibling has 0, every comparison ties, and the date
   * decides.
   */
  order?: number;

  /**
   * The photographs this node's page shows, in this order — its summary of
   * everything beneath it.
   *
   * The same field as `Program.featuredMediaIds` and for the same reason, one
   * level down and repeatable all the way down. An administrator standing on
   * "Week 1 2026" picks from every photograph in every day of that week; on
   * "Day 1" they pick from Day 1.
   *
   * Ids rather than a flag per photograph, because the order *is* the content
   * and a set of booleans cannot hold an order.
   *
   * Empty means summarised automatically, which is the ordinary state. For a
   * node with children that is a spread across the children — see
   * `summariseNode`. For a leaf it is simply the photographs filed there, which
   * is the whole gallery and is why the deepest level needs no curation at all
   * to be worth opening.
   */
  featuredMediaIds?: string[];

  /**
   * Legacy: the inline subgroups this node used to carry, before every level
   * became a node of its own.
   *
   * Kept on the interface, read nowhere in the site. `scripts/migrate-gallery-tree.mjs`
   * turns each one into a child `ProgramEvent` and re-files its photographs onto
   * it. Documents that have not been migrated still parse; their groups simply do
   * not render, and their photographs appear on this node rather than under a
   * heading.
   *
   * @deprecated Use child nodes.
   */
  groups?: ProgramEventGroup[];

  coverMediaId: string | null;

  /**
   * How this node's own photograph block is presented. Independent of its
   * parent's and of each child's — see schema/sectionLayout.ts.
   */
  sectionLayout?: SectionLayout;

  /**
   * The other blocks on this page, in the order they appear.
   *
   * The same field as `Program.bands`, one level down and repeatable all the way
   * down. Each block carries its own pictures; one that has never been picked for
   * follows the page.
   *
   * Read through `resolveBands`, never directly.
   */
  bands?: GalleryBand[];

  /** See `Program.showAllPictures`. The same three-way choice at every depth. */
  showAllPictures?: boolean;
  /**
   * Photographs taken off *this page* by hand, without deleting them.
   *
   * The × on a picture while editing. It is a **hide, not a delete**, and it is a
   * separate list rather than a rewrite of `featuredMediaIds` for one concrete
   * reason: a page in "all of them" can be showing two hundred photographs, and
   * `featuredMediaIds` is capped. Expressing "these two hundred minus one" as a
   * curated list would silently throw away a hundred and seventy-five of them.
   *
   * As its own list it composes with all three modes and changes none of them:
   * removing a picture from an automatic block leaves it automatic, which is also
   * far less surprising than a block that quietly stops being automatic because
   * somebody tidied one photograph off it.
   *
   * This pair belongs to the page's **own** blocks — its first one, and the "Also
   * from here" strip. Those two draw disjoint sets by construction, so one list
   * serves both. Every other block keeps its own; see `GalleryBand.hidden`.
   *
   * The photograph itself is untouched — still approved, still in the parish's
   * storage, still on the page of the level it is filed under. `pagePictures`
   * applies this last.
   */
  hiddenMediaIds?: string[];

  /**
   * A calendar `events` document, when this occurrence is also something people
   * can turn up to. Optional and one-directional — the calendar knows nothing
   * about the gallery.
   */
  calendarEventId: string | null;

  /**
   * Whether the public upload form accepts anything right now.
   *
   * Closing it is how a program stops collecting for an event that finished
   * three years ago, without unpublishing the gallery.
   */
  submissionsOpen: boolean;
}

/**
 * Legacy: an inline subgroup of a node.
 *
 * The third level, back when there were exactly three and the third had no page.
 * Migrated to child `ProgramEvent` documents — see the note on
 * `ProgramEvent.groups`. The type stays so old documents type-check and so the
 * migration script has something to read.
 *
 * @deprecated Use child nodes.
 */
export interface ProgramEventGroup {
  /** Stable id. Media pointed at this, so renaming one must not re-file it. */
  id: string;
  name: string;
  order: number;

  /**
   * This subsection's own arrangement.
   *
   * The reason a layout lives at *every* level rather than only at the top:
   * "Day 1" and "Talent Show" are not the same kind of set. One is forty
   * snapshots that want a sideways rail, the other is six posed photographs that
   * want a composition. Forcing them to share one arrangement makes one of them
   * wrong, which is the same argument `placement.onPage` and
   * `placement.slideshow` are two flags for. The migration carries this onto the
   * child node's own `sectionLayout`.
   */
  layout?: SectionLayout;
}

/**
 * One photograph or clip.
 *
 * Top-level rather than a subcollection of the event, because the two queries
 * that matter most cut across events: the pending-approval queue (everything
 * awaiting review, whichever program) and the homepage band (showcase media
 * from every program at once). Both are one query here and a fan-out otherwise.
 */
export interface GalleryMedia extends AuditFields {
  /** Denormalised from the event so the queues above can filter without a join. */
  programId: string;
  programEventId: string;
  /**
   * Legacy: which inline subgroup of `programEventId` this was filed under.
   *
   * Superseded by the tree — filing a photograph now means pointing
   * `programEventId` at the node it belongs to, at whatever depth that is, and
   * `setMediaNode` is what writes it. Read nowhere in the site.
   *
   * Not dropped from documents by the migration, deliberately: it is the only
   * record of where a photograph sat before, and it costs nothing to keep. New
   * submissions write `null`.
   *
   * @deprecated File against a node instead.
   */
  groupId: string | null;

  kind: MediaKind;
  status: MediaStatus;

  /**
   * Where the file landed when it was uploaded. Under `submissions/`, which is
   * write-only to the public — see docs/program-galleries.md §4.
   */
  sourcePath: string;
  /**
   * The web-ready rendition, written by the transcode Function on approval.
   * Null until then, which is also how "approved but still processing" is told
   * apart from "ready to show".
   *
   * Not optional-by-omission: an iPhone upload is HEIC and no browser can
   * display it, so rendering `sourcePath` directly is never correct.
   */
  renditionPath: string | null;
  /**
   * The same web-ready bytes, sitting in quarantine, for the approval queue.
   *
   * This field exists because of a gap the original design left open: an
   * administrator has to *look* at a photograph before approving it, and
   * `sourcePath` is unviewable for both of the reasons that matter. It is under
   * `submissions/`, which no unauthenticated URL can reach — and it is very
   * often HEIC, which no browser can decode even with permission.
   *
   * So the transcode runs on submission rather than on approval, and writes its
   * output here first. Approval is then a *copy* from this path to
   * `galleries/`, which is both instant and impossible to get wrong: the bytes
   * an administrator approved are byte-for-byte the bytes that get published.
   *
   * Still private — this is a `submissions/` path, staff-readable only. The
   * queue fetches it with `getDownloadURL`, which is authenticated, rather than
   * the unauthenticated `?alt=media` form the public gallery uses.
   *
   * Null for a video (nothing here transcodes one) and null while the Function
   * is still working.
   */
  previewPath: string | null;
  /** Video only. The frame shown before playback and in the grid. */
  posterPath: string | null;

  width: number | null;
  height: number | null;
  /** Video only, seconds. The presentation holds a clip for this long. */
  durationSeconds: number | null;

  /** One line, written by an administrator. Doubles as the alt text. */
  caption: string;

  /**
   * What must survive a crop, as a fraction of width and height. Square
   * thumbnails of a group photograph cut off faces without it.
   */
  focal: FocalPoint;

  placement: MediaPlacement;

  /**
   * Manual position on the 12-column canvas, or null for auto.
   *
   * Four integers rather than CSS or pixels, so a phone and the mobile app can
   * render the same layout the administrator built on a desktop. This is the
   * whole reason the editor snaps — see docs/program-galleries.md §3.
   */
  layout: GridPlacement | null;

  /** Manual ordering within its group, for auto layout and the slideshow. */
  order: number;

  submittedAt: Timestamped;
  reviewedAt: Timestamped | null;
  /** uid of the approving administrator. Null while pending. */
  reviewedBy: string | null;
}

export const MEDIA_KINDS = ['photo', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * `pending` is the only status a public submission may be created with, and
 * `rejected` is kept rather than deleted so the same file resubmitted twice is
 * recognisable.
 */
export const MEDIA_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * The three places an approved item can appear, independently.
 *
 * Three booleans rather than one enum because they genuinely combine: the
 * photograph that opens the page is usually also in the slideshow and often the
 * one on the homepage. Keeping them separate is what lets a page tell its story
 * in twenty pictures while the hall screen runs two hundred.
 */
export interface MediaPlacement {
  /** In the gallery on the event's own page. */
  onPage: boolean;
  /** In the fullscreen presentation. */
  slideshow: boolean;
  /** Eligible for the homepage preview band. */
  homepage: boolean;
}

export interface FocalPoint {
  /** 0 = left edge, 1 = right edge. */
  x: number;
  /** 0 = top edge, 1 = bottom edge. */
  y: number;
}

/** Centre, when nobody has said otherwise. */
export const DEFAULT_FOCAL: FocalPoint = { x: 0.5, y: 0.5 };

/**
 * A cell on the layout canvas. 1-indexed, like CSS grid lines, so these numbers
 * can be handed to `grid-column` without arithmetic.
 */
export interface GridPlacement {
  /** 1…GALLERY_COLUMNS. */
  col: number;
  /** 1-indexed row. Unbounded — the canvas grows downward. */
  row: number;
  colSpan: number;
  rowSpan: number;
}

/**
 * The canvas is twelve columns wide, everywhere, on every device.
 *
 * Twelve because it divides by 2, 3, 4 and 6 — halves, thirds and quarters are
 * the spans an administrator actually reaches for, and each lands on a whole
 * column. A number that did not divide cleanly would make "half width"
 * unrepresentable.
 */
export const GALLERY_COLUMNS = 12;

/** Below this width the canvas collapses to one column, in reading order. */
export const GALLERY_COLLAPSE_BELOW = 700;

export function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === 'string' && (MEDIA_KINDS as readonly string[]).includes(value);
}

export function isMediaStatus(value: unknown): value is MediaStatus {
  return typeof value === 'string' && (MEDIA_STATUSES as readonly string[]).includes(value);
}

/**
 * Clamp a placement onto the canvas.
 *
 * A drag that ends past the right edge, a span wider than the grid, and a
 * hand-edited document with `col: 0` all arrive here. Every one of them is a
 * layout that would silently overflow its container, so they are corrected
 * rather than trusted.
 */
export function clampPlacement(placement: GridPlacement): GridPlacement {
  const colSpan = Math.min(Math.max(Math.round(placement.colSpan), 1), GALLERY_COLUMNS);
  const rowSpan = Math.max(Math.round(placement.rowSpan), 1);
  const col = Math.min(Math.max(Math.round(placement.col), 1), GALLERY_COLUMNS - colSpan + 1);
  const row = Math.max(Math.round(placement.row), 1);
  return { col, row, colSpan, rowSpan };
}
