/**
 * Configuration boundary.
 *
 * The single most important distinction in this file:
 *
 *   Firebase web config (including `apiKey`) is NOT a secret. It ships in the
 *   browser bundle by design — it identifies the project, it does not authorize
 *   anything. Firestore Security Rules are what protect your data. Publishing
 *   it is expected; treating it as a secret buys nothing and usually leads to
 *   someone putting it somewhere the build can't reach it.
 *
 *   The Square access token IS a secret. It authorizes charges. It must exist
 *   only in the Cloud Functions runtime (Secret Manager), never in
 *   NEXT_PUBLIC_*, never in the client bundle, never in git.
 *
 * Hence two separate accessors below with deliberately different behaviour:
 * `getPublicConfig()` is safe to call anywhere; `getServerSecrets()` throws if
 * called somewhere a bundler could inline it.
 */

export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  /** Only present if Analytics is enabled. */
  measurementId?: string;
}

export interface SquareServerSecrets {
  accessToken: string;
  locationId: string;
  /** Verifies inbound webhook signatures. Without it, webhooks are spoofable. */
  webhookSignatureKey: string;
  environment: 'sandbox' | 'production';
}

/** Thrown with the exact variable names missing, so the fix is obvious. */
export class MissingConfigError extends Error {
  constructor(missing: string[], where: string) {
    super(
      `Missing ${where} configuration: ${missing.join(', ')}. ` +
        `See docs/api-keys.md for where each value comes from.`,
    );
    this.name = 'MissingConfigError';
  }
}

function read(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  // Treat the placeholders in .env.example as absent — otherwise a half-filled
  // .env silently "works" until the first real request fails somewhere else.
  if (!value || value.startsWith('REPLACE_ME')) return undefined;
  return value;
}

/**
 * Safe in the browser. Reads NEXT_PUBLIC_* vars, which Next.js inlines at
 * build time — meaning these must be present when you run `next build`, not
 * when the page is served.
 */
export function getPublicConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): FirebasePublicConfig {
  const fields = {
    apiKey: read(env, 'NEXT_PUBLIC_FIREBASE_API_KEY'),
    authDomain: read(env, 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: read(env, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket: read(env, 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: read(env, 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId: read(env, 'NEXT_PUBLIC_FIREBASE_APP_ID'),
  };

  const missing = Object.entries(fields)
    .filter(([, value]) => value === undefined)
    .map(([key]) => `NEXT_PUBLIC_FIREBASE_${camelToScreamingSnake(key)}`);

  if (missing.length > 0) throw new MissingConfigError(missing, 'Firebase web');

  const measurementId = read(env, 'NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID');
  return {
    ...(fields as Required<typeof fields> as FirebasePublicConfig),
    ...(measurementId ? { measurementId } : {}),
  };
}

/** True when the app can talk to Firebase at all — used to render a setup notice. */
export function isFirebaseConfigured(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): boolean {
  try {
    getPublicConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Server-only. Never import this into a client component.
 *
 * The `window` guard is a runtime tripwire, not real protection — the actual
 * protection is that these names have no NEXT_PUBLIC_ prefix, so Next.js will
 * not inline them into browser code.
 */
export function getServerSecrets(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SquareServerSecrets {
  if (typeof window !== 'undefined') {
    throw new Error('getServerSecrets() must never run in the browser.');
  }

  const accessToken = read(env, 'SQUARE_ACCESS_TOKEN');
  const locationId = read(env, 'SQUARE_LOCATION_ID');
  const webhookSignatureKey = read(env, 'SQUARE_WEBHOOK_SIGNATURE_KEY');

  const missing = [
    accessToken ? null : 'SQUARE_ACCESS_TOKEN',
    locationId ? null : 'SQUARE_LOCATION_ID',
    webhookSignatureKey ? null : 'SQUARE_WEBHOOK_SIGNATURE_KEY',
  ].filter((name): name is string => name !== null);

  if (missing.length > 0) throw new MissingConfigError(missing, 'Square server');

  const environment = read(env, 'SQUARE_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';

  return {
    accessToken: accessToken!,
    locationId: locationId!,
    webhookSignatureKey: webhookSignatureKey!,
    environment,
  };
}

function camelToScreamingSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}
