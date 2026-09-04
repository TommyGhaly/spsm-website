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
  /*
   * `coverMediaId` was here: one `galleryMedia` id, "the picture on this
   * ministry's tile", with a panel control that wrote it.
   *
   * Removed because the tile never read it. `programTileMedia` builds the tile's
   * pictures from `featuredMediaIds` below, in the order they were chosen, and the
   * cover was consulted only when that came back empty — so the panel asked a
   * question `featuredMediaIds` had already answered and threw the answer away.
   * Choosing the tile's pictures, and which one it opens on, is `featuredMediaIds`.
   *
   * `ProgramEvent.coverMediaId` has since gone the same way, for a related
   * reason — see it below. Documents written before either removal still carry
   * the keys; nothing reads them.
   */

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
   * What the things inside this one are called, in the parish's own words.
   *
   * Editable rather than a constant, at Tommy's direction. It was hardcoded
   * "Gatherings" — *"I don't know why theyre called gatherings that's just not a
   * thing"* — and he is right that no single word can be: the things inside
   * Summercamp are years, the things inside a year are weeks, and the things
   * inside a week are days. A word chosen here is wrong one level down whatever
   * it is, so the parish names its own.
   *
   * Null or absent means `DEFAULT_CHILD_LABEL`. Stored on the **parent**, because
   * it describes the set of children rather than any one of them.
   */
  childLabel?: string | null;

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
   * Whether this page draws its **own** photographs at all.
   *
   * Absent or false is "yes", so adding this field changed no existing page.
   *
   * ## Why removing them is a field and not an empty list
   *
   * `featuredMediaIds: []` cannot mean it. On this document, empty has meant
   * "choose automatically" since long before blocks carried their own picks — see
   * the call to `pagePictures` in `GalleryShell` — so the page's first block has
   * two states where a band has three, and there is no empty list left to express
   * "none, on purpose". Rather than change what an empty `featuredMediaIds` means,
   * which every page written so far relies on, this says it outright.
   *
   * ## It takes the leftovers strip with it
   *
   * "Also from here" is defined as whatever the blocks above left out, so with the
   * page's own block gone it would otherwise show *everything* filed on this
   * level — pressing Delete would make more pictures appear, not fewer. The two
   * are two halves of one thing and already share one `hiddenMediaIds` list, so
   * one flag governs both. Bands are untouched: each is deleted on its own.
   *
   * Tommy asked for this directly — he wanted to be able to remove every section
   * of pictures from a page and leave it empty.
   */
  hidePagePictures?: boolean;
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
   * Whether the parish is collecting photographs anywhere under this ministry.
   *
   * **One flag for the whole tree**, at Tommy's direction. It used to be a flag
   * per level — `ProgramEvent.submissionsOpen` — and the reason that had to move
   * up is what the upload form now is: a visitor standing anywhere in a ministry
   * chooses which level their photograph belongs to, from a picker of the whole
   * tree. Per-level flags turned that picker into a list with holes in it, where
   * the level a parishioner wants is missing for a reason nobody on the public
   * side can see.
   *
   * The cost, stated because it is a real loss: there is no longer a way to
   * close last year's camp while this year's collects. Everything under a
   * ministry is open together or shut together.
   *
   * **Absent means open**, and that is deliberate rather than lazy. Every
   * program document written before this field existed has no value for it, and
   * a rule that read absence as "closed" would deny every upload the parish
   * receives until somebody remembered to write the field to five documents by
   * hand — which is exactly the class of failure `docs/decisions.md` #10 is
   * about: a policy that is correct on paper and refuses everything real. The
   * surface is public by design and moderated downstream; this flag exists to
   * turn it *off*.
   *
   * `firestore.rules` reads it with the same default. The two must agree.
   */
  submissionsOpen?: boolean;

  /**
   * The level a visitor's upload is filed under unless they say otherwise —
   * "the priority section".
   *
   * A `programEvents` id, or null for none. What it does is preselect: the form
   * offers the whole tree and starts on this one, so a parish that is running
   * Week 1 Day 2 today sets it once and everybody who uploads from anywhere in
   * the ministry lands there without choosing. Tommy asked for exactly this —
   * *"they can set that as priority so the user automatically uploads to that"*.
   *
   * Preselected rather than forced, because the other half of the same request
   * is that a submitter *does* get to say where a photograph belongs. The
   * administrator's real safety net is the queue: whatever level a photograph
   * arrives on, the queue can re-file it before approving.
   *
   * Null and stale ids both mean "no priority" — a level can be deleted long
   * after it was made the priority, and resolving this against the tree on read
   * (rather than cleaning it up on delete) means a deleted level costs a
   * preselection and never a broken form. Every reader must tolerate an id that
   * no longer resolves.
   */
  prioritySubmissionNodeId?: string | null;

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

  /**
   * What the things inside this one are called, in the parish's own words.
   *
   * Editable rather than a constant, at Tommy's direction. It was hardcoded
   * "Gatherings" — *"I don't know why theyre called gatherings that's just not a
   * thing"* — and he is right that no single word can be: the things inside
   * Summercamp are years, the things inside a year are weeks, and the things
   * inside a week are days. A word chosen here is wrong one level down whatever
   * it is, so the parish names its own.
   *
   * Null or absent means `DEFAULT_CHILD_LABEL`. Stored on the **parent**, because
   * it describes the set of children rather than any one of them.
   */
  childLabel?: string | null;


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

  /*
   * `coverMediaId` was here too: one `galleryMedia` id from anywhere in this
   * level's subtree, "the picture on its card", with a chooser in the properties
   * panel — two of them, in fact, one for the level being looked at and one for a
   * child selected from its card.
   *
   * Removed at Tommy's direction, and the reason is not the ministry's. This
   * field *was* read: `summariseChildren` put the chosen picture at the head of
   * the card's cycle. But a card cycles — it cross-fades through five pictures
   * from the subtree — so the whole effect of the choice was which one happened
   * to be showing when the page first drew. A setting nobody can verify four
   * seconds later is a question not worth asking twice on every page.
   *
   * So a card's pictures are simply what is filed beneath it, in filing order.
   * `summariseChildren` is the only thing that decides them.
   */

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

  /** See `Program.hidePagePictures`. The same switch at every depth. */
  hidePagePictures?: boolean;
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
   * Legacy: whether *this level* accepted uploads.
   *
   * Superseded by `Program.submissionsOpen`, which governs the whole tree. Read
   * nowhere and checked by no rule — a level with this set to `false` accepts
   * uploads now if its program is open, which is the change Tommy asked for when
   * he chose one flag per ministry over one per level.
   *
   * Still written by `createProgramEvent` so that a document created today looks
   * like every document created before it, and still on the interface so old
   * documents type-check. Nothing decides anything from it.
   *
   * @deprecated Use `Program.submissionsOpen`.
   */
  submissionsOpen?: boolean;
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
 * The `programId` of a photograph whose ministry has been deleted.
 *
 * ## Why a sentinel rather than a dangling id or a flag
 *
 * Deleting a ministry does not delete its photographs — see `deleteProgram`. The
 * parish's only copy of a camp must not go with the document that organised it.
 * But that leaves pictures naming a program that no longer exists, and something
 * has to be able to *find* them again or "not deleted" is a technicality.
 *
 * Leaving the dead id in place makes them unfindable: the only query that could
 * locate them is "programId is not any of the live ones", and Firestore's
 * `not-in` takes at most ten values — a limit the parish would quietly cross one
 * ministry at a time, at which point the recovery screen would start lying.
 *
 * A new `unfiled: true` field would query cleanly and needs a composite index
 * that is not deployed, and an undeployed index fails at the moment somebody
 * actually needs the screen. This value rides the `(programId, status, order)`
 * index that `getProgramMedia` already uses, so the recovery read is exactly as
 * proven as the ordinary one.
 *
 * The two underscores are deliberate: a Firestore document id may not begin with
 * them by convention here, and no `programs` document is ever created with this
 * slug, so it cannot collide with a real ministry.
 *
 * Note what it does to permission. `firestore.rules` checks
 * `adminsProgramEvent(resource.data.programId, …)`, so once a picture carries
 * this value only a full `admin` can move it — a program grant names a program,
 * and this is deliberately not one. Rogue pictures are the parish's problem, not
 * a ministry's.
 */
export const UNFILED_PROGRAM_ID = '__unfiled';

/**
 * One photograph or clip.
 *
 * Top-level rather than a subcollection of the event, because the two queries
 * that matter most cut across events: the pending-approval queue (everything
 * awaiting review, whichever program) and the homepage band (showcase media
 * from every program at once). Both are one query here and a fan-out otherwise.
 */
export interface GalleryMedia extends AuditFields {
  /**
   * Denormalised from the event so the queues above can filter without a join.
   *
   * `UNFILED_PROGRAM_ID` when the ministry it named has been deleted. Every
   * ordinary read filters on a real program id, so such a picture simply does
   * not appear — which is the point: it belongs to nobody until somebody adopts
   * it.
   */
  programId: string;
  /**
   * The level it is filed on — or the *program's* id, which means "on the
   * ministry itself rather than on any level". Both are real destinations; the
   * top row of `PictureManager` writes the second.
   *
   * May also name a level that has since been deleted. Deleting a level moves
   * its pictures to the ministry first (`deleteProgramEvent`), so this is only
   * the state of pictures orphaned before that existed — and the ministry page
   * shows them as its own anyway. See `getGalleryLevel`.
   */
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

  /**
   * uid of the administrator whose own upload this is, or null for everybody
   * else. Set by `POST /api/gallery/upload-url` from a *verified* token — never
   * from anything the request said about itself — and it is the whole of the
   * "an administrator's own photographs do not queue" feature.
   *
   * ## Why this is a marker and not simply `status: 'approved'`
   *
   * The endpoint cannot create an approved document, and the reason is the
   * shape of the pipeline rather than the rules. `onGalleryMediaCreated` bails
   * on anything that is not `pending`, so an approved-at-birth document is
   * never transcoded, never has `sourceUploaded` flipped true — and is
   * therefore deleted an hour later by the orphan sweep, which is looking for
   * exactly that. `onGalleryMediaReviewed`, which copies the bytes into the
   * public bucket, is an `onDocumentUpdated` and does not fire on a create at
   * all, so there would be no rendition either.
   *
   * So an administrator's upload takes the ordinary road and is waved through
   * at the end of it: created `pending`, transcoded like any other, then
   * flipped to `approved` by the same Function once the preview exists. That
   * flip is an update, so the publish trigger fires normally and the rendition
   * is copied from the preview rather than from a 12MB original.
   *
   * It stays on the document afterwards because it is the only record of why a
   * photograph was never in anybody's queue.
   */
  autoApproveBy: string | null;
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

/**
 * What to call the things inside a level, falling back to a word that is true at
 * every depth.
 *
 * "Albums" rather than a word about *gatherings* or *years*: every level of this
 * tree is a set of photographs, whatever else it also is, so the fallback cannot
 * be wrong the way a more specific one would be. It is only a fallback — the
 * parish sets `childLabel` and this stops being read.
 */
export const DEFAULT_CHILD_LABEL = 'Albums';

export function childLabelOf(
  parent: { childLabel?: string | null } | null | undefined,
): string {
  const named = parent?.childLabel?.trim();
  return named ? named : DEFAULT_CHILD_LABEL;
}
