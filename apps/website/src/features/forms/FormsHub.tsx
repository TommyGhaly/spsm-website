'use client';

import { Suspense, lazy, useEffect, useState } from 'react';
import type { FormDefinition } from '@spsm/shared';
import { Icon, isIconName } from '@/components/Icon';
import { watchPublishedForms } from './data';
import { useFormsAdmin } from './useFormsAdmin';

/**
 * The list of forms, live from Firestore.
 *
 * ---------------------------------------------------------------------------
 * This replaces a hardcoded array, and the reasoning that defended it.
 *
 * The old page said: "`FORMS` is a hardcoded list rather than a Firestore read
 * for the reason NAV in layout.tsx is: a bad read would empty the page, and the
 * set changes about as often as the navigation does."
 *
 * The first half was a fair objection and is answered below rather than ignored
 * — `FALLBACK` is rendered whenever the read fails or has not arrived, so a
 * broken connection shows the forms that existed at build time instead of an
 * empty page. The second half is simply no longer true: the whole point of this
 * work is that the parish adds forms without a deploy, so the set now changes
 * far more often than the navigation does, and a hardcoded list would mean every
 * new form needs somebody with deploy rights.
 * ---------------------------------------------------------------------------
 */

const FormsAdmin = lazy(() =>
  import('./admin/FormsAdmin').then((module) => ({ default: module.FormsAdmin })),
);

/**
 * What the page shows before Firestore answers, and if it never does.
 *
 * Deliberately the two NFC destinations rather than a spinner. Both have been
 * on cards in the pews and tags in the car park for months; a hub that shows
 * nothing at all while it waits is a worse answer than one that shows the two
 * forms most people arriving here are looking for.
 */
const FALLBACK: readonly HubCard[] = [
  {
    slug: 'prayer',
    href: '/prayer',
    title: 'Prayer requests',
    blurb:
      'Ask the clergy and the congregation to pray for you or for someone you love. No account needed.',
    icon: 'hands',
    image: null,
    external: false,
  },
  {
    slug: 'vehicle-registration',
    href: '/forms/vehicle-registration',
    title: 'Register a vehicle',
    blurb:
      'So the parking team can reach you if your car needs moving. Visitors and guests are welcome to register too.',
    icon: 'pin',
    image: null,
    external: false,
  },
] as const;

interface HubCard {
  slug: string;
  href: string;
  title: string;
  blurb: string;
  icon: string;
  /** A photograph the parish chose for this form, or null for the crest. */
  image: string | null;
  external: boolean;
}

export function FormsHub() {
  const [cards, setCards] = useState<readonly HubCard[]>(FALLBACK);
  const [live, setLive] = useState(false);
  const admin = useFormsAdmin();

  useEffect(() => {
    const stop = watchPublishedForms(
      (forms) => {
        setCards(forms.map(toCard));
        setLive(true);
      },
      (error) => {
        // Keep whatever is on screen. An empty hub is the failure this guards
        // against, and it is the one the old hardcoded list was written to
        // avoid — so a failed read must not be allowed to produce it.
        console.error('[forms] could not read the forms list; showing the built-in list', error);
      },
    );
    return stop;
  }, []);

  return (
    <>
      {/*
        The parish's own sanctuary, as a slim band above the list.

        A picture *here* rather than one per card, because that is where a
        photograph can be honest. There is no photograph of a church van and
        none of a car park, so a picture on those cards would be decoration
        standing in for meaning — which reads worse than the crest does. This is
        the parish, on the parish's page of forms, and it says so.

        Slim on purpose. `/livestream` is the precedent: a full header band there
        pushed the player below the fold and was cut. The cap here keeps the
        first card on screen on a phone.

        The LANDSCAPE crop at every width, deliberately — not the portrait one.

        The homepage serves `home-sanctuary-portrait-*` below 40rem, and copying
        that here was wrong and looked it: the portrait crop is 3:4, and forcing
        3:4 into a 375x72 band leaves a horizontal slice of a handrail. That crop
        exists for a tall phone *hero*, where the box is taller than it is wide.
        This box is short and wide at every size, so the wide source is the right
        one everywhere and only the file size needs to change.
      */}
      <div className="fx__banner fx__banner--hub">
        <img
          src="/img/home-sanctuary-1000.webp"
          srcSet="/img/home-sanctuary-1000.webp 1000w, /img/home-sanctuary-1600.webp 1600w"
          sizes="(min-width: 60rem) 68ch, 100vw"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
      </div>

      <p className="note">
        The forms the parish keeps online. Nothing here needs an account.
      </p>

      <ul className="forms">
        {cards.map((card) => (
          <li key={card.slug}>
            <FormCard card={card} />
          </li>
        ))}
      </ul>

      {live && cards.length === 0 && (
        <p className="note">
          There are no forms published at the moment.
        </p>
      )}

      <p className="note forms__ask">
        Looking for something that is not here?{' '}
        <a href="/contact">Ask the parish office</a> — they can send you the right form.
      </p>

      {/*
        Nothing is rendered and nothing is downloaded for a visitor: the builder
        is behind `lazy`, and `canEdit` is false until the auth store has
        confirmed a staff claim.
      */}
      {admin.ready && admin.canEdit && (
        <Suspense fallback={null}>
          <FormsAdmin />
        </Suspense>
      )}
    </>
  );
}

/**
 * A published form, as a card.
 *
 * An `external` form keeps its own URL so the card links straight out to Breeze
 * rather than through a `/forms/<slug>` page whose only content is another link.
 * One click, not two.
 */
function toCard(form: FormDefinition): HubCard {
  const external = form.kind === 'external' && form.externalUrl !== null;
  return {
    slug: form.slug,
    href: external ? (form.externalUrl as string) : `/forms/${form.slug}`,
    title: form.title,
    blurb: form.blurb,
    icon: form.icon,
    image: form.image,
    external,
  };
}

function FormCard({ card }: { card: HubCard }) {
  const inner = (
    <>
      {/*
        The media panel: a photograph when the parish chose one, the crest
        otherwise.

        Never an empty box and never a placeholder photograph. A card whose
        picture is a grey rectangle reads as broken, and a card wearing a stock
        photo of somebody else's church reads as worse than plain — so the
        fallback is a mark rather than an image, and it is drawn rather than
        downloaded. See `.form-card__crest`.
      */}
      <span className="form-card__media" aria-hidden="true">
        {card.image ? (
          <img
            className="form-card__photo"
            src={card.image}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="form-card__crest">
            <Icon name={isIconName(card.icon) ? card.icon : 'file'} size={26} />
          </span>
        )}
      </span>

      <span className="form-card__body">
        <span className="form-card__title">
          {card.title}
          {/* Said in text, not only by an icon: "opens in a new tab" is
              something a screen-reader user needs before they follow the link,
              not after their back button has stopped working. */}
          {card.external && <span className="visually-hidden"> (opens in a new tab)</span>}
        </span>
        <span className="form-card__note">{card.blurb}</span>
        {/*
          A worded affordance rather than a bare arrow in the corner.

          The arrow alone was doing two jobs badly: it had to be recognised as
          "this is a link" and as "this is where to press", and at 18px in a
          quiet grey it managed neither on a phone. The whole card is still the
          target; this is what tells you so.
        */}
        <span className="form-card__go">
          {card.external ? 'Open in a new tab' : 'Open the form'}
          <Icon name="arrow" size={16} className="form-card__arrow" />
        </span>
      </span>
    </>
  );

  /*
   * A plain `<a>` on both branches, not `next/link` on the internal one.
   *
   * `/forms/<slug>` is not a route in this app — it is a Hosting rewrite onto
   * the `/form` shell. The client router would try to fetch a route manifest
   * entry that does not exist and fall back to a hard navigation anyway, having
   * spent a round trip discovering it.
   */
  return card.external ? (
    <a className="form-card" href={card.href} rel="noopener noreferrer" target="_blank">
      {inner}
    </a>
  ) : (
    <a className="form-card" href={card.href}>
      {inner}
    </a>
  );
}
