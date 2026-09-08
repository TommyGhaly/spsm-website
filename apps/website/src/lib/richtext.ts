/**
 * Markdown in and out of the HTML a `contenteditable` box holds.
 *
 * ---------------------------------------------------------------------------
 * ## Why this exists
 *
 * The description fields used to be textareas with formatting buttons over them,
 * so pressing **B** wrote `**word**` and you read the asterisks while you typed.
 * Tommy: *"in the description itself don't show the html text, show what it looks
 * like in the page itself — so don't use `**`, just make it italicised in place."*
 *
 * Which is the right call and was the option not taken the first time round. The
 * markers were defensible — they are what is stored, and a volunteer who notices
 * them can see what the buttons did — but nobody reads a paragraph better for
 * having punctuation in it that is not punctuation.
 *
 * ## Markdown is still what is stored
 *
 * Nothing downstream changes. `components/Prose` renders the same string on the
 * public page, the static export bakes the same string, and the mobile app will
 * read the same string. What changed is only what the *editor* shows. That is
 * also why this file is a pair of pure functions rather than a rich-text format:
 * the document on disk is markdown, and the box is a view of it.
 *
 * ## The subset is the toolbar, and nothing else
 *
 * Bold, italic, headings, bulleted lists, links, paragraphs. Deliberately no
 * tables, images, code or nesting — every one of those is a shape the buttons
 * cannot make, so the only way one could arrive is a paste, and a paste that
 * smuggles in structure nobody can edit again is the exact failure a
 * `contenteditable` is famous for. Anything outside the subset is flattened to
 * its text on the way in.
 *
 * Round-tripping is the property that matters and the one the tests assert:
 * `toMarkdown(toHtml(x))` has to equal `x` for anything the buttons can produce,
 * or a document degrades a little every time somebody opens it.
 * ---------------------------------------------------------------------------
 */

/** Escapes the four characters that would otherwise be read as HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A URL safe to put in an `href`.
 *
 * `javascript:` and `data:` are refused. The parish's own staff are the only
 * people who can reach these fields, but a link is the one thing here that gets
 * *clicked by a visitor*, and "our staff are trustworthy" is not a security
 * model — a compromised account should not be able to script a page every
 * parishioner loads. Anything refused becomes an empty href rather than
 * disappearing, so the words keep their link and somebody can see it is wrong.
 */
export function safeHref(href: string): string {
  const trimmed = href.trim();
  /*
   * Whitespace and control characters stripped before the check, never after:
   * `java\tscript:alert(1)` is a live URL in a browser and an unrecognised
   * scheme to a naive `startsWith`.
   */
  // eslint-disable-next-line no-control-regex
  const bare = trimmed.replace(/[\s\u0000-\u001F]/g, '').toLowerCase();
  if (bare.startsWith('javascript:') || bare.startsWith('data:') || bare.startsWith('vbscript:')) {
    return '';
  }
  return trimmed;
}

/**
 * The inline marks, innermost last.
 *
 * Links first: a label can contain emphasis, and running emphasis first would
 * leave `**` inside a URL alone but break the label's own markers apart from the
 * brackets they belong to.
 */
function inlineToHtml(text: string): string {
  /*
   * Escaped markers are lifted out before anything else looks at the string.
   *
   * A description that mentions a literal asterisk is stored as `\\*`, and
   * without this the emphasis rules below happily pair it with the next real one
   * and italicise half a sentence. They come back as themselves at the end, by
   * which point no rule can mistake them for punctuation.
   */
  const held: string[] = [];
  let out = escapeHtml(text).replace(/\\([*[\]\\])/g, (_whole, char: string) => {
    held.push(char);
    return `\u0000${held.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_whole, label: string, href: string) => {
    const safe = safeHref(href);
    return `<a href="${escapeHtml(safe)}">${label}</a>`;
  });

  // Bold before italic: `**x**` would otherwise match the italic rule twice and
  // come out as `<em><em>x</em></em>`.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_whole, index: string) => held[Number(index)] ?? '');
}

/**
 * Markdown to the HTML the editable box shows.
 *
 * Block-level, line by line. A run of `- ` lines becomes one list; a blank line
 * ends a paragraph; everything else is a paragraph of its own.
 */
export function toHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inlineToHtml(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    out.push(`<ul>${list.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      // Always `h2`. The page owns the `h1`, and a field that can emit `h3` is a
      // field that can emit a document outline nobody asked it for.
      out.push(`<h2>${inlineToHtml(heading[1] ?? '')}</h2>`);
      continue;
    }
    if (bullet) {
      flushParagraph();
      list.push(bullet[1] ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  // An empty document still needs one block, or the caret has nowhere to be and
  // the first keystroke lands in a bare text node the serialiser cannot place.
  return out.join('') || '<p><br></p>';
}

/** The DOM shapes this reads. Kept structural so the tests need no browser. */
export interface NodeLike {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<NodeLike>;
  getAttribute?: (name: string) => string | null;
}

const TEXT_NODE = 3;

/** `*`, `**` and `[]()` are structural in markdown, so literal ones must escape. */
function escapeMarkdown(text: string): string {
  return text.replace(/([*[\]\\])/g, '\\$1');
}

/** The inline content of one block, as markdown. */
function inlineToMarkdown(node: NodeLike): string {
  let out = '';

  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (!child) continue;

    if (child.nodeType === TEXT_NODE) {
      out += escapeMarkdown(child.textContent ?? '');
      continue;
    }

    const name = child.nodeName.toUpperCase();
    const inner = inlineToMarkdown(child);

    if (name === 'BR') {
      out += '\n';
    } else if (name === 'STRONG' || name === 'B') {
      // An empty pair would be `****`, which reads as four asterisks on the page.
      out += inner.trim() === '' ? inner : `**${inner}**`;
    } else if (name === 'EM' || name === 'I') {
      out += inner.trim() === '' ? inner : `*${inner}*`;
    } else if (name === 'A') {
      const href = safeHref(child.getAttribute?.('href') ?? '');
      out += href === '' ? inner : `[${inner}](${href})`;
    } else {
      // Anything else — a `span` a paste left behind, a `font`, a `div` inside a
      // paragraph — contributes its text and nothing else.
      out += inner;
    }
  }

  return out;
}

/**
 * The editable box's HTML back to markdown.
 *
 * Blocks are separated by a blank line, which is what makes the result parse the
 * same way when it comes back through `toHtml` — and the same way `Prose` will
 * render it.
 */
export function toMarkdown(root: NodeLike): string {
  const blocks: string[] = [];

  const walk = (node: NodeLike) => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (!child) continue;

      const name = child.nodeName.toUpperCase();

      if (name === 'UL' || name === 'OL') {
        const items: string[] = [];
        for (let j = 0; j < child.childNodes.length; j += 1) {
          const item = child.childNodes[j];
          if (!item || item.nodeName.toUpperCase() !== 'LI') continue;
          items.push(`- ${inlineToMarkdown(item).trim()}`);
        }
        if (items.length > 0) blocks.push(items.join('\n'));
        continue;
      }

      if (/^H[1-6]$/.test(name)) {
        const text = inlineToMarkdown(child).trim();
        if (text !== '') blocks.push(`## ${text}`);
        continue;
      }

      if (name === 'P' || name === 'DIV') {
        const text = inlineToMarkdown(child).replace(/\s+$/, '');
        if (text.trim() !== '') blocks.push(text);
        continue;
      }

      if (child.nodeType === TEXT_NODE) {
        const text = escapeMarkdown(child.textContent ?? '').trim();
        if (text !== '') blocks.push(text);
        continue;
      }

      if (name === 'BR') continue;

      // An inline element sitting directly in the root — what a browser leaves
      // after some paste-and-delete sequences. Treat it as its own paragraph
      // rather than dropping it.
      const loose = inlineToMarkdown({ ...child, childNodes: [child] } as NodeLike).trim();
      if (loose !== '') blocks.push(loose);
      else walk(child);
    }
  };

  walk(root);
  return blocks.join('\n\n');
}
