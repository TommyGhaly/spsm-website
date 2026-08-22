/**
 * Creating and editing programs and their occurrences, from the public pages.
 *
 * This is the half of the galleries that had no interface at all. `/admin` grew
 * screens for the calendar and the approval queue; nothing anywhere could make
 * a program, publish one, or add "Summercamp Week 1 2027" — so a gallery could
 * not be brought into existence without a developer and a REST client. That is
 * what this file fixes.
 *
 * ## Why it lives beside the public page rather than under /admin
 *
 * Because the thing being edited is already on screen. A separate screen means
 * navigating away from the ministry you are looking at, finding it again in a
 * list, changing a field, and coming back to see whether it looks right. Editing
 * in place removes all four steps, and — for a page whose whole content is
 * photographs and prose — seeing the change against the real layout is most of
 * the review.
 *
 * ## The reads here deliberately do NOT filter on `published`
 *
 * That is the entire difference between these and their counterparts in
 * ./data.ts, and it is the reason they are separate functions rather than a
 * flag. A public read must carry `where('published','==',true)` or the rules
 * cannot prove the query is safe and deny it outright; an administrator's read
 * must omit it, or the unpublished draft they just created is invisible to the
 * person who made it.
 *
 * Firestore judges a list by what it *could* return, so the unfiltered version
 * is allowed only when the reader passes independently of any document — which
 * is `hasRole('admin')`. A program lead with a grant is refused the whole query.
 * `listProgramsForAdmin` therefore falls back to the published-only read, the
 * same shape as `listProgramLinkTargets` in features/events/admin.ts.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  COLLECTIONS,
  GALLERY_SUMMARY_MAX,
  buildGalleryTree,
  defaultBand,
  resolveBands,
  childrenOf,
  clampPlacement,
  descendantsOf,
  parentOf,
  type DocOf,
  type FocalPoint,
  type GalleryBand,
  type GalleryDisplay,
  type GalleryMedia,
  type GridPlacement,
  type MediaPlacement,
  type Program,
  type ProgramEvent,
  type SectionLayout,
} from '@spsm/shared';
import { db } from '@/lib/firebase';
import { docOf } from '@/lib/firestore';
import { PARISH_TIME_ZONE } from '@/lib/dates';

/**
 * A URL-safe id from a name somebody typed.
 *
 * Programs use their slug as the document id — see `getProgram` — so this is
 * the id too, and it is therefore permanent. `/events/summercamp` is a link the
 * parish will put in a bulletin; renaming the program later must not break it,
 * which is why nothing regenerates the slug on edit.
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/* -------------------------------------------------------------------------- */
/* Programs                                                                    */
/* -------------------------------------------------------------------------- */

/** Every program, draft ones included. Falls back to published-only. */
export async function listProgramsForAdmin(): Promise<DocOf<Program>[]> {
  const run = (constrain: boolean) =>
    getDocs(
      constrain
        ? query(
            collection(db(), COLLECTIONS.programs),
            where('published', '==', true),
            orderBy('order', 'asc'),
          )
        : query(collection(db(), COLLECTIONS.programs), orderBy('order', 'asc')),
    );

  const snapshot = await run(false).catch(() => run(true));
  return snapshot.docs.map(docOf<Program>);
}

export interface ProgramDraft {
  name: string;
  description: string;
  order: number;
  published: boolean;
}

/**
 * Create a program.
 *
 * `setDoc` at a known id rather than `addDoc`, because the slug *is* the id and
 * a program whose URL was assigned at random would be unlinkable. Refuses to
 * overwrite: a second "Summercamp" would silently replace the first, taking its
 * description and its published state with it.
 */
export async function createProgram(draft: ProgramDraft): Promise<string> {
  const slug = slugifyName(draft.name);
  if (!slug) throw new Error('Give the ministry a name.');

  const existing = await listProgramsForAdmin();
  if (existing.some((program) => program.id === slug)) {
    throw new Error(`There is already a ministry at /events/${slug}.`);
  }

  await setDoc(doc(db(), COLLECTIONS.programs, slug), {
    slug,
    name: draft.name.trim(),
    description: draft.description,
    coverMediaId: null,
    // Written explicitly rather than left absent. `programFeatured` tolerates a
    // missing key — it has to, for the programs that predate the field — but a
    // document created today with the field absent is a second shape of "empty"
    // for no reason.
    featuredMediaIds: [],
    order: draft.order,
    published: draft.published,
    publishAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: null,
  });

  return slug;
}

/**
 * Edit one.
 *
 * `slug` is absent from the accepted fields on purpose — it is the document id,
 * so changing it is not an edit but a move, and a move silently breaks every
 * link the parish has already shared.
 */
export async function updateProgram(
  programId: string,
  patch: Partial<Omit<ProgramDraft, never>> & {
    coverMediaId?: string | null;
    featuredMediaIds?: string[];
  },
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.programs, programId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Remove a program.
 *
 * The occurrences beneath it are **not** cascaded, and that is deliberate
 * rather than unfinished: a client-side cascade is a loop of deletes that can
 * stop halfway, and the half that survives is a set of galleries pointing at a
 * program that no longer exists. Refusing while any remain keeps the tree
 * consistent and makes the person deleting look at what they are about to lose.
 */
export async function deleteProgram(programId: string): Promise<void> {
  const events = await listProgramEventsForAdmin(programId);
  if (events.length > 0) {
    throw new Error(
      `This ministry still has ${events.length} gathering${events.length === 1 ? '' : 's'}. ` +
        'Remove those first.',
    );
  }
  await deleteDoc(doc(db(), COLLECTIONS.programs, programId));
}

/* -------------------------------------------------------------------------- */
/* Levels — every node of the tree, at any depth                               */
/* -------------------------------------------------------------------------- */

/**
 * Every level under one program, draft ones included, at every depth.
 *
 * One query for the whole tree, the same shape as the public read — see
 * `getProgramEvents`. An administrator's tree has to be the *whole* tree or the
 * unpublished week they just created has nowhere to hang its days.
 */
export async function listProgramEventsForAdmin(programId: string): Promise<DocOf<ProgramEvent>[]> {
  const base = [collection(db(), COLLECTIONS.programEvents), where('programId', '==', programId)] as const;

  const snapshot = await getDocs(query(base[0], base[1], orderBy('startAt', 'desc'))).catch(() =>
    getDocs(query(base[0], base[1], where('published', '==', true), orderBy('startAt', 'desc'))),
  );
  return snapshot.docs.map(docOf<ProgramEvent>);
}

export interface ProgramEventDraft {
  title: string;
  description: string;
  /** `null` for a level with no fixed date — a standing class, or "Day 1". */
  startAt: Date | null;
  endAt: Date | null;
  submissionsOpen: boolean;
  published: boolean;
}

/**
 * Create a level — the thing that gets a page, a gallery, and a queue.
 *
 * `parentId` is what makes this the same function for "add a camp to Summercamp"
 * and "add Day 1 to Week 1". There is no separate call for a subgroup any more,
 * because there is no such thing as a subgroup: the third level and the second
 * are the same kind of document and only their parent differs.
 *
 * The slug is scoped to its **siblings**, not to the program, and that is a
 * deliberate loosening — two camps may each have a `day-1`, because the trail
 * that resolves it walks the tree rather than matching the last segment. Scoping
 * it to the program would refuse the second camp's Day 1, which is the ordinary
 * case rather than a collision.
 *
 * Like a program's, the slug is the last segment of a URL and permanent: nothing
 * regenerates it on edit, because the parish puts these links in a bulletin.
 */
export async function createProgramEvent(
  programId: string,
  parentId: string | null,
  draft: ProgramEventDraft,
): Promise<string> {
  const slug = slugifyName(draft.title);
  if (!slug) throw new Error('Give this level a name.');

  const existing = await listProgramEventsForAdmin(programId);
  const siblings = existing.filter((event) => parentOf(event) === parentId);
  if (siblings.some((event) => event.slug === slug)) {
    throw new Error(`There is already a “${draft.title}” here.`);
  }

  /*
   * The id carries the whole path, so `week-1-2027`'s Day 1 and `week-2-2027`'s
   * cannot collide in a flat collection shared by every program — and so an id
   * read in the Firestore console still says where the photographs came from.
   *
   * Truncated, because Firestore caps a document id at 1500 bytes and a deep
   * tree of long names would reach it. The suffix loop is what makes truncation
   * safe: two levels whose paths agree for the first 200 characters would
   * otherwise silently overwrite one another, which for `setDoc` means the second
   * camp takes the first one's description and its published state with it.
   */
  const taken = new Set(existing.map((event) => event.id));
  const base = `${parentId ?? programId}-${slug}`.slice(0, 200);
  let id = base;
  for (let n = 2; taken.has(id) && n < 500; n += 1) id = `${base}-${n}`;

  /*
   * Ordered after its siblings rather than at 0. `+ 10` matching the media and
   * the old subgroups: gaps, so a later insert between two neighbours does not
   * have to renumber anything.
   *
   * This is what makes "Day 1, Day 2, Day 3" come out in the order they were
   * typed. Dated levels tie at 0 and fall back to the date — see `compareNodes`.
   */
  const lastOrder = siblings.reduce((max, event) => Math.max(max, event.order ?? 0), 0);

  await setDoc(doc(db(), COLLECTIONS.programEvents, id), {
    programId,
    parentId,
    slug,
    title: draft.title.trim(),
    description: draft.description,
    startAt: draft.startAt,
    endAt: draft.endAt,
    timeZone: PARISH_TIME_ZONE,
    order: lastOrder + 10,
    // Written explicitly rather than left absent. `nodeSummary` tolerates a
    // missing key — it has to, for the documents that predate the field — but a
    // document created today with the field absent is a second shape of "empty"
    // for no reason.
    featuredMediaIds: [],
    coverMediaId: null,
    calendarEventId: null,
    submissionsOpen: draft.submissionsOpen,
    published: draft.published,
    publishAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: null,
  });

  return id;
}

export async function updateProgramEvent(
  programEventId: string,
  patch: Partial<ProgramEventDraft>,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.programEvents, programEventId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Remove a level.
 *
 * **Refuses while anything hangs beneath it**, exactly as `deleteProgram`
 * refuses a program that still has levels, and for the same reason: a
 * client-side cascade is a loop of deletes that can stop halfway, and the half
 * that survives is a set of days pointing at a week that no longer exists. Those
 * days would then be lifted to the top of the ministry by `buildGalleryTree` —
 * visible, which is the right failure, but not what anybody asked for. Refusing
 * makes the person deleting look at what they are about to lose.
 *
 * The photographs filed under it are left alone. They are `galleryMedia`
 * documents with their own lifecycle — approved ones have public files behind
 * them — and deleting a level must not quietly destroy the parish's only copy of
 * a camp. They become orphaned, which is recoverable; deleted is not.
 */
export async function deleteProgramEvent(
  programEventId: string,
  programId: string,
): Promise<void> {
  const all = await listProgramEventsForAdmin(programId);
  const beneath = descendantsOf(buildGalleryTree(all), programEventId);
  if (beneath.length > 0) {
    throw new Error(
      `This still has ${beneath.length} level${beneath.length === 1 ? '' : 's'} inside it. ` +
        'Remove those first.',
    );
  }
  await deleteDoc(doc(db(), COLLECTIONS.programEvents, programEventId));
}

/**
 * Move a level up or down among its siblings.
 *
 * One `writeBatch` over the whole sibling list, renumbered from scratch as 10,
 * 20, 30…, for the reason `reorderPrograms` gives: the values that exist have
 * gaps and zeroes in them — every document written before `order` existed has
 * none at all — and "insert between" arithmetic on a list this short buys nothing
 * but fractions.
 *
 * Renumbering the whole list also does something a swap cannot: it gives every
 * sibling a number, which is what turns a level that was sorting by date into
 * one that sorts by hand. Moving "Day 2" once fixes the order of all of them.
 */
export async function moveProgramEvent(
  nodes: readonly DocOf<ProgramEvent>[],
  programEventId: string,
  delta: -1 | 1,
  uid: string | null,
): Promise<void> {
  const tree = buildGalleryTree(nodes);
  const node = tree.byId.get(programEventId);
  if (!node) throw new Error('That level no longer exists.');

  // Already in the order the page draws them — `childrenOf` sorts by
  // `compareNodes`, which is the same comparison the page uses.
  const siblings = [...childrenOf(tree, parentOf(node))];
  const at = siblings.findIndex((one) => one.id === programEventId);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= siblings.length) return;

  const [lifted] = siblings.splice(at, 1);
  if (!lifted) return;
  siblings.splice(to, 0, lifted);

  const batch = writeBatch(db());
  siblings.forEach((sibling, index) => {
    const position = (index + 1) * 10;
    if ((sibling.order ?? 0) === position) return;
    batch.update(doc(db(), COLLECTIONS.programEvents, sibling.id), {
      order: position,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  });
  await batch.commit();
}

/**
 * Re-file a level under a different parent, or up to the top of the ministry.
 *
 * The one operation the fixed three levels made impossible and the tree makes
 * necessary: somebody who added "Day 1" to the ministry instead of to the week
 * had, before this, no way out but to delete it and lose its photographs' filing.
 *
 * Refuses to put a level inside itself or inside its own descendant. That is not
 * a hypothetical — dragging a week into one of its own days is the obvious
 * mis-click — and the result is a cycle, which every walk in gallery/tree.ts
 * would then hit its depth guard on. The guard exists so a cycle is a mis-drawn
 * page rather than a hung tab; this is what stops one being created in the first
 * place.
 *
 * The `order` is reset so the moved level lands at the end of its new siblings
 * rather than wherever its old number happened to put it among them.
 */
export async function setProgramEventParent(
  nodes: readonly DocOf<ProgramEvent>[],
  programEventId: string,
  parentId: string | null,
  uid: string | null,
): Promise<void> {
  if (parentId === programEventId) throw new Error('A level cannot be inside itself.');

  const tree = buildGalleryTree(nodes);
  if (!tree.byId.has(programEventId)) throw new Error('That level no longer exists.');

  if (parentId !== null) {
    if (!tree.byId.has(parentId)) throw new Error('That destination no longer exists.');
    if (descendantsOf(tree, programEventId).some((one) => one.id === parentId)) {
      throw new Error('A level cannot be moved inside something that is already inside it.');
    }
  }

  const siblings = childrenOf(tree, parentId).filter((one) => one.id !== programEventId);
  const lastOrder = siblings.reduce((max, one) => Math.max(max, one.order ?? 0), 0);

  await updateDoc(doc(db(), COLLECTIONS.programEvents, programEventId), {
    parentId,
    order: lastOrder + 10,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Rename a level.
 *
 * The slug is deliberately untouched, which is why this is not just a title
 * patch with a nicer name. A slug is a URL the parish may already have put in a
 * bulletin, and it is also what `resolveTrail` matches — so regenerating it from
 * the new name would break both the link and, for anybody with the page open,
 * the page.
 */
export async function renameProgramEvent(
  programEventId: string,
  title: string,
  uid: string | null,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('This level needs a name.');
  await updateProgramEvent(programEventId, { title: trimmed }, uid);
}

/**
 * Persist a new running order for the ministry rail.
 *
 * One `writeBatch` rather than a loop of updates, and that is the whole reason
 * this is a function rather than five calls at the call site. Dragging one tile
 * changes the position of every tile it passed, so a loop is N writes that can
 * fail on the third — leaving two ministries renumbered and three not, which is
 * an order nobody chose and which the next drag makes worse. A batch is atomic:
 * the parish either sees the new order or the old one.
 *
 * Positions are rewritten from scratch as 1..N rather than nudged, because the
 * seeded values have gaps and duplicates in them and "insert between" arithmetic
 * on a list this short buys nothing but fractions.
 *
 * Only the documents whose number actually changed are written. Dragging the
 * last tile one place left is two writes, not five.
 */
export async function reorderPrograms(
  ordered: readonly DocOf<Program>[],
  uid: string | null,
): Promise<void> {
  const batch = writeBatch(db());
  let touched = 0;

  ordered.forEach((program, index) => {
    const position = index + 1;
    if (program.order === position) return;
    touched += 1;
    batch.update(doc(db(), COLLECTIONS.programs, program.id), {
      order: position,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  });

  if (touched === 0) return;
  await batch.commit();
}

/* -------------------------------------------------------------------------- */
/* Choosing pictures                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The pictures a level shows, and their order.
 *
 * Written as one array rather than a flag per photograph, which is the whole
 * reason `featuredMediaIds` is shaped the way it is: the order the administrator
 * arranged them in *is* the content, and a set of booleans across fifteen
 * documents cannot hold an order. It is also one write instead of fifteen, so a
 * half-finished arrangement is not a state the page can be left in.
 *
 * Capped, and the number is `GALLERY_SUMMARY_MAX` rather than a second opinion:
 * a curated summary and an automatic one appear in the same block of the same
 * page, and letting one run to forty while the other stops at twenty-four would
 * make the page change shape depending on whether anybody had touched it.
 *
 * The cap does not reach the *deepest* level, because a leaf shows everything
 * filed on it and needs no curation to do so — see `nodeSummary`. It applies
 * wherever somebody has actually chosen.
 */
export const MAX_FEATURED = GALLERY_SUMMARY_MAX;

export async function setProgramFeatured(
  programId: string,
  mediaIds: readonly string[],
  uid: string | null,
): Promise<void> {
  // De-duplicated: the picker can be clicked twice on the same photograph
  // faster than it re-renders, and the same picture twice in a row on a page is
  // a bug that looks like a data-entry mistake.
  const unique = [...new Set(mediaIds)].slice(0, MAX_FEATURED);
  await updateProgram(programId, { featuredMediaIds: unique }, uid);
}

/**
 * The same thing, one or more levels down.
 *
 * Separate from `setProgramFeatured` only because it writes a different
 * collection. The *meaning* is identical at every depth, which is the point of
 * the tree: an administrator on "Week 1 2026" chooses from every photograph in
 * every day of that week, exactly as one on "Summercamp" chooses from every
 * photograph in the ministry.
 */
export async function setNodeFeatured(
  programEventId: string,
  mediaIds: readonly string[],
  uid: string | null,
): Promise<void> {
  const unique = [...new Set(mediaIds)].slice(0, MAX_FEATURED);
  await updateDoc(doc(db(), COLLECTIONS.programEvents, programEventId), {
    featuredMediaIds: unique,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** The one picture that stands for the ministry in the rail on /events. */
export async function setProgramCover(
  programId: string,
  mediaId: string | null,
  uid: string | null,
): Promise<void> {
  await updateProgram(programId, { coverMediaId: mediaId }, uid);
}

/**
 * The one picture that stands for a level on the card its parent draws for it.
 *
 * Separate from `updateProgramEvent` rather than a field on `ProgramEventDraft`,
 * because it is not set from the form: it is set by clicking a photograph, in a
 * picker, and folding it into the draft would mean the form had to hold and
 * write back a value it never shows.
 *
 * The picture may come from anywhere in that level's subtree, which is what makes
 * a cover choosable for a week that has no photographs of its own — only days
 * with photographs in them. `summariseChildren` reads the same subtree to find
 * the automatic one.
 */
export async function setNodeCover(
  programEventId: string,
  mediaId: string | null,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.programEvents, programEventId), {
    coverMediaId: mediaId,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/* -------------------------------------------------------------------------- */
/* Arranging a section                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Save a section's arrangement.
 *
 * Every level carries one and there are only two places they live now — a field
 * on the program, or the same field on a node, at any depth. So this takes a
 * target rather than an id and the caller says which.
 *
 * It used to have a third branch, for a subgroup's layout inside
 * `ProgramEvent.groups`. That was a read-modify-write on an array, because
 * Firestore cannot address an array element — `arrayUnion`/`arrayRemove` match on
 * deep equality, which is no use for "change one field of the third element" —
 * and it could silently lose a concurrent edit to a *different* subgroup of the
 * same gathering. Making every level a document of its own deleted that whole
 * class of problem rather than mitigating it: a node's layout is a field on the
 * node, and two administrators arranging two different days now write two
 * different documents.
 *
 * The whole object is written every time, never a partial patch. `SectionLayout`
 * is a nested object, and Firestore's merge semantics for those are a trap: a
 * dotted path (`sectionLayout.title.scale`) merges, but writing the plain field
 * with a partial object *replaces* it — so "just change the scale" would silently
 * drop the title and caption settings. `resolveSectionLayout` gives every caller
 * a complete object to start from, which makes writing the whole thing the
 * easy path as well as the correct one.
 */
export type SectionTarget =
  | { kind: 'program'; programId: string }
  | { kind: 'node'; programEventId: string };

export async function setSectionLayout(
  target: SectionTarget,
  layout: SectionLayout,
  uid: string | null,
): Promise<void> {
  const audit = { updatedAt: serverTimestamp(), updatedBy: uid };

  const reference =
    target.kind === 'program'
      ? doc(db(), COLLECTIONS.programs, target.programId)
      : doc(db(), COLLECTIONS.programEvents, target.programEventId);

  await updateDoc(reference, { sectionLayout: layout, ...audit });
}

/* -------------------------------------------------------------------------- */
/* Scroll wheels added to a page                                              */
/* -------------------------------------------------------------------------- */

/**
 * The extra blocks on one page — added, arranged, renamed, removed.
 *
 * Every one of these is a read-modify-write on a single `bands` array, because
 * Firestore cannot address an array element: `arrayUnion`/`arrayRemove` match on
 * deep equality, which is no use for "change the scale of the second one".
 *
 * That is the same shape as the old `groups` handling, which the tree deleted —
 * and it is worth saying why it is acceptable here when it was worth removing
 * there. Groups were the *structure*: every photograph in the parish pointed into
 * that array, a lost write unfiled a day of a camp, and the array had to be
 * consistent with a separate collection. A band is one block's styling on one
 * page. Nothing points at it, a lost write is a wheel somebody has to re-add, and
 * the writers are the one or two people administering a ministry while looking at
 * the page. The cost is bounded by what the thing is.
 *
 * `resolveBands` on the way in, always: the field is absent from every document
 * written before it existed, and reading a raw array here would write back
 * whatever shape it happened to hold.
 */
async function editBands(
  target: SectionTarget,
  uid: string | null,
  change: (bands: GalleryBand[]) => GalleryBand[],
): Promise<void> {
  const reference =
    target.kind === 'program'
      ? doc(db(), COLLECTIONS.programs, target.programId)
      : doc(db(), COLLECTIONS.programEvents, target.programEventId);

  const snapshot = await getDoc(reference);
  if (!snapshot.exists()) throw new Error('That page no longer exists.');

  await updateDoc(reference, {
    bands: change(resolveBands((snapshot.data() as { bands?: unknown }).bands)),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Whether an *untouched* block on this page draws everything beneath it rather
 * than a selection.
 *
 * A field on the page rather than on each block, and it stayed there when the picks
 * moved onto the blocks. The reason is what it is for: "this camp's page should
 * show all four hundred photographs, not a summary of them" is a statement about
 * the page, and per-block it was the thing that let one wheel disagree with the
 * grid above it about what the page was for.
 *
 * It does **not** clear a block's picked list, and `pagePictures` reads the picks
 * first — so it appears to do nothing to a block somebody has picked for. The
 * control says so in as many words, because a switch that silently does nothing is
 * worse than one that is not offered. The way back for that block is "Back to
 * automatic" in its own footer, which is on the block, where the picking was.
 */
export async function setPageShowsAll(
  target: SectionTarget,
  showAll: boolean,
  uid: string | null,
): Promise<void> {
  const reference =
    target.kind === 'program'
      ? doc(db(), COLLECTIONS.programs, target.programId)
      : doc(db(), COLLECTIONS.programEvents, target.programEventId);

  await updateDoc(reference, {
    showAllPictures: showAll,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * The pictures pressed × on in the page's own blocks — its first one, and the
 * "Also from here" strip.
 *
 * A **hide, not a delete**: the photograph stays approved, stays in the parish's
 * storage, and stays on the page of the level it is filed under. That is why the ×
 * needs no confirmation — nothing is destroyed, and every one of these comes back
 * when somebody presses "Back to automatic" under the block.
 *
 * ## Why this replaced a `setPictureHidden(target, id, true)`
 *
 * It was `arrayUnion`/`arrayRemove`, one member at a time, and that was the better
 * tool for the reason it was chosen: the operation was exactly "add this member",
 * atomically, so two administrators tidying two different photographs off the same
 * page could not lose each other's work.
 *
 * What made it wrong was not concurrency between people but concurrency inside one
 * click run. React batches the state updates from a run of quick ×s and re-renders
 * once at the end, so the page's own copy of the list has to be built with
 * functional state updates or every × in the run starts from the same stale list.
 * That copy is then the authoritative one — and an effect that only sees the
 * finished list would have to diff it against the document to work out which single
 * member to send. Writing the list it already holds is the honest move.
 *
 * The trade, stated: two people tidying the same page in the same second now costs
 * one of them a click. A run of ×s losing all but the last was the actual bug.
 */
export async function setHiddenPictures(
  target: SectionTarget,
  mediaIds: readonly string[],
  uid: string | null,
): Promise<void> {
  const reference =
    target.kind === 'program'
      ? doc(db(), COLLECTIONS.programs, target.programId)
      : doc(db(), COLLECTIONS.programEvents, target.programEventId);

  await updateDoc(reference, {
    hiddenMediaIds: [...mediaIds],
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * How many wheels one page may carry.
 *
 * Not a technical limit — it is the point at which a page stops being a page. Three
 * turning strips under a grid is already a lot of movement on one screen, and the
 * fourth is somebody using bands where they wanted levels.
 */
export const MAX_BANDS = 3;

/**
 * Add one.
 *
 * @returns its id, so the caller can open its row in the panel straight away —
 *   which matters more than it sounds: a wheel added with no title, at the bottom
 *   of a long page, is otherwise something somebody has to go and find.
 */
export async function addBand(
  target: SectionTarget,
  display: GalleryDisplay,
  uid: string | null,
): Promise<string> {
  // Time-based rather than a slug: a band has no name when it is created — the
  // control that adds one asks for a direction, not a title — so there is nothing
  // to derive an id from, and two added in the same second is not a thing a
  // person can do.
  const id = `band-${Date.now().toString(36)}`;
  await editBands(target, uid, (bands) => {
    if (bands.length >= MAX_BANDS) {
      throw new Error(`A page can carry ${MAX_BANDS} scroll wheels.`);
    }
    return [...bands, defaultBand(id, display)];
  });
  return id;
}

export async function removeBand(
  target: SectionTarget,
  bandId: string,
  uid: string | null,
): Promise<void> {
  // Nothing is destroyed: a band holds no photographs, only a rule for which ones
  // to draw. Removing one is why it needs no confirmation.
  await editBands(target, uid, (bands) => bands.filter((band) => band.id !== bandId));
}

export async function updateBand(
  target: SectionTarget,
  bandId: string,
  patch: Partial<Omit<GalleryBand, 'id'>>,
  uid: string | null,
): Promise<void> {
  await editBands(target, uid, (bands) =>
    bands.map((band) => (band.id === bandId ? { ...band, ...patch } : band)),
  );
}

/** Move one up or down the page, past its neighbours. */
export async function moveBand(
  target: SectionTarget,
  bandId: string,
  delta: -1 | 1,
  uid: string | null,
): Promise<void> {
  await editBands(target, uid, (bands) => {
    const at = bands.findIndex((band) => band.id === bandId);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= bands.length) return bands;
    const ordered = [...bands];
    const [lifted] = ordered.splice(at, 1);
    if (!lifted) return bands;
    ordered.splice(to, 0, lifted);
    return ordered;
  });
}

/* -------------------------------------------------------------------------- */
/* Arranging the pictures inside a section                                    */
/* -------------------------------------------------------------------------- */

/**
 * Move or resize one photograph on the twelve-column canvas.
 *
 * `clampPlacement` before writing, not after reading. A drag that ended past the
 * right edge and a span wider than the grid both arrive here, and the rules do
 * not check geometry — so an unclamped write is a document that renders as an
 * overflowing row on the website and something else again in the app. Clamping on
 * write means the stored value is always renderable; `packGallery` clamps again on
 * read, because a document written before this existed may not be.
 */
export async function setMediaLayout(
  mediaId: string,
  layout: GridPlacement | null,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    layout: layout === null ? null : clampPlacement(layout),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Whether a photograph appears on its gathering's page, on the hall screen, or
 * on the homepage.
 *
 * The whole `placement` object every time, for the same reason
 * `setSectionLayout` writes the whole layout: a partial nested object replaces
 * rather than merges, so patching one flag would clear the other two.
 */
export async function setMediaPlacement(
  mediaId: string,
  placement: MediaPlacement,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    placement,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Re-file a photograph onto a different level of the tree.
 *
 * This is what filing a photograph *is* now. It used to be a `groupId` beside an
 * unchanged `programEventId` — a pointer into an array on the gathering — which
 * meant a photograph could only ever move within one gathering, and the third
 * level was the deepest it could go. Writing `programEventId` moves it anywhere
 * in the ministry, to any depth, in one field.
 *
 * `groupId` is cleared at the same time, and that matters: it is the legacy
 * pointer, and a stale one left behind on a re-filed photograph is a claim about
 * a subgroup of a gathering the picture is no longer in.
 *
 * **`programId` is deliberately not written.** The rules check it against the
 * destination on create and the queue and the homepage band filter on it, so a
 * change to it is a change of ministry — a different act, needing a grant on
 * both, and not something a filing control should be able to do by accident.
 * The destination is always within the same program, because the only levels
 * offered are the ones under it.
 */
export async function setMediaNode(
  mediaId: string,
  programEventId: string,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    programEventId,
    groupId: null,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Where in a photograph the thing that matters is.
 *
 * The write half of a field that had none. `GalleryMedia.focal` has been read by
 * every surface on the site since the schema was written — the grid, the covers,
 * the tiles, the presentation, all through `focalPosition` — and the only thing
 * that ever *wrote* it was `submit.ts`, with the literal centre. So every
 * photograph in the parish was `{ x: 0.5, y: 0.5 }` and every crop was centred,
 * including the one case the field exists for: a wide group shot in a square
 * tile, faces along the top.
 *
 * Clamped here as well as in the control, for the same reason `setMediaLayout`
 * clamps a placement: the rules do not check geometry, so an out-of-range value
 * would be stored and then handed to `object-position` as `142% 8%` — which is
 * legal CSS and renders as a photograph shoved out of its own frame.
 *
 * The whole point every time, never a partial patch. `focal` is a nested object,
 * and Firestore *replaces* one written as a plain field — so writing `{ x }`
 * alone would silently drop `y`. Same trap as `placement` and `sectionLayout`.
 */
export async function setMediaFocal(
  mediaId: string,
  focal: FocalPoint,
  uid: string | null,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTIONS.galleryMedia, mediaId), {
    focal: { x: clampFraction(focal.x), y: clampFraction(focal.y) },
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** Into [0, 1]. `NaN` — from a frame measured at zero width — becomes centre. */
function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

/**
 * Move one photograph earlier or later among the ones it is shown with.
 *
 * `reorderMedia` below has existed since the galleries were built and **nothing
 * called it** — docs/program-galleries.md listed reordering under "still to
 * come". This is what calls it.
 *
 * It is the only way to arrange a `rail` or a `column`, and that is not a gap in
 * those displays but their nature: a rail's layout is an *order*, not a position,
 * so there is no canvas to put drag handles on. A grid can be dragged and this
 * still works on one — it moves the picture in the sequence the packer reads,
 * which is what decides where an un-pinned tile lands.
 *
 * Takes the list the page is actually showing rather than a set fetched here.
 * "Earlier" has to mean earlier *on screen*, and only the caller knows which
 * block the photograph is in and in what order it drew it — the same picture is
 * in a different position in its level's gallery and in its parent's summary.
 */
export async function moveMediaWithin(
  shown: readonly DocOf<GalleryMedia>[],
  mediaId: string,
  delta: -1 | 1,
  uid: string | null,
): Promise<void> {
  const at = shown.findIndex((item) => item.id === mediaId);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= shown.length) return;

  const ordered = [...shown];
  const [lifted] = ordered.splice(at, 1);
  if (!lifted) return;
  ordered.splice(to, 0, lifted);

  await reorderMedia(ordered, uid);
}

/**
 * Persist a new running order for a set of photographs.
 *
 * One `writeBatch`, and only the documents whose number actually changed —
 * exactly the reasoning on `reorderPrograms`. Dragging one picture changes the
 * position of every picture it passed, so a loop of updates is N writes that can
 * fail on the third, leaving a set half-renumbered in an order nobody chose.
 *
 * Positions are rewritten from scratch as 10, 20, 30… rather than nudged. The
 * gaps are not fractional-index cleverness; they are so that a later single
 * insert can be given a number between two neighbours without renumbering
 * anything, which is what the approval queue does when it files a new photograph.
 */
export async function reorderMedia(
  ordered: readonly DocOf<GalleryMedia>[],
  uid: string | null,
): Promise<void> {
  const batch = writeBatch(db());
  let touched = 0;

  ordered.forEach((item, index) => {
    const position = (index + 1) * 10;
    if (item.order === position) return;
    touched += 1;
    batch.update(doc(db(), COLLECTIONS.galleryMedia, item.id), {
      order: position,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    });
  });

  if (touched === 0) return;
  await batch.commit();
}
