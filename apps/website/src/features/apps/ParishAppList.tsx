import { ParishAppCard } from './ParishAppCard';
import { PARISH_APPS } from './stores';

/**
 * The apps, one card each.
 *
 * A list rather than a grid of tiles: each card is an icon, a name, a sentence
 * and two badges whose height the vendors fix, so three of them side by side
 * would be three tall columns of mostly air. Stacked, each one reads as a
 * paragraph with a button in it, which is what it is.
 *
 * The card itself is `ParishAppCard`, because `/giving` shows the Tithe.ly one
 * on its own — see the note there.
 *
 * A server component — nothing here has state, and the badges and icons are
 * static `<img>` tags. It costs the page no JavaScript at all, which is worth
 * saying because the last two pages that grew a list of links grew a client
 * component with it.
 */
export function ParishAppList() {
  return (
    <ul className="app-cards">
      {PARISH_APPS.map((app) => (
        <ParishAppCard key={app.name} app={app} />
      ))}
    </ul>
  );
}
