'use client';

import type { OrdinationApplicationDraft } from '@spsm/shared';

/**
 * Sending a nomination to `ordinationApply`.
 *
 * The camp's `sendServantSignUp` with the ordination's body, and the same
 * split between "could not reach the server" and "the server said no", because
 * one of those is the sender's to fix and the other is not.
 */
export type ApplyResult = { ok: true } | { ok: false; errors: string[] };

export async function sendNomination(draft: OrdinationApplicationDraft): Promise<ApplyResult> {
  let response: Response;
  try {
    response = await fetch('/api/ordination/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
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
    console.error(
      `[ordination] ${response.status} from /api/ordination/apply, and the body was not JSON. ` +
        'In production that means the Hosting rewrite for this path is missing; ' +
        'locally it means the Functions emulator is not running. See docs/local-dev.md.',
    );
    return { ok: false, errors: ['Could not send the nomination. Please try again shortly.'] };
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(payload['errors'])
    ? (payload['errors'] as unknown[]).map(String).filter(Boolean)
    : [];

  if (!response.ok || errors.length > 0) {
    return {
      ok: false,
      errors: errors.length > 0 ? errors : ['Could not send the nomination. Please try again.'],
    };
  }
  return { ok: true };
}
