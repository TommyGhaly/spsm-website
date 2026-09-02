import type { Metadata } from 'next';
import { AttendanceScreen } from '@/features/camp/AttendanceScreen';

export const metadata: Metadata = {
  title: 'Camp attendance',
  robots: { index: false, follow: false },
};

export default function CampAttendancePage() {
  return <AttendanceScreen />;
}
