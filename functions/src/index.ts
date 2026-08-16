import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { COLLECTIONS } from '@spsm/shared';

initializeApp();

// Sign-in and roles. See functions/src/auth.ts — Microsoft-only, restricted to
// the parish Entra tenant, and tenant membership is what grants `servant`.
export { enforceTenantOnCreate, setMemberRole } from './auth.js';

// Declared as secrets, not env vars: these are read from Secret Manager at
// runtime and never appear in source, in git, or in a deployed bundle.
const SQUARE_ACCESS_TOKEN = defineSecret('SQUARE_ACCESS_TOKEN');
const SQUARE_WEBHOOK_SIGNATURE_KEY = defineSecret('SQUARE_WEBHOOK_SIGNATURE_KEY');

/**
 * Square webhook listener. Routed here by the `/api/square/webhook` rewrite in
 * firebase.json.
 *
 * Not implemented yet — deliberately returns 503 rather than 200, so that if
 * this is ever wired up in the Square dashboard before the logic exists, Square
 * retries the event instead of discarding it as delivered.
 *
 * When implementing, in this order:
 *   1. Verify the HMAC signature against SQUARE_WEBHOOK_SIGNATURE_KEY using the
 *      RAW request body. Reject on mismatch before parsing anything. Without
 *      this, anyone who finds the URL can mark orders paid.
 *   2. Check `appliedEventIds` on the order — Square redelivers, and a replayed
 *      refund event must not double-apply.
 *   3. Only then update the order via PaymentProvider.interpretWebhook.
 */
export const squareWebhook = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY], cors: false },
  async (req, res) => {
    void COLLECTIONS.orders;
    res.status(503).json({ error: 'Square webhook handler not yet implemented.' });
  },
);

// The weekly bulletin is NOT synced here any more. The website reads the
// announcements project directly at build time — see
// apps/website/src/features/bulletin/data.ts and docs/integrations.md. There is
// no scheduled Function and no copy in our Firestore.
