import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The invisible session a gallery upload runs under.
 *
 * ---------------------------------------------------------------------------
 * Three callers reach `getIdToken`, and the whole module is four lines of
 * branching that decide which of them is standing there. Every one of the three
 * has cost the site a working upload path at some point:
 *
 *   1. **A servant with a Microsoft session.** Must be reused, never overwritten
 *      — signing them in anonymously loses the administrator bypass in the
 *      endpoint, which is how they upload a full-resolution original.
 *   2. **A stranger with no session.** Must be signed in anonymously. This was
 *      broken outright until 2026-09-04, because the provider was never enabled
 *      on the project.
 *   3. **A stranger whose anonymous account was swept.** Firebase's automatic
 *      clean-up of anonymous users deletes them server-side at about a month
 *      old and leaves the browser's persisted session behind, so the token
 *      refresh fails on a user the SDK happily restored. Must sign in again.
 *
 * 3 is the reason this file exists. It is invisible for the first month after
 * clean-up is switched on, happens only to people who came back, and produces
 * the same unreadable SDK error that 2 did. Nothing else in the project would
 * notice it: no rule, no typecheck, and no test that did not mock a refusing
 * `getIdToken`.
 *
 * The distinction between 1 and 3 is the sharp edge. Both are "a restored
 * session whose token will not refresh", and the only thing separating them is
 * `isAnonymous` — get it wrong and a servant with a revoked account is silently
 * downgraded to a stranger instead of being told to sign in again.
 * ---------------------------------------------------------------------------
 */

const signInAnonymously = vi.fn();
const onAuthStateChanged = vi.fn();

vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInAnonymously: (...args: unknown[]) => signInAnonymously(...args),
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
}));

vi.mock('@/lib/firebase', () => ({
  firebaseApp: () => ({}),
  appCheckTokenForFetch: async () => 'attestation',
}));

/**
 * Whatever `onAuthStateChanged` should hand back as the restored session.
 *
 * The callback fires on a microtask, not synchronously, because that is what
 * the real SDK does and the difference is not cosmetic: `getIdToken` calls the
 * unsubscribe function from *inside* the callback, so a synchronous mock
 * reaches `stop()` before the `const` holding it is initialised and dies with
 * a temporal-dead-zone error that has nothing to do with the code under test.
 */
function restores(user: unknown) {
  onAuthStateChanged.mockImplementation(
    (_auth: unknown, callback: (u: unknown) => void) => {
      queueMicrotask(() => callback(user));
      return () => {};
    },
  );
}

/** A user whose token refresh fails, as a deleted or revoked account's does. */
function deadSession(isAnonymous: boolean, code = 'auth/user-token-expired') {
  return {
    isAnonymous,
    getIdToken: vi.fn().mockRejectedValue(Object.assign(new Error(code), { code })),
  };
}

async function getIdToken() {
  const module = await import('@/lib/uploadSession');
  return module.getIdToken();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  signInAnonymously.mockResolvedValue({
    user: { isAnonymous: true, getIdToken: async () => 'fresh-anon-token' },
  });
});

describe('a servant who is already signed in', () => {
  it('uploads as themselves, and is never signed in anonymously over the top', async () => {
    restores({ isAnonymous: false, getIdToken: async () => 'microsoft-token' });

    expect(await getIdToken()).toBe('microsoft-token');
    // The assertion that matters: their administrator bypass survives.
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});

describe('a stranger with no session', () => {
  it('is signed in anonymously, silently', async () => {
    restores(null);

    expect(await getIdToken()).toBe('fresh-anon-token');
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it('is told something readable when the provider is disabled', async () => {
    // The module logs the console path at error level on this branch, on
    // purpose — swallowed here only so a green run stays readable.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    restores(null);
    signInAnonymously.mockRejectedValue(
      Object.assign(new Error('admin-restricted-operation'), {
        code: 'auth/admin-restricted-operation',
      }),
    );

    // Not the SDK's own text, which names nothing and appeared once per file
    // on every row of a forty-photograph batch.
    await expect(getIdToken()).rejects.toThrow(/not switched on at the moment/);
    // …and it must actually name the switch, since that log is the only thing
    // standing between this failure and an afternoon of guessing.
    expect(logged.mock.calls[0]?.[0]).toMatch(/Sign-in method/);
    logged.mockRestore();
  });
});

describe('a stranger whose anonymous account was swept by automatic clean-up', () => {
  it('is signed in again rather than shown a refresh error', async () => {
    const swept = deadSession(true, 'auth/user-token-expired');
    restores(swept);

    expect(await getIdToken()).toBe('fresh-anon-token');
    expect(swept.getIdToken).toHaveBeenCalledOnce();
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it('also recovers from user-not-found, which is the other shape of the same fault', async () => {
    restores(deadSession(true, 'auth/user-not-found'));

    expect(await getIdToken()).toBe('fresh-anon-token');
  });
});

describe('a servant whose Microsoft session will not refresh', () => {
  it('is told, and NOT quietly downgraded to an anonymous stranger', async () => {
    /*
     * The pair to the swept-session tests above, and the reason `isAnonymous`
     * is checked rather than the error code. Falling through here would take a
     * revoked servant, hand them an anonymous uid, and then refuse them the
     * administrator bypass they still believe they hold — a wrong answer that
     * looks like a working upload.
     */
    restores(deadSession(false, 'auth/user-token-expired'));

    await expect(getIdToken()).rejects.toThrow(/user-token-expired/);
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
