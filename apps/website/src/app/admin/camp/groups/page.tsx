import type { Metadata } from 'next';
import { GroupsScreen } from '@/features/camp/GroupsScreen';

export const metadata: Metadata = {
  title: 'Camp groups',
  robots: { index: false, follow: false },
};

export default function CampGroupsPage() {
  return <GroupsScreen />;
}
