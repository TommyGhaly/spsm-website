/**
 * Putting emphasis, headings, lists and links into a markdown string, from a
 * selection.
 *
 * ---------------------------------------------------------------------------
 * Kept out of React so it can be tested without a DOM. The index arithmetic *is*
 * the correctness of those buttons — an off-by-one leaves a stray asterisk in a
 * paragraph on a public page — and asserting it is far cheaper than clicking it.
 *
 * ## Why markdown at all, when the buttons exist to hide it
 *
 * Tommy: *"I don't want markdown for italicies make buttons or something to make
 * it easier for users."* And again of the events description: *"I don't want to
 * rely on html coding to get italicies or bold text."* What changed is the
 * interface, not the format. The document keeps markdown because something has to
 * render on the public page, `components/Prose` already renders it safely — React
 * elements, so raw HTML in the source is inert — and the alternative is inventing
 * a rich-text format and a renderer for it in exchange for two kinds of emphasis
 * and a link.
 *
 * So the markers are still in the box. That is honest rather than ideal: a
 * volunteer who has never seen markdown never has to type them, and one who
 * notices them can see what the buttons did.
 *
 * ## Why it is in `lib/` rather than in a feature
 *
 * Two editors format prose with the same gestures — the About overlay's
 * `RichField` and the event description's `BodyField` — and they had two copies.
 * The events one was the older and the wrong one: it never trimmed the selection,
 * so a double-clicked word wrapped to `**Coptic **`, which CommonMark renders as
 * literal asterisks. One tested copy, or the fix lands in one editor and not the
 * other.
 * ---------------------------------------------------------------------------
 */

/** The new text, and where the selection should end up in it. */
export interface Wrapped {
  text: string;
  start: number;
  end: number;
}

/**
 * Put `marker` around the selection, or take it off if it is already there.
 *
 * Toggling matters: without it the button is a one-way trip and the only way
 * back is deleting the asterisks by hand — which is exactly the notation the
 * buttons exist to hide.
 *
 * Two shapes of "already there" have to be handled, and they are what a second
 * press actually produces. After the first press the selection sits *inside* the
 * markers, so pressing again looks at the characters either side of it; a person
 * who selects the words including their markers gets the other case.
 */
export function toggleMarker(
  value: string,
  rawStart: number,
  rawEnd: number,
  marker: string,
): Wrapped {
  const width = marker.length;

  /*
   * Shrink the selection past whitespace at either end before wrapping.
   *
   * **Not tidiness — correctness.** CommonMark will not open emphasis on a
   * marker followed by a space, so `*Coptic *` is not italic at all: it renders
   * as a literal asterisk, a word, a space and another asterisk, on a public
   * page. And a trailing space is exactly what a double-click on a word gives
   * you in most browsers, which makes this the common case rather than an edge
   * one.
   *
   * Caught by a unit test with off-by-one indices, which is a better outcome
   * than it sounds: the wrong indices were what a real selection looks like.
   */
  const [start, end] = trimSelection(value, rawStart, rawEnd);

  /* Markers outside the selection — what the first press leaves behind. */
  if (
    start - width >= 0 &&
    value.slice(start - width, start) === marker &&
    value.slice(end, end + width) === marker
  ) {
    return {
      text: value.slice(0, start - width) + value.slice(start, end) + value.slice(end + width),
      start: start - width,
      end: end - width,
    };
  }

  const selected = value.slice(start, end);

  /* Markers inside the selection. */
  if (
    selected.length > width * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const bare = selected.slice(width, -width);
    return {
      text: value.slice(0, start) + bare + value.slice(end),
      start,
      end: start + bare.length,
    };
  }

  /*
   * Nothing selected: insert the pair and put the caret between them, so typing
   * carries on inside the emphasis. Wrapping nothing would leave `**` sitting in
   * the text, which reads as a bug.
   */
  if (start === end) {
    return {
      text: value.slice(0, start) + marker + marker + value.slice(start),
      start: start + width,
      end: start + width,
    };
  }

  return {
    text: value.slice(0, start) + marker + selected + marker + value.slice(end),
    start: start + width,
    end: end + width,
  };
}

/**
 * Move a selection's ends inward past whitespace.
 *
 * Leaves an empty selection alone: `start === end` is the "insert a pair and put
 * the caret between them" case, and trimming it would be meaningless.
 */
function trimSelection(value: string, start: number, end: number): [number, number] {
  if (start === end) return [start, end];
  let from = start;
  let to = end;
  while (from < to && /\s/.test(value[from] ?? '')) from += 1;
  while (to > from && /\s/.test(value[to - 1] ?? '')) to -= 1;
  // An all-whitespace selection trims to nothing; treat it as a caret so the
  // pair is still inserted rather than wrapping a space.
  return from === to ? [start, start] : [from, to];
}

/**
 * `[selected](href)`, or a placeholder when nothing is selected.
 *
 * The label comes back selected, so the next thing typed replaces it — which is
 * what somebody who just inserted a placeholder wants.
 */
export function insertLink(value: string, start: number, end: number, href: string): Wrapped {
  const label = start === end ? 'this page' : value.slice(start, end);
  const made = `[${label}](${href})`;
  return {
    text: value.slice(0, start) + made + value.slice(end),
    start: start + 1,
    end: start + 1 + label.length,
  };
}

/**
 * Put `marker` at the front of every line the selection touches, or take it off
 * every line if they all already have it.
 *
 * Headings and bulleted lists, which are line things rather than span things: a
 * heading is about the line the caret is in, not the character it is on, so the
 * start is walked back to its line's beginning before anything is written.
 * Selecting four lines and pressing the list button makes four bullets.
 *
 * The whole block comes back selected. Restoring the original selection would
 * mean tracking how many characters were inserted before it on each of several
 * lines; showing what was changed is both simpler and clearer.
 */
export function togglePrefix(value: string, start: number, end: number, marker: string): Wrapped {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const after = value.indexOf('\n', end);
  const lineEnd = after === -1 ? value.length : after;

  const lines = value.slice(lineStart, lineEnd).split('\n');
  const allPrefixed = lines.every((line) => line.startsWith(marker));

  const next = lines
    .map((line) => (allPrefixed ? line.slice(marker.length) : `${marker}${line}`))
    .join('\n');

  return {
    text: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: lineStart,
    end: lineStart + next.length,
  };
}
