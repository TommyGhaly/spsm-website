/**
 * What a failed upload actually means.
 *
 * This module exists because of one production incident and the wording of one
 * SDK error. On 2026-09-03 every staff upload on the live site failed with
 *
 *     Firebase Storage: User is not authenticated, please authenticate using
 *     Firebase Authentication and try again. (storage/unauthenticated)
 *
 * reported by somebody who was signed in, holding the `events` grant, looking
 * at an editor that only renders for people who hold it. The message is a lie
 * in every particular, and it cost an afternoon.
 *
 * The mechanism, because it will come back:
 *
 *   - Cloud Storage answers 401 for *two* different refusals — a rules denial
 *     with no auth token, and App Check enforcement with no attestation token.
 *   - The Storage SDK tells them apart by substring. `sharedErrorHandler` in
 *     @firebase/storage reports `storage/unauthorized-app` only when the
 *     server's body contains the exact text `Firebase App Check token is
 *     invalid`. A *missing* token does not say that, so it falls through to
 *     `unauthenticated()` — which is hard-coded to talk about sign-in.
 *   - App Check enforcement is per service. Storage is ENFORCED; Firestore is
 *     UNENFORCED, deliberately, because `next build` reads Firestore from Node
 *     where nothing can attest. So an attestation outage leaves sign-in, the
 *     grants read, and every editor working perfectly, and breaks uploads
 *     alone. Every symptom points away from the cause.
 *
 * So: never show the SDK's own message for a 401. Ask App Check whether it can
 * mint a token, and say which of the two things is wrong.
 */
import { appCheckTokenForFetch } from './firebase';

function codeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Turn a Storage failure into something true.
 *
 * Async because the diagnosis is a live question — "can this browser attest
 * right now?" — and the only honest way to answer it is to try. The call is
 * cheap and cached by the App Check SDK, and it only happens on a path that
 * has already failed.
 *
 * Anything that is not a 401 is returned unchanged: the rest of the SDK's
 * messages are accurate, and rewriting them would only hide detail.
 */
export async function explainUploadFailure(error: unknown): Promise<Error> {
  const code = codeOf(error);

  if (code === 'storage/unauthorized') {
    return new Error(
      'Cloud Storage refused the upload. Your account is signed in but does not hold the ' +
        'grant for this area — ask a superadmin to allocate it on /access.',
    );
  }

  if (code !== 'storage/unauthenticated' && code !== 'storage/unauthorized-app') {
    return error instanceof Error ? error : new Error('The upload failed.');
  }

  // The discriminating question. `appCheckTokenForFetch` returns null when App
  // Check is not running at all *and* when the exchange fails — both of which
  // mean an enforced bucket will refuse every request from this browser.
  const attested = await appCheckTokenForFetch();

  if (!attested) {
    return new Error(
      'The upload was refused because this browser could not prove it is the parish site. ' +
        'App Check is enforced on Cloud Storage, and no attestation token could be minted — ' +
        'so this is a configuration or reCAPTCHA problem, not a sign-in problem. Check ' +
        'Firebase console → App Check → Apps that the reCAPTCHA Enterprise key is registered ' +
        'for this web app, and that the key allows the domain you are on.',
    );
  }

  if (code === 'storage/unauthorized-app') {
    return new Error(
      'App Check rejected this browser. The attestation token was minted but refused — ' +
        'check the reCAPTCHA Enterprise score threshold in Firebase console → App Check.',
    );
  }

  // Attestation is fine, so the 401 really is about the person: their session
  // has lapsed under them since the page loaded.
  return new Error('Your session has expired. Reload the page and sign in again.');
}
