/**
 * The public half of the Square configuration.
 *
 * These three are not secrets — the application id and location id are visible
 * in the network tab of any site using the Web Payments SDK, and they authorize
 * nothing on their own. The token that *does* authorize charges never leaves
 * the Cloud Functions runtime.
 *
 * Read through explicit `process.env.X` rather than a loop: Next inlines these
 * by literal textual match at build time, so a computed key silently becomes
 * `undefined` in the browser.
 *
 * The environment matters as much as the ids. Square publishes two SDKs and two
 * sets of credentials, and a sandbox application id against the production SDK
 * fails at `payments()` with a message about the application id — which reads
 * like a wrong id rather than a wrong environment, and costs an hour.
 */
export function squarePublicConfig(): {
  applicationId: string;
  locationId: string;
  sandbox: boolean;
} {
  const applicationId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID ?? '';
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? '';
  const environment = process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? '';

  if (!applicationId || !locationId) {
    console.warn(
      '[bookstore] NEXT_PUBLIC_SQUARE_APPLICATION_ID or NEXT_PUBLIC_SQUARE_LOCATION_ID is ' +
        'not set, so the card form cannot be rendered and the basket will say checkout ' +
        'is unavailable. See .env.example.',
    );
  }

  /*
   * Derived from the application id when the environment is not stated.
   *
   * Square prefixes sandbox application ids with `sandbox-`, which makes the id
   * itself the most reliable signal available — more reliable than a separate
   * variable someone can forget to change when they swap the credentials.
   */
  const sandbox = environment
    ? environment !== 'production'
    : applicationId.startsWith('sandbox-');

  return { applicationId, locationId, sandbox };
}
