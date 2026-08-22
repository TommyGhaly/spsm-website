import type { Metadata } from 'next';
import { ProgramDirectory } from '@/features/programs';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Our activities',
  description:
    'Summercamp, St. Simon for Seniors, College and Young Professionals, and Mother of Mercy — the standing ministries of St. Philopater Mercurius & St. Mina in Wayland, MA.',
};

/**
 * The parish's activities: a heading, a line, and the ministries.
 *
 * **This page carried a list of upcoming events and no longer does.** The
 * calendar entries behind it were inaccurate, and a page announcing the wrong
 * date for a Liturgy is worse than a page that announces none — so it was taken
 * off at the parish's direction. `/calendar` still renders the month grid over
 * the same collection, which is where a date belongs. Please do not put the list
 * back.
 *
 * ---------------------------------------------------------------------------
 * It also carried three link cards — the calendar, the forms, the parish office
 * — put there to fill the page, and they came off at Tommy's direction. Worth
 * recording why, because "the page looks empty" will come round again and this
 * is the answer that worked:
 *
 * The page was not short of *sections*, it was short of *presence*. Signposts to
 * three other pages add height without adding anything a visitor came here for,
 * and the footer already links all three. What filled the page properly was
 * making the ministries themselves bigger — the photographs are the content, so
 * the content got the room. See the tile-scale block in globals.css.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * On the three names this page has.
 *
 * The header says "Our activities", at Tommy's direction. The top bar says
 * "Events", the footer says "Ministries", and the route is `/events`. That is
 * not tidy, and it is not an oversight here — renaming a nav item changes the
 * masthead on every page of the site, and the route is what `firebase.json`
 * rewrites galleries through. If they are to be brought into line, that is its
 * own change.
 * ---------------------------------------------------------------------------
 */
export default function EventsPage() {
  return (
    /*
      `flush`, because this page's own `padding-top` is the only thing between
      the header and the masthead — `.page-body` has none of its own.
    */
    <PageBody flush>
      {/*
        A visible header, which almost no other page has.

        `PageHeader` renders a hidden `h1` site-wide, and that was a deliberate
        cut: the banner it replaced was 230px of padding that pushed the
        bookstore's products off-screen. This is the same decision made the
        other way for one page, at Tommy's direction, because this page had a
        single sentence above a rail and nothing that said what it was.

        It is a heading and a line, not a band: no ground, no border, no
        ornament, and about a sixth of the height of the thing that was cut —
        which matters because the rail below is sized from whatever height is
        left under it. Two lines here, not three: the sentence that used to be
        the third now sits at the foot of the page for that reason.
      */}
      <header className="pagehead">
        <p className="pagehead__eyebrow">St. Philopater Mercurius &amp; St. Mina</p>
        <h1>Our activities</h1>
      </header>

      <ProgramDirectory />

      {/*
        The line describing the page sits *under* the rail, at Tommy's direction,
        and it is not a stylistic preference — it is what buys the height.

        Every pixel above the plates comes off them: they are sized from what is
        left of the window, and this sentence was 54 of those pixels plus its
        gap. Below, the rail starts higher, more of the ministries are on screen
        when the page opens, and the sentence still reads in the right order —
        the heading names the page, the photographs are the page, and this
        explains what to do with them.
      */}
      <p className="lede events-lede">
        The standing ministries of the parish — who each is for, when it gathers,
        and the photographs it keeps. Choose one to see its gatherings.
      </p>
    </PageBody>
  );
}
