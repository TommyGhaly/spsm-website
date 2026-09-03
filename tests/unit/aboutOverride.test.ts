import { describe, expect, it } from 'vitest';
import {
  ABOUT_SECTION_LIMIT,
  copyOf,
  emptyAboutOverride,
  hasCopy,
  hasPicture,
  isAboutSlug,
  parseAboutOverride,
  pictureOf,
} from '../../packages/shared/dist/schema/about.js';

/**
 * The merge behind the About-pages editor.
 *
 * ---------------------------------------------------------------------------
 * ## Why this file is mostly about emptiness
 *
 * The five About pages are hand-written React. An override replaces a declared
 * slot's words or photograph and falls back to the coded original otherwise —
 * so the entire safety of the feature is the answer to "what counts as an
 * override?". Get it wrong in the generous direction and an empty string blanks
 * a band on a public page.
 *
 * That is not hypothetical here. /bookstore shipped a live swap that believed
 * an empty `imagePaths` and turned all eleven covers into placeholders a second
 * after the page loaded — nothing errored and nothing moved. The same mistake
 * on /about/who-we-are would silently delete a paragraph about the church's
 * history and look deliberate.
 *
 * So `''`, `'   '`, `null` and `undefined` all mean *no override*, and every
 * one of them is asserted separately below. The behaviour staff actually feel:
 * clearing a box puts the original words back, which is the only undo the
 * editor has and does not need another.
 *
 * ## And mostly about garbage
 *
 * `parseAboutOverride` is total, like `resolveSectionLayout`. Nothing in
 * Firestore is guaranteed to hold any of this — the collection is new, a
 * console edit can write anything, and a half-finished section is the ordinary
 * state of one somebody is still writing. Hand it rubbish and it returns a
 * usable override, because the alternative is a page that throws during
 * `next build`.
 * ---------------------------------------------------------------------------
 */

const CODED = 'A word that means Egyptian';
const CODED_PICTURE = { src: '/img/who/coptic-family-1280.webp', alt: 'A hand-coloured print.' };

describe('copyOf — the coded words win unless something was really written', () => {
  it('uses the override when there is one', () => {
    expect(copyOf({ text: 'Copt means Egyptian' }, CODED)).toBe('Copt means Egyptian');
  });

  it.each([
    ['an absent slot', undefined],
    ['a null slot', null],
    ['an empty slot', {}],
    ['an empty string', { text: '' }],
    ['whitespace only', { text: '   ' }],
    ['a newline only', { text: '\n\n' }],
    ['an explicit null', { text: null }],
  ])('falls back to the coded words for %s', (_why, slot) => {
    expect(copyOf(slot as never, CODED)).toBe(CODED);
    expect(hasCopy(slot as never)).toBe(false);
  });

  it('keeps the writer’s own leading space — trimming is the test, not the value', () => {
    // Blank-ness is judged on the trimmed string; what is stored and rendered
    // is what was typed. Trimming the value would silently reformat somebody's
    // markdown.
    expect(copyOf({ text: '  indented' }, CODED)).toBe('  indented');
  });
});

describe('pictureOf — an override with no src is not an override', () => {
  it('uses the chosen photograph', () => {
    const chosen = { src: '/img/home-sanctuary-1600.webp', alt: 'The sanctuary.' };
    expect(pictureOf({ image: chosen }, CODED_PICTURE)).toBe(chosen);
  });

  it.each([
    ['an absent slot', undefined],
    ['no image key', {}],
    ['an explicit null', { image: null }],
    ['an empty src', { image: { src: '' } }],
    ['whitespace src', { image: { src: '  ' } }],
    ['a caption but no picture', { image: { caption: 'Typed before choosing' } }],
  ])('falls back to the coded plate for %s', (_why, slot) => {
    expect(pictureOf(slot as never, CODED_PICTURE)).toBe(CODED_PICTURE);
    expect(hasPicture(slot as never)).toBe(false);
  });

  it('does not treat a half-written image as a picture', () => {
    // The bookstore case, in the shape it takes here: a slot that exists and
    // carries alt text but no file must not blank the coded plate.
    const slot = { image: { alt: 'Someone started describing a photo' } };
    expect(pictureOf(slot as never, CODED_PICTURE)).toBe(CODED_PICTURE);
  });
});

describe('parseAboutOverride — total, whatever it is handed', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nonsense'],
    ['a number', 7],
    ['an array', []],
  ])('returns an empty override for %s', (_why, raw) => {
    expect(parseAboutOverride('who-we-are', raw)).toEqual(emptyAboutOverride('who-we-are'));
  });

  it('falls back to a real slug when handed one that is not', () => {
    // The five are fixed and the rule refuses any other id, so this can only be
    // reached by a caller passing something wrong — and returning a document
    // keyed to a slug that does not exist would be worse than picking one.
    expect(isAboutSlug('our-history')).toBe(false);
    expect(parseAboutOverride('our-history', {}).slug).toBe('who-we-are');
  });

  it('drops a slot that says nothing, rather than storing a tombstone', () => {
    const parsed = parseAboutOverride('who-we-are', {
      slots: {
        'a.h2': { text: 'Kept' },
        'b.h2': { text: '   ' },
        'c.h2': {},
        'd.h2': 'not an object',
        'e.picture': { image: { src: '' } },
      },
    });
    expect(Object.keys(parsed.slots)).toEqual(['a.h2']);
  });

  it('keeps a picture’s dimensions and refuses nonsense ones', () => {
    const parsed = parseAboutOverride('who-we-are', {
      slots: {
        'a.picture': {
          image: { src: '/img/x.webp', width: 1600, height: 0, alt: 'x', caption: '  ' },
        },
      },
    });
    expect(parsed.slots['a.picture']?.image).toEqual({
      src: '/img/x.webp',
      alt: 'x',
      width: 1600,
    });
  });
});

describe('parseAboutOverride — sections', () => {
  it('sorts by order and renumbers nothing', () => {
    const parsed = parseAboutOverride('who-we-are', {
      sections: [
        { id: 'b', kind: 'prose', order: 20, heading: 'Second', body: 'x' },
        { id: 'a', kind: 'prose', order: 10, heading: 'First', body: 'y' },
      ],
    });
    expect(parsed.sections.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('drops a second section sharing an id', () => {
    // Two sections with one id would key the same React element twice, and a
    // reorder would move whichever the reconciler happened to pick.
    const parsed = parseAboutOverride('who-we-are', {
      sections: [
        { id: 'a', kind: 'prose', order: 10, heading: 'Kept', body: 'x' },
        { id: 'a', kind: 'prose', order: 20, heading: 'Dropped', body: 'y' },
      ],
    });
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]?.heading).toBe('Kept');
  });

  it.each([
    ['no id', { kind: 'prose', order: 10, heading: 'x', body: 'y' }],
    ['an unknown kind', { id: 'a', kind: 'carousel', order: 10, heading: 'x' }],
    ['nothing said at all', { id: 'a', kind: 'prose', order: 10, heading: '', body: '' }],
    ['an empty list', { id: 'a', kind: 'list', order: 10, heading: '', items: [] }],
  ])('drops a section with %s', (_why, section) => {
    expect(parseAboutOverride('who-we-are', { sections: [section] }).sections).toEqual([]);
  });

  it('gives a section with no usable order one from its position', () => {
    const parsed = parseAboutOverride('who-we-are', {
      sections: [
        { id: 'a', kind: 'prose', heading: 'First', body: 'x' },
        { id: 'b', kind: 'prose', order: 'soon', heading: 'Second', body: 'y' },
      ],
    });
    expect(parsed.sections.map((s) => s.order)).toEqual([10, 20]);
  });

  it('falls back to plain paper for an unknown ground', () => {
    const parsed = parseAboutOverride('who-we-are', {
      sections: [{ id: 'a', kind: 'prose', order: 10, ground: 'chartreuse', heading: 'x', body: 'y' }],
    });
    expect(parsed.sections[0]?.ground).toBe('plain');
  });

  it('degrades a picture section whose photograph has gone to prose', () => {
    /*
     * Rather than dropping it. The words in it are somebody's writing, and a
     * missing `src` — a file deleted from Storage, a half-finished section — is
     * not a reason to delete a paragraph.
     */
    const parsed = parseAboutOverride('who-we-are', {
      sections: [
        { id: 'a', kind: 'picture', order: 10, heading: 'Kept', body: 'Words', image: { src: '' } },
      ],
    });
    expect(parsed.sections[0]).toMatchObject({ kind: 'prose', heading: 'Kept', body: 'Words' });
  });

  it('drops rows of a list that say nothing, and keeps a half-written one', () => {
    const parsed = parseAboutOverride('who-we-are', {
      sections: [
        {
          id: 'a',
          kind: 'list',
          order: 10,
          heading: 'Dates',
          items: [
            { term: '1968', detail: 'They arrived.' },
            { term: '', detail: '' },
            { term: '1970', detail: '' },
            'not an object',
          ],
        },
      ],
    });
    const section = parsed.sections[0];
    expect(section?.kind).toBe('list');
    expect(section?.kind === 'list' && section.items).toEqual([
      { term: '1968', detail: 'They arrived.' },
      { term: '1970', detail: '' },
    ]);
  });

  it('caps the list, so one document cannot become megabytes', () => {
    const many = Array.from({ length: ABOUT_SECTION_LIMIT + 6 }, (_row, index) => ({
      id: `s${index}`,
      kind: 'prose',
      order: index,
      heading: `Section ${index}`,
      body: 'x',
    }));
    expect(parseAboutOverride('who-we-are', { sections: many }).sections).toHaveLength(
      ABOUT_SECTION_LIMIT,
    );
  });
});
