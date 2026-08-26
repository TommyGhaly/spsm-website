import { SUMMARY_COVERS } from '@spsm/shared';
import { getProgramMedia, getPrograms } from './data';
import { programHref } from './route';

/**
 * The programs, as sub-items of "Events" in the main navigation.
 *
 * Names only. They carried a line of description each, which made the panel
 * taller than the header it hung from for the sake of five short names — the
 * sentence explaining what these are now sits once, on `/events`, where there
 * is room for it.
 *
 * **Read once at build time, in the root layout, and passed down as props.**
 * Nothing here runs in a visitor's browser, so the nav still costs no Firestore
 * read on a page load — which is the property `layout.tsx` was protecting when
 * it said the nav is hardcoded.
 *
 * That comment is still right about the top level and this does not weaken it.
 * The eight top-level items remain literals in the source; only the submenu
 * under Events is data. If this read fails, `getPrograms` returns an empty list
 * and the submenu is simply absent — "Events" itself is untouched, still in the
 * bar, still linking to a page that lists the programs. A bad read costs a
 * dropdown, never the navigation.
 *
 * The consequence to know: a program created after a deploy is immediately live
 * at its own URL and on `/events`, and joins the header at the next build. The
 * parish creates programs about as often as it starts a ministry, so trading a
 * deploy for zero per-page reads is the right way round.
 */

export type ProgramNavChild = {
  href: string;
  label: string;
  /**
   * Up to `SUMMARY_COVERS` photographs for the tile to cycle through, in
   * gallery order. Empty for a program with no approved pictures yet.
   *
   * Paths rather than URLs: the bucket host differs between production and
   * the emulators, and only the browser knows which it is talking to. `media.ts`
   * turns them into URLs at render time.
   */
  coverPaths: readonly string[];
};

export async function programNavChildren(): Promise<ProgramNavChild[]> {
  const programs = await getPrograms();

  /*
   * A handful of pictures each, fetched in parallel at build time.
   *
   * This is the only reason the menu costs more than one query, and it costs it
   * once per build rather than once per visitor. Asking for `SUMMARY_COVERS`
   * instead of one costs the same number of queries — a `limit` of five reads
   * five documents in the query that was already being run — and it is what
   * lets each tile show the ministry rather than one frozen moment of it.
   *
   * A program with no approved photographs yields an empty list and its tile
   * falls back to a plain ground; one with a single photograph simply holds it,
   * because the cycling in `NavTile` is driven by how many arrived.
   */
  const covers = await Promise.all(
    programs.map(async (program) =>
      (await getProgramMedia(program.id, SUMMARY_COVERS))
        .map((media) => media.renditionPath)
        .filter((path): path is string => path !== null),
    ),
  );

  return programs.map((program, index) => ({
    href: programHref(program.slug),
    label: program.name,
    coverPaths: covers[index] ?? [],
  }));
}
