import { describe, expect, it } from 'vitest';
import {
  insertLink,
  toggleMarker,
} from '../../apps/website/src/features/about/markers';
import {
  codedTextFromMirror,
  tidy,
  type MirrorLike,
} from '../../apps/website/src/features/about/codedText';
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  record,
  redo,
  startHistory,
  undo,
} from '../../apps/website/src/features/about/history';
import type { AboutCopy } from '../../apps/website/src/features/about/context';

/**
 * The three pure parts of the About-pages editor.
 *
 * ---------------------------------------------------------------------------
 * All three were split out of components specifically so they could be asserted
 * here, and each earns it for the same reason: they are the parts whose failure
 * is *silent*. A stray asterisk left in a paragraph, three paragraphs collapsed
 * into one, an undo that steps one letter at a time — none of them throws, and
 * all of them reach a public page.
 * ---------------------------------------------------------------------------
 */

/* -------------------------------------------------------------------------- */
/* Italic, bold and links                                                     */
/* -------------------------------------------------------------------------- */

describe('toggleMarker', () => {
  it('wraps the selection', () => {
    const out = toggleMarker('the Coptic Church', 4, 10, '*');
    expect(out.text).toBe('the *Coptic* Church');
    // The words stay selected, so a second press can take it off again.
    expect(out.text.slice(out.start, out.end)).toBe('Coptic');
  });

  it('takes it off when the markers sit either side of the selection', () => {
    // Exactly what a second press sees, after the first left the words selected.
    const first = toggleMarker('the Coptic Church', 4, 10, '*');
    const second = toggleMarker(first.text, first.start, first.end, '*');
    expect(second.text).toBe('the Coptic Church');
    expect(second.text.slice(second.start, second.end)).toBe('Coptic');
  });

  it('drops a trailing space out of the selection', () => {
    /*
     * A double-click on a word includes the space after it in most browsers, and
     * CommonMark will not open emphasis on a marker followed by a space — so
     * `*Coptic *` renders as a literal asterisk on a public page rather than as
     * italic. This is the common case, not an edge one.
     */
    const out = toggleMarker('the Coptic Church', 4, 11, '*');
    expect(out.text).toBe('the *Coptic* Church');
  });

  it('drops a leading space too', () => {
    const out = toggleMarker('the Coptic Church', 3, 10, '*');
    expect(out.text).toBe('the *Coptic* Church');
  });

  it('treats an all-whitespace selection as a caret', () => {
    // Wrapping a space would produce `* *`, which is not emphasis either.
    const out = toggleMarker('a  b', 1, 3, '*');
    expect(out.text).toBe('a**  b');
  });

  it('takes it off when the markers are inside the selection', () => {
    const out = toggleMarker('the *Coptic* Church', 4, 12, '*');
    expect(out.text).toBe('the Coptic Church');
  });

  it('does the same for bold, whose marker is two characters', () => {
    const on = toggleMarker('a word', 2, 6, '**');
    expect(on.text).toBe('a **word**');
    const off = toggleMarker(on.text, on.start, on.end, '**');
    expect(off.text).toBe('a word');
  });

  it('does not read bold as italic', () => {
    // `*` either side of a `**word**` selection is the *inner* pair. Toggling
    // italic here must not silently half-unwrap the bold.
    const out = toggleMarker('a **word**', 2, 10, '*');
    expect(out.text).toBe('a *word*');
  });

  it('inserts an empty pair and puts the caret between them', () => {
    // Wrapping nothing would leave `**` sitting in the paragraph, which reads as
    // a bug rather than as emphasis waiting to be typed into.
    const out = toggleMarker('start end', 5, 5, '*');
    expect(out.text).toBe('start** end');
    expect(out.start).toBe(6);
    expect(out.end).toBe(6);
  });

  it('does not run off the front of the string', () => {
    // `start - width` is negative here. Guarded, because `slice(-1, 0)` is `''`
    // and comparing that to the marker is a coincidence waiting to happen.
    const out = toggleMarker('word', 0, 4, '*');
    expect(out.text).toBe('*word*');
  });
});

describe('insertLink', () => {
  it('links the selection', () => {
    const out = insertLink('read Our Belief for more', 5, 15, '/about/our-belief');
    expect(out.text).toBe('read [Our Belief](/about/our-belief) for more');
    expect(out.text.slice(out.start, out.end)).toBe('Our Belief');
  });

  it('leaves a selected placeholder when nothing was selected', () => {
    const out = insertLink('see ', 4, 4, '/giving');
    expect(out.text).toBe('see [this page](/giving)');
    // Selected, so the next thing typed replaces it.
    expect(out.text.slice(out.start, out.end)).toBe('this page');
  });
});

/* -------------------------------------------------------------------------- */
/* Seeding a box from the page                                                */
/* -------------------------------------------------------------------------- */

/** Enough of an element for `codedTextFromMirror`. */
function mirror(text: string, blocks: string[] = []): MirrorLike {
  return {
    textContent: text,
    querySelectorAll: () => blocks.map((b) => ({ textContent: b })),
  };
}

describe('codedTextFromMirror', () => {
  it('keeps the paragraph breaks — the bug this exists for', () => {
    /*
     * `textContent` alone returned "…belongs to it.Copt is not…", so clicking a
     * band showed its prose as one run and saving would have flattened three
     * paragraphs into one on a public page.
     */
    const out = codedTextFromMirror(
      mirror('ignored', ['First paragraph.', 'Second paragraph.', 'Third.']),
    );
    expect(out).toBe('First paragraph.\n\nSecond paragraph.\n\nThird.');
  });

  it('falls back to the text for a slot with no blocks — every heading', () => {
    expect(codedTextFromMirror(mirror('A word that means Egyptian'))).toBe(
      'A word that means Egyptian',
    );
  });

  it('drops a block that says nothing', () => {
    // Otherwise a stray whitespace node becomes an empty paragraph in the box,
    // and then a blank line in the saved markdown.
    expect(codedTextFromMirror(mirror('x', ['One.', '   ', 'Two.']))).toBe('One.\n\nTwo.');
  });

  it('collapses the whitespace JSX indentation leaves behind', () => {
    // The source is wrapped at 100 columns, so a paragraph arrives full of
    // newlines and runs of spaces that are not in the sentence.
    expect(tidy('\n    a sentence\n    over two lines\n  ')).toBe('a sentence over two lines');
  });

  it('is total', () => {
    expect(codedTextFromMirror(null)).toBe('');
    expect(codedTextFromMirror(mirror(null as unknown as string))).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* Undo and redo                                                              */
/* -------------------------------------------------------------------------- */

function copy(text: string): AboutCopy {
  return { slots: { 'a.h2': { text } }, sections: [] };
}

describe('the history', () => {
  it('starts with nothing to undo or redo', () => {
    const h = startHistory(copy('one'));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('steps back and forward', () => {
    let h = startHistory(copy('one'), 0);
    h = record(h, copy('two'), 'image:a', 1000);
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.present.copy).toEqual(copy('one'));
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(h.present.copy).toEqual(copy('two'));
  });

  it('ignores a change that changed nothing', () => {
    // Returned by identity, so a caller holding this in React state does not
    // re-render on every arrow key inside a textarea.
    const h = startHistory(copy('one'), 0);
    expect(record(h, copy('one'), 'text:a.h2', 10)).toBe(h);
  });

  it('coalesces a run of typing in one field into one step', () => {
    /*
     * The whole reason coalescing exists. Without it ⌘Z after typing a sentence
     * steps back one *letter* at a time and the feature is a joke.
     */
    let h = startHistory(copy(''), 0);
    for (let i = 1; i <= 12; i += 1) {
      h = record(h, copy('x'.repeat(i)), 'text:a.h2', i * 50);
    }
    expect(h.present.copy).toEqual(copy('xxxxxxxxxxxx'));
    h = undo(h);
    expect(h.present.copy).toEqual(copy(''));
    expect(canUndo(h)).toBe(false);
  });

  it('breaks the run after a pause', () => {
    // A pause is a boundary somebody can feel, and the only way to get more than
    // one undo step out of a long stretch of writing in one box.
    let h = startHistory(copy(''), 0);
    h = record(h, copy('one'), 'text:a.h2', 100);
    h = record(h, copy('one two'), 'text:a.h2', 100 + COALESCE_MS + 1);
    h = undo(h);
    expect(h.present.copy).toEqual(copy('one'));
  });

  it('breaks the run when the field changes, even mid-sentence', () => {
    let h = startHistory(copy(''), 0);
    h = record(h, copy('one'), 'text:a.h2', 10);
    h = record(h, copy('one'), 'text:b.body', 20);
    // Same instant, different slot: two steps, not one.
    expect(h.past).toHaveLength(1);
  });

  it('never coalesces anything that is not typing', () => {
    /*
     * A picture, a revert, a removed section: each is one deliberate act and
     * deserves its own step. Removing a section especially — it is the edit with
     * no other way back, because there is no publish step to abandon.
     */
    let h = startHistory(copy('a'), 0);
    h = record(h, copy('b'), 'section-remove:s1', 10);
    h = record(h, copy('c'), 'section-remove:s1', 20);
    expect(h.past).toHaveLength(2);
  });

  it('abandons the redo branch on a new edit', () => {
    let h = startHistory(copy('one'), 0);
    h = record(h, copy('two'), 'image:a', 100);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = record(h, copy('three'), 'image:a', 200);
    expect(canRedo(h)).toBe(false);
  });

  it('caps the stack, dropping the oldest step', () => {
    let h = startHistory(copy('start'), 0);
    for (let i = 0; i < HISTORY_LIMIT + 25; i += 1) {
      h = record(h, copy(`step ${i}`), `image:${i}`, i * 10);
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    // The newest steps survive, which is the direction that matters.
    expect(h.present.copy).toEqual(copy(`step ${HISTORY_LIMIT + 24}`));
  });

  it('does nothing at the ends rather than throwing', () => {
    const h = startHistory(copy('one'));
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});
