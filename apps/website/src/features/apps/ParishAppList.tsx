import { appAnchor } from './AppsHero';
import { ParishAppCard } from './ParishAppCard';
import { PARISH_APPS } from './stores';

/**
 * The apps, one card each.
 *
 * A list rather than a grid of tiles: each card is an icon, a name, a sentence
 * and two badges whose height the vendors fix, so three of them side by side
 * would be three tall columns of mostly air.
 *
 * SPSM Connect's card is drawn dark, as the App Clip draws it: it is the app
 * for everyone, and the one the page most wants installed.
 *
 * A server component — nothing here has state, and the badges and icons are
 * static `<img>` tags.
 */
export function ParishAppList() {
  return (
    <ul className="app-cards">
      {PARISH_APPS.map((app, index) => {
        const featured = app.name === 'SPSM Connect';
        return (
          <ParishAppCard
            key={app.name}
            app={app}
            id={appAnchor(app.name)}
            index={index + 1}
            dark={featured}
            eyebrow={featured ? 'New on both stores' : undefined}
            footnote={featured ? 'Free, and from the church’s own developer account.' : undefined}
          />
        );
      })}
    </ul>
  );
}
