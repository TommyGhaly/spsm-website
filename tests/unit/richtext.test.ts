import { describe, expect, it } from 'vitest';
import { safeHref, toHtml, toMarkdown } from '../../apps/website/src/lib/richtext';

/**
 * Markdown in and out of the editable description boxes.
 *
 * ---------------------------------------------------------------------------
 * The box shows bold as bold, but what is stored — and what the public page and
 * the mobile app read — is still markdown. So every edit is a round trip, and a
 * round trip that is not exact is a document that **degrades every time somebody
 * opens it**: a stray asterisk one day, a lost link the next, and nobody can say
 * which edit did it because none of them threw.
 *
 * That is what most of this file asserts. `toMarkdown(parse(toHtml(x))) === x`.
 * ---------------------------------------------------------------------------
 */

/**
 * A tiny HTML parser, so these tests need no DOM.
 *
 * Deliberately not jsdom: the point is to pin the *conversion*, and a dependency
 * that brings a whole document implementation to check a paragraph is a slower
 * test with more ways to be wrong. It handles exactly what `toHtml` emits.
 */
interface Parsed {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: Parsed[];
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
}

function text(value: string): Parsed {
  return {
    nodeType: 3,
    nodeName: '#text',
    textContent: value,
    childNodes: [],
    attrs: {},
    getAttribute: () => null,
  };
}

function element(name: string, attrs: Record<string, string>, children: Parsed[]): Parsed {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: children.map((c) => c.textContent ?? '').join(''),
    childNodes: children,
    attrs,
    getAttribute: (key) => attrs[key] ?? null,
  };
}

const VOID = new Set(['BR']);

/** Parses the subset `toHtml` produces into something `toMarkdown` can walk. */
function parse(html: string): Parsed {
  const root = element('div', {}, []);
  const stack: Parsed[] = [root];
  const token = /<\/?([a-zA-Z0-9]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*\/?>|([^<]+)/g;

  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    const [whole, name, rawAttrs, chunk] = match;
    const top = stack[stack.length - 1];
    if (!top) throw new Error('unbalanced html in a test fixture');

    if (chunk !== undefined) {
      top.childNodes.push(text(decode(chunk)));
      continue;
    }
    if (!name) continue;

    if (whole.startsWith('</')) {
      stack.pop();
      continue;
    }

    const attrs: Record<string, string> = {};
    for (const attr of (rawAttrs ?? '').matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      attrs[attr[1] as string] = decode(attr[2] as string);
    }

    const node = element(name, attrs, []);
    top.childNodes.push(node);
    if (!VOID.has(node.nodeName)) stack.push(node);
  }

  return root;
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** What an edit actually does: markdown → box → markdown. */
function roundTrip(markdown: string): string {
  return toMarkdown(parse(toHtml(markdown)));
}

/* -------------------------------------------------------------------------- */
/* Markdown into the box                                                      */
/* -------------------------------------------------------------------------- */

describe('toHtml', () => {
  it('makes emphasis real', () => {
    expect(toHtml('a *word* and a **bold** one')).toBe(
      '<p>a <em>word</em> and a <strong>bold</strong> one</p>',
    );
  });

  it('reads two asterisks as bold, not as italic twice', () => {
    expect(toHtml('**x**')).toBe('<p><strong>x</strong></p>');
  });

  it('makes a heading and a list', () => {
    expect(toHtml('## Come and see\n\n- bread\n- wine')).toBe(
      '<h2>Come and see</h2><ul><li>bread</li><li>wine</li></ul>',
    );
  });

  it('joins the lines of one paragraph', () => {
    // A soft wrap in the source is not a line break on the page, and the box has
    // to agree with `Prose` about that or the text reflows when you open it.
    expect(toHtml('one\ntwo')).toBe('<p>one two</p>');
  });

  it('makes a link', () => {
    expect(toHtml('see [our belief](/about/our-belief)')).toBe(
      '<p>see <a href="/about/our-belief">our belief</a></p>',
    );
  });

  it('escapes HTML in the source', () => {
    // The whole safety argument for `Prose` is that markup in the document is
    // inert. The editable box must not be the hole in that.
    expect(toHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('leaves an escaped asterisk alone', () => {
    // Without the placeholder pass, this pairs with the next real marker and
    // italicises the rest of the sentence.
    expect(toHtml('2 \\* 3 is not *emphasis*')).toBe('<p>2 * 3 is not <em>emphasis</em></p>');
  });

  it('always has one block, so the caret has somewhere to be', () => {
    expect(toHtml('')).toBe('<p><br></p>');
  });
});

/* -------------------------------------------------------------------------- */
/* The box back to markdown                                                   */
/* -------------------------------------------------------------------------- */

describe('toMarkdown', () => {
  it('reads the tags a browser actually writes', () => {
    // `execCommand` emits `b` and `i`, not `strong` and `em`, in every browser
    // the parish uses. Reading only the semantic pair would silently drop every
    // bold the toolbar made.
    expect(toMarkdown(parse('<p><b>bold</b> and <i>italic</i></p>'))).toBe(
      '**bold** and *italic*',
    );
  });

  it('separates blocks with a blank line', () => {
    // Not one newline. `Prose` would render two paragraphs as one.
    expect(toMarkdown(parse('<p>one</p><p>two</p>'))).toBe('one\n\ntwo');
  });

  it('flattens a span a paste left behind', () => {
    expect(toMarkdown(parse('<p><span style="color:red">plain</span></p>'))).toBe('plain');
  });

  it('drops an empty emphasis rather than writing four asterisks', () => {
    expect(toMarkdown(parse('<p>a<strong></strong>b</p>'))).toBe('ab');
  });

  it('escapes an asterisk somebody typed', () => {
    expect(toMarkdown(parse('<p>2 * 3</p>'))).toBe('2 \\* 3');
  });

  it('keeps a link, and drops a dangerous one to its words', () => {
    expect(toMarkdown(parse('<p><a href="/giving">give</a></p>')).trim()).toBe('[give](/giving)');
    expect(toMarkdown(parse('<p><a href="javascript:alert(1)">click</a></p>'))).toBe('click');
  });

  it('ignores an empty paragraph', () => {
    expect(toMarkdown(parse('<p>one</p><p><br></p>'))).toBe('one');
  });
});

/* -------------------------------------------------------------------------- */
/* The property that matters                                                  */
/* -------------------------------------------------------------------------- */

describe('a round trip through the box', () => {
  const documents: [string, string][] = [
    ['a plain sentence', 'Vespers is at seven.'],
    ['emphasis', 'The *Agpeya* is the **book of hours**.'],
    ['a heading and prose', '## Come and see\n\nEgyptian food and tours of the church.'],
    ['a list', '- bread\n- wine\n- incense'],
    ['a link', 'Read [our belief](/about/our-belief) first.'],
    ['emphasis inside a link', 'Read [*our* belief](/about/our-belief).'],
    [
      'the whole toolbar at once',
      '## Come and see\n\nEgyptian food, **live music**, and tours of [the church](/about).\n\n- Friday: vespers\n- Saturday: all day\n\nParking is on site.',
    ],
    ['a literal asterisk', 'A 4 \\* 4 grid.'],
  ];

  for (const [what, markdown] of documents) {
    it(`survives ${what}`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }

  it('is stable on a second pass', () => {
    // The failure this catches is a document that loses a little each time it is
    // opened — which nobody notices until several edits in.
    const once = roundTrip('## Head\n\n*a* and **b**\n\n- one\n- two');
    expect(roundTrip(once)).toBe(once);
  });
});

describe('safeHref', () => {
  it('keeps ordinary links', () => {
    expect(safeHref('https://example.org/a')).toBe('https://example.org/a');
    expect(safeHref('/about/our-belief')).toBe('/about/our-belief');
  });

  it('refuses a script URL', () => {
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('  JavaScript:alert(1)')).toBe('');
  });

  it('refuses one hidden behind whitespace inside the scheme', () => {
    // A browser strips these before resolving, so a naive `startsWith` on the
    // raw string sees an unknown scheme and lets it through.
    expect(safeHref('java\tscript:alert(1)')).toBe('');
    expect(safeHref('java\nscript:alert(1)')).toBe('');
  });

  it('refuses a data URL', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('');
  });
});
