/**
 * The invisible session a gallery upload runs under.
 *
 * ---------------------------------------------------------------------------
 * Nobody is asked to sign in, and nobody ever will be on this path.
 *
 * Sign-in on this site is Microsoft-only against the parish's Entra tenant, so
 * the people who *can* hold an account are clergy, staff and servants —
 * precisely not the grandmother with forty photographs of the camp. Requiring
 * an account to submit one would not mean fewer uploaders; it would mean only
 * staff could ever upload, which deletes the feature.
 *
 * So the browser signs in anonymously, silently, and the visitor sees nothing.
 * What that buys is not authentication — an anonymous uid is free and anyone
 * can mint as many as they like — but *attribution*: the upload endpoint has a
 * stable key to count a day's submissions against, and a uid to refuse if one
 * of them turns out to be a nuisance. The wall is App Check; this is the thing
 * that makes the quota mean something.
 *
 * ## Two reasons this is not in `lib/auth.ts`
 *
 * That module is the parish's real sign-in: Microsoft, popups, tenant checks,
 * claims, account deletion. None of it applies here and mixing the two would
 * invite somebody to reuse a helper from one on the other.
 *
 * It is also imported lazily, on purpose. `firebase/auth` is not small, and a
 * gallery page is mostly read by people who will never upload anything — so
 * nothing here may be pulled into the initial bundle. Every import below is
 * dynamic and happens on the submitter's first interaction with the form, not
 * on page load. Follow the same pattern as `useProgramAdmin.ts` if you add to
 * this file.
 *
 * ## The blocking function had to be taught about this
 *
 * `enforceTenantOnCreate` refuses any account that does not present the
 * parish's tenant. An anonymous account presents no credential at all, so every
 * one of these sign-ins would have been rejected as "not part of the church
 * directory" until that hook learned to let an empty `providerData` through.
 * The two changes belong together; neither works alone.
 * ---------------------------------------------------------------------------
 */
import { appCheckTokenForFetch } from './firebase';

/**
 * The current user's ID token, signing in anonymously first if need be.
 *
 * Reuses a Microsoft session when there is one — a servant who is already
 * signed in uploads as themselves, which is what makes the administrator
 * bypass in the endpoint reachable at all.
 */
export async function getIdToken(): Promise<string> {
  const [{ getAuth, signInAnonymously, onAuthStateChanged }] = await Promise.all([
    import('firebase/auth'),
  ]);
  const { firebaseApp } = await import('./firebase');
  const auth = getAuth(firebaseApp());

  /*
   * Wait for the SDK to restore a persisted session before deciding there is
   * none. `currentUser` is null for the first moments after a page load even
   * when somebody is signed in, so acting on it directly would sign a servant
   * in anonymously over the top of their own Microsoft session — and then
   * refuse them the administrator bypass they actually hold.
   */
  const existing = await new Promise<unknown>((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });

  const user = existing ?? (await signInAnonymously(auth)).user;
  return (user as { getIdToken(): Promise<string> }).getIdToken();
}

/**
 * The headers the upload endpoint needs, both of them.
 *
 * The App Check token is separate from the ID token and does a different job:
 * the ID token says *which browser session* this is, the App Check token says
 * *that it is a browser at all*. The endpoint refuses a request without the
 * second one, so a null here is a refusal — see `appCheckTokenForFetch` for
 * when that happens, and note that localhost without a debug token is one of
 * the cases.
 */
export async function uploadHeaders(): Promise<Record<string, string>> {
  const [token, attestation] = await Promise.all([getIdToken(), appCheckTokenForFetch()]);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(attestation ? { 'X-Firebase-AppCheck': attestation } : {}),
  };
}
