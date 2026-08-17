import { describe, it, expect } from 'vitest';
import { mapSquareCatalog, slugify } from '@spsm/shared';

/**
 * Mapping Square's catalog into bookstore products.
 *
 * The fixture is trimmed from the parish's real production catalog, read on
 * 2026-08-17, and it is real on purpose: every awkward case below is in the
 * live data rather than invented. That catalog is a *festival* catalog — 68
 * items, of which 57 are food and 11 are books — so the single most important
 * behaviour here is that a bookstore page never lists a Lamb Dinner.
 */
const CATALOG = [
  { type: 'CATEGORY', id: 'CAT_BOOK', category_data: { name: 'Bookstore' } },
  { type: 'CATEGORY', id: 'CAT_FOOD', category_data: { name: 'Festival Food' } },
  { type: 'IMAGE', id: 'IMG_BIBLE', image_data: { url: 'https://items.sq/bible.jpg' } },
  { type: 'IMAGE', id: 'IMG_PASCHA', image_data: { url: 'https://items.sq/pascha.jpg' } },
  {
    type: 'ITEM',
    id: 'ITEM_BIBLE',
    item_data: {
      name: 'Holy Bible',
      categories: [{ id: 'CAT_BOOK' }],
      image_ids: ['IMG_BIBLE'],
      variations: [
        {
          id: 'VAR_BIBLE',
          item_variation_data: { price_money: { amount: 1500, currency: 'USD' } },
        },
      ],
    },
  },
  {
    type: 'ITEM',
    id: 'ITEM_PASCHA',
    item_data: {
      // Trailing space, as in the real catalog.
      name: 'The Holy Pascha ',
      description: 'The services of Holy Week.',
      categories: [{ id: 'CAT_BOOK' }],
      image_ids: ['IMG_PASCHA'],
      variations: [
        {
          id: 'VAR_PASCHA',
          item_variation_data: { price_money: { amount: 1500, currency: 'USD' } },
        },
      ],
    },
  },
  {
    type: 'ITEM',
    id: 'ITEM_LAMB',
    item_data: {
      name: 'Lamb Dinner',
      categories: [{ id: 'CAT_FOOD' }],
      variations: [
        {
          id: 'VAR_LAMB',
          item_variation_data: { price_money: { amount: 1699, currency: 'USD' } },
        },
      ],
    },
  },
] as const;

describe('mapSquareCatalog', () => {
  it('maps the books and nothing else', () => {
    const { products } = mapSquareCatalog(CATALOG, 'Bookstore');

    expect(products.map((p) => p.name)).toEqual(['Holy Bible', 'The Holy Pascha']);
    // The whole reason the category filter exists.
    expect(products.some((p) => p.name === 'Lamb Dinner')).toBe(false);
  });

  it('carries the fields a mirrored row needs', () => {
    const [bible] = mapSquareCatalog(CATALOG, 'Bookstore').products;

    expect(bible).toMatchObject({
      slug: 'holy-bible',
      name: 'Holy Bible',
      description: '',
      price: { amount: 1500, currency: 'USD' },
      imagePaths: ['https://items.sq/bible.jpg'],
      squareCatalogObjectId: 'ITEM_BIBLE',
      squareVariationId: 'VAR_BIBLE',
      category: 'Bookstore',
      // Not 0: nothing in this catalog tracks inventory, and 0 would mean sold
      // out and hide the entire shop.
      stockCount: null,
    });
  });

  it('trims the trailing spaces the real catalog has', () => {
    const pascha = mapSquareCatalog(CATALOG, 'Bookstore').products[1];
    expect(pascha?.name).toBe('The Holy Pascha');
    expect(pascha?.slug).toBe('the-holy-pascha');
  });

  /**
   * The dangerous failure. If a category is renamed in Square and this matched
   * loosely — or fell back to "everything" — the parish bookstore page would
   * publish 57 food items.
   */
  it('yields nothing when the category does not exist, never everything', () => {
    expect(mapSquareCatalog(CATALOG, 'Books').products).toEqual([]);
    expect(mapSquareCatalog(CATALOG, '').products).toEqual([]);
    expect(mapSquareCatalog([], 'Bookstore').products).toEqual([]);
  });

  it('matches the category name case-insensitively', () => {
    expect(mapSquareCatalog(CATALOG, 'bookstore').products).toHaveLength(2);
    expect(mapSquareCatalog(CATALOG, '  BOOKSTORE  ').products).toHaveLength(2);
  });

  it('reads the older category_id shape as well as categories[]', () => {
    const legacy = [
      CATALOG[0],
      {
        type: 'ITEM',
        id: 'ITEM_OLD',
        item_data: {
          name: 'Come and See',
          category_id: 'CAT_BOOK',
          variations: [
            { id: 'V', item_variation_data: { price_money: { amount: 800, currency: 'USD' } } },
          ],
        },
      },
    ];
    expect(mapSquareCatalog(legacy, 'Bookstore').products).toHaveLength(1);
  });

  describe('the awkward rows', () => {
    const withItem = (item: unknown) => [CATALOG[0], item];

    it('skips an archived item and says so', () => {
      const { products, skipped } = mapSquareCatalog(
        withItem({
          type: 'ITEM',
          id: 'ITEM_OLD',
          item_data: {
            name: 'Retired Title',
            categories: [{ id: 'CAT_BOOK' }],
            is_archived: true,
            variations: [
              { id: 'V', item_variation_data: { price_money: { amount: 800, currency: 'USD' } } },
            ],
          },
        }),
        'Bookstore',
      );
      expect(products).toEqual([]);
      expect(skipped).toEqual([{ id: 'ITEM_OLD', name: 'Retired Title', reason: 'archived' }]);
    });

    it('skips an item with no price rather than showing $0.00', () => {
      const { products, skipped } = mapSquareCatalog(
        withItem({
          type: 'ITEM',
          id: 'ITEM_NP',
          item_data: { name: 'Unpriced', categories: [{ id: 'CAT_BOOK' }], variations: [] },
        }),
        'Bookstore',
      );
      expect(products).toEqual([]);
      expect(skipped[0]).toMatchObject({ reason: 'no-price' });
    });

    it('refuses a non-USD price rather than relabelling it', () => {
      const { skipped } = mapSquareCatalog(
        withItem({
          type: 'ITEM',
          id: 'ITEM_EUR',
          item_data: {
            name: 'Euro Book',
            categories: [{ id: 'CAT_BOOK' }],
            variations: [
              { id: 'V', item_variation_data: { price_money: { amount: 800, currency: 'EUR' } } },
            ],
          },
        }),
        'Bookstore',
      );
      expect(skipped[0]).toMatchObject({ reason: 'no-price' });
    });

    it('allows a genuinely free item', () => {
      const { products } = mapSquareCatalog(
        withItem({
          type: 'ITEM',
          id: 'ITEM_FREE',
          item_data: {
            name: 'Free Tract',
            categories: [{ id: 'CAT_BOOK' }],
            variations: [
              { id: 'V', item_variation_data: { price_money: { amount: 0, currency: 'USD' } } },
            ],
          },
        }),
        'Bookstore',
      );
      expect(products[0]?.price).toEqual({ amount: 0, currency: 'USD' });
    });

    /**
     * "The Bridegroom: Pascha Sermons" appears twice in the live catalog. Only
     * one copy is in the Bookstore category today, so this does not bite yet —
     * but slugs are Firestore document ids, and two rows sharing one id means
     * the second sync overwrites the first and a book silently vanishes.
     */
    it('suffixes a duplicate name instead of colliding on the document id', () => {
      const twice = [
        CATALOG[0],
        ...['A', 'B'].map((suffix) => ({
          type: 'ITEM',
          id: `ITEM_${suffix}`,
          item_data: {
            name: 'The Bridegroom: Pascha Sermons',
            categories: [{ id: 'CAT_BOOK' }],
            variations: [
              { id: `V${suffix}`, item_variation_data: { price_money: { amount: 800, currency: 'USD' } } },
            ],
          },
        })),
      ];
      const slugs = mapSquareCatalog(twice, 'Bookstore').products.map((p) => p.slug);
      expect(slugs).toEqual(['the-bridegroom-pascha-sermons', 'the-bridegroom-pascha-sermons-2']);
      expect(new Set(slugs).size).toBe(2);
    });

    it('ignores an image id that has no IMAGE object', () => {
      const { products } = mapSquareCatalog(
        withItem({
          type: 'ITEM',
          id: 'ITEM_GHOST',
          item_data: {
            name: 'Ghost Image',
            categories: [{ id: 'CAT_BOOK' }],
            image_ids: ['IMG_MISSING'],
            variations: [
              { id: 'V', item_variation_data: { price_money: { amount: 800, currency: 'USD' } } },
            ],
          },
        }),
        'Bookstore',
      );
      expect(products[0]?.imagePaths).toEqual([]);
    });

    it('survives junk objects without throwing', () => {
      expect(() => mapSquareCatalog([null, 42, 'x', {}, { type: 'ITEM' }], 'Bookstore')).not.toThrow();
    });
  });

  it('returns products in a stable order regardless of input order', () => {
    const forwards = mapSquareCatalog(CATALOG, 'Bookstore').products.map((p) => p.slug);
    const backwards = mapSquareCatalog([...CATALOG].reverse(), 'Bookstore').products.map((p) => p.slug);
    expect(forwards).toEqual(backwards);
  });
});

describe('slugify', () => {
  it('produces the slugs the real titles produce', () => {
    expect(slugify('The Holy Pascha ')).toBe('the-holy-pascha');
    expect(slugify('The Crucified Jesus - by Manasseh Youhanna (Paperback)')).toBe(
      'the-crucified-jesus-by-manasseh-youhanna-paperback',
    );
    expect(slugify('The Bridegroom: Pascha Sermons')).toBe('the-bridegroom-pascha-sermons');
  });

  it('keeps apostrophes out of the middle of a word', () => {
    expect(slugify("St. Mary's Book")).toBe('st-marys-book');
    expect(slugify('St. Mary’s Book')).toBe('st-marys-book');
  });

  it('strips accents rather than turning them into hyphens', () => {
    expect(slugify('Théotokos')).toBe('theotokos');
  });

  it('never returns an empty id', () => {
    // An empty string would collide with every other unslugifiable name at the
    // document-id level, which is a data-loss bug rather than a cosmetic one.
    expect(slugify('!!!')).toBe('item');
    expect(slugify('')).toBe('item');
  });

  it('is stable, because it is the document id', () => {
    expect(slugify('Holy Bible')).toBe(slugify('Holy Bible'));
  });
});
