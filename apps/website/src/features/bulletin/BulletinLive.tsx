'use client';

import type { Bulletin } from '@spsm/shared';
import { SectionHeading } from '@/components/SectionHeading';
import { BulletinWeek } from './BulletinWeek';
import { useActiveBulletin } from './useActiveBulletin';

/**
 * The contents of the homepage's "This week" section, kept current by
 * re-reading the source rather than by redeploying.
 *
 * **The heading is inside this, and it has to be.** `weekLabel` ("August 17,
 * 2026") and `presetName` ("St. Mary Nahda Schedule") come out of the same
 * document as the days. Refresh the days but leave the title on the server page,
 * and making a different bulletin active shows the new week's services under the
 * old week's date — worse than either being stale, because the two disagree in a
 * way the reader cannot detect.
 *
 * `today` is passed in rather than read from the clock here, and that is not
 * incidental: a static export renders client components once at build time too,
 * so a clock read during that render gives the day of the *deploy* on one side
 * of hydration and the day of the *visit* on the other. React reports that as a
 * mismatch. Taking it as a prop keeps the "Today" flag exactly the build-time
 * value it has always been — see `todayInParish`.
 *
 * The `<section>` and its band class stay on the server page. This only ever
 * swaps contents inside a box that is already on the page at its final width,
 * so nothing arrives late to push the rest of the page around, and the band
 * alternation is still dealt out in render order at build time.
 */
export function BulletinLive({ initial, today }: { initial: Bulletin; today: string }) {
  const bulletin = useActiveBulletin(initial);

  return (
    <>
      <SectionHeading
        id="bulletin-heading"
        eyebrow="This week"
        title={bulletin.weekLabel}
        note={bulletin.presetName || undefined}
      />
      <BulletinWeek bulletin={bulletin} today={today} />
    </>
  );
}
