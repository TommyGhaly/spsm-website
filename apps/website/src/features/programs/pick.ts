/**
 * One click on the admin picture picker, as a pure function.
 *
 * Its own module, with no React and no `@/` imports, for two reasons. It is the
 * one piece of the picker with rules worth asserting — see
 * tests/unit/mediaPicker.test.ts — and a test that reaches into MediaPicker.tsx
 * pulls in `@/components/Icon`, which vitest does not resolve. Same arrangement
 * as `route.ts` beside `GalleryShell.tsx`.
 */

export type PickerMode = 'one' | 'many';

/**
 * Apply one click to the chosen list.
 *
 * Pure, exported, and separate from the component because of a bug this shape
 * fixes rather than hides. The picker used to compute the next list from its
 * `selected` **prop** and hand the result back — so two clicks that arrived
 * before a re-render both read the same starting list and the second one threw
 * the first away. Distinct user clicks are separate tasks and do re-render in
 * between, so this only ever showed up under automation; that is precisely the
 * kind of thing that stays broken until it matters.
 *
 * The caller now owns the list and applies this with a functional state update,
 * which cannot read a stale value. Being pure, it is also testable — see
 * tests/unit/mediaPicker.test.ts.
 *
 * @param ceiling the most that may be chosen. `Infinity` for no limit.
 */
export function togglePick(
  current: readonly string[],
  id: string,
  mode: PickerMode,
  ceiling: number,
): string[] {
  if (mode === 'one') {
    // Clicking the chosen one again clears it, which is how "no cover, use the
    // newest" is expressed without a second control saying so.
    return current[0] === id ? [] : [id];
  }

  if (current.includes(id)) return current.filter((chosen) => chosen !== id);
  // Silently refused at the limit rather than dropping the oldest. Quietly
  // removing a picture somebody chose earlier, to make room for one they just
  // clicked, is worse than not adding it — the tile is disabled and says so.
  if (current.length >= ceiling) return [...current];
  return [...current, id];
}
