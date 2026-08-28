import type { Metadata } from 'next';
import { ParishAppList } from '@/features/apps';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeading } from '@/components/SectionHeading';

export const metadata: Metadata = {
  title: 'Apps',
  description:
    'The apps of St. Philopater Mercurius & St. Mina — Taksis for servants’ schedules and attendance, and Tithe.ly for the offering, on iPhone and Android.',
};

/**
 * Where to get the parish's apps, and which store to get them from.
 *
 * ---------------------------------------------------------------------------
 * This page exists because "download the app" was previously a thing said out
 * loud and nowhere else. Taksis has been on both stores for months; nothing on
 * this site linked to either listing, so a parishioner told to install it had to
 * search a store for a word they had only heard, and the App Store search for
 * "taksis" is not a safe place to send somebody.
 *
 * One page rather than a badge in the footer, because the answer is genuinely
 * "it depends": there are two apps that do different jobs, and a third that
 * does not exist yet and is still worth naming. A visitor needs to be told which
 * one they want before they are shown a button.
 * ---------------------------------------------------------------------------
 *
 * A band, not a bare `PageBody`. `PageHeader` renders nothing visible, so a page
 * that opens with a column of cards opens hard against the masthead and reads as
 * a fragment — the same problem `/contact` had. The band brings its own ground
 * and its own heading.
 *
 * Everything here is static. No Firestore, no client component, no state: the
 * list is a literal in `features/apps/stores.ts` and the badges are `<img>`.
 */
export default function AppsPage() {
  return (
    <>
      <PageHeader title="Apps" />

      <section className="band" aria-labelledby="apps-heading">
        <div className="wrap">
          <SectionHeading
            id="apps-heading"
            eyebrow="On a phone"
            title="Our apps"
            note="Two to install, and one that is not out yet. Both stores, in each case."
          />
          <ParishAppList />
        </div>
      </section>
    </>
  );
}
