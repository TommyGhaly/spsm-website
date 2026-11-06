import { PARISH_APPS } from './stores';

/** The anchor each app's card carries, so the hero's icons can link to it. */
export function appAnchor(name: string): string {
  return `app-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * The band `/apps` opens on: all three icons side by side over the church's
 * deep red, each one a link down to its card.
 *
 * The App Clip's Apps screen opens the same way (`AppsHero` in SPSM-Connect's
 * `AppsView.swift`), because the icon is what somebody will be looking for in a
 * store and on their home screen — the shape is learned here, not the name.
 */
export function AppsHero({ headingId }: { headingId: string }) {
  return (
    <div className="apps-hero">
      <p className="apps-hero__eyebrow">On your phone</p>
      <h2 id={headingId} className="apps-hero__title">
        Three apps, one church
      </h2>
      <p className="apps-hero__note">
        One for everyone, one for servants and parents, and one for the offering. Both stores,
        in each case.
      </p>

      <ul className="apps-hero__icons">
        {PARISH_APPS.map((app) => {
          const v = app.iconVersion ? `?v=${app.iconVersion}` : '';
          return (
            <li key={app.name}>
              <a href={`#${appAnchor(app.name)}`}>
                {app.icon ? (
                  <img
                    className="apps-hero__icon"
                    src={`/img/${app.icon}-128.webp${v}`}
                    srcSet={`/img/${app.icon}-128.webp${v} 2x, /img/${app.icon}-192.webp${v} 3x`}
                    alt=""
                    aria-hidden="true"
                    width={60}
                    height={60}
                    decoding="async"
                  />
                ) : (
                  <span className="apps-hero__icon" aria-hidden="true" />
                )}
                <span className="apps-hero__name">{app.name}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
