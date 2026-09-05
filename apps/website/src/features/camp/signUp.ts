'use client';

import type { CampRegistrationDraft } from '@spsm/shared';

/**
 * Sending a servant's own sign-up.
 *
 * The forms feature's `submitForm` with the camp's body, and deliberately the
 * same shape of error handling — a network failure and a rejection say
 * different things, because "check your connection" is actionable and
 * "sign-up failed" is not.
 *
 * There is no read counterpart and there is not meant to be one. A sign-up
 * lands in `campServantRequests`, which `firestore.rules` refuses to anyone
 * without a program grant on the camp: somebody who has just signed up cannot
 * read back what they sent, and the confirmation on screen is the whole of what
 * they get. That is the cost of an open form with no accounts behind it, and it
 * is why the confirmation says the camp will be in touch rather than offering a
 * link to something they cannot open.
 */
export type SignUpResult = { ok: true } | { ok: false; errors: string[] };

export async function sendServantSignUp(input: {
  registration: CampRegistrationDraft;
  message: string;
  /**
   * A single-use Square token, when the camp charges its servants.
   *
   * Sent with the answers rather than charged separately, for the reason
   * `FormPaymentStep` gives: a form that took the money and then failed to
   * store the sign-up would have charged somebody for a place the camp has no
   * record of. One request, one Function, one place that decides both.
   */
  cardToken?: string;
}): Promise<SignUpResult> {
  let response: Response;
  try {
    response = await fetch('/api/camp/servant-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration: input.registration,
        message: input.message,
        ...(input.cardToken ? { cardToken: input.cardToken } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      errors: ['Could not reach the church server. Check your connection and try again.'],
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    /*
     * Not JSON. In production that is Hosting serving the 404 page because the
     * rewrite is missing; locally it is the Next dev proxy with no Functions
     * emulator behind it. Both are configuration rather than anything the
     * person signing up can fix, so the console gets the detail.
     */
    console.error(
      `[camp] ${response.status} from /api/camp/servant-request, and the body was not JSON. ` +
        'In production that means the Hosting rewrite for this path is missing; ' +
        'locally it means the Functions emulator is not running. See docs/local-dev.md.',
    );
    return { ok: false, errors: ['Could not send the sign-up. Please try again shortly.'] };
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(payload['errors'])
    ? (payload['errors'] as unknown[]).map(String).filter(Boolean)
    : [];

  /*
   * Errors are read on a 200 as well, and that is not belt and braces.
   *
   * There is exactly one success status that carries them: the card was
   * charged and the sign-up then failed to store. The endpoint answers 200
   * because the money genuinely moved — the one thing it must not do is invite
   * a second payment — and the sentence it sends says to ring the office
   * rather than try again. Showing it means reading `errors` before `ok`.
   */
  if (!response.ok || errors.length > 0) {
    return {
      ok: false,
      errors: errors.length > 0 ? errors : ['Could not send the sign-up. Please try again.'],
    };
  }

  return { ok: true };
}
