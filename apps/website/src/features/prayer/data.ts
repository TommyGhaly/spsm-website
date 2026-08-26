import type { PrayerRequestInput } from '@spsm/shared';

/**
 * Send a prayer request. Through a Cloud Function, not straight to Firestore.
 *
 * ---------------------------------------------------------------------------
 * This used to be an unauthenticated `addDoc`, and it cannot be any more.
 *
 * The old comment here explained at length why the write went straight from the
 * browser with `firestore.rules` bounding it: authentication is Microsoft-only
 * against the parish tenant, so a parishioner has no account, and requiring one
 * would have meant the only people able to ask for prayer were the people you
 * would ask in person anyway. All of that is still true, and none of it changed.
 *
 * What changed is that the bodies are sealed now — AES-256-GCM under a Secret
 * Manager key, so the database holds envelopes rather than sentences. Sealing
 * needs the key, and a key shipped to a browser is not a key. So the write moved
 * into `prayerSubmit`, which validates with the same shared validator this form
 * runs, seals, and writes with the Admin SDK.
 *
 * `firestore.rules` now closes the collection to clients in both directions.
 * See docs/decisions.md #1, which this supersedes.
 *
 * The privacy properties that survive intact:
 *   - no account needed, still;
 *   - anonymity is still *absence* rather than a flag, so an anonymous request
 *     cannot be un-anonymised later — including by us — and the submitter
 *     equally cannot edit or withdraw it.
 * ---------------------------------------------------------------------------
 */
export type SubmitOutcome =
  | { ok: true; id: string }
  | { ok: false; errors: string[] };

export async function submitPrayerRequest(input: PrayerRequestInput): Promise<SubmitOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/prayer/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: input.body,
        visibility: input.visibility,
        anonymous: input.anonymous,
        // Both null when anonymous. The Function enforces this again; sending
        // them would not help anyone and there is no reason to transmit a name
        // somebody asked us not to keep.
        authorName: input.anonymous ? null : input.authorName,
        contactEmail: input.contactEmail,
        kind: input.kind,
        commemoration: input.commemoration,
      }),
    });
  } catch {
    return {
      ok: false,
      errors: ['Could not reach the parish server. Check your connection and try again.'],
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    /*
     * Not JSON. In production that means the Hosting rewrite for this path is
     * missing; locally it means the Functions emulator is not running. Neither
     * is something the person asking for prayer can act on.
     */
    console.error(
      `[prayer] ${response.status} from /api/prayer/submit, and the body was not JSON. ` +
        'That endpoint is a Cloud Function behind a Hosting rewrite.',
    );
    return { ok: false, errors: ['That did not send. Please try again shortly.'] };
  }

  if (!response.ok) {
    const errors = Array.isArray(payload['errors'])
      ? (payload['errors'] as unknown[]).map(String).filter(Boolean)
      : [];
    return { ok: false, errors: errors.length > 0 ? errors : ['That did not send.'] };
  }

  return { ok: true, id: String(payload['id'] ?? '') };
}
