import { describe, it, expect } from 'vitest';
import {
  CAMP_FORM_SLUG,
  DEFAULT_FORMS_PAGE_CONFIG,
  parseFormsPageConfig,
} from '../../packages/shared/src/schema/config.js';

/**
 * `config/forms` — the hub's two settings: where a tap lands, and where the
 * summer camp card sits.
 *
 * Both are read by public pages that have no way to complain. A missing or
 * malformed `nfcFormSlug` has to come out as the vehicle registration, because
 * that is what the tag in the car park has always opened and a parish that has
 * never touched this document must keep getting it. A malformed `campOrder` has
 * to come out as a number, because it is sorted against the forms' own `order`
 * and `undefined` in that comparison shuffles the whole page.
 */

describe('parseFormsPageConfig', () => {
  it('reads a slug and a position', () => {
    expect(parseFormsPageConfig({ nfcFormSlug: CAMP_FORM_SLUG, campOrder: 15 })).toEqual({
      nfcFormSlug: CAMP_FORM_SLUG,
      campOrder: 15,
    });
  });

  it('trims what somebody typed in the console', () => {
    expect(parseFormsPageConfig({ nfcFormSlug: '  summer-camp  ' }).nfcFormSlug).toBe(
      CAMP_FORM_SLUG,
    );
  });

  /*
   * The important one. Every shape of "nobody has set this" is the vehicle
   * registration — not null, not the first form in the collection — so that no
   * reader has to decide what an unset tag destination means.
   */
  it('falls back to the vehicle registration for every shape of nothing', () => {
    for (const raw of [
      undefined,
      null,
      {},
      { nfcFormSlug: null },
      { nfcFormSlug: '' },
      { nfcFormSlug: '   ' },
      { nfcFormSlug: 42 },
      { nfcFormSlug: ['summer-camp'] },
    ]) {
      expect(parseFormsPageConfig(raw).nfcFormSlug).toBe('vehicle-registration');
    }
  });

  it('keeps the camp last when no one has moved it', () => {
    for (const raw of [{}, { campOrder: null }, { campOrder: 'third' }, { campOrder: NaN }]) {
      expect(parseFormsPageConfig(raw).campOrder).toBe(
        DEFAULT_FORMS_PAGE_CONFIG.campOrder,
      );
    }
  });

  /*
   * A position is compared against the forms' `order`, which the drawer writes
   * as 10, 20, 30 … A negative or enormous number would pin the card to one end
   * of the hub with no way to drag it back from the other, so both ends are
   * clamped and a fraction is rounded rather than carried.
   */
  it('bounds a position that could not have come from the drawer', () => {
    expect(parseFormsPageConfig({ campOrder: -40 }).campOrder).toBe(0);
    expect(parseFormsPageConfig({ campOrder: 10 ** 9 }).campOrder).toBe(100_000);
    expect(parseFormsPageConfig({ campOrder: 12.6 }).campOrder).toBe(13);
  });

  it('matches the committed default when the document is empty', () => {
    expect(parseFormsPageConfig({})).toEqual(DEFAULT_FORMS_PAGE_CONFIG);
  });
});
