import type { Metadata } from 'next';
import Link from 'next/link';
import { PrivacyDisclosure } from '@/features/prayer';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Prayer Requests',
  description: 'Ask the clergy and the congregation of St. Philopater Mercurius & St. Mina to pray with you.',
};

/**
 * The submission form is not here yet — but the reason changed, and it is now a
 * scheduling decision rather than a blocker.
 *
 * It used to be that `firestore.rules` required a signed-in user and no sign-in
 * provider was enabled. Sign-in now exists, and is Microsoft-only against the
 * parish directory: clergy, staff, and servants have an account and a
 * parishioner deliberately does not. So requiring one here would mean nobody
 * who actually wants to ask for prayer could.
 *
 * The route out is the one `vehicles` already takes — an anonymous, field-
 * validated create, with the rules doing the bounding. `submitPrayerRequest` in
 * features/prayer/data.ts is written and waiting. That is a rules change plus a
 * form, and it is scheduled after the cutover.
 *
 * The privacy disclosure ships now regardless — it is the part that has to be
 * read *before* someone types anything personal, and the wording is a decision
 * (docs/decisions.md #1), not filler. Building it now also means the form gets
 * added around a disclosure that already exists, rather than the disclosure
 * being an afterthought bolted on at the end.
 */
export default function PrayerPage() {
  return (
    <>
      <PageHeader
        title="Prayer Requests"
        lede="The fathers of the parish pray for the intentions entrusted to them, and the congregation prays together for those who ask."
      />

      <PrivacyDisclosure />

      <div className="notice notice--alarm">
        <h2>Not open yet</h2>
        <p>
          Requests can&apos;t be submitted through the website yet — that form is still
          being built. In the meantime, please speak to one of the fathers after
          liturgy, or <Link href="/contact">contact the parish office</Link>. Nothing
          you send is any less welcome for arriving that way.
        </p>
      </div>
    </>
  );
}
