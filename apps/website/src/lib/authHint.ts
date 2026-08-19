/**
 * A one-bit guess at whether somebody is signed in, readable without loading
 * `firebase/auth`.
 *
 * The header now offers sign-in, which means the sign-in control renders on
 * every public page — and the rule at the top of ./auth.ts still stands:
 * `firebase/auth` is ~150KB and must not reach the homepage. Those two facts
 * are only compatible if the header can answer "signed in?" *before* deciding
 * whether to load the SDK.
 *
 * Reading Firebase's own persisted session was the obvious way and is a trap.
 * It lives in IndexedDB (`firebaseLocalStorageDb` v1, store `firebaseLocalStorage`),
 * and `indexedDB.open(name, 1)` *creates* the database when it is absent. A
 * probe that opened it first would leave an empty v1 database with no object
 * store; Firebase would then open it, see a matching version, skip
 * `onupgradeneeded`, and throw `NotFoundError` on its first transaction. The
 * cheap read would have broken sign-in for everyone who was signed out.
 *
 * So this is our own flag, not Firebase's, and it is deliberately only a hint:
 *
 *   - Set/cleared by `onAuthChange` in ./auth.ts, which is the authority. Every
 *     surface that loads the SDK — the header, /admin, /servants — corrects it
 *     as a side effect of doing its normal work.
 *   - Wrong in the safe direction. A false negative shows "Sign in" to somebody
 *     who is already signed in; clicking it loads the SDK, finds the live
 *     session, and skips the popup entirely (see `signIn` in ./authStore.ts).
 *     A false positive loads the SDK for somebody signed out, which is the cost
 *     we were avoiding, once, and it clears itself.
 *
 * Never trust it for access. It is a localStorage string a visitor can type;
 * `firestore.rules` and the ID token decide what anyone can actually read.
 */
const HINT_KEY = 'spsm.auth.signedIn';

/** Whether a session is *likely* live. False on the server and with no storage. */
export function hasSessionHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    // Safari in private mode, and anyone browsing with storage denied. Guessing
    // "signed out" costs such a visitor one popup-free SDK load when they click.
    return false;
  }
}

export function setSessionHint(signedIn: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (signedIn) window.localStorage.setItem(HINT_KEY, '1');
    else window.localStorage.removeItem(HINT_KEY);
  } catch {
    // Storage denied. The hint is an optimisation; losing it is not an error.
  }
}
