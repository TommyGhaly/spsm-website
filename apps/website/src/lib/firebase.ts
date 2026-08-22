/**
 * Firebase client SDK, one instance per process.
 *
 * The same code path serves two very different callers:
 *
 *   - `next build`, running in Node, reading published content to bake into
 *     static HTML. Unauthenticated, so it sees exactly what a stranger sees —
 *     which is a useful property: if a page renders during the build, the
 *     public can read it. If firestore.rules ever tightens by mistake, the
 *     build goes blank rather than shipping content that then 403s at runtime.
 *
 *   - The browser, for the interactive parts (auth, prayer requests, vehicle
 *     registration) that a static file cannot do.
 *
 * `getPublicConfig` throws with the exact missing variable names, which is what
 * we want at build time. At runtime in the browser the values were inlined by
 * Next at build time, so a throw there means the build itself was misconfigured.
 */
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { getPublicConfig } from '@spsm/shared';

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` by literal textual match, so the
 * names have to appear spelled out rather than looked up dynamically. Building
 * the object here and handing it to the shared validator keeps the one place
 * that knows the names separate from the one place that knows the rules.
 */
function publicEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };
}

export function firebaseApp(): FirebaseApp {
  if (getApps().length > 0) return getApp();
  return initializeApp(getPublicConfig(publicEnv()));
}

/**
 * Opt-in local mode, for working on anything behind a sign-in.
 *
 * `npm run dev` normally reads the real Firestore, which is right for the public
 * pages — they render published content and nothing else. The admin is
 * different: it needs a signed-in user with a role, and the only way to get one
 * against the real project is to be a real member of the parish directory. That
 * makes the emulators the only way to develop /admin at all, and the only way
 * to try a destructive action without doing it to the parish.
 *
 * Off unless `NEXT_PUBLIC_USE_EMULATORS` is set, so the default stays "real
 * data" and nobody ships a build wired to localhost. Next inlines the name by
 * literal match, hence spelling it out.
 */
export function usingEmulators(): boolean {
  return process.env.NEXT_PUBLIC_USE_EMULATORS === '1';
}

/**
 * App Check: proving a request came from this site rather than from a script.
 *
 * This exists because of one feature. Program galleries accept photographs from
 * people with no account — no sign-in, no email, no name — so every social
 * deterrent that normally limits abuse is gone, and the only thing between the
 * parish and somebody's upload loop is this. reCAPTCHA Enterprise scores the
 * browser, App Check turns that score into a short-lived token, and Cloud
 * Storage refuses requests that arrive without one.
 *
 * ## Initialized from `db()` and `storage()`, not at module load
 *
 * Both because of *where* this code runs and *when* it has to have run.
 *
 * `next build` executes this module in Node to bake the static pages. There is
 * no browser there, no reCAPTCHA, and nothing to attest — so initialising at
 * module scope would throw during every build. The `window` guard below is what
 * makes that safe.
 *
 * And App Check has to be initialised *before* the first Firestore or Storage
 * request goes out, or that request carries no token. Every path to either
 * service runs through these two accessors, which makes them the one place that
 * is both late enough to be in a browser and early enough to matter.
 *
 * ## Deliberately non-fatal
 *
 * Every failure here is swallowed. An unregistered app, a blocked reCAPTCHA
 * script, a misconfigured key — none of them should take the parish website
 * down. While enforcement is off the request succeeds anyway; once it is on,
 * the request fails at Storage with a clear error rather than at page load with
 * a blank screen. A church site that renders is worth more than one that proves
 * a point about attestation.
 */
let appCheckStarted = false;

function ensureAppCheck(): void {
  if (appCheckStarted) return;
  // Node, during the export build. There is nothing to attest and no browser
  // API to attest with.
  if (typeof window === 'undefined') return;
  // The emulators ignore App Check entirely, and initialising it locally only
  // produces console noise about a token that nothing will check.
  if (usingEmulators()) return;

  // Spelled out rather than looked up, because Next inlines `NEXT_PUBLIC_*` by
  // literal textual match — same rule as `publicEnv()` above.
  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) return; // Not configured yet. Inert, rather than broken.

  const debugToken = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN;

  /*
   * Localhost without a debug token: do not start App Check at all.
   *
   * This is not a convenience, it is a fix for a regression this file caused.
   * Starting App Check here and having the attestation fail does NOT degrade
   * gracefully — the Firestore SDK waits on a token before it will send, so a
   * 400 from the reCAPTCHA exchange surfaces as
   *
   *     @firebase/app-check: AppCheck: 400 error
   *     Could not reach Cloud Firestore backend. Backend didn't respond
   *     within 10 seconds.
   *
   * and every page that reads Firestore renders empty. Which reads as "the
   * database is down", not as "attestation is misconfigured", and cost an hour
   * to trace the first time.
   *
   * Enforcement is what App Check is *for*, and it is a property of the backend
   * rather than of this client — an unenforced project accepts requests with no
   * token at all. So skipping it locally costs nothing real and removes a whole
   * class of "the site is broken on my laptop". The moment a debug token is
   * present the branch below runs and the full path is exercised, which is
   * exactly when somebody is deliberately testing enforcement.
   */
  const local =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (local && !debugToken) {
    console.info(
      '[appcheck] skipped on localhost — no NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN set. ' +
        'Add one from Firebase console → App Check → Apps → Manage debug tokens to test it.',
    );
    return;
  }

  appCheckStarted = true;

  try {
    /*
     * A debug token is a BYPASS. It tells App Check to accept this browser
     * without a real attestation, which is the only way `npm run dev` works
     * against the real project — there is no reCAPTCHA for localhost that
     * would satisfy an enforced backend.
     *
     * Set on `self` before `initializeAppCheck`, which is the only point the
     * SDK reads it. Guarded by NODE_ENV as well as by the variable being
     * present: this must be impossible to switch on in a production build with
     * a stray environment variable, exactly as the emulator branch in
     * lib/authStore.ts is. `NODE_ENV` is always `production` in a build, so the
     * whole branch folds out of the shipped bundle.
     */
    if (process.env.NODE_ENV === 'development' && debugToken) {
      (self as unknown as Record<string, unknown>)['FIREBASE_APPCHECK_DEBUG_TOKEN'] = debugToken;
    }

    initializeAppCheck(firebaseApp(), {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      // Refresh in the background so a long-lived tab — the kiosk running a
      // gallery presentation in the hall all evening — does not reach the end
      // of its token's life mid-slideshow and start failing reads.
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    // Already initialised (a second call for the same app throws), or the
    // provider could not start. Neither is worth breaking a page over.
    console.warn('[appcheck] could not start App Check:', error);
  }
}

let firestoreConnected = false;

export function db(): Firestore {
  ensureAppCheck();
  const instance = getFirestore(firebaseApp());

  // `connectFirestoreEmulator` throws if the instance has already been used, so
  // this has to happen on first access and exactly once.
  if (usingEmulators() && !firestoreConnected) {
    firestoreConnected = true;
    connectFirestoreEmulator(instance, '127.0.0.1', 8080);
  }
  return instance;
}

let storageConnected = false;

/**
 * Cloud Storage, for program gallery photographs.
 *
 * Browser-only in practice. The static build never touches this: an approved
 * item's public URL is derived from its storage path, so nothing has to be
 * fetched at build time, and the one caller that does upload — the submission
 * form — cannot run in Node anyway.
 */
export function storage(): FirebaseStorage {
  ensureAppCheck();
  const instance = getStorage(firebaseApp());

  if (usingEmulators() && !storageConnected) {
    storageConnected = true;
    connectStorageEmulator(instance, '127.0.0.1', 9199);
  }
  return instance;
}

/**
 * Whether the six required values are present.
 *
 * Used to decide between "render the site" and "render a setup notice" — a
 * missing `.env.local` should produce a page that says so, not a stack trace
 * in the build log that someone has to scroll back to find.
 */
export function isConfigured(): boolean {
  try {
    getPublicConfig(publicEnv());
    return true;
  } catch {
    return false;
  }
}
