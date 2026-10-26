import Link from 'next/link';
import { StoreBadges } from '@/components/StoreBadges';
import type { ParishApp } from './stores';

/**
 * One app: its icon, its name, what it is for, and where to get it.
 *
 * ---------------------------------------------------------------------------
 * Lifted out of `ParishAppList` for the same reason `StoreBadges` was lifted out
 * of `features/giving/` — two pages need it now. `/apps` stacks three of these,
 * and the band at the bottom of `/giving` shows the Tithe.ly one on its own.
 *
 * The duplicate that would otherwise exist is not cosmetic. It is the rule about
 * the empty icon slot (never invent a mark for an unbuilt app), the rule about
 * the decorative `alt`, and the rule about naming the publisher — three
 * judgements that have to be made the same way on both pages, and would drift
 * the first time only one copy was edited.
 * ---------------------------------------------------------------------------
 */
export function ParishAppCard({
  app,
  /**
   * `li` inside `/apps`'s list, `div` where the app stands alone.
   *
   * `/giving` shows exactly one app, and a one-item `ul` announces itself to a
   * screen reader as a list of one — a structure that promises siblings that do
   * not exist. The card's styling never depended on being a list item.
   */
  as: Tag = 'li',
  /**
   * Replaces `app.what` where the page has already said it better.
   *
   * The stored sentence has to make sense on `/apps`, which means it refers to
   * things by name — Tithe.ly's ends "the same offering as the form on the
   * Giving page", which is a strange thing to read *on* the Giving page, a
   * screen above that very form.
   */
  what,
  /**
   * `app.more` points at the page that says more, which on that page itself is a
   * link back to where you are standing.
   */
  showMore = true,
}: {
  app: ParishApp;
  as?: 'li' | 'div';
  // `| undefined` explicitly rather than just `?`, because the project runs
  // `exactOptionalPropertyTypes` — see the same note on SectionHeading.
  what?: string | undefined;
  showMore?: boolean;
}) {
  const v = app.iconVersion ? `?v=${app.iconVersion}` : '';
  return (
    <Tag className="app-card app-card--iconed">
      {app.icon ? (
        /*
          Decorative, hence the empty alt: the app's name is right beside it and
          a screen reader announcing both says "Taksis Taksis".

          `width`/`height` reserve the square before the file arrives, so the
          text does not jump left as each icon loads. The rounded corner is CSS —
          see `.app-card__icon`, and the note in the pipeline about why it is not
          baked into the pixels.
        */
        <img
          className="app-card__icon"
          src={`/img/${app.icon}-128.webp${v}`}
          srcSet={`/img/${app.icon}-128.webp${v} 2x, /img/${app.icon}-192.webp${v} 3x`}
          alt=""
          aria-hidden="true"
          width={64}
          height={64}
          loading="lazy"
          decoding="async"
        />
      ) : (
        /*
          An empty square where the icon would be, on an app that has none.

          Not a placeholder mark and deliberately not one: inventing artwork for
          an unbuilt app is the single thing on this page that could mislead
          somebody. It is an outline holding the column open, so the cards start
          their names in the same place instead of one sitting 80px to the left
          of the others — which reads as a mistake rather than as meaning.
        */
        <span className="app-card__icon app-card__icon--none" aria-hidden="true" />
      )}

      <div className="app-card__body">
        <h3 className="app-card__name">
          {app.name}
          {/* The publisher, only when it is somebody else. Saying "by the parish"
              on the parish's own site is noise; saying "by Tithe.ly" tells a
              parishioner why the app they install is not called St. Philopater
              Mercurius & St. Mina — which is the difference between finding it in
              a store search and giving up. */}
          {app.by && <span className="app-card__by">by {app.by}</span>}
        </h3>

        <p className="app-card__what">{what ?? app.what}</p>

        {app.unreleased ? (
          <p className="app-card__unreleased">{app.unreleased}</p>
        ) : (
          <StoreBadges ios={app.ios} android={app.android} appName={app.name} />
        )}

        {app.pending && <p className="app-card__unreleased">{app.pending}</p>}

        {showMore && app.more && (
          <p className="app-card__more">
            <Link href={app.more.href}>{app.more.label}</Link>
          </p>
        )}
      </div>
    </Tag>
  );
}
