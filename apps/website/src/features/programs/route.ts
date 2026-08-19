/**
 * Reading a gallery URL out of the address bar.
 *
 * Pure and separate from any component, because this is the one piece of the
 * client-rendered section that decides *what page you are on* — normally the
 * framework's job — and getting it wrong shows a visitor the wrong parish
 * program. It is unit-tested for that reason.
 *
 * ## Why the browser has to do the routing at all
 *
 * `output: 'export'` cannot emit a route it does not know at build time, and
 * `dynamicParams: true` is unsupported. A camp created after the last deploy
 * therefore has no HTML file. Firebase Hosting resolves redirects, then exact
 * static files, then rewrites — so `/events/some-liturgy` is served from disk
 * as usual, and only paths with nothing on disk fall through to the rewrite
 * onto the shell, which reads `location.pathname` and renders from Firestore.
 *
 * The URL never changes: a rewrite is not a redirect. The visitor sees
 * `/events/summercamp/week-1-2027` and so does this function.
 */

export type GalleryRoute =
  | { kind: 'program'; programSlug: string }
  | { kind: 'event'; programSlug: string; eventSlug: string }
  | { kind: 'unknown' };

/**
 * Segments that can never be a program, because a real page owns them.
 *
 * Belt and braces: Hosting serves those files before the rewrite is consulted,
 * so this function should never see them in production. It sees them in
 * `next dev`, which has no Hosting in front of it — and it would see them if a
 * static file were ever missing from a deploy, where rendering "no such
 * program" beats rendering a blank gallery under a URL that used to work.
 */
const NOT_A_PROGRAM: readonly string[] = ['gallery'];

export function parseGalleryPath(pathname: string): GalleryRoute {
  // Trailing slashes, double slashes, and the query string are all things a
  // real link carries and none of them are route information.
  const [beforeQuery = ''] = pathname.split('?');
  const segments = beforeQuery.split('/').filter((segment) => segment.length > 0);

  if (segments[0] !== 'events') return { kind: 'unknown' };

  const [, programSlug, eventSlug, ...rest] = segments;

  // `/events` itself is a real static page and never reaches here.
  if (!programSlug || rest.length > 0) return { kind: 'unknown' };
  if (NOT_A_PROGRAM.includes(programSlug)) return { kind: 'unknown' };

  // Decoded because a slug with a space or an accent arrives percent-encoded,
  // and Firestore holds the real characters.
  const program = safeDecode(programSlug);
  if (program === null) return { kind: 'unknown' };

  if (!eventSlug) return { kind: 'program', programSlug: program };

  const event = safeDecode(eventSlug);
  if (event === null) return { kind: 'unknown' };

  return { kind: 'event', programSlug: program, eventSlug: event };
}

/**
 * `decodeURIComponent` throws on a malformed escape — `%zz`, or a stray `%` —
 * which is trivially reachable by typing in the address bar. An exception here
 * would unmount the page; "no such program" is the honest answer instead.
 */
function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Where a program lives. The single place these URLs are constructed. */
export function programHref(programSlug: string): string {
  return `/events/${encodeURIComponent(programSlug)}`;
}

export function programEventHref(programSlug: string, eventSlug: string): string {
  return `/events/${encodeURIComponent(programSlug)}/${encodeURIComponent(eventSlug)}`;
}

/**
 * The presentation, at whichever level was asked for.
 *
 * A query parameter rather than a path segment, deliberately: a kiosk in the
 * hall is pointed at one URL and left running for an evening, and a query is
 * something somebody can bookmark, edit and restart without a deploy. It also
 * keeps the presentation on the same rewritten shell rather than needing a
 * second one.
 */
export function presentHref(
  programSlug: string,
  eventSlug?: string,
  groupId?: string,
): string {
  const base = eventSlug ? programEventHref(programSlug, eventSlug) : programHref(programSlug);
  const params = new URLSearchParams({ present: groupId ?? 'all' });
  return `${base}?${params.toString()}`;
}
