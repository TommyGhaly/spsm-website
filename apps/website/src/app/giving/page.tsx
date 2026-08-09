import type { Metadata } from 'next';
import { GivingPanel, givingUrl } from '@/features/giving';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = {
  title: 'Giving',
  description: 'Support the ministry of St. Philopater Mercurius & St. Mina Coptic Orthodox Church.',
};

export default function GivingPage() {
  return (
    <>
      <PageHeader
        title="Giving"
        lede="Thank you for supporting the ministry of the parish."
      />
      <GivingPanel givingUrl={givingUrl()} />
    </>
  );
}
