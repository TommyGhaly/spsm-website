/**
 * Which of an event's stored photographs are no longer anybody's.
 *
 * ---------------------------------------------------------------------------
 * Split out of `admin.ts` so it can be tested, and it is worth saying why this
 * particular decision earns a file of its own when nothing else in the events
 * feature does.
 *
 * It is the only piece of the editor that can **destroy something that is still
 * wanted**. Everything else there writes a document, and a wrong write is
 * retyped; this deletes objects out of a bucket with no trash and no versioning,
 * and the photograph it takes is one somebody brought to the church office on a
 * phone. The two guards below — the path being kept, and the grace window — are
 * what stand between "tidy up the folder" and "delete the picture that was
 * chosen four seconds ago", and neither is visible from the call site.
 *
 * `admin.ts` cannot be imported by a test: it reaches `lib/firebase`, which
 * builds a live SDK the moment it is loaded. This has no imports at all.
 * ---------------------------------------------------------------------------
 */

/**
 * The upload stamp carried in a hero object's own name.
 *
 * `heroPath` names every upload `hero-{Date.now()}.{ext}`, so the age of a file
 * is readable from the listing itself. The alternative is `getMetadata` per
 * object — a network request each, to learn something already written down.
 *
 * Null for anything that does not parse, which the caller treats as *old*. That
 * direction is deliberate: the unparseable names are the pre-2026 files this
 * sweep exists to remove, and treating them as new would mean the tidying pass
 * never tidied the thing it was written for.
 */
export function uploadedAt(name: string): number | null {
  const stamp = Number(/^hero-(\d+)\./.exec(name)?.[1]);
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * Everything under an event that should go.
 *
 * `keep` is the full path the document currently names — the replacement on a
 * Replace, and null on a Remove or a delete.
 *
 * `graceMs` spares anything uploaded that recently, whatever the document says.
 * Zero for a removal somebody just pressed: they are looking at the event and
 * have said what they want. Non-zero for the sweep the editor runs when it
 * opens, which is fire-and-forget and races nothing except the person who
 * opened it — without the window, opening an event and immediately choosing a
 * photograph can end with that photograph deleted by a listing that began
 * before it existed.
 */
export function doomedFiles<T extends { name: string; fullPath: string }>(
  items: readonly T[],
  { keep, now, graceMs }: { keep: string | null; now: number; graceMs: number },
): T[] {
  return items.filter((item) => {
    if (item.fullPath === keep) return false;
    if (graceMs <= 0) return true;
    const stamp = uploadedAt(item.name);
    return stamp === null || now - stamp > graceMs;
  });
}
