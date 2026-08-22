import { describe, it, expect } from 'vitest';
import {
  PACE_FACTORS,
  PRESENTATION_PACES,
  PRESENTATION_STYLES,
  isPresenting,
  parseGalleryPath,
  presentationPace,
  presentationStyle,
  programHref,
  programEventHref,
  presentHref,
  withPresentationPace,
  withPresentationStyle,
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
   * The level is the path, not a value in the query. "Present Day 2", "present
   * Week 1" and "present all of Summercamp" are one operation over three
   * subtrees, so what the query carries is the *style* — see the block on
   * `presentationStyle` below.
   */
  it('builds a presentation link at any depth', () => {
    expect(presentHref('summercamp')).toBe('/events/summercamp?present=columns');
    expect(presentHref('summercamp', ['week-1-2027'])).toBe(
      '/events/summercamp/week-1-2027?present=columns',
    );
    expect(presentHref('summercamp', ['2026', 'week-1', 'day-2'])).toBe(
      '/events/summercamp/2026/week-1/day-2?present=columns',
    );
  });

  it('carries a chosen style', () => {
    expect(presentHref('summercamp', [], 'notebook')).toBe('/events/summercamp?present=notebook');
    expect(presentHref('summercamp', ['day-2'], 'slide')).toBe(
      '/events/summercamp/day-2?present=slide',
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

  /*
   * The pace goes with it. It only ever meant anything to the presentation, and
   * leaving it behind would put `?pace=brisk` on an ordinary gallery page — where
   * it describes nothing, and gets carried into every link copied from there.
   */
  it('drops the pace as well', () => {
    expect(withoutPresent('/events/summercamp', '?present=notebook&pace=fast')).toBe(
      '/events/summercamp',
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

/**
 * Which of the three styles a URL asks for.
 *
 * The same parameter answers two questions — *whether* to present and *how* —
 * and the reason that is safe is entirely in this block: every value the
 * parameter has ever had still presents. `?present=all` and `?present=day-2` are
 * on printed sheets and in kiosk bookmarks around the parish, and the worst
 * outcome for either would be a screen that refuses to start.
 */
describe('presentationStyle', () => {
  it('reads each style back', () => {
    expect(presentationStyle('?present=columns')).toBe('columns');
    expect(presentationStyle('?present=slide')).toBe('slide');
    expect(presentationStyle('?present=notebook')).toBe('notebook');
  });

  /** The two older meanings of the value, and a bare flag. */
  it('gives the old URLs the style they have always shown', () => {
    expect(presentationStyle('?present=all')).toBe('columns');
    expect(presentationStyle('?present=day-2')).toBe('columns');
    expect(presentationStyle('?present')).toBe('columns');
    expect(presentationStyle('?present=')).toBe('columns');
  });

  it('does not care about a missing question mark or other parameters', () => {
    expect(presentationStyle('present=slide')).toBe('slide');
    expect(presentationStyle('?utm_source=bulletin&present=notebook')).toBe('notebook');
  });

  /*
   * Case and whitespace are not corrected, deliberately: `Slide` is a typo, and
   * a typo that silently works is a URL nobody ever fixes. It still presents.
   */
  it('falls back on anything it does not recognise', () => {
    expect(presentationStyle('?present=Slide')).toBe('columns');
    expect(presentationStyle('?present=carousel')).toBe('columns');
    expect(presentationStyle('')).toBe('columns');
  });

  it('does not throw on a malformed escape', () => {
    expect(() => presentationStyle('?present=%zz')).not.toThrow();
  });

  it('reads back every style presentHref can write', () => {
    for (const style of PRESENTATION_STYLES) {
      const [, search = ''] = presentHref('summercamp', ['day-2'], style).split('?');
      expect(isPresenting(search)).toBe(true);
      expect(presentationStyle(search)).toBe(style);
    }
  });
});

/**
 * Switching style on screen.
 *
 * What the switcher hands to `history.replaceState`. It is a URL rewrite rather
 * than a navigation, so getting it wrong does not throw — it leaves a kiosk
 * showing one style and bookmarking another.
 */
describe('withPresentationStyle', () => {
  it('replaces the style and keeps the path', () => {
    expect(withPresentationStyle('/events/summercamp/day-2', '?present=columns', 'notebook')).toBe(
      '/events/summercamp/day-2?present=notebook',
    );
  });

  it('upgrades a URL that carried an old value', () => {
    expect(withPresentationStyle('/events/summercamp', '?present=all', 'slide')).toBe(
      '/events/summercamp?present=slide',
    );
  });

  /** Somebody else's parameters are not the switcher's to drop. */
  it('keeps every other parameter', () => {
    expect(
      withPresentationStyle('/events/summercamp', '?utm_source=bulletin&present=all', 'notebook'),
    ).toBe('/events/summercamp?utm_source=bulletin&present=notebook');
  });

  /*
   * A page that was not being presented gets the flag rather than nothing. Only
   * reachable if the switcher were ever rendered outside the presentation, and
   * "start presenting in that style" is the only sensible answer if it is.
   */
  it('adds the flag when there was none', () => {
    expect(withPresentationStyle('/events/summercamp', '', 'slide')).toBe(
      '/events/summercamp?present=slide',
    );
  });
});

/**
 * How fast it moves.
 *
 * The second thing a kiosk URL carries. Tested for the same reason the style is:
 * it is read out of a string a stranger can type, and the only acceptable failure
 * is "the speed it has always been".
 */
describe('presentationPace', () => {
  it('reads each pace back', () => {
    expect(presentationPace('?present=notebook&pace=slow')).toBe('slow');
    expect(presentationPace('?pace=steady')).toBe('steady');
    expect(presentationPace('?pace=brisk')).toBe('brisk');
    expect(presentationPace('?pace=fast')).toBe('fast');
  });

  it('is steady when the URL says nothing', () => {
    expect(presentationPace('')).toBe('steady');
    expect(presentationPace('?present=columns')).toBe('steady');
    expect(presentationPace('?pace=')).toBe('steady');
    expect(presentationPace('?pace=147')).toBe('steady');
    expect(presentationPace('?pace=Fast')).toBe('steady');
  });

  it('does not throw on a malformed escape', () => {
    expect(() => presentationPace('?pace=%zz')).not.toThrow();
  });

  /**
   * `steady` must be exactly 1, or every screen in the parish changes speed the
   * day this ships — a URL with no `pace` in it has to behave as it did before
   * there was a setting.
   */
  it('leaves steady at exactly one', () => {
    expect(PACE_FACTORS.steady).toBe(1);
  });

  /** Ordered slowest to fastest, which is what the −/+ control steps through. */
  it('is ordered', () => {
    const factors = PRESENTATION_PACES.map((pace) => PACE_FACTORS[pace]);
    expect(factors).toEqual([...factors].sort((a, b) => a - b));
  });
});

describe('withPresentationPace', () => {
  it('sets the pace and keeps the style', () => {
    expect(withPresentationPace('/events/summercamp', '?present=notebook', 'fast')).toBe(
      '/events/summercamp?present=notebook&pace=fast',
    );
  });

  it('replaces a pace that was already there', () => {
    expect(withPresentationPace('/events/summercamp', '?present=slide&pace=slow', 'brisk')).toBe(
      '/events/summercamp?present=slide&pace=brisk',
    );
  });

  /*
   * The default writes *no* parameter. A bookmark carrying `?pace=steady` claims
   * a decision was made where none was, and these URLs get pasted into the
   * bulletin.
   */
  it('drops the parameter at the default', () => {
    expect(withPresentationPace('/events/summercamp', '?present=slide&pace=fast', 'steady')).toBe(
      '/events/summercamp?present=slide',
    );
    expect(withPresentationPace('/events/summercamp', '', 'steady')).toBe('/events/summercamp');
  });

  it('keeps every other parameter', () => {
    expect(
      withPresentationPace('/events/summercamp', '?utm_source=bulletin&present=columns', 'slow'),
    ).toBe('/events/summercamp?utm_source=bulletin&present=columns&pace=slow');
  });

  /** Round trip, over every pace and both directions. */
  it('reads back what it writes', () => {
    for (const pace of PRESENTATION_PACES) {
      const url = withPresentationPace('/events/summercamp', '?present=notebook', pace);
      const [, search = ''] = url.split('?');
      expect(presentationPace(search)).toBe(pace);
      expect(presentationStyle(search)).toBe('notebook');
      expect(isPresenting(search)).toBe(true);
    }
  });
});
