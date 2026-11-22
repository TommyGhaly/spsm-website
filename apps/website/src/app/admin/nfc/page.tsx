import type { Metadata } from 'next';
import { NfcScreen } from '@/features/nfc/NfcScreen';

/**
 * NFC tags — how the church's tags are tapped, and what follows.
 *
 * Under /admin beside Finance, for the reason that page gives: there is no
 * visitor-facing page whose contents are "how often the bookstore tag was
 * tapped", so there is nowhere in-place for it to live. `noindex` for the same
 * reason too — the address is public in a static export, and what keeps the
 * figures private is `firestore.rules`.
 */
export const metadata: Metadata = {
  title: 'NFC tags',
  robots: { index: false, follow: false },
};

export default function NfcPage() {
  return <NfcScreen />;
}
