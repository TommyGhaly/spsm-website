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
