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
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
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

let firestoreConnected = false;

export function db(): Firestore {
  const instance = getFirestore(firebaseApp());

  // `connectFirestoreEmulator` throws if the instance has already been used, so
  // this has to happen on first access and exactly once.
  if (usingEmulators() && !firestoreConnected) {
    firestoreConnected = true;
    connectFirestoreEmulator(instance, '127.0.0.1', 8080);
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
