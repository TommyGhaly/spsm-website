import type { Metadata } from 'next';
import { SignatureScreen } from '@/features/ordination/SignatureScreen';

/** Where a priest draws the signature stamped on what they sign. */
export const metadata: Metadata = {
  title: 'My signature',
  robots: { index: false, follow: false },
};

export default function SignaturePage() {
  return <SignatureScreen />;
}
