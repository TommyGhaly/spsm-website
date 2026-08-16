import type { Metadata } from 'next';
import { GivingPanel, givingUrl } from '@/features/giving';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Giving',
  description: 'Support the ministry of St. Philopater Mercurius & St. Mina Coptic Orthodox Church.',
};

export default function GivingPage() {
  return (
    <>
      <PageHeader
        title="Giving"
        lede="What is offered here sustains the church, its services, and the poor."
      />
      <PageBody>
        <GivingPanel givingUrl={givingUrl()} />
      </PageBody>
    </>
  );
}
