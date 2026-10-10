/**
 * Sales tax on bookstore orders.
 *
 * ---------------------------------------------------------------------------
 * Who decides what, and why the page can show the figure before Square does.
 *
 * Which products are taxable is the parish's field on each product
 * (`Product.taxable`), and the rate is the shop's setting
 * (`BookstoreConfig.taxRateBps`, 625 for Massachusetts' 6.25%). Neither comes
 * from the browser at checkout: `squareCheckout` reads both from Firestore and
 * asks **Square** to apply the tax, as a real tax rather than a fee, so it lands
 * in Square's sales-tax reports where the parish files from.
 *
 * Square applies a LINE_ITEM-scoped percentage tax to each taxable line on its
 * own and rounds each with Bankers' Rounding (half to even). `salesTaxCents`
 * does the same arithmetic, so the line the buyer reads above the Pay button is
 * the figure Square then charges. The checkout Function logs it if the two ever
 * disagree.
 *
 * Delivery is never taxed here. Massachusetts does not tax a delivery charge
 * that is stated separately and avoidable by collecting, and the checkout's
 * shipping is both.
 * ---------------------------------------------------------------------------
 */

/** Half to even, which is what Square's Orders API uses. */
export function bankersRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  // A tolerance, because 0.5 arrives as 0.49999999999 after a multiplication.
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

/** Tax on one line, in cents. `rateBps` is basis points: 625 is 6.25%. */
export function lineTaxCents(lineCents: number, rateBps: number): number {
  if (!(lineCents > 0) || !(rateBps > 0)) return 0;
  return bankersRound((lineCents * rateBps) / 10_000);
}

/** Tax on a basket: each taxable line taxed and rounded on its own, then summed. */
export function salesTaxCents(
  lines: readonly { amountCents: number; taxable: boolean }[],
  rateBps: number,
): number {
  return lines.reduce((sum, line) => sum + (line.taxable ? lineTaxCents(line.amountCents, rateBps) : 0), 0);
}

/** `625` → `"6.25"`, the string Square's `percentage` field wants. */
export function taxPercentage(rateBps: number): string {
  return (rateBps / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
}

/** What the buyer reads: `"Sales tax (6.25%)"`. */
export function taxLabel(rateBps: number): string {
  return `Sales tax (${taxPercentage(rateBps)}%)`;
}

/** Upper bound on the rate, as a guard against a typo (20%). */
export const MAX_TAX_RATE_BPS = 2_000;
