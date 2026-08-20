import type { Metadata } from 'next';
import { ProgramDirectory } from '@/features/programs';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Events',
  description:
    'Summercamp, St. Simon for Seniors, College and Young Professionals, and Mother of Mercy — the standing programs of St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

/**
 * The parish's programs.
 *
 * **This page carried a list of upcoming events and no longer does.** The
 * calendar entries behind it were inaccurate, and a page announcing the wrong
 * date for a Liturgy is worse than a page that announces none — so it was taken
 * off at the parish's direction. `/calendar` still renders the month grid over
 * the same collection, which is where a date belongs.
 *
 * That leaves this page as the programs, and nothing else. Please do not put
 * the list back.
 */
export default function EventsPage() {
  return (
    <>
      <PageHeader title="Events" />

      {/*
        `flush`, because this page opens straight into a grid. `PageHeader`
        renders only a hidden h1 and sits outside `PageBody`, so the grid is the
        first child and `.page-body > * + *` never applies to it — the cards end
        up hard against the masthead with no gap at all. Pages that open with
        prose do not show this, which is why it survived unnoticed.
      */}
      <PageBody flush>
        {/*
          The page says what it is before it shows anything. Without this line
          a visitor arrives at five photographs and has to infer the category
          from the pictures — and the hidden h1 gives them nothing to read.
        */}
        <p className="note">
          The standing ministries of the parish. Choose one to see its gatherings
          and photographs.
        </p>

        <ProgramDirectory />
      </PageBody>
    </>
  );
}
