/**
 * Who may administer which program galleries.
 *
 * A third permission axis, alongside `Role` in ./roles.ts and `ScreenAdmin` in
 * ./screens.ts. The three answer different questions:
 *
 *   role         how much of the parish's administrative surface at all
 *   screenAdmin  which areas of the site
 *   programAdmin which *programs* within the galleries
 *
 * **Deliberately not folded into `screenAdmin.events`.** That flag means the
 * parish calendar. Handing the youth servant every Summercamp photograph must
 * not also hand them the Liturgy schedule, and one flag cannot express both.
 *
 * Like screen flags, these grant and never revoke: `role: 'admin'` already
 * opens everything, and a grant here is how somebody below admin is let into
 * one program. Client-side checks hide UI only — `firestore.rules` is the
 * enforcement.
 */

/**
 * A member's program grants.
 *
 * Two lists rather than one, because they expire differently. A program grant
 * is standing — the youth servant runs Summercamp, this year and every year,
 * and the superadmin never touches it again. An event grant is for the
 * volunteer who helps with one week and should not inherit the next.
 *
 * Ids, not slugs. A program renamed from `summercamp` to `summer-camp` must not
 * silently drop everybody's permission.
 */
export interface ProgramAdmin {
  /** Program ids. Covers every event under them, past and future. */
  programs: string[];
  /** ProgramEvent ids. Covers that event alone. */
  events: string[];
}

/**
 * What a member holds until a superadmin says otherwise: nothing.
 *
 * A function rather than a shared constant for the same reason
 * `defaultScreenAdmin` is one — callers write the result straight into
 * Firestore, and handing them all the same arrays is how one caller pushes onto
 * it and the next member inherits somebody else's grants.
 */
export function defaultProgramAdmin(): ProgramAdmin {
  return { programs: [], events: [] };
}

/**
 * Coerce anything read out of Firestore into a trustworthy shape.
 *
 * Member documents predate this axis, are written by older code, or are
 * hand-edited. All of those arrive as `undefined`, a partial object, or an
 * array with numbers in it. Anything that is not a non-empty string is dropped
 * rather than carried, so a malformed grant cannot become a wildcard.
 */
export function parseProgramAdmin(value: unknown): ProgramAdmin {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return { programs: idList(source.programs), events: idList(source.events) };
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

/**
 * Whether this person may administer everything under a program.
 *
 * Note what this is *not*: holding a single event under a program does not make
 * somebody a program administrator. They cannot rename the program, reorder it,
 * or create a second event in it. See `canAdminProgramEvent` for the narrower
 * question, which is the one most screens should be asking.
 */
export function canAdminProgram(
  claims: { role?: string } | null | undefined,
  programAdmin: ProgramAdmin | null | undefined,
  programId: string,
): boolean {
  if (claims?.role === 'admin') return true;
  return programAdmin?.programs.includes(programId) === true;
}

/**
 * Whether this person may administer one event — its photographs, its layout,
 * its groups, its approval queue.
 *
 * True by either route: a standing grant on the program the event belongs to,
 * or a grant on the event itself. The program id has to be passed in because a
 * `GalleryMedia` document carries both and the caller should never have to
 * fetch the event to answer this.
 */
export function canAdminProgramEvent(
  claims: { role?: string } | null | undefined,
  programAdmin: ProgramAdmin | null | undefined,
  programId: string,
  programEventId: string,
): boolean {
  if (canAdminProgram(claims, programAdmin, programId)) return true;
  return programAdmin?.events.includes(programEventId) === true;
}

/**
 * Whether there is any program screen worth showing this person at all.
 *
 * What the admin navigation asks before rendering the Ministries entry. A
 * member with no grants gets no link, rather than a link to an empty page.
 */
export function hasAnyProgramGrant(
  claims: { role?: string } | null | undefined,
  programAdmin: ProgramAdmin | null | undefined,
): boolean {
  if (claims?.role === 'admin') return true;
  return (programAdmin?.programs.length ?? 0) > 0 || (programAdmin?.events.length ?? 0) > 0;
}
