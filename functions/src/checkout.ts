import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  buildOrderEmail,
  buildSquareOrder,
  isUsableAddress,
  looksLikeEmail,
  type Product,
} from '@spsm/shared';

const SQUARE_ACCESS_TOKEN = defineSecret('SQUARE_ACCESS_TOKEN');
/*
 * The sandbox counterpart, and the reason it has to exist separately.
 *
 * Square issues one token per environment and they are not interchangeable: the
 * production token returns 401 against `connect.squareupsandbox.com`, and the
 * sandbox token returns 401 against `connect.squareup.com`. Both were already
 * in the repo's .env, but only `SQUARE_ACCESS_TOKEN` was ever read — so with
 * `SQUARE_ENVIRONMENT=sandbox`, which is how the site runs locally, every
 * payment sent the production token to the sandbox host and came back 401.
 *
 * Reading the pair together is what makes the environment switch mean one
 * thing. Setting `SQUARE_ENVIRONMENT=production` to make that 401 go away would
 * have been the dangerous fix: the browser stays in sandbox mode, still showing
 * "Test mode — no real money moves", while the Function starts taking real
 * money.
 */
const SQUARE_SANDBOX_ACCESS_TOKEN = defineSecret('SQUARE_SANDBOX_ACCESS_TOKEN');
const SQUARE_LOCATION_ID = defineString('SQUARE_LOCATION_ID');
const SQUARE_ENVIRONMENT = defineString('SQUARE_ENVIRONMENT');

/**
 * Flat shipping, in cents.
 *
 * Flat because it is the only honest option available: not one item in the
 * parish's Square catalog carries a weight or a dimension, so no carrier can
 * quote a rate for a parcel nobody has described. When those are filled in,
 * this becomes a rate lookup; until then a single number the parish chooses is
 * better than a calculation resting on invented data.
 */
const SHIPPING_FLAT_CENTS = defineString('SHIPPING_FLAT_CENTS', { default: '700' });

/**
 * Where a buyer should write if their order is wrong. Empty is fine — the email
 * then says "contact the parish office" rather than naming an address that does
 * not exist.
 */
const PARISH_EMAIL = defineString('PARISH_EMAIL', { default: '' });

const SQUARE_VERSION = '2025-01-23';

/**
 * Take a payment for a basket.
 *
 * ---------------------------------------------------------------------------
 * Where the money is decided, and why it is not here.
 *
 * The browser sends slugs, quantities, and a single-use card token. It does not
 * send prices — there is deliberately nowhere in the request to put one. Line
 * items go to Square as catalog ids, Square prices them from its own catalog,
 * and the total Square returns is the total charged. So the amount cannot be
 * altered by editing the page, and it cannot drift if our Firestore mirror goes
 * stale either.
 *
 * Card details never reach this Function or the parish's servers. The Web
 * Payments SDK collects them in an iframe served by Square and hands back a
 * one-time token, which is all `source_id` below ever is.
 * ---------------------------------------------------------------------------
 */
export const squareCheckout = onRequest(
  {
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
    // Same origin through the Hosting rewrite, so no cross-origin access is
    // needed or wanted: this endpoint moves money and should not be callable
    // from another site's page.
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    /*
     * The token that matches the host we are about to call.
     *
     * Falls back to `SQUARE_ACCESS_TOKEN` when no sandbox token is set, so an
     * environment that only ever had one secret keeps working exactly as it
     * did.
     */
    const environment = SQUARE_ENVIRONMENT.value();
    const production = environment === 'production';
    const token = production
      ? SQUARE_ACCESS_TOKEN.value()
      : SQUARE_SANDBOX_ACCESS_TOKEN.value() || SQUARE_ACCESS_TOKEN.value();
    const locationId = SQUARE_LOCATION_ID.value();
    if (!token || !locationId) {
      console.error(
        `[checkout] No access token for SQUARE_ENVIRONMENT=${environment || '(unset)'}, ` +
          'or SQUARE_LOCATION_ID is missing.',
      );
      res.status(503).json({ error: 'Checkout is not configured.' });
      return;
    }

    const body = (req.body ?? {}) as {
      sourceId?: unknown;
      cart?: unknown;
      email?: unknown;
      fulfillment?: unknown;
      address?: Record<string, string>;
      idempotencyKey?: unknown;
    };

    const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const shipping = body.fulfillment === 'ship';
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.length >= 8
        ? body.idempotencyKey.slice(0, 45)
        : '';

    if (!sourceId || !idempotencyKey) {
      res.status(400).json({ error: 'Missing payment token.' });
      return;
    }
    if (!looksLikeEmail(email)) {
      res.status(400).json({ error: 'A valid email address is needed for the receipt.' });
      return;
    }
    if (shipping && !isUsableAddress(body.address ?? {})) {
      res.status(400).json({ error: 'A full shipping address is needed.' });
      return;
    }

    // ── Price the basket from the catalog, never from the request ──────────
    const db = getFirestore();
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (cart.length === 0) {
      res.status(400).json({ error: 'The basket is empty.' });
      return;
    }

    const slugs = [...new Set(cart.map((l: { slug?: unknown }) => String(l?.slug ?? '')).filter(Boolean))].slice(0, 40);
    const catalog = new Map<string, Product>();
    await Promise.all(
      slugs.map(async (slug) => {
        const doc = await db.collection(COLLECTIONS.products).doc(slug).get();
        if (doc.exists) catalog.set(slug, doc.data() as Product);
      }),
    );

    const built = buildSquareOrder(cart, catalog);
    if (built.lines.length === 0) {
      res.status(409).json({ error: 'Nothing in the basket is available.', rejected: built.rejected });
      return;
    }

    const host = squareHost(environment);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    };

    try {
      // ── 1. Square builds and prices the order ────────────────────────────
      const orderBody: Record<string, unknown> = {
        idempotency_key: `${idempotencyKey}-order`,
        order: {
          location_id: locationId,
          line_items: built.lines,
          ...(shipping
            ? {
                // Shipping as a service charge rather than a line item, so it
                // is not mistaken for something in the catalog and does not
                // appear as stock sold.
                service_charges: [
                  {
                    name: 'Shipping',
                    amount_money: {
                      amount: Number(SHIPPING_FLAT_CENTS.value()) || 0,
                      currency: 'USD',
                    },
                    calculation_phase: 'TOTAL_PHASE',
                  },
                ],
              }
            : {}),
        },
      };

      const orderRes = await fetch(`${host}/v2/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(orderBody),
      });
      const orderJson = (await orderRes.json()) as {
        order?: {
          id?: string;
          total_money?: { amount?: number; currency?: string };
          /*
           * Read for the confirmation email, and read from *here* rather than
           * from the Firestore mirror on purpose. Square prices the order from
           * its own catalog — that is the whole reason the browser never sends
           * a price — so the mirror can be stale by exactly the amount that
           * would make the email disagree with the card statement.
           */
          line_items?: { name?: string; quantity?: string; total_money?: { amount?: number } }[];
          net_amounts?: unknown;
        };
        errors?: { detail?: string }[];
      };

      // Pulled out *before* the guard so the guard narrows this binding, and
      // every later use is a plain string. Reading `orderJson.order.id` again
      // afterwards would be `string | undefined` to the compiler — and, more to
      // the point, a second chance for it to be missing.
      const orderId = orderJson.order?.id;

      if (!orderRes.ok || !orderId) {
        console.error('[checkout] order creation failed', JSON.stringify(orderJson.errors));
        res.status(502).json({ error: 'Could not price the order.' });
        return;
      }

      const total = orderJson.order?.total_money?.amount ?? 0;
      if (total <= 0) {
        // A zero total means the catalog priced everything at nothing, which is
        // a data fault rather than a free order. Charging $0 would "succeed"
        // and ship books.
        console.error(`[checkout] refusing a zero-total order ${orderId}`);
        res.status(409).json({ error: 'Could not price the order.' });
        return;
      }

      // ── 2. Charge it, for exactly what Square said it costs ──────────────
      const payRes = await fetch(`${host}/v2/payments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          source_id: sourceId,
          location_id: locationId,
          order_id: orderId,
          amount_money: { amount: total, currency: orderJson.order?.total_money?.currency ?? 'USD' },
          buyer_email_address: email,
          ...(shipping && body.address
            ? {
                shipping_address: {
                  address_line_1: body.address['line1'],
                  address_line_2: body.address['line2'] ?? '',
                  locality: body.address['city'],
                  administrative_district_level_1: body.address['state'],
                  postal_code: body.address['postalCode'],
                  country: 'US',
                },
              }
            : {}),
        }),
      });
      const payJson = (await payRes.json()) as {
        payment?: { id?: string; status?: string };
        errors?: { detail?: string; code?: string }[];
      };

      if (!payRes.ok || !payJson.payment?.id) {
        const detail = payJson.errors?.[0];
        console.error('[checkout] payment failed', JSON.stringify(payJson.errors));
        // Square's decline messages are written for buyers, so pass one
        // through rather than replacing it with something vaguer.
        res.status(402).json({ error: detail?.detail ?? 'The card was declined.' });
        return;
      }

      // ── 3. Record it ─────────────────────────────────────────────────────
      const status = payJson.payment.status === 'COMPLETED' ? 'paid' : 'pending';
      await db
        .collection(COLLECTIONS.orders)
        .doc(orderId)
        .set(
          {
            squareOrderId: orderId,
            squarePaymentId: payJson.payment.id,
            memberUid: null,
            contactEmail: email,
            lineItems: cart
              .filter((l: { slug?: string }) => built.names[String(l?.slug)])
              .map((l: { slug?: string; quantity?: number }) => ({
                productId: String(l.slug),
                name: built.names[String(l.slug)],
                quantity: Number(l.quantity),
              })),
            total: { amount: total, currency: 'USD' },
            status,
            fulfillment: 'unfulfilled',
            shipping,
            shippingAddress: shipping ? (body.address ?? null) : null,
            idempotencyKey,
            // The webhook fills this as events arrive; starting it empty means
            // the first one is never mistaken for a replay.
            appliedEventIds: [],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: null,
          },
          // Merge, because the webhook can beat this write: a COMPLETED payment
          // fires an event before this request has finished, and a plain set()
          // would erase the status that event just applied.
          { merge: true },
        );

      /*
       * The parish's own confirmation, queued for the Trigger Email extension.
       *
       * **After the response is decided, and inside a catch that swallows
       * everything.** The money has moved and the order is recorded by this
       * point; if the queue write fails, the correct outcome is still a paid
       * order and a 200. Letting a mail problem turn a successful payment into
       * an error would tell the buyer their card failed when it did not, and
       * invite them to pay twice.
       *
       * Square's own receipt goes out regardless — see `buyer_email_address`
       * above. This one carries the half Square cannot: whether the books are
       * to be collected or delivered.
       */
      try {
        /*
         * `create`, not `set`, and the doc id is the order — so the queue is
         * idempotent the same way the payment is.
         *
         * Square returns the *original* order for a repeated idempotency key,
         * which is exactly right for a double-tap. But that means this line can
         * run twice for one purchase, and `set` would overwrite a message the
         * extension had already delivered — wiping the `delivery` field it
         * writes back, and sending the buyer a second copy. `create` fails
         * instead, which is the outcome we want.
         */
        await db
          .collection(COLLECTIONS.mail)
          .doc(`order-${orderId}`)
          .create(
            buildOrderEmail({
              orderId,
              email,
              shipping,
              lines: (orderJson.order?.line_items ?? []).map((item) => ({
                name: item.name ?? 'Book',
                quantity: Number(item.quantity ?? '1'),
                amount: item.total_money?.amount ?? 0,
              })),
              total,
              ...(PARISH_EMAIL.value() ? { parishEmail: PARISH_EMAIL.value() } : {}),
            }),
          );
      } catch (cause) {
        // ALREADY_EXISTS is the idempotent retry above doing its job, not a
        // fault — logging it as an error would cry wolf on a normal double-tap.
        if ((cause as { code?: number })?.code === 6) {
          console.log(`[checkout] confirmation email for ${orderId} was already queued`);
        } else {
          // Deliberately not surfaced to the buyer. The order is good; somebody
          // reading logs needs to know the email did not go.
          console.error('[checkout] confirmation email not queued', cause);
        }
      }

      res.status(200).json({ ok: true, orderId, status, total });
    } catch (error) {
      console.error('[checkout] unexpected failure', error);
      res.status(500).json({ error: 'Checkout failed. Nothing was charged.' });
    }
  },
);

function squareHost(environment: string): string {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}
