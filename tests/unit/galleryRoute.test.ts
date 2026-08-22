import { describe, it, expect } from 'vitest';
import {
  isPresenting,
  parseGalleryPath,
  programHref,
  programEventHref,
  presentHref,
  withoutPresent,
} from '../../apps/website/src/features/programs/route.js';

/**
 * The gallery URL parser.
 *
 * This is routing, done by hand, in the browser — normally the framework's job.
 * It is here because `output: 'export'` cannot emit a route for a camp created
 * after the last deploy, so the shell reads the address bar itself.
 *
 * Worth real tests because the failure is not a crash. A parser that takes one
 * segment too many shows a visitor the wrong parish program under a URL that
 * looks right, and nothing anywhere reports it.
 */

describe('parseGalleryPath', () => {
  it('reads a program', () => {
    expect(parseGalleryPath('/events/summercamp')).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('reads one level down', () => {
    expect(parseGalleryPath('/events/summercamp/week-1-2027')).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail: ['week-1-2027'],
    });
  });

  /*
   * The whole reason this parser was rewritten. The galleries are a tree of
   * arbitrary depth, and a parser that stops at two segments does not show a
   * visitor a shallower page — it shows them "no such gallery" for a URL the
   * parish put in a bulletin.
   */
  it('reads a trail of any length', () => {
    expect(parseGalleryPath('/events/summercamp/2026/week-1/day-1/the-hike')).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail: ['2026', 'week-1', 'day-1', 'the-hike'],
    });
  });

  it('ignores a trailing slash', () => {
    expect(parseGalleryPath('/events/summercamp/')).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('ignores a query string, which the presentation always carries', () => {
    expect(parseGalleryPath('/events/summercamp/week-1-2027?present=all')).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail: ['week-1-2027'],
    });
  });

  it('survives doubled slashes', () => {
    expect(parseGalleryPath('//events//summercamp//week-1-2027')).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail: ['week-1-2027'],
    });
  });

  it('decodes an escaped slug', () => {
    expect(parseGalleryPath('/events/st%20simon')).toEqual({
      kind: 'program',
      programSlug: 'st simon',
    });
  });

  /** Reachable by typing in the address bar; `decodeURIComponent` throws. */
  it('does not throw on a malformed escape', () => {
    expect(parseGalleryPath('/events/%zz')).toEqual({ kind: 'unknown' });
    expect(parseGalleryPath('/events/ok/%')).toEqual({ kind: 'unknown' });
  });

  /*
   * There is no depth the parish is likely to reach, so this is a stop on
   * nonsense rather than a limit: a thousand-segment URL is not a link anybody
   * made, and answering it with somebody's real gallery would be worse than
   * answering it with nothing.
   */
  it('refuses a trail longer than the tree can be', () => {
    const silly = `/events/summercamp/${Array.from({ length: 40 }, () => 'x').join('/')}`;
    expect(parseGalleryPath(silly)).toEqual({ kind: 'unknown' });
  });

  it('decodes every segment of a trail, not just the first', () => {
    expect(parseGalleryPath('/events/st%20simon/outing%202027/day%201')).toEqual({
      kind: 'node',
      programSlug: 'st simon',
      trail: ['outing 2027', 'day 1'],
    });
  });

  it('does not throw on a malformed escape deep in a trail', () => {
    expect(parseGalleryPath('/events/summercamp/week-1/%zz')).toEqual({ kind: 'unknown' });
  });

  it('rejects paths outside /events', () => {
    for (const path of ['/', '/calendar', '/giving/summercamp', '/bookstore/events/x']) {
      expect(parseGalleryPath(path)).toEqual({ kind: 'unknown' });
    }
  });

  it('rejects /events itself, which is a real static page', () => {
    expect(parseGalleryPath('/events')).toEqual({ kind: 'unknown' });
    expect(parseGalleryPath('/events/')).toEqual({ kind: 'unknown' });
  });

  it('refuses the shell\'s own route as a program', () => {
    expect(parseGalleryPath('/events/gallery')).toEqual({ kind: 'unknown' });
  });
});

describe('href builders', () => {
  it('round-trips a program through parse', () => {
    expect(parseGalleryPath(programHref('summercamp'))).toEqual({
      kind: 'program',
      programSlug: 'summercamp',
    });
  });

  it('round-trips a trail through parse', () => {
    const trail = ['2026', 'week-1', 'day-1'];
    expect(parseGalleryPath(programEventHref('summercamp', trail))).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail,
    });
  });

  /*
   * An empty trail is the program, not a broken URL with a trailing slash. It is
   * reachable: `trailSlugs` returns the part of a node's trail that resolves, and
   * for a node whose every ancestor is unpublished that is nothing at all.
   */
  it('treats an empty trail as the program', () => {
    expect(programEventHref('summercamp', [])).toBe('/events/summercamp');
  });

  /** A slug with a space must survive being written into a link and read back. */
  it('round-trips a slug that needs escaping', () => {
    const href = programEventHref('st simon', ['outing 2027', 'day 1']);
    expect(href).not.toContain(' ');
    expect(parseGalleryPath(href)).toEqual({
      kind: 'node',
      programSlug: 'st simon',
      trail: ['outing 2027', 'day 1'],
    });
  });

  /*
   * The level is the path now, not a value in the query. "Present Day 2",
   * "present Week 1" and "present all of Summercamp" are one operation over
   * three subtrees, so the only thing the query still says is *that* the page is
   * being presented.
   */
  it('builds a presentation link at any depth', () => {
    expect(presentHref('summercamp')).toBe('/events/summercamp?present=all');
    expect(presentHref('summercamp', ['week-1-2027'])).toBe(
      '/events/summercamp/week-1-2027?present=all',
    );
    expect(presentHref('summercamp', ['2026', 'week-1', 'day-2'])).toBe(
      '/events/summercamp/2026/week-1/day-2?present=all',
    );
  });

  it('leaves a presentation link parseable', () => {
    expect(parseGalleryPath(presentHref('summercamp', ['week-1', 'day-2']))).toEqual({
      kind: 'node',
      programSlug: 'summercamp',
      trail: ['week-1', 'day-2'],
    });
  });
});

/**
 * Whether the page is being presented, read from the query string.
 *
 * The other half of the hand-rolled routing: the shell cannot use
 * `useSearchParams` — it suspends, and under `output: 'export'` that opts the
 * whole route out of prerendering — so the query is parsed here instead.
 *
 * It used to carry a subgroup id, because the third level had no URL of its own
 * to be presented from. Every level has one now, so this is a flag.
 */
describe('isPresenting', () => {
  it('is false on an ordinary page', () => {
    expect(isPresenting('')).toBe(false);
    expect(isPresenting('?')).toBe(false);
    expect(isPresenting('?utm_source=bulletin')).toBe(false);
  });

  it('is true whatever the flag says', () => {
    expect(isPresenting('?present=all')).toBe(true);
    // An old kiosk bookmark, which named a subgroup. It presents the level in
    // its own path rather than failing, which is the honest way to retire the
    // parameter's meaning without retiring the URL.
    expect(isPresenting('?present=day-2')).toBe(true);
  });

  /** A kiosk URL is typed by hand, so the shortest form has to work. */
  it('accepts a bare flag', () => {
    expect(isPresenting('?present')).toBe(true);
    expect(isPresenting('?present=')).toBe(true);
  });

  it('survives the leading question mark being left off', () => {
    expect(isPresenting('present=all')).toBe(true);
  });

  /*
   * A malformed escape must not throw. `decodeURIComponent` does — which is why
   * `parseGalleryPath` wraps it — and an exception here would unmount the page
   * rather than render a gallery.
   */
  it('does not throw on a malformed escape', () => {
    expect(() => isPresenting('?present=%zz')).not.toThrow();
  });

  it('reads back what presentHref writes', () => {
    const [, search = ''] = presentHref('summercamp', ['week-1', 'day-2']).split('?');
    expect(isPresenting(search)).toBe(true);
  });
});

describe('withoutPresent', () => {
  it('drops the flag and keeps the path', () => {
    expect(withoutPresent('/events/summercamp/week-1-2027', '?present=day-2')).toBe(
      '/events/summercamp/week-1-2027',
    );
  });

  /** Anything else in the query is somebody else's — a campaign tag, a share
      link — and leaving the presentation is not a reason to lose it. */
  it('keeps every other parameter', () => {
    expect(withoutPresent('/events/summercamp', '?present=all&utm_source=bulletin')).toBe(
      '/events/summercamp?utm_source=bulletin',
    );
  });

  it('is a no-op on a page that was not being presented', () => {
    expect(withoutPresent('/events/summercamp', '')).toBe('/events/summercamp');
  });
});
