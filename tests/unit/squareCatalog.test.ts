import { describe, it, expect } from 'vitest';
import {
  mapSquareCatalog,
  mirrorDocumentId,
  parseInventoryCounts,
  slugify,
  trackInventoryPatch,
  tracksInventory,
} from '@spsm/shared';

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

  it('reads the SKU off the first variation, and null when there is none', () => {
    const withSku = [
      CATALOG[0],
      {
        type: 'ITEM',
        id: 'ITEM_SKU',
        item_data: {
          name: 'Be Prepared',
          categories: [{ id: 'CAT_BOOK' }],
          variations: [
            {
              id: 'V1',
              // Square keeps whatever was typed, padding included.
              item_variation_data: { sku: ' SPSM-0007 ', price_money: { amount: 800, currency: 'USD' } },
            },
          ],
        },
      },
    ];
    expect(mapSquareCatalog(withSku, 'Bookstore').products[0]?.sku).toBe('SPSM-0007');
    expect(mapSquareCatalog(CATALOG, 'Bookstore').products.every((p) => p.sku === null)).toBe(true);
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

/**
 * Stock, which is three states rather than two.
 *
 * `null` is "Square is not counting these", `0` is sold out and hides the book,
 * and a number is what is on the shelf. The whole risk in this area is the two
 * ways those collapse into each other: an untracked item reading as 0 empties
 * the shop, and a tracked-but-uncounted item reading as null sells copies that
 * are not there.
 */
describe('mapSquareCatalog inventory', () => {
  const TRACKED = [
    { type: 'CATEGORY', id: 'CAT_BOOK', category_data: { name: 'Bookstore' } },
    {
      type: 'ITEM',
      id: 'ITEM_A',
      item_data: {
        name: 'Counted Book',
        categories: [{ id: 'CAT_BOOK' }],
        variations: [
          {
            id: 'VAR_A',
            item_variation_data: {
              price_money: { amount: 1000, currency: 'USD' },
              track_inventory: true,
            },
          },
        ],
      },
    },
    {
      type: 'ITEM',
      id: 'ITEM_B',
      item_data: {
        name: 'Uncounted Book',
        categories: [{ id: 'CAT_BOOK' }],
        variations: [
          {
            id: 'VAR_B',
            item_variation_data: { price_money: { amount: 1000, currency: 'USD' } },
          },
        ],
      },
    },
  ] as const;

  const stock = (objects: readonly unknown[], counts?: ReadonlyMap<string, number>) =>
    new Map(mapSquareCatalog(objects, 'Bookstore', counts).products.map((p) => [p.name, p.stockCount]));

  it('reads a tracked variation from the counts and leaves an untracked one null', () => {
    const counts = stock(TRACKED, new Map([['VAR_A', 4]]));

    expect(counts.get('Counted Book')).toBe(4);
    // Tracking is off on this one, so no count exists and none is invented.
    expect(counts.get('Uncounted Book')).toBe(null);
  });

  /**
   * The distinction the sync depends on. Square returns no count row for a
   * variation that has never had one recorded, so "absent" is only zero when
   * the variation says it is being tracked.
   */
  it('treats a tracked variation with no count row as sold out', () => {
    expect(stock(TRACKED, new Map()).get('Counted Book')).toBe(0);
  });

  /**
   * The failure that would empty the shop. `sync-catalog.mjs` passes `undefined`
   * when the inventory endpoint refuses it — one 403 on INVENTORY_READ must not
   * mark every tracked book sold out.
   */
  it('marks nothing sold out when inventory was never read', () => {
    expect(stock(TRACKED, undefined).get('Counted Book')).toBe(null);
    expect(stock(TRACKED).get('Counted Book')).toBe(null);
  });

  /**
   * The shape the parish's production catalog actually uses, and the one this
   * mapping read past for months.
   *
   * Switching tracking on for a location in the Square dashboard writes
   * `location_overrides[].track_inventory`, and leaves the variation-wide
   * `track_inventory` unset. All ten books in the live Bookstore category carry
   * exactly this: an override saying true, no top-level flag, and real counts
   * of one to three copies. Reading only the top-level flag reported every one
   * of them untracked, so a sold-out book stayed on the shop and stayed
   * buyable — `squareCheckout` refuses a line only at `stockCount === 0`.
   */
  const OVERRIDDEN = [
    { type: 'CATEGORY', id: 'CAT_BOOK', category_data: { name: 'Bookstore' } },
    {
      type: 'ITEM',
      id: 'ITEM_C',
      item_data: {
        name: 'Counted At The Shop',
        categories: [{ id: 'CAT_BOOK' }],
        variations: [
          {
            id: 'VAR_C',
            item_variation_data: {
              price_money: { amount: 600, currency: 'USD' },
              location_overrides: [{ location_id: 'LNEHSYVXMN51F', track_inventory: true }],
            },
          },
        ],
      },
    },
  ] as const;

  it('reads tracking from a location override, not just the variation', () => {
    expect(stock(OVERRIDDEN, new Map([['VAR_C', 2]])).get('Counted At The Shop')).toBe(2);
    // And the same distinction holds: tracked with no row is genuinely nought.
    expect(stock(OVERRIDDEN, new Map()).get('Counted At The Shop')).toBe(0);
  });

  /**
   * An empty `location_overrides` is not tracking. "Holy Bible" is the live
   * example — the one book in the parish's catalog with no override at all, and
   * it must keep coming back null rather than being read as sold out.
   */
  it('leaves a variation with no override untracked', () => {
    const none = [
      OVERRIDDEN[0],
      {
        type: 'ITEM',
        id: 'ITEM_D',
        item_data: {
          name: 'Uncounted Bible',
          categories: [{ id: 'CAT_BOOK' }],
          variations: [
            {
              id: 'VAR_D',
              item_variation_data: {
                price_money: { amount: 1500, currency: 'USD' },
                location_overrides: [],
              },
            },
          ],
        },
      },
    ];

    expect(stock(none, new Map()).get('Uncounted Bible')).toBe(null);
  });
});

describe('parseInventoryCounts', () => {
  it('keeps IN_STOCK and drops the other states', () => {
    const counts = parseInventoryCounts([
      { catalog_object_id: 'VAR_A', state: 'IN_STOCK', quantity: '3' },
      // Summing these in would count every copy already sold as still on the
      // shelf, which is the one arithmetic error available here.
      { catalog_object_id: 'VAR_A', state: 'SOLD', quantity: '11' },
      { catalog_object_id: 'VAR_B', state: 'WASTE', quantity: '2' },
    ]);

    expect(counts.get('VAR_A')).toBe(3);
    expect(counts.has('VAR_B')).toBe(false);
  });

  it('clamps an oversell to zero rather than reading it as plenty', () => {
    const counts = parseInventoryCounts([
      { catalog_object_id: 'VAR_A', state: 'IN_STOCK', quantity: '-1' },
    ]);
    // The shop reads `stockCount === 0` as sold out; -1 would have shown as in
    // stock, which is exactly backwards.
    expect(counts.get('VAR_A')).toBe(0);
  });

  it('ignores rows it cannot use', () => {
    expect(
      parseInventoryCounts([
        null,
        'nonsense',
        { state: 'IN_STOCK', quantity: '4' },
        { catalog_object_id: 'VAR_A', state: 'IN_STOCK', quantity: 'many' },
      ]).size,
    ).toBe(0);
  });
});

/**
 * Renaming a book, which is the pair of behaviours that keeps a retitle from
 * costing the parish a document.
 */
describe('mirrorDocumentId', () => {
  const existing = new Map([['SQ_PASCHA', 'the-holy-pascha']]);

  it('keeps the document a renamed book already lives in', () => {
    // Square now calls it something else, so `mapSquareCatalog` slugified a new
    // name — but the object id is the same book.
    expect(
      mirrorDocumentId({ slug: 'pascha-sermons', squareCatalogObjectId: 'SQ_PASCHA' }, existing),
    ).toBe('the-holy-pascha');
  });

  it('names a book the mirror has never seen after its title', () => {
    expect(
      mirrorDocumentId({ slug: 'come-and-see', squareCatalogObjectId: 'SQ_NEW' }, existing),
    ).toBe('come-and-see');
  });

  it('falls back to the slug when nothing has been mirrored yet', () => {
    expect(
      mirrorDocumentId({ slug: 'holy-bible', squareCatalogObjectId: 'SQ_BIBLE' }, new Map()),
    ).toBe('holy-bible');
  });
});

/**
 * The setter has to write the flag everywhere `tracksInventory` reads it, or
 * "stop counting" is a control that appears to work and does nothing. These
 * assert the round trip rather than the shape.
 */
describe('trackInventoryPatch', () => {
  it('turns tracking off in the location override as well as the top level', () => {
    const variation = {
      price_money: { amount: 600, currency: 'USD' },
      location_overrides: [{ location_id: 'LNEHSYVXMN51F', track_inventory: true }],
    };

    expect(tracksInventory(variation)).toBe(true);
    expect(tracksInventory(trackInventoryPatch(variation, false))).toBe(false);
  });

  it('turns it on for a variation that has never tracked', () => {
    const variation = { price_money: { amount: 600, currency: 'USD' } };

    expect(tracksInventory(variation)).toBe(false);
    expect(tracksInventory(trackInventoryPatch(variation, true))).toBe(true);
  });

  /* Overrides carry per-location price and sellability too, and this function
     has no business dropping them to set one boolean. */
  it('leaves the rest of an override alone', () => {
    const patched = trackInventoryPatch(
      {
        location_overrides: [
          { location_id: 'L1', track_inventory: false, price_money: { amount: 500, currency: 'USD' } },
        ],
      },
      true,
    );

    expect(patched['location_overrides']).toEqual([
      { location_id: 'L1', track_inventory: true, price_money: { amount: 500, currency: 'USD' } },
    ]);
  });

  it('does not invent an overrides array where there was none', () => {
    expect(trackInventoryPatch({ price_money: { amount: 100, currency: 'USD' } }, true)).toEqual({
      price_money: { amount: 100, currency: 'USD' },
      track_inventory: true,
    });
  });
});
