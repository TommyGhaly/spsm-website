import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  buildOrderEmail,
  buildSquareOrder,
  cleanName,
  cleanPhone,
  looksLikeEmail,
  mayMoveOrder,
  normalizeEmail,
  shouldReturnSizes,
  stockRefusal,
  taxLabel,
} from '@spsm/shared';
import { bookstoreSettings, recordOrderAndHold, shortAnswer, withSalesTax } from './checkout.js';
import { callerOf, mayManageOrders } from './httpAuth.js';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { productsFor } from './shipping.js';
import { readSizeReturn } from './sizeStock.js';
import { SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN, squareClient } from './square.js';
import { refreshStock, trackedDemand } from './stockHold.js';

/**
 * `POST /api/square/cash-order` — a volunteer recording a sale paid in cash.
 *
 * ---------------------------------------------------------------------------
 * Why this goes through Square at all, when no card is involved.
 *
 * Stock. Square-tracked books come off Square's count only when Square sees a
 * paid order for them, and clothing sizes come off the website's counts only
 * when an order is recorded here. A sale at the table that nobody recorded left
 * both counts claiming copies that were gone, and the next online buyer paid
 * for a book that was not on the shelf.
 *
 * So a cash sale is a real Square order, priced by Square from its catalog
 * exactly as checkout is, and paid with Square's `CASH` source. Square takes
 * its own stock and puts the takings in its reports beside the card sales;
 * this Function takes the clothing sizes and the mirror's hold in the same
 * transaction checkout uses (`recordOrderAndHold`), and refuses a basket the
 * counts cannot cover — fix the count first, then record the sale.
 *
 * Buyer details are all optional: most cash sales are somebody handing over a
 * twenty for a prayer book. An email, when given, gets the usual confirmation.
 * The order is born `collected`, because the books left with the buyer.
 * ---------------------------------------------------------------------------
 */
export const squareCashOrder = onRequest(
  { secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN], cors: false, maxInstances: CAPS.cashOrder },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }
    if (throttled(req, res, { bucket: 'cashOrder:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayManageOrders(caller))) {
      res.status(caller ? 403 : 401).json({
        error: caller
          ? 'Recording a cash sale is limited to the bookstore group and church staff.'
          : 'Sign in again — your session has expired.',
      });
      return;
    }
    if (
      throttled(req, res, {
        bucket: 'cashOrder',
        max: BUDGETS.cashOrder,
        identity: caller!.uid,
        message: 'That is a lot of sales at once. Please wait a minute.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const idempotencyKey =
      typeof body['idempotencyKey'] === 'string' && body['idempotencyKey'].length >= 8
        ? body['idempotencyKey'].slice(0, 45)
        : '';
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Missing request key.' });
      return;
    }

    // All optional; each one sent and malformed is refused, so a typo is fixed
    // rather than recorded.
    const emailSent = typeof body['email'] === 'string' && body['email'].trim() !== '';
    const email = emailSent ? String(body['email']).trim() : '';
    if (emailSent && !looksLikeEmail(email)) {
      res.status(400).json({ error: 'That email address does not look right.' });
      return;
    }
    const phoneSent = typeof body['phone'] === 'string' && body['phone'].trim() !== '';
    const phone = cleanPhone(body['phone']);
    if (phoneSent && !phone) {
      res.status(400).json({ error: 'That phone number does not look right.' });
      return;
    }
    const firstName = cleanName(body['firstName']);
    const lastName = cleanName(body['lastName']);

    const cart = Array.isArray(body['cart']) ? body['cart'] : [];
    if (cart.length === 0) {
      res.status(400).json({ error: 'Add something to the sale first.' });
      return;
    }

    const square = squareClient();
    if (!square) {
      res.status(503).json({ error: 'Square is not configured.' });
      return;
    }

    const db = getFirestore();
    const settings = await bookstoreSettings(db);
    const slugs = [...new Set(cart.map((l: { slug?: unknown }) => String(l?.slug ?? '')).filter(Boolean))].slice(0, 40);
    const catalog = await productsFor(db, slugs);
    const built = buildSquareOrder(cart, catalog);

    const short = stockRefusal(built.rejected, (slug) => catalog.get(slug)?.name);
    if (short) {
      res.status(409).json({ error: short.replace('Nothing was charged.', 'Nothing was recorded.'), code: 'sold-out' });
      return;
    }
    /*
     * Stricter than checkout, which charges what is left of a basket: a
     * volunteer is holding the books, and a sale recorded without one of them
     * would put the till out by its price.
     */
    if (built.rejected.length > 0 || built.lines.length === 0) {
      const first = built.rejected[0];
      const name = (first && catalog.get(first.slug)?.name) ?? 'Something in the sale';
      res.status(409).json({ error: `${name} cannot be sold here (${first?.reason ?? 'empty'}). Nothing was recorded.` });
      return;
    }

    // Who rang it up, by name: the order card shows it, and `fulfilledBy` wants it.
    const name = await getAuth()
      .getUser(caller!.uid)
      .then((user) => user.displayName ?? '')
      .catch(() => '');
    const stamp = { uid: caller!.uid, name, email: caller!.email ?? '', at: FieldValue.serverTimestamp() };

    try {
      // ── 1. Square prices it ─────────────────────────────────────────────
      const { lines, taxes } = withSalesTax(built.lines, catalog, settings);
      const orderRes = await fetch(`${square.host}/v2/orders`, {
        method: 'POST',
        headers: square.headers,
        body: JSON.stringify({
          idempotency_key: `${idempotencyKey}-order`,
          order: {
            location_id: square.locationId,
            line_items: lines,
            ...(taxes.length > 0 ? { taxes } : {}),
            // Shown in the Square dashboard, so the treasurer can tell these apart.
            source: { name: 'SPSM bookstore — cash' },
          },
        }),
      });
      const orderJson = (await orderRes.json().catch(() => ({}))) as {
        order?: {
          id?: string;
          total_money?: { amount?: number };
          total_tax_money?: { amount?: number };
          line_items?: { uid?: string; name?: string; quantity?: string; gross_sales_money?: { amount?: number }; total_money?: { amount?: number } }[];
        };
        errors?: { detail?: string }[];
      };
      const orderId = orderJson.order?.id;
      const total = orderJson.order?.total_money?.amount ?? 0;
      const taxCharged = orderJson.order?.total_tax_money?.amount ?? 0;
      if (!orderRes.ok || !orderId || total <= 0) {
        console.error('[cash] Square could not price the sale', JSON.stringify(orderJson.errors));
        res.status(502).json({ error: orderJson.errors?.[0]?.detail ?? 'Square could not price the sale.' });
        return;
      }

      /*
       * What the buyer handed over, for the change. Optional — the exact
       * amount when absent — and never less than the total: a cash sale short
       * of its price is not one Square can record.
       */
      const tenderedRaw = body['tenderedCents'];
      const tendered = tenderedRaw === undefined || tenderedRaw === null ? total : Number(tenderedRaw);
      if (!Number.isInteger(tendered) || tendered < total || tendered > total + 100_000) {
        res.status(400).json({
          error: `The cash handed over must be at least the total, ${(total / 100).toFixed(2)}.`,
          total,
        });
        return;
      }

      // ── 2. Record it and take the stock ────────────────────────────────
      const priced = new Map<string, number>();
      for (const item of orderJson.order?.line_items ?? []) {
        const quantity = Number(item.quantity ?? '1') || 1;
        const amount = item.gross_sales_money?.amount ?? item.total_money?.amount;
        if (item.uid && typeof amount === 'number') priced.set(item.uid, Math.round(amount / quantity));
      }
      const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
      const record = {
        squareOrderId: orderId,
        squarePaymentId: null,
        memberUid: null,
        contactEmail: email,
        contactEmailLower: email ? normalizeEmail(email) : '',
        ...(firstName ? { buyerFirstName: firstName } : {}),
        ...(lastName ? { buyerLastName: lastName } : {}),
        ...(phone ? { buyerPhone: phone } : {}),
        lineItems: built.items.map((item) => {
          const unit = priced.get(item.uid);
          return {
            productId: item.slug,
            name: item.name,
            quantity: item.quantity,
            unitPrice: typeof unit === 'number' ? { amount: unit, currency: 'USD' } : null,
            sku: catalog.get(item.slug)?.sku ?? null,
            ...(item.size ? { size: item.size } : {}),
          };
        }),
        total: { amount: total, currency: 'USD' },
        tax: { amount: taxCharged, currency: 'USD' },
        subtotal: { amount: total - taxCharged, currency: 'USD' },
        shipping: false,
        shippingAddress: null,
        shippingCents: 0,
        handlingCents: 0,
        idempotencyKey,
        paymentMethod: 'cash',
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: caller!.uid,
      };
      const held = await recordOrderAndHold(db, orderRef, record, built.items, {
        // Only on the first write: a retry must not re-stamp a sale.
        initial: { recordedBy: stamp, fulfillment: 'collected', fulfilledBy: stamp },
      });
      if (held.short.length > 0) {
        const answer = shortAnswer(held.short, (slug) => catalog.get(slug)?.name);
        res.status(409).json({ ...answer, error: answer.error.replace('Nothing was charged.', 'Nothing was recorded.') });
        return;
      }

      // ── 3. Pay it in cash ──────────────────────────────────────────────
      const payRes = await fetch(`${square.host}/v2/payments`, {
        method: 'POST',
        headers: square.headers,
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          source_id: 'CASH',
          cash_details: { buyer_supplied_money: { amount: tendered, currency: 'USD' } },
          amount_money: { amount: total, currency: 'USD' },
          order_id: orderId,
          location_id: square.locationId,
          note: `Cash sale recorded by ${name || caller!.email || 'staff'}`.slice(0, 500),
          ...(email ? { buyer_email_address: email } : {}),
        }),
      });
      const payJson = (await payRes.json().catch(() => ({}))) as {
        payment?: { id?: string; status?: string; cash_details?: { change_back_money?: { amount?: number } } };
        errors?: { code?: string; detail?: string }[];
      };

      if (!payRes.ok || !payJson.payment?.id) {
        console.error(`[cash] Square refused the payment for ${orderId}`, JSON.stringify(payJson.errors));
        const reused = payJson.errors?.some((error) => error.code === 'IDEMPOTENCY_KEY_REUSED') === true;
        // As checkout: a plain refusal recorded nothing, so the stock goes back.
        if (payRes.status < 500 && !reused) {
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(orderRef);
            if (snap.get('status') !== 'pending') return;
            const order = snap.data() ?? {};
            const putBack = shouldReturnSizes('failed', order) ? await readSizeReturn(tx, db, orderRef, order) : null;
            putBack?.();
            tx.update(orderRef, {
              status: 'failed',
              ...(order['stockHeld'] === true ? { stockHeld: false } : {}),
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
          await refreshStock(db, [...trackedDemand(built.items).keys()], square);
        }
        res.status(502).json({ error: payJson.errors?.[0]?.detail ?? 'Square would not record the cash payment.' });
        return;
      }

      // ── 4. Paid ────────────────────────────────────────────────────────
      const paymentId = payJson.payment.id;
      const status = payJson.payment.status === 'COMPLETED' ? 'paid' : 'pending';
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        const current = snap.get('status');
        tx.update(orderRef, {
          squarePaymentId: paymentId,
          ...(current === 'pending' && mayMoveOrder(current, status) ? { status } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      if (email) {
        try {
          await db
            .collection(COLLECTIONS.mail)
            .doc(`order-${orderId}`)
            .create(
              buildOrderEmail({
                orderId,
                email,
                ...(firstName || lastName ? { buyerName: `${firstName} ${lastName}`.trim() } : {}),
                shipping: false,
                handedOver: true,
                lines: (orderJson.order?.line_items ?? []).map((item) => {
                  const asked = built.items.find((one) => one.uid === item.uid);
                  return {
                    name: `${item.name ?? 'Book'}${asked?.size ? ` — size ${asked.size}` : ''}`,
                    quantity: Number(item.quantity ?? '1'),
                    amount: item.gross_sales_money?.amount ?? item.total_money?.amount ?? 0,
                    sku: (asked && catalog.get(asked.slug)?.sku) || null,
                  };
                }),
                ...(taxCharged > 0 ? { taxCents: taxCharged, taxLabel: taxLabel(settings.taxRateBps) } : {}),
                total,
                ...(settings.orderEmail ? { parishEmail: settings.orderEmail } : {}),
              }),
            );
        } catch (cause) {
          // ALREADY_EXISTS is a retry; anything else is logged, never surfaced.
          if ((cause as { code?: number })?.code !== 6) console.error('[cash] receipt not queued', cause);
        }
      }

      res.status(200).json({
        ok: true,
        orderId,
        status,
        total,
        change: payJson.payment.cash_details?.change_back_money?.amount ?? tendered - total,
      });
    } catch (error) {
      console.error('[cash] unexpected failure', error);
      res.status(500).json({ error: 'The sale could not be recorded. Check the orders list before trying again.' });
    }
  },
);
