import type { Metadata } from 'next';
import { PrayerForm, PrivacyDisclosure } from '@/features/prayer';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Prayer Requests',
  description: 'Ask the clergy and the congregation of St. Philopater Mercurius & St. Mina to pray with you.',
};

/**
 * Prayer requests, open to anyone.
 *
 * The form requires no account, and that is a decision rather than a shortcut.
 * `firestore.rules` used to require a signed-in user here, from a time when
 * sign-in was expected to be for everyone. It is not: authentication is
 * Microsoft-only against the parish Entra tenant, so clergy, staff and servants
 * have accounts and a parishioner deliberately does not. Keeping the
 * requirement would have meant the only people able to ask for prayer were the
 * people you would ask in person anyway.
 *
 * So this takes the shape `features/parking` already established: an
 * unauthenticated, field-validated, create-only write with no public read.
 *
 * The privacy disclosure is rendered *above* the form on purpose. It has to be
 * read before someone types something personal, and its wording is a decision
 * (docs/decisions.md #1), not filler.
 */
/**
 * The NFC destination for the prayer card in the pews.
 *
 * The same form is now also at `/forms/prayer-requests`, and both stay. This
 * URL is printed on physical cards that cannot be reprinted by editing a file —
 * the same argument that keeps `/parking` where it is — and `robots.ts`
 * disallows it, because a search result for "prayer request" should land on the
 * hub that explains what it is rather than cold on the form itself.
 *
 * Worth knowing why the hub route had to exist at all: when `/forms` became
 * data-driven, only forms with a `forms/*` document appeared on it, and this
 * page had none. It was reachable solely by typing the URL or tapping a card —
 * which removed the "second door" the hub was built to be.
 */
export default function PrayerPage() {
  return (
    <>
      <PageHeader title="Prayer Requests" />

      <PageBody>
        <p className="note">The fathers of the parish pray for those who ask. You need no account, and you may write without giving your name.</p>
        <PrivacyDisclosure />
        <PrayerForm />
      </PageBody>
    </>
  );
}
