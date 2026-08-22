import type { Metadata } from 'next';
import { AdminGate } from '@/components/AdminGate';
import { ScheduleEmbed } from '@/features/servants';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

/**
 * The servants schedule.
 *
 * The reason sign-in exists at all, now that the /admin section is gone. On the
 * Wix site this page sat behind one shared password; it is now per person, via
 * the parish Microsoft account people already have.
 *
 * `requires="servant"` rather than `staff`: a first sign-in from the parish
 * tenant grants `servant`, so anyone with a parish account can see the rota
 * without an administrator doing anything. See DEFAULT_SIGNIN_ROLE.
 *
 * Nothing is rendered from Firestore at build time. The calendar URL is a
 * bearer credential and this is a static export, so it is fetched in the
 * browser after sign-in and never written into the exported HTML.
 */
export const metadata: Metadata = {
  title: 'Servants Schedule',
  robots: { index: false, follow: false },
};

export default function ServantsPage() {
  return (
    <>
      <PageHeader title="Servants Schedule" />
      <PageBody>
        <p className="note">Who is serving, and when. Signed in with your parish Microsoft account — no separate password.</p>
        <AdminGate requires="servant" area="servants schedule">
          <ScheduleEmbed />
        </AdminGate>
      </PageBody>
    </>
  );
}
