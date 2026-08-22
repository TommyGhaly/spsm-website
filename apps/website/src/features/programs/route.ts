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
 * `/events/summercamp/2026-week-1/day-1` and so does this function.
 *
 * ## The path is a trail of unknown length
 *
 * This used to accept exactly one or two segments and reject a third. The
 * galleries are a tree of arbitrary depth now — Summercamp → 2026 Week 1 → Day
 * 1 → The hike is a real page — so everything after the program is handed back
 * as a list and resolved against the tree by `resolveTrail`. Nothing here knows
 * or cares how deep the parish has gone.
 *
 * That is also why the depth cap lives here rather than only in the tree walk:
 * `/events/x/a/a/a/…` with two thousand segments is a URL a stranger can type,
 * and it should be answered with "no such gallery" before anything tries to
 * resolve it.
 */
import { GALLERY_MAX_DEPTH } from '@spsm/shared';

export type GalleryRoute =
  /** The ministry page. */
  | { kind: 'program'; programSlug: string }
  /**
   * A level inside a ministry. `trail` is every segment after the program, in
   * order — one for a gathering, two for a day inside it, and so on. Never
   * empty; a zero-length trail is the `program` case.
   */
  | { kind: 'node'; programSlug: string; trail: string[] }
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

  const [, programSlug, ...rest] = segments;

  // `/events` itself is a real static page and never reaches here.
  if (!programSlug) return { kind: 'unknown' };
  if (NOT_A_PROGRAM.includes(programSlug)) return { kind: 'unknown' };
  // Refused before resolving rather than truncated: a trail this long is not a
  // link the parish made, and answering it with somebody's real gallery would be
  // worse than answering it with nothing.
  if (rest.length > GALLERY_MAX_DEPTH) return { kind: 'unknown' };

  // Decoded because a slug with a space or an accent arrives percent-encoded,
  // and Firestore holds the real characters.
  const program = safeDecode(programSlug);
  if (program === null) return { kind: 'unknown' };

  if (rest.length === 0) return { kind: 'program', programSlug: program };

  const trail: string[] = [];
  for (const segment of rest) {
    const decoded = safeDecode(segment);
    if (decoded === null) return { kind: 'unknown' };
    trail.push(decoded);
  }

  return { kind: 'node', programSlug: program, trail };
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

/**
 * Where one level inside a program lives.
 *
 * `trail` is the slugs from the top down — `['2026-week-1', 'day-1']`. An empty
 * trail is the program itself, which is what makes this safe to call with
 * whatever `trailSlugs` returned for a node whose ancestors are unpublished.
 */
export function programEventHref(programSlug: string, trail: readonly string[]): string {
  const tail = trail.map((slug) => encodeURIComponent(slug)).join('/');
  return tail ? `${programHref(programSlug)}/${tail}` : programHref(programSlug);
}

/**
 * The presentation, at whichever level was asked for.
 *
 * A query parameter rather than a path segment, deliberately: a kiosk in the
 * hall is pointed at one URL and left running for an evening, and a query is
 * something somebody can bookmark, edit and restart without a deploy. It also
 * keeps the presentation on the same rewritten shell rather than needing a
 * second one.
 *
 * There is no longer a level *inside* the query. It used to carry a subgroup id
 * — `?present=day-2` — because the third level had no URL of its own to be
 * presented from. Every level has one now, so "present this" is always "present
 * everything beneath the page I am on", and the level is the path.
 */
export function presentHref(programSlug: string, trail: readonly string[] = []): string {
  const params = new URLSearchParams({ present: 'all' });
  return `${programEventHref(programSlug, trail)}?${params.toString()}`;
}

/**
 * Whether the page is being presented.
 *
 * Pure and here rather than inline in the shell, for the same reason
 * `parseGalleryPath` is: this decides *which view a visitor gets*, and it is
 * reading a string a stranger can type. It is unit-tested beside the path
 * parser.
 *
 * Any value counts, including none. `?present` with no value is the shortest
 * form of a URL that is typed and edited by hand at a laptop in the hall, and
 * refusing it — then rendering the ordinary page with no explanation — is the
 * least helpful thing this could do with a request it understands perfectly
 * well. The old subgroup ids still parse for the same reason: an old kiosk
 * bookmark presents the level in its path rather than failing.
 *
 * @param search `location.search`, with or without its leading `?`.
 * @returns true when this page is to be presented rather than read.
 */
export function isPresenting(search: string): boolean {
  // `URLSearchParams` accepts a leading `?` and an empty string, so neither is
  // guarded here. It does not throw on a malformed escape the way
  // `decodeURIComponent` does — see `safeDecode` — which is why this one is not
  // wrapped.
  return new URLSearchParams(search).has('present');
}

/** Where "leave the presentation" goes: this page, without the query. */
export function withoutPresent(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('present');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
