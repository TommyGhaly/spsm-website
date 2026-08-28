import type { Metadata } from 'next';
import { FormsHub } from '@/features/forms';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Forms',
  description:
    'The forms of St. Philopater Mercurius & St. Mina — vehicle registration and church paperwork.',
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
 * The list is read from Firestore now, and this file no longer holds it.
 *
 * It used to be a hardcoded `FORMS` array, defended like this: "a bad read would
 * empty the page, and the set changes about as often as the navigation does."
 *
 * The first half was a fair objection and is answered rather than dropped —
 * `FormsHub` keeps a built-in list on screen whenever the read fails or has not
 * arrived, so a broken connection shows the forms that existed at build time
 * instead of nothing. The second half stopped being true the moment staff could
 * build a form in the drawer on this page: the set now changes far more often
 * than the navigation, and hardcoding it would mean every new form waits for
 * somebody with deploy rights.
 *
 * `/parking` was built as an NFC destination — a tag by the car park door — and
 * `robots.ts` still keeps it out of search, because a search result for
 * "register a vehicle" is only ever a wrong turn into a page that assumes you
 * are standing in the car park. Being *browsable* is a different question from
 * being *findable*, and this page is the answer to the first one. The tag still
 * works and still lands in the same place; this is a second door, not a
 * replacement for the first.
 *
 * Note that vehicle registration has moved. It is `/forms/vehicle-registration`
 * now, writing to Taksis rather than to our own `vehicles` collection — see
 * `features/forms/VehicleForm.tsx`. `/parking` remains as the NFC destination.
 * ---------------------------------------------------------------------------
 *
 * A server component holding a client one: the header, the metadata and the
 * shell are static HTML, and only the list and the staff drawer are live.
 */
export default function FormsPage() {
  return (
    <>
      <PageHeader title="Forms" />
      <PageBody>
        <FormsHub />
      </PageBody>
    </>
  );
}
