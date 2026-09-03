/**
 * The hand-written words for a slot, read off the page.
 *
 * ---------------------------------------------------------------------------
 * The editing column needs them to seed its box — somebody fixing one sentence
 * must not start from an empty field — and there is no string of them anywhere
 * in the process: the coded version is JSX rendered by a server component. Its
 * text in the document is the only source, and it is exactly what the reader is
 * looking at.
 *
 * `Editable` leaves a hidden mirror of its `children` under
 * `[data-about-coded="<slot>"]` for this, so what is read is always the
 * *hand-written* words and never an override that happens to be showing. That
 * distinction was a bug once: reading the visible tree meant an
 * already-overridden slot seeded its box with the override's own words, so
 * reverting left the page and the box disagreeing.
 *
 * ## The paragraphs have to be put back, and forgetting cost a real bug
 *
 * `textContent` on a block of three paragraphs returns their words with nothing
 * between them, so the first thing anybody saw on clicking a band was its prose
 * collapsed into one run — *"…this church in Wayland belongs to it.Copt is not
 * the name of a denomination…"* — and saving that would have flattened three
 * paragraphs into one on a public page.
 *
 * So the block children are read one at a time and joined with a blank line,
 * which is what markdown reads as a paragraph break. A slot whose children are a
 * bare string — every heading — has no block children and falls through to
 * `textContent`.
 *
 * Other formatting is still lost in the transfer: an override is markdown, so a
 * `<Link>` and an `<i lang="ar">` come across as plain words. Nothing is lost
 * until somebody types, because an untouched field writes nothing.
 *
 * Split from the column so it can be tested against a stub rather than a DOM.
 * ---------------------------------------------------------------------------
 */

/** The two things this needs of an element, so a test can supply them. */
export interface MirrorLike {
  textContent: string | null;
  querySelectorAll: (selector: string) => ArrayLike<{ textContent: string | null }>;
}

export function codedTextFromMirror(el: MirrorLike | null): string {
  if (el === null) return '';
  const blocks = el.querySelectorAll(':scope > p, :scope > ul, :scope > ol, :scope > blockquote');
  if (blocks.length === 0) return tidy(el.textContent);
  return Array.from(blocks)
    .map((block) => tidy(block.textContent))
    .filter((line) => line !== '')
    .join('\n\n');
}

/**
 * Collapse the whitespace JSX indentation leaves behind.
 *
 * The source is wrapped at 100 columns, so every paragraph arrives full of
 * newlines and runs of spaces that are not in the sentence.
 */
export function tidy(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function codedTextOf(slot: string): string {
  if (typeof document === 'undefined') return '';
  return codedTextFromMirror(document.querySelector(`[data-about-coded="${slot}"]`));
}
