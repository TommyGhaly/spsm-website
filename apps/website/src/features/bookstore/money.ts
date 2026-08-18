/**
 * Integer minor units to "$8.00".
 *
 * Cents always, including on whole dollars. This dropped them — "$15" rather
 * than "$15.00" — on the reasoning that a shop price reads cleaner short. It
 * does not: a column of prices where some carry cents and some do not stops
 * being a column, and "$15" reads as a label where "$15.00" reads as a price.
 * Every shop that takes money prints the cents.
 *
 * Its own module rather than living in `Shop.tsx`, because that file is a
 * client component and the homepage preview is a server one. Importing a plain
 * function across that boundary drags the whole client module with it.
 */
export function money(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
