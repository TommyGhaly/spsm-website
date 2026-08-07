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
import { getFirestore, type Firestore } from 'firebase/firestore';
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

export function db(): Firestore {
  return getFirestore(firebaseApp());
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
