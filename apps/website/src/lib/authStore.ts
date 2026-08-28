/**
 * The header's view of who is signed in.
 *
 * **This module must never statically import ./auth, or anything from
 * `firebase/auth`.** It is reached from the masthead, the masthead renders on
 * every page, and the whole point of the rule at the top of ./auth.ts is that
 * the ~150KB auth SDK stays off the homepage. Every route into it here is a
 * dynamic `import('./auth')`, which Next splits into its own chunk and fetches
 * only when one of two things happens: the hint in ./authHint.ts says a session
 * is probably live, or somebody actually clicks sign in. A parishioner reading
 * the calendar does neither and downloads none of it.
 *
 * A module singleton rather than a React context, because the control is
 * rendered twice — inline in the bar on a wide screen, and inside the
 * disclosure panel below the breakpoint, the same both-trees-and-CSS-picks
 * arrangement `SiteNav` uses. Two components, one subscription, one SDK load.
 * A context would have needed a provider in the root layout, which is a server
 * component and is the one place we cannot put a client boundary.
 *
 * Read through `useAuthSession` in components/HeaderAuth.tsx; nothing else
 * should subscribe. /admin and /servants keep using `AdminGate` — they are
 * behind a gate that has already paid for the SDK, and they need the full user
 * object rather than the four fields kept here.
 */
import { type SpsmClaims } from '@spsm/shared';
import { hasSessionHint, setSessionHint } from './authHint';

/**
 * `restoring` is the state that earns this design.
 *
 * It means "the hint says yes and the SDK is on its way" — the signed-in user's
 * first paint. Without it the header would flash "Sign in" at somebody who is
 * signed in, every navigation, for as long as the chunk takes to arrive.
 */
export type AuthState =
  | { kind: 'signed-out' }
  | { kind: 'restoring' }
  | { kind: 'signing-in' }
  | { kind: 'signed-in'; name: string; email: string | null; claims: SpsmClaims }
  | { kind: 'error'; message: string };

/**
 * What the prerendered HTML says, and therefore what almost every visitor sees
 * painted before any JavaScript runs.
 *
 * `signed-out` rather than a blank or a spinner: this is a static export, the
 * signed-out control is the honest answer for all but a few dozen people, and
 * rendering it directly means the header does not reflow on hydration. The
 * signed-in minority get one swap, which is the right way round to spend it.
 */
const SERVER_STATE: AuthState = { kind: 'signed-out' };

let state: AuthState =
  typeof window !== 'undefined' && hasSessionHint()
    ? { kind: 'restoring' }
    : { kind: 'signed-out' };

const listeners = new Set<() => void>();

/**
 * Suppresses the `signed-out` that Firebase reports while a popup is open.
 *
 * `onAuthChange` fires as soon as persistence resolves, which for someone
 * signing in fresh is "no user" — and that would flip the button from "Opening
 * Microsoft…" back to "Sign in" while their popup is still on screen, reading
 * as if the click had been dropped.
 */
let pendingSignIn = false;

/** The live `onAuthChange` subscription, once the SDK is loaded. Attached once. */
let detach: (() => void) | null = null;

/**
 * Resolves once Firebase has given its first answer, so `signIn` can wait for
 * the SDK to make up its mind before deciding whether to open a popup.
 *
 * It carries no answer of its own, deliberately. It used to resolve with
 * `user !== null` and `signIn` read *that* — a value frozen at the first
 * transition of the page's life — as "are you signed in right now". Sign in,
 * sign out, click sign in again, and the memoised `true` said a session was
 * live: no popup, no error, the button stuck on "Opening Microsoft…" until a
 * reload threw the module away. Whether somebody is signed in is a live fact
 * and is kept in `hasLiveSession`.
 */
let firstAnswer: Promise<void> | null = null;

/**
 * What Firebase last reported, updated on every transition — the answer to
 * "signed in right now?", as opposed to `state`, which also holds the
 * in-between kinds the header paints.
 */
let hasLiveSession = false;

function emit(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

type AuthModule = typeof import('./auth');

/** Loads the SDK and attaches the listener. Idempotent — safe to await anywhere. */
async function attach(): Promise<{ mod: AuthModule; signedIn: boolean }> {
  const mod = await import('./auth');

  if (!firstAnswer) {
    firstAnswer = new Promise<void>((resolve) => {
      let settled = false;
      detach = mod.onAuthChange((user, claims) => {
        hasLiveSession = user !== null;
        if (!settled) {
          settled = true;
          resolve();
        }
        if (user) {
          pendingSignIn = false;
          emit({
            kind: 'signed-in',
            // `displayName` is what Entra sends and what a person recognises;
            // the email is the fallback for an account that has not set one.
            name: user.displayName ?? user.email ?? 'Signed in',
            email: user.email,
            claims,
          });
        } else if (!pendingSignIn) {
          emit({ kind: 'signed-out' });
        }
      });
    });
  }

  // Read after the await, not before: `hasLiveSession` is whatever the most
  // recent transition said, which is the only thing worth acting on.
  await firstAnswer;
  return { mod, signedIn: hasLiveSession };
}

let started = false;

/**
 * Called on first subscribe. Loads the SDK only if the hint says there is
 * something to restore — this is the branch that keeps the homepage light.
 */
function start(): void {
  if (started) return;
  started = true;
  if (state.kind !== 'restoring') return;
  void attach().catch(() => {
    // The chunk failed, or Firebase is misconfigured. Falling back to
    // signed-out leaves a working sign-in button rather than a stuck spinner.
    emit({ kind: 'signed-out' });
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  // The subscription to Firebase itself is deliberately not torn down: the
  // header is mounted for the whole session, and dropping it on the last
  // unsubscribe would only re-attach on the next render.
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AuthState {
  return state;
}

export function getServerSnapshot(): AuthState {
  return SERVER_STATE;
}

/**
 * Sign in, skipping the popup when there is already a session.
 *
 * That second case is not hypothetical: it is exactly what a stale hint looks
 * like — somebody who signed in on /admin before this control existed, or whose
 * localStorage was cleared while their Firebase session survived in IndexedDB.
 * They click "Sign in", we load the SDK, discover they already are, and the
 * header just fills in. No popup, no second trip to Microsoft.
 */
export async function signIn(): Promise<void> {
  if (state.kind === 'signing-in') return;

  pendingSignIn = true;
  emit({ kind: 'signing-in' });

  try {
    const { mod, signedIn } = await attach();
    if (signedIn) {
      pendingSignIn = false;
      return; // The listener has already emitted `signed-in`.
    }

    /*
     * Local development never opens the Microsoft popup.
     *
     * `signInWithEmulatorAccount` was written so the admin would be
     * developable — "every role check needs a signed-in user with a claim" —
     * and then nothing ever called it, so the only way in locally was the
     * popup. Against the Auth emulator that is a round trip through its IdP
     * widget in a second window, which is slow, needs the account picked by
     * hand every time, and fails outright wherever popups are blocked.
     *
     * Which account is a URL question: `?as=lead` on any page signs in as
     * lead@spsmwayland.org. That is what makes the program-grant model
     * testable — the whole point of it is that `lead` and `volunteer` see
     * different things, and comparing them should be an edit to the address
     * bar rather than a sign-out and a re-pick.
     *
     * **`NODE_ENV` is checked first, and it is the part that matters.** The
     * public flag alone left this branch in the production bundle, reading the
     * variable at runtime rather than folded away — so a build made with
     * `NEXT_PUBLIC_USE_EMULATORS=1` still in the environment would have shipped
     * a site whose sign-in tried a seeded password against the real project.
     * That is an easy environment to be in by accident; it is the one every
     * local build of this app uses. `NODE_ENV` is always `production` in a
     * build, so this whole branch folds out and cannot be switched back on by
     * an environment variable.
     *
     * Deliberately not imported from lib/firebase: this module lazy-loads the
     * SDK on purpose, and importing anything from there would pull it into
     * every page's bundle.
     */
    if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_USE_EMULATORS === '1') {
      await mod.signInWithEmulatorAccount(emulatorAccount(), 'emulator-only');
      pendingSignIn = false;
      return;
    }

    await mod.signInWithMicrosoft();
    pendingSignIn = false;
    // `onAuthChange` emits `signed-in`; there is nothing to do here.
  } catch (error) {
    pendingSignIn = false;
    // The raw error, once, where a developer will look. The strings below are
    // for the person in the parish office; this is the `auth/...` code and the
    // stack, which is what actually gets a misconfiguration fixed.
    console.error('[auth] Microsoft sign-in failed:', error);
    // An empty explanation means "not worth reporting" — closing the popup is
    // the only case, and it should look like never having clicked.
    const message = explain(error);
    emit(message === '' ? { kind: 'signed-out' } : { kind: 'error', message });
  }
}

/**
 * Which seeded account `?as=` asks for. Local development only.
 *
 * A bare name is expanded, so `?as=volunteer` is enough and nobody has to type
 * the domain. Defaults to the admin, because that is the account somebody
 * signing in locally almost always wants.
 */
function emulatorAccount(): string {
  const asked =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('as');

  if (!asked) return 'admin@spsmwayland.org';
  return asked.includes('@') ? asked : `${asked}@spsmwayland.org`;
}

/**
 * Turns a Firebase error into something worth putting in the masthead.
 *
 * Firebase puts the code in the message as `(auth/thing)`, so matching on the
 * text is safe and avoids importing `FirebaseError` — which would mean a static
 * `firebase/app` import in the one module that must not have one.
 *
 * The three that are configuration rather than user error say what to change
 * and where, because the person who sees them first is the person who can fix
 * them, and "sign-in failed" would send them to the code instead of the console.
 *
 * Returns the empty string for "say nothing", which the caller reads as a
 * cancelled sign-in rather than a failed one.
 */
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Sign-in failed.';

  // Closing the popup is a decision, not a failure — it puts you back where you
  // started. Same carve-out as AdminGate, for the same reason.
  if (message.includes('popup-closed-by-user') || message.includes('cancelled-popup')) {
    return '';
  }
  if (message.includes('popup-blocked')) {
    return 'Your browser blocked the Microsoft sign-in window. Allow popups for this site, then try again.';
  }
  /*
   * The one that bites on a new domain. Firebase refuses to open the popup at
   * all unless the *site's own* origin is on Authentication → Settings →
   * Authorized domains. It is not the Entra redirect URI, which is a different
   * list in a different portal, and the two get confused constantly — hence
   * naming both here.
   */
  if (message.includes('unauthorized-domain')) {
    return `${location.hostname} is not an authorized domain for this Firebase project. Add it under Authentication → Settings → Authorized domains.`;
  }
  // What a redirect-URI mismatch surfaces as by the time it reaches us: Entra
  // refuses, the handler closes, and Firebase reports the popup as closed.
  if (message.includes('operation-not-allowed')) {
    return 'Microsoft sign-in is not enabled on this Firebase project, or its client ID and secret are missing.';
  }
  if (message.includes('network-request-failed')) {
    return 'Could not reach Microsoft. Check your connection and try again.';
  }
  /*
   * A rejection from `enforceTenantOnCreate`, our own blocking function.
   *
   * Firebase wraps whatever the function threw in an `auth/internal-error`
   * whose message is a JSON envelope with the real sentence buried three levels
   * down — so the user was shown a wall of `{"error":{"message":...}}` for what
   * is, in fact, a plain and deliberate refusal. Dig the sentence out and show
   * only that; the envelope is already in the console for whoever needs it.
   */
  const blocked = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(message);
  if (blocked && message.includes('Cloud Function')) {
    try {
      return JSON.parse(`"${blocked[1]}"`) as string;
    } catch {
      return blocked[1] ?? message;
    }
  }
  /*
   * Browser storage, not Microsoft. This surfaced as the raw string "the
   * database connection is closing" after a sign-in that had otherwise
   * *succeeded* — Firebase used to persist the session to IndexedDB, and the
   * write failed. `auth()` now pins persistence to localStorage so this should
   * be unreachable; it stays because the raw DOMException text reads like a
   * database outage and sent us looking in the wrong place once already.
   */
  if (
    message.includes('database connection is closing') ||
    message.includes('InvalidStateError') ||
    message.includes('indexedDB')
  ) {
    return 'Your browser blocked the storage this sign-in needs. Close any other tabs of this site and try again.';
  }
  return message;
}

/**
 * Sign out, and end up signed out even when Firebase refuses to.
 *
 * This used to `await mod.signOut()` inside a bare `try/catch {}` and leave the
 * UI to `onAuthChange`. That is fine when the call succeeds and silently broken
 * when it throws — the listener never fires, nothing is logged, and the header
 * goes on showing your initials as though the click missed. Which is exactly
 * what happened: `signOut` touches the same persistence layer that was throwing
 * `Database is closing/hidden`, so the one path that most needed to survive a
 * storage failure was the one that swallowed it.
 *
 * So the local state is cleared unconditionally, before the await. Signing out
 * is the action where a false "you are still signed in" is worst — someone on a
 * shared machine deserves the sign-out to look like it worked even if the token
 * revocation did not. Firebase's own listener will confirm it a moment later
 * and agree.
 */
export async function signOut(): Promise<void> {
  try {
    const mod = await import('./auth');
    await mod.signOut();
    // `onAuthChange` emits `signed-out`; this is belt and braces for the case
    // where the listener was never attached in this page's lifetime.
    hasLiveSession = false;
    emit({ kind: 'signed-out' });
  } catch (error) {
    // Loud, unlike before. A sign-out that fails is worth knowing about, and
    // the raw error is the only thing that says why.
    console.error('[auth] sign-out failed:', error);
    setSessionHint(false);
    // Whatever the SDK still thinks, this session is over as far as the header
    // is concerned — and leaving this set would make the next `signIn` skip the
    // popup on the strength of a session that just failed to end.
    hasLiveSession = false;
    emit({ kind: 'signed-out' });
  }
}

