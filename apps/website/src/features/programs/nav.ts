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
   * Storage path of a photograph to sit behind the name, or null.
   *
   * A path rather than a URL: the bucket host differs between production and
   * the emulators, and only the browser knows which it is talking to. `media.ts`
   * turns it into a URL at render time.
   */
  coverPath: string | null;
};

export async function programNavChildren(): Promise<ProgramNavChild[]> {
  const programs = await getPrograms();

  /*
   * A cover each, fetched in parallel at build time.
   *
   * This is the only reason the menu costs more than one query, and it costs it
   * once per build rather than once per visitor. A program with no approved
   * photographs yields null and its tile falls back to a plain ground — which
   * is every program today, and progressively fewer as the galleries fill.
   */
  const covers = await Promise.all(
    programs.map(async (program) => (await getProgramMedia(program.id, 1))[0]?.renditionPath ?? null),
  );

  return programs.map((program, index) => ({
    href: programHref(program.slug),
    label: program.name,
    coverPath: covers[index] ?? null,
  }));
}
