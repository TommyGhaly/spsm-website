/**
 * Choosing which few photographs a cycling tile shows.
 *
 * ---------------------------------------------------------------------------
 * Every tile that cycles — a ministry's plate on `/events` and the homepage,
 * its tile in the header's Events menu, a level's card and shelf tile — has
 * room for a handful of pictures out of hundreds. They used to take the
 * *first* handful in gallery order and always open on the first of those, so
 * a camp of six hundred photographs was shown as the same five from its first
 * morning, starting from the same one every visit. Tommy: *"it keeps showing
 * the same picture first — I want it to be a full overview within that tiny
 * window."*
 *
 * So the two halves of that are separate functions:
 *
 *   - `spreadAcross` decides **which** — evenly spaced through the whole set,
 *     so the handful is a cross-section of the event rather than its opening.
 *     Deterministic, so a page rendered on the server and hydrated in the
 *     browser agree on it.
 *   - `shuffle` decides **in what order**, and therefore which one opens.
 *     Random, so it is applied in the browser after mount — see
 *     `useShuffled` — and never during a render that has to match the server.
 * ---------------------------------------------------------------------------
 */

/**
 * `count` items spaced evenly through `list`, first and last included.
 *
 * Out of a gallery in order, that is a picture from near the start, one from
 * near the end, and the rest between — the overview. A list no longer than
 * `count` comes back whole.
 */
export function spreadAcross<T>(list: readonly T[], count: number): T[] {
  if (count <= 0) return [];
  if (list.length <= count) return [...list];
  if (count === 1) return [list[0]!];
  const step = (list.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => list[Math.round(i * step)]!);
}

/**
 * A shuffled copy (Fisher–Yates). `random` is injectable so tests can pin it;
 * everywhere else it is `Math.random`.
 */
export function shuffle<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
