import type { Metadata } from 'next';
import { PrivacyDisclosure } from '@/features/prayer';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Prayer Requests',
  description: 'Ask the clergy and the congregation of St. Philopater Mercurius & St. Mina to pray with you.',
};

/**
 * The submission form is not here yet, and the reason is a hard blocker rather
 * than a choice: `firestore.rules` requires a signed-in user to create a prayer
 * request, and Email/Password sign-in is still disabled on the Firebase project.
 * A form that cannot possibly succeed is worse than an honest explanation.
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
          Requests can&apos;t be submitted through the website yet — parish accounts
          aren&apos;t switched on. Until they are, please speak to one of the fathers
          after liturgy or contact the parish office.
        </p>
      </div>
    </>
  );
}
