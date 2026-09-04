/**
 * What the approval queue is holding that is not in the database yet.
 *
 * Two pieces of state, both of them local to one person's screen and both
 * deliberately unsaved:
 *
 *   - **which rows are ticked**, which is a working set and means nothing to
 *     anybody else
 *   - **where each row has been re-pointed**, which is an *intention* and only
 *     becomes a fact when it is approved
 *
 * The second one is the rule Tommy asked for in as many words: move a
 * photograph to another week, walk away without approving it, and it is back on
 * the level its sender chose. So nothing here writes, and nothing here is
 * persisted to `sessionStorage` or anywhere else — a reload is meant to lose it.
 *
 * ## Why this is its own file
 *
 * Because the queue is live now. A snapshot arrives whenever anybody uploads or
 * approves anything, and it carries a different set of rows than the one the
 * reviewer started with — so every one of these maps has to be reconciled
 * against it, and doing that inline in a component is how a half-decided screen
 * silently loses somebody's filing. The reconciliation is three small pure
 * functions, and pure functions can be tested; see tests/unit/queueSelection.test.ts.
 */

/** A row's id, and where its reviewer has pointed it. Never written. */
export type Filings = ReadonlyMap<string, string>;

/**
 * Drop anything that is no longer in the queue.
 *
 * Called on every snapshot, and it is the load-bearing half of "live". Without
 * it a photograph approved on somebody else's laptop stays ticked here forever,
 * silently included in the next "Approve 12" — which would then fail whole,
 * because the row it names is no longer pending.
 *
 * Returns the same collection when nothing changed, so React can skip the
 * render. That is not a micro-optimisation on a screen where a snapshot arrives
 * every few seconds while forty photographs upload.
 */
export function keepPresent<T extends string>(
  chosen: ReadonlySet<T>,
  present: ReadonlySet<string>,
): ReadonlySet<T> {
  const kept = new Set<T>();
  for (const id of chosen) if (present.has(id)) kept.add(id);
  return kept.size === chosen.size ? chosen : kept;
}

/** The same, for the filings map. */
export function keepPresentFilings(filings: Filings, present: ReadonlySet<string>): Filings {
  const kept = new Map<string, string>();
  for (const [id, target] of filings) if (present.has(id)) kept.set(id, target);
  return kept.size === filings.size ? filings : kept;
}

/**
 * Where one row will actually be filed: the reviewer's choice if they made one,
 * otherwise the level its sender chose.
 *
 * The absence of an entry is what "unchanged" means, rather than an entry equal
 * to the original. That is why a refresh reverts: an empty map is exactly the
 * submitter's own filing, with nothing to reconstruct.
 */
export function filingFor(
  media: { id: string; programEventId: string },
  filings: Filings,
): string {
  return filings.get(media.id) ?? media.programEventId;
}

/**
 * The argument for `approveMany`, in the queue's own order.
 *
 * Built from `items` rather than by iterating the selection, so what is written
 * is always a subset of what is on screen — a stale id in the selection cannot
 * put a write into the batch. `keepPresent` should have removed it already;
 * this makes it structurally impossible rather than merely handled.
 */
export function filingsFor(
  items: readonly { media: { id: string; programEventId: string } }[],
  selected: ReadonlySet<string>,
  filings: Filings,
): { mediaId: string; programEventId: string }[] {
  return items
    .filter((item) => selected.has(item.media.id))
    .map((item) => ({
      mediaId: item.media.id,
      programEventId: filingFor(item.media, filings),
    }));
}
