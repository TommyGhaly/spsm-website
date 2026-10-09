import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKSTORE_CONFIG,
  MAX_PARCEL_OZ,
  basketKey,
  formatWeight,
  parcelFor,
  parseShipping,
  parseWeight,
  quoteCents,
  servicesFor,
  signQuote,
  usableZip,
  verifyQuote,
  type SignedQuote,
} from '@spsm/shared';

/**
 * Live USPS postage — the arithmetic and the signature, without USPS.
 *
 * The signature tests are the ones that protect money: the browser carries the
 * quoted price back to checkout, and checkout charges what the token says. So a
 * token must stop verifying the moment anything in it, or anything it was
 * issued for, is different.
 */

const BOX = DEFAULT_BOOKSTORE_CONFIG.shipping.box;
const hmac = (message: string) => createHmac('sha256', 'test-key').update(message).digest('base64url');

describe('parcelFor', () => {
  const catalog = new Map([
    ['bible', { weightOz: 24, mediaMail: true }],
    ['pascha', { weightOz: 10.5, mediaMail: true }],
    ['icon', { weightOz: 8, mediaMail: false }],
    ['unweighed', { weightOz: null, mediaMail: true }],
  ]);

  it('adds every copy and the box', () => {
    expect(
      parcelFor(
        [
          { slug: 'bible', quantity: 2 },
          { slug: 'pascha', quantity: 1 },
        ],
        catalog,
        BOX,
      ),
    ).toEqual({ weightOz: 24 * 2 + 10.5 + BOX.tareOz, mediaMail: true });
  });

  it('is not Media Mail if any line is not media', () => {
    const parcel = parcelFor(
      [
        { slug: 'bible', quantity: 1 },
        { slug: 'icon', quantity: 1 },
      ],
      catalog,
      BOX,
    );
    expect(parcel?.mediaMail).toBe(false);
  });

  it('refuses a basket with one unweighed line rather than leaving it out', () => {
    expect(
      parcelFor(
        [
          { slug: 'bible', quantity: 1 },
          { slug: 'unweighed', quantity: 1 },
        ],
        catalog,
        BOX,
      ),
    ).toBeNull();
  });

  it('refuses an unknown line, an empty basket, and anything over 70 lb', () => {
    expect(parcelFor([{ slug: 'nope', quantity: 1 }], catalog, BOX)).toBeNull();
    expect(parcelFor([], catalog, BOX)).toBeNull();
    const heavy = new Map([['brick', { weightOz: MAX_PARCEL_OZ, mediaMail: false }]]);
    expect(parcelFor([{ slug: 'brick', quantity: 1 }], heavy, BOX)).toBeNull();
  });
});

describe('servicesFor', () => {
  const settings = DEFAULT_BOOKSTORE_CONFIG.shipping;

  it('offers Media Mail only for an all-media parcel', () => {
    expect(servicesFor(settings, { weightOz: 20, mediaMail: true })).toContain('MEDIA_MAIL');
    expect(servicesFor(settings, { weightOz: 20, mediaMail: false })).not.toContain('MEDIA_MAIL');
  });

  it('offers only what the parish switched on', () => {
    expect(
      servicesFor({ ...settings, services: ['PRIORITY_MAIL'] }, { weightOz: 20, mediaMail: true }),
    ).toEqual(['PRIORITY_MAIL']);
  });
});

describe('quoteCents', () => {
  it('rounds the USPS dollars once and adds handling in cents', () => {
    // 6.85 * 100 is 684.9999… in floating point; the charge must still be 685.
    expect(quoteCents(6.85, 150)).toBe(835);
    expect(quoteCents(4.35, 0)).toBe(435);
  });

  it('refuses a price that is not one', () => {
    expect(quoteCents(0, 150)).toBeNull();
    expect(quoteCents(Number.NaN, 150)).toBeNull();
    expect(quoteCents(-1, 150)).toBeNull();
  });
});

describe('usableZip', () => {
  it('takes five digits from the usual ways of typing a ZIP', () => {
    expect(usableZip('01778')).toBe('01778');
    expect(usableZip(' 01778-1234 ')).toBe('01778');
    expect(usableZip('017781234')).toBe('01778');
  });

  it('refuses the rest', () => {
    for (const bad of ['1778', 'O1778', '01778-12', '', null, 1778]) expect(usableZip(bad)).toBeNull();
  });
});

describe('basketKey', () => {
  it('is the same basket in any order', () => {
    expect(
      basketKey([
        { slug: 'b', quantity: 1 },
        { slug: 'a', quantity: 2 },
      ]),
    ).toBe(
      basketKey([
        { slug: 'a', quantity: 2 },
        { slug: 'b', quantity: 1 },
      ]),
    );
  });

  it('is a different basket with a different quantity', () => {
    expect(basketKey([{ slug: 'a', quantity: 1 }])).not.toBe(basketKey([{ slug: 'a', quantity: 2 }]));
  });
});

describe('signed quotes', () => {
  const now = 1_800_000_000_000;
  const quote: SignedQuote = {
    service: 'USPS_GROUND_ADVANTAGE',
    cents: 835,
    zip: '90210',
    basket: 'bible:1',
    expires: now + 60_000,
  };
  const expect_ = { zip: '90210', basket: 'bible:1', now };

  it('verifies a genuine token and returns what it says', () => {
    expect(verifyQuote(signQuote(quote, hmac), hmac, expect_)).toEqual(quote);
  });

  it('refuses an expired token', () => {
    expect(verifyQuote(signQuote(quote, hmac), hmac, { ...expect_, now: now + 60_001 })).toBeNull();
  });

  it('refuses a token for another ZIP or another basket', () => {
    const token = signQuote(quote, hmac);
    expect(verifyQuote(token, hmac, { ...expect_, zip: '01778' })).toBeNull();
    expect(verifyQuote(token, hmac, { ...expect_, basket: 'bible:5' })).toBeNull();
  });

  it('refuses a token whose price was edited', () => {
    const token = signQuote(quote, hmac);
    const [, signature] = token.split('.');
    const cheaper = signQuote({ ...quote, cents: 1 }, hmac).split('.')[0];
    expect(verifyQuote(`${cheaper}.${signature}`, hmac, expect_)).toBeNull();
  });

  it('refuses a token signed with another key', () => {
    const forged = signQuote(quote, (m) => createHmac('sha256', 'guess').update(m).digest('base64url'));
    expect(verifyQuote(forged, hmac, expect_)).toBeNull();
  });

  it('refuses junk without throwing', () => {
    for (const junk of ['', '.', 'abc', 'abc.def', 42, null, undefined, {}, 'x'.repeat(5000)]) {
      expect(verifyQuote(junk, hmac, expect_)).toBeNull();
    }
  });
});

describe('parseWeight', () => {
  it('reads pounds and returns ounces', () => {
    expect(parseWeight('2')).toBe(32);
    expect(parseWeight('1.5')).toBe(24);
    expect(parseWeight('.5')).toBe(8);
    expect(parseWeight('2.5 lb')).toBe(40);
    expect(parseWeight('31 lbs')).toBe(496);
  });

  it('tells an emptied box from a mistyped one', () => {
    expect(parseWeight('  ')).toBeNull();
    expect(parseWeight('heavy')).toBeUndefined();
    expect(parseWeight('0')).toBeUndefined();
    expect(parseWeight('100')).toBeUndefined();
    // Ounces are no longer a unit the box takes.
    expect(parseWeight('12 oz')).toBeUndefined();
  });
});

describe('formatWeight', () => {
  it('says it the way a person would', () => {
    expect(formatWeight(16)).toBe('1 lb');
    expect(formatWeight(40)).toBe('2.5 lb');
    expect(formatWeight(25)).toBe('1.56 lb');
  });
});

describe('parseShipping', () => {
  it('is flat until the parish turns live postage on', () => {
    expect(parseShipping(undefined).mode).toBe('flat');
    expect(parseShipping({ mode: 'usps' }).mode).toBe('usps');
    expect(parseShipping({ mode: 'ups' }).mode).toBe('flat');
  });

  it('falls each field back on its own', () => {
    const parsed = parseShipping({ originZip: '90210', handlingCents: 999_999, box: { lengthIn: 14 } });
    expect(parsed.originZip).toBe('90210');
    expect(parsed.handlingCents).toBe(DEFAULT_BOOKSTORE_CONFIG.shipping.handlingCents);
    expect(parsed.box).toEqual({ ...DEFAULT_BOOKSTORE_CONFIG.shipping.box, lengthIn: 14 });
  });

  it('keeps only real services, in the canonical order', () => {
    expect(parseShipping({ services: ['MEDIA_MAIL', 'FEDEX', 'USPS_GROUND_ADVANTAGE'] }).services).toEqual([
      'USPS_GROUND_ADVANTAGE',
      'MEDIA_MAIL',
    ]);
    // An emptied list means none — not "all of them".
    expect(parseShipping({ services: [] }).services).toEqual([]);
  });

  it('refuses a ZIP that is not five digits', () => {
    expect(parseShipping({ originZip: '1778' }).originZip).toBe('01778');
  });
});
