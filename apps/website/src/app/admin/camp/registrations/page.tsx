import type { Metadata } from 'next';
import { RegistrationsScreen } from '@/features/camp/RegistrationsScreen';

export const metadata: Metadata = {
  title: 'Camp registrations',
  robots: { index: false, follow: false },
};

export default function CampRegistrationsPage() {
  return <RegistrationsScreen />;
}
