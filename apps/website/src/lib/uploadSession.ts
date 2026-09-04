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
 *
 * ## And so did the Firebase console
 *
 * There is a third thing, and it is not code: the **Anonymous** provider has to
 * be enabled under Authentication → Sign-in method. It was off on
 * `spsm-database` until 2026-09-04, and while it was off this whole file threw
 * on its first call for every visitor without a parish account — so uploads
 * were broken for precisely everybody the feature is for, and worked for
 * precisely everybody who might have noticed. See the long note on
 * `signInAnonymously` below, and docs/gallery-console-setup.md §6.
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

  if (existing) {
    const user = existing as { isAnonymous?: boolean; getIdToken(): Promise<string> };
    try {
      return await user.getIdToken();
    } catch (error) {
      /*
       * The session in this browser outlived the account behind it.
       *
       * Firebase's **automatic clean-up of anonymous users** deletes accounts
       * roughly a month old, and it deletes them *server-side only* — the
       * browser goes on holding the persisted session in IndexedDB, so the
       * loop above restores a user that no longer exists anywhere. The cached
       * ID token lasts an hour, which a returning visitor is well past, so the
       * refresh is attempted and fails: `auth/user-token-expired`, or
       * `auth/user-not-found`.
       *
       * Uncaught, that throws out of `uploadHeaders()` before the request is
       * built and hands the visitor a raw SDK error once per file — the exact
       * failure the provider being disabled used to cause, arriving through a
       * different door and only for people who uploaded something a month ago.
       * Signing in again is the whole remedy: an anonymous account is a quota
       * key and nothing else, so a new one is as good as the old one and there
       * is nothing to migrate.
       *
       * **Only when the dead session was itself anonymous.** A servant's
       * Microsoft session can fail to refresh too — revoked, tenant removed,
       * password changed — and falling through for them would sign them in
       * anonymously over the top of their own identity and then refuse them the
       * administrator bypass they hold, which is the hazard the comment above
       * exists to prevent. They have to be told, so their error is rethrown.
       */
      if (user.isAnonymous !== true) throw error;
    }
  }

  /*
   * The anonymous sign-in, and the one refusal it has that is ours rather than
   * the visitor's.
   *
   * The Anonymous provider is a switch in the Firebase console, off by default,
   * and nothing in this repository can turn it on or notice that it is off — no
   * rule, no deploy, no test. While it is off, `signInAnonymously` rejects
   * before a single byte is prepared, and it does so *only for people who are
   * not signed in*: a servant with a Microsoft session returns above and never
   * reaches this line. So the feature looks like it works to everybody who
   * could report it working, and fails for exactly the parishioners it exists
   * for. It was off on the live project until 2026-09-04, which is how this
   * comment came to be written.
   *
   * The visitor is told something true and given the way out, because there is
   * nothing they can do about it — the same shape as `UNATTESTED` in
   * `features/programs/submit.ts`. The console line carries the diagnosis,
   * because the person who needs the switch's name is not the one reading the
   * page.
   */
  try {
    return await (await signInAnonymously(auth)).user.getIdToken();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed') {
      console.error(
        '[uploads] anonymous sign-in is disabled on this Firebase project, so nobody ' +
          'without an account can upload anything. Firebase console → Authentication ' +
          '→ Sign-in method → Anonymous → Enable. ' +
          'See docs/gallery-console-setup.md §6.',
        error,
      );
      throw new Error(
        'Uploads from this website are not switched on at the moment. This is a fault at ' +
          'our end rather than anything you have done — please email the church office, ' +
          'and it will be put right.',
      );
    }
    throw error;
  }
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
