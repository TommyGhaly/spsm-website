import type { AuditFields, Publishable, Timestamped } from './common.js';

/**
 * The parish's standing programs, and the photographs the parish takes of them.
 *
 * Three levels — program, event, group — because presentation has to run at all
 * three: "present Day 2", "present Week 1", and "present all of Summercamp" are
 * each something somebody will ask for. See docs/program-galleries.md.
 *
 * Deliberately not the same collection as `events`. That one answers *what is
 * coming up* and a Wednesday Liturgy belongs to it; this answers *what we did*
 * and is mostly pictures. They share an entrance (`/events`) and nothing else.
 */

/**
 * One standing program — Summercamp, St. Simon for Seniors, and so on.
 *
 * Data rather than a constant, so a superadmin can add the sixth program in
 * 2029 without a developer. The five the parish runs today are seeded, not
 * hardcoded.
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
  /** Manual order in the programs strip. Lower sorts first. */
  order: number;
}

/**
 * One occurrence of a program — "Summercamp Week 1 2027".
 *
 * This is the thing that gets a page, a gallery, and a submission queue.
 */
export interface ProgramEvent extends AuditFields, Publishable {
  programId: string;
  /** Unique within the program. The last segment of the URL. */
  slug: string;
  title: string;
  /** Markdown, shown above the gallery. */
  description: string;

  startAt: Timestamped | null;
  endAt: Timestamped | null;
  timeZone: string;

  /**
   * Named buckets an administrator invents — usually "Day 1"…"Day 3", but
   * equally "Chapel" or "Talent Show". Ordered, because the presentation walks
   * them in sequence when the whole event is presented.
   *
   * Stored inline rather than as a subcollection: there are a handful per
   * event, they are always read with the event, and a subcollection would cost
   * a second round trip on every gallery page for no benefit.
   */
  groups: ProgramEventGroup[];

  coverMediaId: string | null;

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

export interface ProgramEventGroup {
  /** Stable id. Media point at this, so renaming a group must not re-file it. */
  id: string;
  name: string;
  order: number;
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
  /** Null until an administrator files it. Submitters choose, admins correct. */
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
