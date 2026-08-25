/**
 * The one place that decides which Square we are talking to.
 *
 * ---------------------------------------------------------------------------
 * Environment and token are a pair, and separating them is how money moves by
 * accident.
 *
 * Square issues one access token per environment and they are not
 * interchangeable: the production token returns 401 against
 * `connect.squareupsandbox.com`, and the sandbox token returns 401 against
 * `connect.squareup.com`. Both live in this repo's secrets, and reading the
 * wrong one produces a 401 whose obvious "fix" — flipping SQUARE_ENVIRONMENT to
 * production — leaves the browser still displaying "Test mode, no real money
 * moves" while the backend starts taking real payments.
 *
 * So `squareClient()` returns the host and the matching token together, or it
 * returns nothing. There is deliberately no way to ask for one without the
 * other. Every Function that touches Square goes through here.
 * ---------------------------------------------------------------------------
 */
import { defineSecret, defineString } from 'firebase-functions/params';

export const SQUARE_ACCESS_TOKEN = defineSecret('SQUARE_ACCESS_TOKEN');
export const SQUARE_SANDBOX_ACCESS_TOKEN = defineSecret('SQUARE_SANDBOX_ACCESS_TOKEN');
export const SQUARE_LOCATION_ID = defineString('SQUARE_LOCATION_ID');
export const SQUARE_ENVIRONMENT = defineString('SQUARE_ENVIRONMENT');

export const SQUARE_VERSION = '2025-01-23';

export interface SquareClient {
  host: string;
  locationId: string;
  production: boolean;
  headers: Record<string, string>;
}

/** The host for an environment name. Anything that is not `production` is sandbox. */
export function squareHost(environment: string): string {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

/**
 * Host, token, and location, or null when Square is not configured.
 *
 * Null rather than a throw: "checkout is switched off" is a 503 with a sentence
 * a person can act on, not a stack trace in a log nobody is reading.
 */
export function squareClient(): SquareClient | null {
  const environment = SQUARE_ENVIRONMENT.value();
  const production = environment === 'production';
  const token = production
    ? SQUARE_ACCESS_TOKEN.value()
    : SQUARE_SANDBOX_ACCESS_TOKEN.value() || SQUARE_ACCESS_TOKEN.value();
  const locationId = SQUARE_LOCATION_ID.value();

  if (!token || !locationId) {
    console.error(
      `[square] No access token for SQUARE_ENVIRONMENT=${environment || '(unset)'}, ` +
        'or SQUARE_LOCATION_ID is missing.',
    );
    return null;
  }

  return {
    host: squareHost(environment),
    locationId,
    production,
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
  };
}
