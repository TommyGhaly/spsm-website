import type { Metadata } from 'next';
import { GivingApps, GivingHero } from '@/features/giving';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Giving',
  description:
    'Give to St. Philopater Mercurius & St. Mina Coptic Orthodox Church \u2014 a single offering or a recurring one, through the church\u2019s Tithe.ly form.',
};

/**
 * Two bands, and no `PageBody`.
 *
 * ---------------------------------------------------------------------------
 * There was prose under the hero — what the offering supports, other ways to
 * give. Tommy cut it: *"a lot of the text at the bottom is unnecessary and
 * inaccurate."* Both halves of that are right. It was unnecessary because the
 * page has exactly one errand and the button does it; it was inaccurate because
 * nobody had told us how the parish receives an offering in person, and the
 * paragraph said so anyway.
 *
 * So: do not restore it from memory. Anything that goes back here has to come
 * from the parish.
 *
 * `GivingApps` is not that prose coming back. It is two store badges and one
 * line, and every fact in it is checkable — Tommy asked for it after the cut.
 * ---------------------------------------------------------------------------
 *
 * Neither band is wrapped in `PageBody`: that component is the centred `.wrap`
 * column, and a full-bleed band's ground has to reach both edges of the window.
 * Each band brings its own `.wrap` for its text.
 */
export default function GivingPage() {
  return (
    <>
      <PageHeader title="Giving" />
      <GivingHero />
      <GivingApps />
    </>
  );
}
