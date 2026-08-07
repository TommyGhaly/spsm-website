import { isConfigured } from '@/lib/firebase';

/**
 * What a section renders when Firestore has nothing in it yet.
 *
 * There are two genuinely different reasons a page can be empty, and conflating
 * them costs an hour of debugging every time:
 *
 *   - Firebase isn't configured  → the build never asked. A developer problem,
 *     fixed in .env.local.
 *   - Firebase answered, with nothing → a content problem, fixed by staff in
 *     the admin tools.
 *
 * So this says which one it is instead of showing a generic "nothing here."
 */
export function EmptyState({ what, collection }: { what: string; collection: string }) {
  if (!isConfigured()) {
    return (
      <div className="notice notice--alarm">
        <h2>Firebase isn&apos;t configured</h2>
        <p>
          This page was built without credentials, so it never asked for {what}. Copy{' '}
          <code>.env.example</code> to <code>.env.local</code> and fill in the six{' '}
          <code>NEXT_PUBLIC_FIREBASE_*</code> values, then rebuild. See{' '}
          <code>docs/api-keys.md</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="notice">
      <h2>Nothing here yet</h2>
      <p>
        Firestore answered, and the <code>{collection}</code> collection has no published{' '}
        {what}. This is a content gap, not a broken build — the page will fill in as soon as
        staff publish something and the site is redeployed.
      </p>
    </div>
  );
}
