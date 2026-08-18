/**
 * The page's `h1`, and nothing on screen.
 *
 * ---------------------------------------------------------------------------
 * This was a banner, then a compact title, and is now invisible.
 *
 * The banner put a raised, bordered band across the top of every page carrying
 * a heading, a sentence, and an ornament, inside roughly 230px of padding. It
 * pushed the actual page below the fold — on /bookstore the products started
 * off-screen — and it was cut for that reason.
 *
 * What survives is the `h1` itself, hidden. A document still needs exactly one:
 * it is the accessible name of the page, what a screen-reader user gets when
 * navigating by heading, and what a search result shows. Deleting it outright
 * would cost all of that and save nothing, because hidden text occupies no
 * space.
 *
 * There is no `lede` any more. Where that sentence carried something a visitor
 * needs — "Times are shown in Eastern Time", "purchases are made in person" —
 * it now sits with the content it qualifies, as a `.note`, rather than in a
 * banner above it. Where it was only scene-setting, it is gone.
 * ---------------------------------------------------------------------------
 */
export function PageHeader({ title }: { title: string }) {
  return <h1 className="visually-hidden">{title}</h1>;
}
