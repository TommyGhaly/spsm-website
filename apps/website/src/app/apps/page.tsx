import type { Metadata } from 'next';
import { AppsHero, ParishAppList } from '@/features/apps';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Apps',
  description:
    'The apps of St. Philopater Mercurius & St. Mina — SPSM Connect for everyone, Taksis for servants’ schedules and attendance, and Tithe.ly for the offering, on iPhone and Android.',
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
 * "it depends": there are three apps that do different jobs. A visitor needs to be told which
 * one they want before they are shown a button.
 * ---------------------------------------------------------------------------
 *
 * A band, not a bare `PageBody`. `PageHeader` renders nothing visible, so a page
 * that opens with a column of cards opens hard against the masthead and reads as
 * a fragment — the same problem `/contact` had. The band brings its own ground
 * and its own heading.
 *
 * The band opens on `AppsHero` rather than a `SectionHeading`, and the cards
 * below it wear a stripe and feature chips: the page is drawn the way the App
 * Clip's Apps screen is, so a parishioner who met the apps off a tag finds the
 * same three icons, colours and words here.
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
          <AppsHero headingId="apps-heading" />
          <ParishAppList />
        </div>
      </section>
    </>
  );
}
