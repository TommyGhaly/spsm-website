import type { Metadata } from 'next';
import { NominationScreen } from '@/features/ordination/NominationScreen';

/**
 * The nomination for ordination — a form with a route of its own, like
 * /forms/summer-camp and for the same reason: it is not a `FormDefinition`,
 * so the `/form` shell has nothing to find. The exported
 * `out/forms/ordination.html` is a file, and Hosting serves a file before it
 * considers the `/forms/**` rewrite. See `app/forms/summer-camp/page.tsx`.
 *
 * Website only. The SPSM-Connect app's forms hub does not list it.
 */
export const metadata: Metadata = {
  title: 'Nomination for ordination',
  robots: { index: false, follow: false },
};

export default function OrdinationNominationPage() {
  return <NominationScreen />;
}
