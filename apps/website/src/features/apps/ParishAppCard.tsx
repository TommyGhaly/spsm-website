import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
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
 *
 * Drawn the way the App Clip's Apps screen draws it (`AppsView.swift` in
 * SPSM-Connect): the icon beside an eyebrow and the name, a sentence, a row of
 * feature chips, a hairline, then the badges — with a stripe of the app's tone
 * down the leading edge. `dark` is the clip's SPSM Connect card, where the
 * features are a grid of gold-marked tiles rather than chips.
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
  /** The deep-red card, for the one app the page features. */
  dark = false,
  /** Replaces the eyebrow ("The church's own", "By Tithe.ly"). */
  eyebrow,
  /** A line under the badges, small and soft. */
  footnote,
  /** The card's `id`, so the hero's icons can link down to it. */
  id,
  /** Its place in the stack, which staggers its arrival. */
  index = 0,
}: {
  app: ParishApp;
  as?: 'li' | 'div';
  // `| undefined` explicitly rather than just `?`, because the project runs
  // `exactOptionalPropertyTypes` — see the same note on SectionHeading.
  what?: string | undefined;
  showMore?: boolean;
  dark?: boolean;
  eyebrow?: string | undefined;
  footnote?: string | undefined;
  id?: string | undefined;
  index?: number;
}) {
  const v = app.iconVersion ? `?v=${app.iconVersion}` : '';
  const className = [
    'app-card',
    dark ? 'app-card--dark' : app.tone && `app-card--${app.tone}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={className} id={id} style={{ '--rise-index': index } as CSSProperties}>
      <div className="app-card__head">
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
            somebody.
          */
          <span className="app-card__icon app-card__icon--none" aria-hidden="true" />
        )}

        <div className="app-card__titles">
          {/* The publisher, when it is somebody else, tells a parishioner why the
              app they install is not called St. Philopater Mercurius & St. Mina —
              which is the difference between finding it in a store search and
              giving up. The parish's own say so instead. */}
          <p className="app-card__eyebrow">
            {dark && <span className="app-card__dot" aria-hidden="true" />}
            {eyebrow ?? (app.by ? `By ${app.by}` : 'The church’s own')}
          </p>
          <h3 className="app-card__name">{app.name}</h3>
        </div>
      </div>

      <p className="app-card__what">{what ?? app.what}</p>

      {app.features && app.features.length > 0 && (
        <ul className={dark ? 'app-card__grid' : 'app-card__chips'}>
          {app.features.map((feature) => (
            <li key={feature.label}>
              <Icon name={feature.icon} size={dark ? 18 : 15} />
              {feature.label}
            </li>
          ))}
        </ul>
      )}

      {app.unreleased ? (
        <p className="app-card__unreleased">{app.unreleased}</p>
      ) : (
        /* A hairline above the badges, because the badge is artwork and not this
           card's type: without it the black pill sits directly under the chips
           and reads as one more of them rather than as the thing to tap. */
        <div className="app-card__get">
          <StoreBadges ios={app.ios} android={app.android} appName={app.name} />
        </div>
      )}

      {app.pending && <p className="app-card__unreleased">{app.pending}</p>}

      {footnote && <p className="app-card__footnote">{footnote}</p>}

      {showMore && app.more && (
        <p className="app-card__more">
          <Link href={app.more.href}>{app.more.label}</Link>
        </p>
      )}
    </Tag>
  );
}
