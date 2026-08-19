import type { Metadata } from 'next';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Forms',
  description:
    'The forms of St. Philopater Mercurius & St. Mina — prayer requests, vehicle registration, and parish paperwork.',
};

/**
 * One page listing every form the parish asks anyone to fill in.
 *
 * A hub rather than a form. The parish adds forms — a servants' application, a
 * baptism request, a summer camp registration — faster than the top bar can
 * grow, and each one arriving as its own nav item is how a seven-item header
 * becomes a twelve-item header nobody can read. One item, one page, a card
 * added here per form.
 *
 * ---------------------------------------------------------------------------
 * On the two forms that are here today.
 *
 * `/prayer` and `/parking` were built as NFC destinations — a card in the pew,
 * a tag by the car park door — and until now nothing on the site linked to
 * either. That was deliberate: `robots.ts` still keeps both out of search,
 * because a search result for "register a vehicle" is only ever a wrong turn
 * into a page that assumes you are standing in the car park.
 *
 * Being *browsable* is a different question from being *findable*, and this is
 * the answer to the first one. Someone who wants to ask for prayer on a Tuesday
 * should not have to remember which card in the pew had the tag on it. The tags
 * still work and still land in the same place; this is a second door, not a
 * replacement for the first.
 * ---------------------------------------------------------------------------
 *
 * `FORMS` is a hardcoded list rather than a Firestore read for the reason NAV
 * in layout.tsx is: a bad read would empty the page, and the set changes about
 * as often as the navigation does. An externally hosted form — a Microsoft or
 * Google form the parish office already runs — belongs here too; give it an
 * absolute `href` and the card renders as an outbound link on its own.
 */

type FormLink = {
  href: string;
  title: string;
  /** What the form is for, in the words of the person who has to fill it in. */
  note: string;
  icon: IconName;
};

const FORMS: readonly FormLink[] = [
  {
    href: '/prayer',
    title: 'Prayer requests',
    note: 'Ask the clergy and the congregation to pray for you or for someone you love. No account needed.',
    icon: 'hands',
  },
  {
    href: '/parking',
    title: 'Register a vehicle',
    note: 'So the parking team can reach you if your car needs moving. Visitors and guests are welcome to register too.',
    icon: 'pin',
  },
] as const;

/** An absolute URL is somebody else's form and opens in its own tab. */
function isExternal(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

export default function FormsPage() {
  return (
    <>
      <PageHeader title="Forms" />
      <PageBody>
        <p className="note">
          The forms the parish keeps online. Nothing here needs an account.
        </p>

        <ul className="forms">
          {FORMS.map((form) => (
            <li key={form.href}>
              {/*
                The whole card is the link, not a "read more" at the bottom of
                it. A card that looks clickable and only is in one corner is the
                commonest way a list like this frustrates someone on a phone.
              */}
              <FormCard form={form} />
            </li>
          ))}
        </ul>

        <p className="note forms__ask">
          Looking for something that is not here?{' '}
          <Link href="/contact">Ask the parish office</Link> — they can send you the
          right form.
        </p>
      </PageBody>
    </>
  );
}

function FormCard({ form }: { form: FormLink }) {
  const external = isExternal(form.href);

  const inner = (
    <>
      <span className="form-card__icon" aria-hidden="true">
        <Icon name={form.icon} size={20} />
      </span>
      <span className="form-card__body">
        <span className="form-card__title">
          {form.title}
          {/* Said in text, not only by an icon: "opens in a new tab" is a thing
              a screen-reader user needs before they follow the link, not after
              their back button has stopped working. */}
          {external && <span className="visually-hidden"> (opens in a new tab)</span>}
        </span>
        <span className="form-card__note">{form.note}</span>
      </span>
      <Icon name="arrow" size={18} className="form-card__arrow" />
    </>
  );

  return external ? (
    <a className="form-card" href={form.href} rel="noopener noreferrer" target="_blank">
      {inner}
    </a>
  ) : (
    <Link className="form-card" href={form.href}>
      {inner}
    </Link>
  );
}
