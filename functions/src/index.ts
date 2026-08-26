import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  interpretSquareWebhook,
  verifySquareWebhookSignature,
  type OrderStatusUpdate,
} from '@spsm/shared';

initializeApp();

// Sign-in and roles. See functions/src/auth.ts — Microsoft-only, restricted to
// the parish Entra tenant, and tenant membership is what grants `servant`.
export { enforceTenantOnCreate, setMemberRole } from './auth.js';

// Bookstore checkout. Prices from Square's own catalog, never from the request.
export { squareCheckout } from './checkout.js';

// A buyer finding their own orders with no account, because on this site they
// cannot have one. The credential is a receipt: order number plus the email it
// was sent to. See orders.ts.
export { orderLookup } from './orders.js';

// Adding a book to the shop and putting photographs on it. Square first, always
// — a product that exists only in Firestore has no variation id and therefore
// cannot be bought. See catalog.ts.
// Stock and removal go through Square too, for the same reason: `stockCount` is
// on the sync's field mask, and `published` is overwritten on every run — so a
// number or a hide written only to Firestore lasts until the next sync.
export {
  squareCreateProduct,
  squareProductImage,
  squareRemoveProductImage,
  squareProductStock,
  squareArchiveProduct,
} from './catalog.js';

// Refunding an order in full. The parish publishes a no-returns policy; this is
// the door for the exceptions to it, and it records who made one and why.
export { squareRefund } from './refunds.js';

/*
 * Parish forms.
 *
 * `formSubmit` is what every native form posts to: it validates against the
 * stored definition, prices the answers server-side, takes the Square payment
 * when there is one, and pushes a vehicle registration into the Taksis project.
 * `firestore.rules` keeps `formSubmissions` closed to clients precisely so that
 * this is the only way in — see the note above that rule.
 *
 * The two Breeze endpoints are staff-only and answer 503 until BREEZE_API_KEY
 * and BREEZE_SUBDOMAIN are set. Nothing else depends on them.
 */
export { formSubmit } from './forms/submit.js';

/*
 * Prayer requests, sealed.
 *
 * Both directions are Functions because the key cannot be in a browser, and
 * because encrypting without building a read path would leave the parish with a
 * collection nobody can open. `firestore.rules` closes the collection to clients
 * in both directions; the Admin SDK bypasses that. See docs/decisions.md #1,
 * which this supersedes.
 */
export { prayerSubmit, prayerList } from './prayer/index.js';
export { breezeListForms, breezeImportForm } from './forms/breeze.js';

// Bookstore statistics. The shop writes one document per view and cart change
// rather than incrementing a counter — a counter tops out near one write per
// second and would fail first on the most popular book — so all the arithmetic
// happens here, hourly, off the request path. See stats.ts.
export { rollupBookstoreStats, refreshBookstoreStats } from './stats.js';

// The active bulletin, read at request time. The homepage schedule was baked
// into static HTML at build time, so making a different bulletin active in the
// announcements app changed nothing until a redeploy. See bulletin.ts.
export { bulletin } from './bulletin.js';

// Whether a liturgy is streaming right now, and which video it is. YouTube
// sends no CORS header, so unlike the Castr probe this cannot be a fetch from
// the page itself. See live.ts.
export { live } from './live.js';

// Program galleries: transcode on submission, publish on approval, take down on
// rejection. Deployed to us-east1 rather than us-central1 like everything else
// here — a v2 Firestore trigger must sit in the database's own region, and
// spsm-database is us-east1. See the note at the top of galleries.ts.
export { onGalleryMediaCreated, onGalleryMediaReviewed } from './galleries.js';

// Declared as secrets, not env vars: these are read from Secret Manager at
// runtime and never appear in source, in git, or in a deployed bundle.
const SQUARE_ACCESS_TOKEN = defineSecret('SQUARE_ACCESS_TOKEN');
const SQUARE_WEBHOOK_SIGNATURE_KEY = defineSecret('SQUARE_WEBHOOK_SIGNATURE_KEY');

/**
 * Square webhook listener. Routed here by the `/api/square/webhook` rewrite in
 * firebase.json.
 *
 * ---------------------------------------------------------------------------
 * Order of operations, and none of it is rearrangeable.
 *
 *   1. Verify the HMAC over the RAW body before parsing anything. This endpoint
 *      is public and unauthenticated — it must be, because Square calls it —
 *      so the signature is the only thing distinguishing Square from anyone who
 *      finds the URL. Parsing first and verifying later means acting on
 *      attacker-controlled JSON.
 *   2. Guard against replays with `appliedEventIds`. Square redelivers on any
 *      non-2xx and on its own schedule, so the same refund can arrive twice.
 *   3. Only then write, and only inside a transaction, so two deliveries racing
 *      each other cannot both pass the guard.
 *
 * Returns 401 on a bad signature, 200 on anything understood or safely ignored,
 * and 500 only when a retry might genuinely help — Square keeps retrying
 * non-2xx responses for days, so acknowledging an event we will never act on is
 * correct and 500-ing on it is not.
 * ---------------------------------------------------------------------------
 */
export const squareWebhook = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY], cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      // A GET is what a person does when checking the URL is live. Say what
      // this is rather than returning a bare 405 with no explanation.
      res.status(405).json({ error: 'This endpoint accepts POST from Square only.' });
      return;
    }

    const signatureKey = SQUARE_WEBHOOK_SIGNATURE_KEY.value();
    if (!signatureKey) {
      // Refuse rather than accept-without-verifying. An endpoint that processes
      // unsigned events is worse than one that is switched off.
      console.error(
        '[square] SQUARE_WEBHOOK_SIGNATURE_KEY is not set, so no delivery can be ' +
          'verified. Set it with: firebase functions:secrets:set SQUARE_WEBHOOK_SIGNATURE_KEY',
      );
      res.status(503).json({ error: 'Webhook signature key not configured.' });
      return;
    }

    /*
     * The URL Square signed. It is part of the signed message, so it has to be
     * character-identical to the one in the subscription.
     *
     * Reconstructed from the request by default, which is right behind the
     * Hosting rewrite: `host` is the site's domain and `originalUrl` the path
     * Square was given. `SQUARE_WEBHOOK_URL` overrides it for the cases that
     * are not — a custom domain fronted by something that rewrites the Host
     * header, or a subscription pointed at the function's own run.app URL.
     */
    const notificationUrl =
      process.env['SQUARE_WEBHOOK_URL'] ||
      `https://${req.headers.host ?? ''}${req.originalUrl ?? req.url ?? ''}`;

    // `rawBody` is the bytes as received. `req.body` has already been parsed and
    // re-serialising it changes key order and whitespace, which breaks the HMAC
    // permanently and in a way that looks like a wrong key.
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    const signature = String(req.headers['x-square-hmacsha256-signature'] ?? '');

    const verified = await verifySquareWebhookSignature({
      signatureKey,
      notificationUrl,
      rawBody,
      signature,
    });

    if (!verified) {
      // The URL is logged because a mismatch here is nearly always the URL
      // rather than the key, and it is invisible otherwise.
      console.error(
        `[square] signature rejected. Signed URL used: ${notificationUrl} — this must ` +
          `match the subscription in Square exactly. Set SQUARE_WEBHOOK_URL to override.`,
      );
      res.status(401).json({ error: 'Invalid signature.' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Signed by Square but not JSON. Acknowledge: retrying will not fix it.
      console.error('[square] verified delivery was not JSON; acknowledging.');
      res.status(200).json({ ok: true });
      return;
    }

    const envelope = payload as { event_id?: string; type?: string };
    const update = interpretSquareWebhook({
      verified: true,
      eventId: envelope.event_id ?? '',
      type: envelope.type ?? '',
      payload,
    });

    if (!update || !update.eventId) {
      // Not an event we act on — Square emits many. Acknowledged so it stops.
      res.status(200).json({ ok: true, applied: false });
      return;
    }

    try {
      const applied = await applyOrderUpdate(update);
      res.status(200).json({ ok: true, applied });
    } catch (error) {
      // A write failure is the one case where a retry genuinely helps.
      console.error('[square] could not apply order update:', error);
      res.status(500).json({ error: 'Could not apply update.' });
    }
  },
);

/**
 * Apply a status change to its order, once.
 *
 * In a transaction because Square can deliver the same event twice
 * concurrently: read-then-write outside one lets both copies see an empty
 * `appliedEventIds` and both apply.
 *
 * A payment for an order we have no record of is acknowledged rather than
 * created. The parish also sells in person through the same Square account, and
 * those payments arrive here too — inventing an order document for every
 * over-the-counter Bible would fill the collection with rows nobody ordered.
 */
async function applyOrderUpdate(update: OrderStatusUpdate): Promise<boolean> {
  const db = getFirestore();
  const ref = db.collection(COLLECTIONS.orders).doc(update.squareOrderId);

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      console.info(
        `[square] no order ${update.squareOrderId} — probably an in-person sale. Ignored.`,
      );
      return false;
    }

    const applied: string[] = snapshot.get('appliedEventIds') ?? [];
    if (applied.includes(update.eventId)) return false;

    tx.update(ref, {
      status: update.status,
      squarePaymentId: update.squarePaymentId,
      // Capped so a long-lived order cannot grow this array without bound; the
      // recent ids are the only ones a replay could plausibly repeat.
      appliedEventIds: [...applied, update.eventId].slice(-50),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: null,
    });
    return true;
  });
}

// The weekly bulletin is NOT synced here any more. The website reads the
// announcements project directly at build time — see
// apps/website/src/features/bulletin/data.ts and docs/integrations.md. There is
// no scheduled Function and no copy in our Firestore.
