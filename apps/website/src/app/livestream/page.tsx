import type { Metadata } from 'next';
import Link from 'next/link';
import { getIntegrationsConfig } from '@/lib/config';
import { LivestreamPlayer } from '@/features/livestream';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Watch Live',
  description:
    'Watch the Divine Liturgy live from St. Philopater Mercurius & St. Mina Coptic Orthodox Church.',
};

export default async function LivestreamPage() {
  const config = await getIntegrationsConfig();

  return (
    <>
      <PageHeader
        title="Watch Live"
        lede="For those who cannot be with us in person — the sick, the homebound, and those travelling."
      />

      <LivestreamPlayer config={config.livestream} />

      <p className="prose" style={{ marginTop: '2rem' }}>
        This week&apos;s full schedule is on the <Link href="/">homepage</Link>, and the
        regular service times are on the <Link href="/contact">contact page</Link>.
      </p>
    </>
  );
}
