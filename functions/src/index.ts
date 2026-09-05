import { onRequest } from 'firebase-functions/v2/https';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  interpretSquareWebhook,
  verifySquareWebhookSignature,
  type OrderStatusUpdate,
} from '@spsm/shared';

initializeApp();

// Sign-in, and the one claim mirror. See functions/src/auth.ts — Microsoft-only,
// restricted to the parish Entra tenant, and tenant membership is worth an
// account and the servants' rota. Everything else is allocated at /access;
// `mirrorGrantsToClaims` copies those grants into the token for storage.rules,
// which cannot read Firestore.
export { enforceTenantOnCreate, mirrorGrantsToClaims } from './auth.js';

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
  squareProductDetails,
  squareArchiveProduct,
} from './catalog.js';

// Keeping the mirror in step with Square without anybody running a script.
// A photograph attached in the Square app appears on the website within fifteen
// minutes, and one deleted there disappears — see catalogSync.ts, and the note
// there about what it cannot do (re-bake the optimised covers).
export { syncSquareCatalog, refreshSquareCatalog } from './catalogSync.js';
import { mirrorCatalog } from './catalogSync.js';

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
 * An embedded form never reaches this Function: it is framed on our page and
 * submitted inside that frame to whoever hosts it — Tithe.ly or Breeze — which
 * is what `kind: 'embed'` means. `formSubmit` refuses one that is posted here
 * anyway, so a stale tab cannot quietly file a copy of somebody else's form in
 * our collection.
 *
 * There were two Breeze endpoints beside this one, removed on 2026-09-01 with
 * the Breeze importer they served. Their key — BREEZE_API_KEY — read the whole
 * member database and had no other user, so it is now unset everywhere and can
 * be revoked in Breeze.
 */
export { formSubmit } from './forms/submit.js';

/*
 * The one door into `formUploads/`, and the sibling of `galleryUploadUrl`.
 *
 * A photograph attached to a form used to be written straight to Storage by the
 * browser, under an anonymous `allow create` rule whose only real protection
 * was App Check enforcement on the Storage service. That enforcement had to be
 * turned off on 2026-09-03 — it was refusing every `<img>` on the public site,
 * because an image tag cannot present an App Check token — so the rule was left
 * standing on nothing. This endpoint verifies attestation in its own code,
 * which is why it is unaffected by that setting either way.
 */
export { formUploadUrl } from './forms/uploadUrl.js';

/*
 * A servant signing themselves up for camp.
 *
 * The one other endpoint anybody may post to without an account, and it is a
 * Function for the same reasons `formSubmit` is: the season and the ministry a
 * sign-up is filed under are read from `config/camp` here rather than taken
 * from the request, whether sign-ups are open at all is a document rather than
 * a field, and rules cannot rate-limit. It writes to `campServantRequests`,
 * which is a waiting room — nothing here can write a registration.
 */
export { campServantRequest } from './camp/servantRequest.js';

/*
 * A servant deleting their own account.
 *
 * The only endpoint here whose caller is also its subject, and the only one
 * that removes an identity rather than a record. It is a Function because the
 * half of an account that lives in Firestore — `members/{uid}`, the document
 * that says which areas somebody administers — is not deletable from a browser
 * under any rule this site has, and should not be made so. See account.ts for
 * the order the two halves are removed in and why it cannot be the other one.
 */
export { deleteOwnAccount } from './account.js';

// Bookstore statistics. The shop writes one document per view and cart change
// rather than incrementing a counter — a counter tops out near one write per
// second and would fail first on the most popular book — so all the arithmetic
// happens here, hourly, off the request path. See stats.ts.
export { rollupBookstoreStats, refreshBookstoreStats } from './stats.js';

// The parish's money, with the people taken out. Camp fees and paid form totals
// live inside documents full of personal data, so no rule can hand a treasurer
// one without the other; this reads them with the Admin SDK and writes
// totals-only documents the `finance` grant can be given on its own. See
// finance.ts, and the long note on `'finance'` in packages/shared/src/screens.ts.
export { rollupFinanceStats, refreshFinanceStats } from './finance.js';

// The active bulletin, read at request time. The homepage schedule was baked
// into static HTML at build time, so making a different bulletin active in the
// announcements app changed nothing until a redeploy. See bulletin.ts.
export { bulletin } from './bulletin.js';

// Whether a liturgy is streaming right now, and which video it is. YouTube
// sends no CORS header, so unlike the Castr probe this cannot be a fetch from
// the page itself. See live.ts.
export { live } from './live.js';

// The church schedule, read out of Breeze and served as JSON. Replaces the
// iframe on /servants: the embed URL is a bearer credential, and this sends the
// events rather than the credential. `?scope=servants` needs a verified
// `servant` claim. See calendar.ts.
export { calendar } from './calendar.js';

// Program galleries: transcode on submission, publish on approval, take down on
// rejection. Deployed to us-east1 rather than us-central1 like everything else
// here — a v2 Firestore trigger must sit in the database's own region, and
// spsm-database is us-east1. See the note at the top of galleries.ts.
export {
  onGalleryMediaCreated,
  onGalleryMediaDeleted,
  onGalleryMediaReviewed,
} from './galleries.js';

/*
 * The one door into a gallery submission, and the sweep that tidies up after
 * the uploads it authorises that never happen.
 *
 * us-central1 like every other HTTP endpoint here, unlike the two triggers
 * above. Only Firestore and Storage triggers have to match their resource's
 * region; this one merely talks to them, and putting it with its siblings keeps
 * the Hosting rewrites uniform. The sweep is a scheduled job, not a trigger,
 * and is under the same rule.
 */
export { galleryUploadUrl } from './galleries/uploadUrl.js';
export { sweepUnuploadedSubmissions, sweepStaleQuotas } from './galleries/orphans.js';

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
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_WEBHOOK_SIGNATURE_KEY],
    cors: false,
    maxInstances: CAPS.squareWebhook,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      // A GET is what a person does when checking the URL is live. Say what
      // this is rather than returning a bare 405 with no explanation.
      res.status(405).json({ error: 'This endpoint accepts POST from Square only.' });
      return;
    }

    /*
     * Ahead of the signature check, and high enough that Square never meets it.
     *
     * Verification is an HMAC over the whole body, so an unsigned flood costs
     * real CPU per request even though every one of them is refused — this
     * bounds that. Six hundred a minute is well above Square's burstiest
     * redelivery after an outage, and a 429 is a non-2xx like any other, so
     * Square would simply try again later if it ever did meet it.
     */
    if (throttled(req, res, { bucket: 'squareWebhook', max: BUDGETS.squareWebhook })) return;

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

    /*
     * A catalog change, which is not an order event at all.
     *
     * Handled before `interpretSquareWebhook` because that function is about
     * orders and correctly returns null for everything else — which would
     * acknowledge this and do nothing. Square fires
     * `catalog.version.updated` whenever any catalog object changes, including a
     * photograph attached or removed in the Square app, so this is what makes
     * *"the pictures in square should automatically show up"* mean seconds
     * rather than the scheduled fifteen minutes.
     *
     * The event carries no useful detail — only that *something* changed — so
     * there is nothing to interpret and nothing to replay-guard: the mirror is
     * idempotent, and running it twice writes the same documents twice.
     *
     * Acknowledged 200 even when the mirror fails. Square retries a non-2xx for
     * days, and `syncSquareCatalog` is already the safety net; turning a
     * transient Square blip into a retry storm buys nothing.
     *
     * This does nothing until `catalog.version.updated` is added to the parish's
     * webhook subscription in Square. Absent that, the schedule is the only path
     * and the shop is at most fifteen minutes stale.
     */
    if (envelope.type === 'catalog.version.updated') {
      const result = await mirrorCatalog();
      if (result.failure) console.warn(`[square] catalog webhook: ${result.failure}`);
      else console.info(`[square] catalog webhook mirrored ${result.written} product(s).`);
      res.status(200).json({ ok: true, catalog: true });
      return;
    }

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
  const orders = db.collection(COLLECTIONS.orders);

  return db.runTransaction(async (tx) => {
    let ref = orders.doc(update.squareOrderId);
    let snapshot: DocumentSnapshot = await tx.get(ref);

    /*
     * A refund does not carry the id of the order that was bought.
     *
     * -----------------------------------------------------------------------
     * Square books a refund against a *return order* of its own making, so
     * `refund.order_id` is an id we have never seen — not the order id we used
     * as this document's name at checkout. Looked up by that alone, every
     * refund of a website order missed, and the miss was indistinguishable
     * from a genuine over-the-counter sale: the log below said "probably an
     * in-person sale" and the order stayed `paid` with the money already gone.
     *
     * The consequence was worse than a stale badge. `rollupDay` reads
     * `order.status`, so a refunded order kept counting as revenue with
     * `refunded: 0` beside it, and the takings on /bookstore disagreed with
     * Square's own report by the value of every refund ever issued.
     *
     * `payment_id` is the one identifier both events carry: a refund names the
     * payment it reverses, and that payment id is on the order from the moment
     * the checkout wrote it. So the id lookup stays the fast path — it is what
     * every `payment.*` event hits — and this is the fallback behind it.
     *
     * One equality filter, served by the automatic single-field index; there is
     * nothing to add to firestore.indexes.json.
     * -----------------------------------------------------------------------
     */
    if (!snapshot.exists && update.squarePaymentId) {
      const byPayment = await tx.get(
        orders.where('squarePaymentId', '==', update.squarePaymentId).limit(1),
      );
      const found = byPayment.docs[0];
      if (found) {
        ref = found.ref;
        snapshot = found;
      }
    }

    if (!snapshot.exists) {
      // Both identifiers, because "no order" against only one of them is what
      // made a missed refund read as an in-person sale for a fortnight.
      console.info(
        `[square] no order for ${update.squareOrderId}` +
          (update.squarePaymentId ? ` / payment ${update.squarePaymentId}` : '') +
          ' — probably an in-person sale. Ignored.',
      );
      return false;
    }

    const applied: string[] = snapshot.get('appliedEventIds') ?? [];
    if (applied.includes(update.eventId)) return false;

    tx.update(ref, {
      status: update.status,
      // Only when the event carried one. `interpretSquareWebhook` returns null
      // for a payment with no id, and writing that null over a good value would
      // erase the field the refund lookup above depends on — the failure would
      // then be permanent for that order and invisible until somebody refunded.
      ...(update.squarePaymentId ? { squarePaymentId: update.squarePaymentId } : {}),
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
