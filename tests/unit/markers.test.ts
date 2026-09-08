import { describe, expect, it } from 'vitest';
import {
  insertLink,
  toggleMarker,
  togglePrefix,
} from '../../apps/website/src/lib/markers';

/**
 * The arithmetic behind the formatting buttons, in both editors.
 *
 * ---------------------------------------------------------------------------
 * `lib/markers` is shared by the About overlay's `RichField` and the event
 * description's `BodyField`, and it is pure string work with no React and no DOM
 * precisely so it can be asserted here. It earns the tests because its failures
 * are *silent*: a stray asterisk left in a paragraph does not throw, it reaches a
 * public page and reads as a typo.
 *
 * These lived in `aboutEditor.test.ts` while there was only one caller.
 * ---------------------------------------------------------------------------
 */

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
/* Headings and bulleted lists                                                */
/* -------------------------------------------------------------------------- */

describe('togglePrefix', () => {
  it('puts the marker at the front of the line the caret is in', () => {
    // Not at the caret. "Make this a heading" is about the line, not the
    // character — a heading written mid-word is not a heading at all.
    const out = togglePrefix('Vespers\nEveryone is welcome', 3, 3, '## ');
    expect(out.text).toBe('## Vespers\nEveryone is welcome');
  });

  it('takes it off again on a second press', () => {
    const on = togglePrefix('Vespers', 0, 0, '## ');
    const off = togglePrefix(on.text, on.start, on.end, '## ');
    expect(off.text).toBe('Vespers');
  });

  it('bullets every line a selection touches', () => {
    const out = togglePrefix('bread\nwine\nincense', 2, 12, '- ');
    expect(out.text).toBe('- bread\n- wine\n- incense');
  });

  it('only unbullets when every line already has one', () => {
    // A partly-bulleted block: the press has to finish the job rather than
    // undo half of it, or the button appears to do nothing.
    const out = togglePrefix('- bread\nwine', 0, 12, '- ');
    expect(out.text).toBe('- - bread\n- wine');
  });

  it('leaves the rest of the document alone', () => {
    const out = togglePrefix('one\ntwo\nthree', 4, 4, '- ');
    expect(out.text).toBe('one\n- two\nthree');
  });

  it('selects the block it changed', () => {
    const out = togglePrefix('one\ntwo', 4, 4, '- ');
    expect(out.text.slice(out.start, out.end)).toBe('- two');
  });
});
