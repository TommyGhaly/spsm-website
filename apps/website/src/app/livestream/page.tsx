import type { Metadata } from 'next';
import { getIntegrationsConfig } from '@/lib/config';
import { LivestreamPlayer, PastStreams, getPastStreams } from '@/features/livestream';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Watch Live',
  description:
    'Watch the Divine Liturgy live from St. Philopater Mercurius & St. Mina Coptic Orthodox Church.',
};

/**
 * The broadcast first, then what came before it.
 *
 * That order is the page: someone arriving during a liturgy wants the player
 * and nothing above it, and someone arriving on a Tuesday wants the most recent
 * service. Putting the archive above or beside the player would serve the
 * second reader at the first one's expense, and the first one is the one in a
 * hurry.
 *
 * **This is the one page with no `PageHeader`, deliberately.** The banner every
 * other page opens with — title, lede, ornament — filled the whole first screen
 * and pushed the player below the fold, so a visitor arriving mid-liturgy had
 * to scroll past a paragraph explaining the page to reach the thing they came
 * for. The `h1` survives as `visually-hidden` rather than being deleted: the
 * document still needs exactly one, for the outline and for the search result,
 * and hidden text costs nothing on screen.
 *
 * The two halves come from different services — the live embed from Castr, the
 * archive from the parish's YouTube channel — because the parish streams to
 * Castr and restreams to YouTube. See `LivestreamConfig.archiveChannelId`.
 */
export default async function LivestreamPage() {
  const config = await getIntegrationsConfig();
  // No await: the archive is a committed snapshot, not a network read.
  const pastStreams = getPastStreams(config.livestream);

  return (
    <PageBody flush>
      <h1 className="visually-hidden">Watch Live</h1>

      <LivestreamPlayer config={config.livestream} wide />

      <PastStreams streams={pastStreams} />
    </PageBody>
  );
}
