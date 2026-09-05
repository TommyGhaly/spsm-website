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
import { createHash } from 'node:crypto';
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

/* ---------------------------------------------------------------------------
 * Charging a card
 * ------------------------------------------------------------------------ */

export type Charged =
  | { ok: true; paymentId: string }
  | { ok: false; status: number; reason: string };

/**
 * Charge a card for an amount the *server* worked out.
 *
 * ---------------------------------------------------------------------------
 * A bare payment, not an order — unlike the bookstore.
 *
 * `checkout.ts` builds a Square *order* out of catalog ids and lets Square
 * price it, which is what makes the bookstore's totals untamperable: the
 * browser has nowhere to put a price because it never sends one.
 *
 * A form and a camp sign-up have no Square catalog behind them. Nothing in the
 * parish's Square account corresponds to "summer camp, servant shirt", and
 * inventing catalog objects per form would put the prices in a second system
 * somebody would then have to keep in step. So the guarantee is rebuilt on our
 * side instead: the amount is computed from a document in Firestore that the
 * submitter cannot write, and the browser's copy of that number is a display,
 * never an input. **Every caller must pass an amount it derived itself.**
 * ---------------------------------------------------------------------------
 *
 * Lifted out of `forms/submit.ts` when the camp's servant sign-up needed to
 * take a payment too. A second copy would have been a second place to get the
 * sandbox/production token pairing wrong, which is the mistake this whole
 * module exists to make impossible.
 *
 * The idempotency key is derived from the request rather than random. A
 * single-use token can only be charged once anyway, but deriving the key means
 * a retried request carrying the same token maps to the same key, and Square
 * returns the original payment instead of an error about a spent token.
 *
 * **Everything else in the body has to be derived too, and this was wrong.**
 * `reference_id` was `randomUUID()`, so the *second* attempt sent the same
 * idempotency key with a different body — and Square does not answer that with
 * the original payment, it answers `Different request parameters used for the
 * same idempotency_key`, which arrives here as a 402 and is shown to the payer
 * as a decline. So the retry that this key exists to make safe was the one
 * thing it broke. Found by charging Square's sandbox twice with its own test
 * nonce; there is no way to see it from a single attempt.
 */
export async function chargeCard(input: {
  cardToken: string;
  totalCents: number;
  note: string;
  buyerEmail: string | null;
  /** What the log lines are tagged with: `forms`, `camp`. */
  tag: string;
}): Promise<Charged> {
  const square = squareClient();
  if (!square) {
    return { ok: false, status: 503, reason: 'Payments are not set up on this site yet.' };
  }

  /*
   * One hash for the whole request, and both derived fields come off it.
   *
   * The amount and the note are in it as well as the token: two charges that
   * differ in what they are for are two charges, and a key that ignored the
   * difference would answer the second with the first one's payment.
   */
  const fingerprint = createHash('sha256')
    .update(`${input.cardToken}|${input.totalCents}|${input.note}`)
    .digest('hex');
  const idempotencyKey = fingerprint.slice(0, 45);

  let response: Response;
  try {
    response = await fetch(`${square.host}/v2/payments`, {
      method: 'POST',
      headers: square.headers,
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        source_id: input.cardToken,
        location_id: square.locationId,
        amount_money: { amount: input.totalCents, currency: 'USD' },
        note: input.note.slice(0, 500),
        ...(input.buyerEmail ? { buyer_email_address: input.buyerEmail } : {}),
        /*
         * Square's own reference for the parish's records. Nothing on our side
         * looks a payment up by it — but it must be *derived*, not random: see
         * the note above. A retry has to send a byte-identical body or the
         * idempotency key it shares with the first attempt is refused.
         */
        reference_id: fingerprint.slice(0, 40),
      }),
    });
  } catch (error) {
    console.error(`[${input.tag}] could not reach Square`, error);
    return { ok: false, status: 502, reason: 'The payment service could not be reached.' };
  }

  const json = (await response.json().catch(() => ({}))) as {
    payment?: { id?: string };
    errors?: { detail?: string }[];
  };

  if (!response.ok || !json.payment?.id) {
    console.error(`[${input.tag}] payment failed`, JSON.stringify(json.errors));
    // Square's decline messages are written for buyers, so pass one through
    // rather than replacing it with something vaguer.
    return {
      ok: false,
      status: 402,
      reason: json.errors?.[0]?.detail ?? 'The card was declined.',
    };
  }

  return { ok: true, paymentId: json.payment.id };
}
