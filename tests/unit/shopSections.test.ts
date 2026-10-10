import { describe, expect, it } from 'vitest';
import {
  childSections,
  orderSections,
  subtreeOf,
  UNSORTED_LABEL,
  countBySection,
  groupProducts,
  moveSection,
  parseSections,
  sectionId,
  type BookstoreSection,
} from '@spsm/shared';

/**
 * How the shop divides itself.
 *
 * The rules that matter here are all about *not losing a book*: a section that
 * gets renamed, deleted, or emptied must never take a product off the shop with
 * it, and none of that is visible from reading the component.
 */

const sections: BookstoreSection[] = [
  { id: 'books', label: 'Books' },
  { id: 'icons', label: 'Icons' },
  { id: 'gifts', label: 'Gifts' },
];

// One category each, the common case; the multi and nested cases are below.
const p = (slug: string, section?: string | null) => ({ slug, categoryIds: section ? [section] : [] });

describe('groupProducts', () => {
  it('groups under the sections, in the parish’s order', () => {
    const groups = groupProducts(
      [p('a', 'gifts'), p('b', 'books'), p('c', 'icons'), p('d', 'books')],
      sections,
    );
    expect(groups.map((g) => g.label)).toEqual(['Books', 'Icons', 'Gifts']);
    expect(groups[0]?.items.map((i) => i.slug)).toEqual(['b', 'd']);
  });

  it('drops a section with nothing in it', () => {
    // A heading with no products under it reads as a loading failure.
    const groups = groupProducts([p('a', 'books')], sections);
    expect(groups.map((g) => g.label)).toEqual(['Books']);
  });

  /*
   * The rule that matters most. Renaming or deleting a heading must not take a
   * book off the shop as a side effect — it lands in the unsorted group, where
   * it is visible and can be re-filed.
   */
  it('keeps a product whose section no longer exists', () => {
    const groups = groupProducts([p('a', 'books'), p('b', 'deleted-section')], sections);
    expect(groups.map((g) => g.label)).toEqual(['Books', UNSORTED_LABEL]);
    expect(groups[1]?.items.map((i) => i.slug)).toEqual(['b']);
  });

  it('keeps an unfiled product, under its own heading', () => {
    const groups = groupProducts([p('a', 'books'), p('b'), p('c', null)], sections);
    expect(groups[1]).toMatchObject({ id: null, label: UNSORTED_LABEL });
    expect(groups[1]?.items.map((i) => i.slug)).toEqual(['b', 'c']);
  });

  /*
   * A shop nobody has sorted must render exactly as it did before sections
   * existed — one list, no heading over the whole catalog.
   */
  it('is one unheaded list when there are no sections', () => {
    const groups = groupProducts([p('a'), p('b')], []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: null, label: '' });
    expect(groups[0]?.items).toHaveLength(2);
  });

  it('is one unheaded list when sections exist but nothing is filed', () => {
    // Every section is empty, so the shop is undivided in practice and should
    // not grow a "More from the bookstore" heading over all of it.
    const groups = groupProducts([p('a'), p('b')], sections);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('');
  });

  it('has nothing to show for an empty catalog', () => {
    expect(groupProducts([], sections)).toEqual([]);
    expect(groupProducts([], [])).toEqual([]);
  });

  it('loses no product, whatever the arrangement', () => {
    const products = [p('a', 'books'), p('b'), p('c', 'gone'), p('d', 'icons'), p('e', null)];
    for (const list of [sections, [], [sections[0]!]]) {
      const seen = groupProducts(products, list).flatMap((g) => g.items.map((i) => i.slug));
      expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    }
  });
});

describe('countBySection', () => {
  it('counts each section and the unfiled, including the empty ones', () => {
    const counts = countBySection([p('a', 'books'), p('b'), p('c', 'gone')], sections);
    expect(counts.get('books')).toBe(1);
    // Zero rather than absent: the admin shows every section, empty or not.
    expect(counts.get('icons')).toBe(0);
    // A dangling id counts as unfiled, matching where it actually renders.
    expect(counts.get(null)).toBe(2);
  });
});

describe('moveSection', () => {
  it('moves one place at a time', () => {
    expect(moveSection(sections, 'icons', -1).map((s) => s.id)).toEqual(['icons', 'books', 'gifts']);
    expect(moveSection(sections, 'icons', 1).map((s) => s.id)).toEqual(['books', 'gifts', 'icons']);
  });

  it('clamps at the ends rather than wrapping', () => {
    // Pressing Up on the first should do nothing, not send it to the bottom.
    expect(moveSection(sections, 'books', -1).map((s) => s.id)).toEqual(['books', 'icons', 'gifts']);
    expect(moveSection(sections, 'gifts', 1).map((s) => s.id)).toEqual(['books', 'icons', 'gifts']);
  });

  it('leaves an unknown id alone', () => {
    expect(moveSection(sections, 'nope', 1)).toEqual(sections);
  });

  it('does not mutate the array it was given', () => {
    const before = [...sections];
    moveSection(sections, 'gifts', -1);
    expect(sections).toEqual(before);
  });
});

describe('sectionId', () => {
  it('makes a readable id from a label', () => {
    expect(sectionId('Books')).toBe('books');
    expect(sectionId('  Icons for the Home  ')).toBe('icons-for-the-home');
    expect(sectionId('Gifts & Cards')).toBe('gifts-cards');
  });

  /*
   * Two Arabic labels would both reduce to "" and silently become one section,
   * merging their products. A generated id is worse to read and correct.
   */
  it('never returns an empty id', () => {
    expect(sectionId('الأيقونات')).toMatch(/^section-/);
    expect(sectionId('—')).toMatch(/^section-/);
    expect(sectionId('')).toMatch(/^section-/);
  });
});

describe('parseSections', () => {
  it('is empty for anything that is not a list', () => {
    for (const bad of [null, undefined, 'books', 42, {}]) {
      expect(parseSections(bad)).toEqual([]);
    }
  });

  it('drops one malformed entry rather than the whole list', () => {
    const parsed = parseSections([
      { id: 'books', label: 'Books' },
      { id: 'broken' },
      { label: 'No id' },
      'nonsense',
      { id: 'gifts', label: 'Gifts' },
    ]);
    expect(parsed.map((s) => s.id)).toEqual(['books', 'gifts']);
  });

  it('drops a duplicate id', () => {
    // Two sections sharing an id means products land in whichever renders
    // first, which reads as products going missing.
    const parsed = parseSections([
      { id: 'books', label: 'Books' },
      { id: 'books', label: 'Books again' },
    ]);
    expect(parsed).toHaveLength(1);
  });
});

describe('categories from Square — several per item, and nested', () => {
  const tree: BookstoreSection[] = [
    { id: 'books', label: 'Books' },
    { id: 'gifts', label: 'Gifts' },
    { id: 'arabic', label: 'Arabic books', parentId: 'books' },
    { id: 'children', label: 'Children books', parentId: 'books' },
  ];

  it('puts an item in every category it is filed in', () => {
    const groups = groupProducts([{ slug: 'mug', categoryIds: ['gifts', 'children'] }], tree);
    expect(groups.map((g) => g.id)).toEqual(['books', 'gifts', 'children']);
  });

  it('counts a subcategory\'s items in its parent too', () => {
    const groups = groupProducts([{ slug: 'a', categoryIds: ['arabic'] }, { slug: 'b', categoryIds: ['books'] }], tree);
    expect(groups.find((g) => g.id === 'books')?.items.map((i) => i.slug)).toEqual(['a', 'b']);
    expect(groups.find((g) => g.id === 'arabic')?.items.map((i) => i.slug)).toEqual(['a']);
  });

  it('knows a category\'s children and its whole subtree', () => {
    expect(childSections(tree, null).map((s) => s.id)).toEqual(['books', 'gifts']);
    expect(childSections(tree, 'books').map((s) => s.id)).toEqual(['arabic', 'children']);
    expect([...subtreeOf(tree, 'books')].sort()).toEqual(['arabic', 'books', 'children']);
  });

  it('keeps the parish\'s order, adds new categories after, and drops removed ones', () => {
    const previous: BookstoreSection[] = [
      { id: 'gifts', label: 'Gifts' },
      { id: 'books', label: 'Old name' },
      { id: 'gone', label: 'Gone' },
    ];
    const fromSquare = [
      { id: 'books', label: 'Books', parentId: null },
      { id: 'gifts', label: 'Gifts', parentId: null },
      { id: 'arabic', label: 'Arabic books', parentId: 'books' },
    ];
    expect(orderSections(fromSquare, previous)).toEqual([
      { id: 'gifts', label: 'Gifts' },
      { id: 'books', label: 'Books' },
      { id: 'arabic', label: 'Arabic books', parentId: 'books' },
    ]);
  });
});
