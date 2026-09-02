'use client';

import { Suspense, lazy, useEffect, useState } from 'react';
import { builtInForms, type FormDefinition } from '@spsm/shared';
import { Icon, isIconName } from '@/components/Icon';
import { useCampAdmin } from '@/features/camp';
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
 * Summer camp, as a card rather than a form definition.
 *
 * It is not in the `forms` collection and cannot be: a camp registration
 * repeats a child, carries a payment ledger written to over weeks, and has
 * roles appended long after it was taken, none of which a `FormField` list can
 * express. It has a route of its own instead — see
 * `app/forms/summer-camp/page.tsx`.
 *
 * So the card is assembled here. A hardcoded entry in a list whose whole point
 * is not being hardcoded deserves the same defence `FORMS_WITH_A_HOME` gets
 * below: this is a consequence of a route existing in this codebase rather than
 * a setting the parish office should have to understand, and it belongs next to
 * the route.
 *
 * ---------------------------------------------------------------------------
 * Two cards for one address, and which one you get depends on who you are.
 *
 * This used to appear only for somebody holding a program grant on the camp's
 * ministry, because the page behind it was administrator-only in its entirety.
 * Half of it no longer is: servants sign themselves up on an open form, and
 * families are still registered by the camp at a desk. The page decides which
 * of those you see from the same grant — this only decides what the card
 * promises, so that a teenager and a camp director are not both told the form
 * is "for the people who run the camp".
 *
 * The public card is not hidden when sign-ups are closed. `config/camp` is a
 * second read this page has no other reason to make, and a card that leads to
 * "the camp is not taking sign-ups at the moment" is a better answer than one
 * that silently is not there — somebody sent a link by a friend needs to be
 * told the list is shut, not left wondering.
 * ---------------------------------------------------------------------------
 */
const CAMP_CARD: HubCard = {
  slug: 'summer-camp',
  href: '/forms/summer-camp',
  title: 'Serve at summer camp',
  blurb:
    'Sign up to serve — the days you can come, which half of the camp, and what ' +
    'you would like to do. No account needed. Children are registered by the camp.',
  icon: 'present',
  image: null,
  external: false,
};

/**
 * A second card, for somebody who runs the camp, pointing somewhere else.
 *
 * It used to be the *same* address with different wording, because the one
 * screen held both the public sign-up and the whole of the camp's admin. Since
 * the rebuild those are two places: this hub is public and shows the sign-up,
 * and everything a camp administrator does is at /admin/camp.
 */
const CAMP_ADMIN_CARD: HubCard = {
  slug: 'summer-camp-admin',
  href: '/admin/camp',
  title: 'Run summer camp',
  blurb:
    'Registrations, groups and the daily register, with the camp\u2019s settings. ' +
    'For the people who run the camp.',
  icon: 'present',
  image: null,
  external: false,
};

/**
 * Whether the camp is advertised on this page at all.
 *
 * ---------------------------------------------------------------------------
 * **Back on as of 2 Sep 2026**, with the camp rebuilt. It was switched off on
 * 1 Sep — one word, nothing deleted — and this is that word changed back.
 *
 * The switch stays because it is the right shape for the question it answers:
 * the camp is a thing the parish runs for two weeks a year, and a hub that
 * advertises it in February is a hub advertising something that is not
 * happening. The finer control now lives in the camp's own settings —
 * `servantSignUp` closes the form itself and the page then says so — and this
 * remains the blunt one that takes the card off the hub entirely.
 *
 * The matching row in the account menu is in `features/admin/sections.ts` and
 * carries the same note.
 * ---------------------------------------------------------------------------
 */
const SHOW_CAMP: boolean = true;

/**
 * The two forms that are always on this page.
 *
 * ---------------------------------------------------------------------------
 * Not a spinner substitute any more — a floor.
 *
 * This was one hardcoded card shown *only* while Firestore had not answered:
 * the NFC destination, on the argument that a hub showing nothing while it
 * waits is worse than one showing the form most people arriving here want.
 * That argument was right and it under-reached. The same reasoning says the
 * card must also survive a read that answers *successfully* without the
 * document — a seeder that was never run, a document deleted from the console —
 * because the tag in the car park is equally unhelped by an empty list that
 * arrived quickly.
 *
 * So these are merged into every render: before the read, after a failed read,
 * and after a successful one that did not include them. A stored document
 * always wins over its built-in copy, because staff edit these two like any
 * other form and this must never overwrite that.
 *
 * `builtInForms()` is the same definition the seeder writes and the form page
 * falls back to. One copy, in `@spsm/shared`.
 * ---------------------------------------------------------------------------
 */
/*
 * A function, not a `const` — and this is not a style preference.
 *
 * As a module-level constant it ran at import time and called `toCard`, which
 * reads `FORMS_WITH_A_HOME` further down this file. `function` declarations
 * hoist; `const` declarations do not, so the map ran while that one was still
 * in its temporal dead zone. It failed as `ReferenceError: Cannot access 'm'
 * before initialization` during the static export of /forms — a build error
 * naming a minified variable, from a file with no obvious ordering problem in
 * it. Two cards is not a computation worth caching into that.
 */
function builtInCards(): HubCard[] {
  return builtInForms().map(({ draft }) => toCard(draft as FormDefinition));
}

/**
 * The live list, with the two permanent forms guaranteed present.
 *
 * Keyed on slug rather than id because that is what a card is addressed by, and
 * a built-in's slug cannot be edited — the builder makes that field read-only
 * for exactly this reason.
 */
function withBuiltIns(cards: readonly HubCard[]): HubCard[] {
  const known = new Set(cards.map((card) => card.slug));
  const missing = builtInCards().filter((card) => !known.has(card.slug));
  // The built-ins first: `order` puts contact at 1 and the vehicle form at 10,
  // ahead of the default 100 every other form is created with, and the live
  // list arrives already sorted by that same field.
  return [...missing, ...cards];
}

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
  const [cards, setCards] = useState<readonly HubCard[]>(builtInCards);
  const admin = useFormsAdmin();
  const camp = useCampAdmin();

  useEffect(() => {
    const stop = watchPublishedForms(
      (forms) => {
        setCards(withBuiltIns(forms.map(toCard)));
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

  /*
   * The camp card is appended rather than folded into `cards`, so a failed
   * Firestore read cannot take it away: `cards` falls back to the built-in list
   * when the subscription errors, and both a servant signing up and somebody
   * who runs the camp should still find the form on a page that could not reach
   * the database.
   *
   * Shown before `camp.ready`, deliberately — the public card is the honest
   * default for a visitor, and waiting for a grant read that only a signed-in
   * person triggers would make the card appear a beat late for everybody else.
   * What `ready` decides is only whether it is swapped for the administrator's
   * wording.
   */
  const visible = SHOW_CAMP
    ? [...cards, CAMP_CARD, ...(camp.ready && camp.canEdit ? [CAMP_ADMIN_CARD] : [])]
    : cards;

  return (
    <>
      <p className="note">
        The forms the church keeps online. Nothing here needs an account.
      </p>

      <ul className="forms">
        {visible.map((card) => (
          <li key={card.slug}>
            <FormCard card={card} />
          </li>
        ))}
      </ul>



      <p className="note forms__ask">
        Looking for something that is not here?{' '}
        <a href="/contact">Ask the church office</a> — they can send you the right form.
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
 * Forms whose home is a page of their own, keyed by slug.
 *
 * ---------------------------------------------------------------------------
 * A hardcoded slug in the hub, which deserves a defence.
 *
 * `contact` is a real form definition — that is what gives it validation, a
 * notification email, and a row in the submissions panel — but it is *rendered*
 * inside /contact, under the parish's address and service times, because that
 * is where somebody looking for a way to reach the office goes. Left to the
 * default the card would point at `/forms/contact`, which is the same form on a
 * bare page with none of that context, and the parish would have two URLs for
 * one thing with no way to tell which is the real one.
 *
 * So the card links to the page the form lives on. The map is deliberately not
 * a field on `FormDefinition`: this is not a setting the parish office should
 * have to understand, it is a consequence of a route existing in this codebase,
 * and it belongs next to the route rather than in Firestore.
 *
 * The fragment matters as much as the path. Somebody who clicked a card called
 * "Contact the parish office" has already decided to write; landing them at the
 * top of /contact makes them scroll past the address, the map and the service
 * times to find the thing they clicked. `#write-heading` is the h2 above the
 * form, and it is in the exported HTML even though the form itself arrives
 * later, so the jump lands correctly on a cold load.
 * ---------------------------------------------------------------------------
 */
const FORMS_WITH_A_HOME: Readonly<Record<string, string>> = {
  contact: '/contact#write-heading',
};

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
    href: external
      ? (form.externalUrl as string)
      : (FORMS_WITH_A_HOME[form.slug] ?? `/forms/${form.slug}`),
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
        The photograph.

        Every form has one now. The fallback that used to sit here — a gradient
        wash with the parish seal watermarked into it — was rejected: four cards
        differing only by a small glyph, in colours that read as muddy against
        the cream page. What is left is a plain tinted panel with the form's
        icon, which is what a form with no picture chosen gets and is meant to
        look like an absence rather than a decision.
      */}
      <span className="form-card__media" aria-hidden="true">
        {card.image ? (
          <img
            className="form-card__photo"
            src={card.image}
            alt=""
            loading="lazy"
            decoding="async"
            width={1000}
            height={400}
          />
        ) : (
          <span className="form-card__blank">
            <Icon name={isIconName(card.icon) ? card.icon : 'file'} size={28} />
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
