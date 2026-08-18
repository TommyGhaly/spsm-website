import type { Metadata } from 'next';
import { VehicleForm } from '@/features/parking';
import { PageHeader } from '@/components/PageHeader';
import { PageBody } from '@/components/PageBody';

export const metadata: Metadata = {
  title: 'Register a Vehicle',
  description:
    'Register your vehicle with the parking team at St. Philopater Mercurius & St. Mina.',
};

export default function ParkingPage() {
  return (
    <>
      <PageHeader title="Register a Vehicle" />
      <PageBody>
        <p className="note">So the parking team can reach you if your car needs moving. No account needed — visitors and guests are welcome to register too.</p>
        <VehicleForm />
      </PageBody>
    </>
  );
}
