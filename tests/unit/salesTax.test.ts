import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKSTORE_CONFIG,
  bankersRound,
  lineTaxCents,
  parseBookstoreConfig,
  salesTaxCents,
  taxLabel,
  taxPercentage,
} from '@spsm/shared';

/**
 * Sales tax — the figure the checkout shows must be the figure Square charges,
 * so this is Square's arithmetic: each taxable line on its own, half to even.
 */
describe('bankersRound', () => {
  it('rounds halves to the even neighbour', () => {
    expect(bankersRound(0.5)).toBe(0);
    expect(bankersRound(1.5)).toBe(2);
    expect(bankersRound(2.5)).toBe(2);
    expect(bankersRound(2.51)).toBe(3);
    expect(bankersRound(2.49)).toBe(2);
  });
});

describe('lineTaxCents', () => {
  it('taxes a line at the rate', () => {
    // $15.00 at 6.25% is exactly 93.75 cents → 94.
    expect(lineTaxCents(1500, 625)).toBe(94);
    // $8.00 at 6.25% is exactly 50 cents.
    expect(lineTaxCents(800, 625)).toBe(50);
  });

  it('takes a half cent to the even cent, as Square does', () => {
    // $2.00 at 6.25% is 12.5 cents → 12, not 13.
    expect(lineTaxCents(200, 625)).toBe(12);
    // $6.00 at 6.25% is 37.5 cents → 38.
    expect(lineTaxCents(600, 625)).toBe(38);
  });

  it('is nothing at no rate or no amount', () => {
    expect(lineTaxCents(1500, 0)).toBe(0);
    expect(lineTaxCents(0, 625)).toBe(0);
  });
});

describe('salesTaxCents', () => {
  it('taxes only the taxable lines, each rounded on its own', () => {
    expect(
      salesTaxCents(
        [
          { amountCents: 1500, taxable: false }, // a Bible
          { amountCents: 200, taxable: true }, // 12.5 → 12
          { amountCents: 600, taxable: true }, // 37.5 → 38
        ],
        625,
      ),
    ).toBe(50);
  });

  it('is nothing for a basket of exempt books', () => {
    expect(salesTaxCents([{ amountCents: 1500, taxable: false }], 625)).toBe(0);
  });
});

describe('labels', () => {
  it('prints the rate the way a person writes it', () => {
    expect(taxPercentage(625)).toBe('6.25');
    expect(taxPercentage(700)).toBe('7');
    expect(taxPercentage(650)).toBe('6.5');
    expect(taxLabel(625)).toBe('Sales tax (6.25%)');
  });
});

describe('taxRateBps in the shop settings', () => {
  it('defaults to Massachusetts and refuses a typo', () => {
    expect(parseBookstoreConfig(null).taxRateBps).toBe(625);
    expect(parseBookstoreConfig({ taxRateBps: 0 }).taxRateBps).toBe(0);
    expect(parseBookstoreConfig({ taxRateBps: 62500 }).taxRateBps).toBe(DEFAULT_BOOKSTORE_CONFIG.taxRateBps);
    expect(parseBookstoreConfig({ taxRateBps: 6.25 }).taxRateBps).toBe(DEFAULT_BOOKSTORE_CONFIG.taxRateBps);
  });
});
