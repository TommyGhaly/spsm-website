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
 * How a presentation is drawn.
 *
 * Three, because a hall screen and a laptop on a table in the narthex are not
 * the same room and the parish asked for both:
 *
 * - `columns` — the drifting columns that fill the screen. The default, and what
 *   the presentation was before there was a choice.
 * - `slide` — one photograph at a time, whole, advancing itself and advanceable
 *   by hand. The thing the columns replaced, kept because "one picture, large,
 *   and I say when" is a real request and not a regression.
 * - `notebook` — the photographs overlapping and tilted, the whole plane sliding
 *   leftward, with vertical strips travelling along with it.
 *
 * The *value* of `?present` rather than a second parameter, because the two can
 * never disagree that way: there is no such thing as a style with no
 * presentation, and `?present=notebook` is a URL somebody can read out loud over
 * the phone to whoever is standing at the laptop in the hall.
 */
export const PRESENTATION_STYLES = ['columns', 'slide', 'notebook'] as const;

export type PresentationStyle = (typeof PRESENTATION_STYLES)[number];

/** What each style is called on the switcher. */
export const PRESENTATION_STYLE_NAMES: Record<PresentationStyle, string> = {
  columns: 'Columns',
  slide: 'Slide',
  notebook: 'Notebook',
};

/**
 * What a URL with no usable style in it gets.
 *
 * `columns` because it is what every existing kiosk bookmark is already
 * showing — see `presentationStyle` for the two older values that land here.
 */
export const DEFAULT_PRESENTATION_STYLE: PresentationStyle = 'columns';

function isPresentationStyle(value: string | null): value is PresentationStyle {
  return value !== null && (PRESENTATION_STYLES as readonly string[]).includes(value);
}

/**
 * Which style a URL asks for.
 *
 * **Anything it does not recognise is the default, silently.** That is the whole
 * backwards-compatibility story and it is deliberate: the parameter used to mean
 * *what* to present rather than *how* — `?present=all`, and before that
 * `?present=day-2` — so every bookmark and printed URL in the parish carries a
 * value that is not a style. Refusing them would break a working kiosk; treating
 * them as "the way it has always looked" is exactly right, because it is.
 *
 * @param search `location.search`, with or without its leading `?`.
 */
export function presentationStyle(search: string): PresentationStyle {
  const value = new URLSearchParams(search).get('present');
  return isPresentationStyle(value) ? value : DEFAULT_PRESENTATION_STYLE;
}

/**
 * How fast a presentation moves.
 *
 * Named steps rather than a number in the URL, and the reason is the same one
 * that makes the style a name: `?pace=brisk` is something somebody reads out
 * over the phone to whoever is at the laptop in the hall, and `?pace=137` is a
 * number a stranger can type that the parish then has to be defended against.
 * Four steps because two is not a setting and eight is a dial nobody turns.
 *
 * The names are the contract; `PACE_FACTORS` holds the numbers, and every style
 * multiplies its own speeds by one of them — so "brisk" means the same thing to
 * the drifting columns, the sliding plane and the eight-second slide, without any
 * of the three agreeing on a pixel rate.
 */
export const PRESENTATION_PACES = ['slow', 'steady', 'brisk', 'fast'] as const;

export type PresentationPace = (typeof PRESENTATION_PACES)[number];

/** What each pace is called on the control. */
export const PRESENTATION_PACE_NAMES: Record<PresentationPace, string> = {
  slow: 'Slow',
  steady: 'Steady',
  brisk: 'Brisk',
  fast: 'Fast',
};

/**
 * What each pace multiplies a style's own speeds by.
 *
 * `steady` is exactly 1, and that is load-bearing: it is what every screen in
 * the parish was doing before there was a setting, so a URL with no `pace` in it
 * has to behave identically to one from last month. The others are spaced by
 * roughly a factor of 1.6 rather than evenly, because motion is judged
 * proportionally — 0.5 to 1 is the same *felt* step as 1.6 to 2.5.
 */
export const PACE_FACTORS: Record<PresentationPace, number> = {
  slow: 0.5,
  steady: 1,
  brisk: 1.6,
  fast: 2.5,
};

/** What a URL with no usable pace in it gets: what it has always done. */
export const DEFAULT_PRESENTATION_PACE: PresentationPace = 'steady';

function isPresentationPace(value: string | null): value is PresentationPace {
  return value !== null && (PRESENTATION_PACES as readonly string[]).includes(value);
}

/**
 * Which pace a URL asks for.
 *
 * Anything unrecognised — and that includes no parameter at all, which is the
 * common case — is `steady`. Same reasoning as `presentationStyle`: a screen in
 * a hall should never refuse to start over a query string.
 *
 * @param search `location.search`, with or without its leading `?`.
 */
export function presentationPace(search: string): PresentationPace {
  const value = new URLSearchParams(search).get('pace');
  return isPresentationPace(value) ? value : DEFAULT_PRESENTATION_PACE;
}

/**
 * The same page, moving at another pace.
 *
 * Drops the parameter entirely at the default rather than writing `pace=steady`.
 * The URLs the parish keeps are the ones somebody chose something in — a bookmark
 * carrying `?pace=steady` says a decision was made where none was, and it is the
 * URL that gets pasted into the bulletin.
 */
export function withPresentationPace(
  pathname: string,
  search: string,
  pace: PresentationPace,
): string {
  const params = new URLSearchParams(search);
  if (pace === DEFAULT_PRESENTATION_PACE) params.delete('pace');
  else params.set('pace', pace);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
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
 * everything beneath the page I am on", and the level is the path. What the
 * value carries instead is the style; see `PRESENTATION_STYLES`.
 */
export function presentHref(
  programSlug: string,
  trail: readonly string[] = [],
  style: PresentationStyle = DEFAULT_PRESENTATION_STYLE,
): string {
  const params = new URLSearchParams({ present: style });
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
 * Note that this is *whether*, not *how*: a value that is not a style still
 * presents, in the default one. Asking both questions of one parameter is what
 * keeps a mistyped style from dropping a visitor onto the ordinary page.
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

/**
 * The same page, presented in another style.
 *
 * Built here rather than in the component so that the switcher is one
 * `history.replaceState` away from being right: the style is in the URL, so
 * whatever is on the screen can be bookmarked, and a kiosk restarted overnight
 * comes back in the style somebody chose rather than in the default.
 *
 * `replaceState` and not a navigation, for the reason `withoutPresent` is used
 * that way too — the gallery behind the presentation is already fetched and
 * mounted, and a route change would read every document again to draw a screen
 * that is already in memory.
 */
export function withPresentationStyle(
  pathname: string,
  search: string,
  style: PresentationStyle,
): string {
  const params = new URLSearchParams(search);
  params.set('present', style);
  return `${pathname}?${params.toString()}`;
}

/**
 * Where "leave the presentation" goes: this page, without the query.
 *
 * `pace` goes with `present`, because it only ever meant anything to the
 * presentation — leaving it behind would put `?pace=brisk` on an ordinary gallery
 * page, where it describes nothing and would be carried into every link somebody
 * copies from there. Anything else in the query is somebody else's and stays.
 */
export function withoutPresent(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('present');
  params.delete('pace');
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
