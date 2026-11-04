import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  CONFIG_DOC_BOOKSTORE,
  COLLECTIONS,
  DEFAULT_BOOKSTORE_CONFIG,
  FLAT_SHIPPING_LABEL,
  SERVICE_LABELS,
  basketKey,
  buildOrderEmail,
  salesTaxCents,
  taxLabel,
  taxPercentage,
  buildSquareOrder,
  cleanName,
  cleanPhone,
  cleanSizes,
  isUsableAddress,
  looksLikeEmail,
  normalizeEmail,
  mayMoveOrder,
  parseBookstoreConfig,
  shouldReturnSizes,
  sizeDemand,
  takeSizes,
  usableZip,
  verifyQuote,
  type BookstoreConfig,
  type ShippingQuoteResponse,
} from '@spsm/shared';
import { callerOf } from './httpAuth.js';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { needsRetake, readSizeRetake, readSizeReturn } from './sizeStock.js';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_ENVIRONMENT,
  SQUARE_LOCATION_ID,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  SQUARE_VERSION,
  squareHost,
} from './square.js';
import {
  SHIPPING_QUOTE_SECRET,
  USPS_CLIENT_ID,
  USPS_CLIENT_SECRET,
  liveOptions,
  parcelLines,
  productsFor,
  quoteHmac,
} from './shipping.js';

/*
 * Square's host, token pair, and location now live in ./square.ts, imported
 * above. They were defined here, and the long note explaining that the sandbox
 * and production tokens 401 against each other's hosts moved with them — the
 * refund endpoint needs the same pairing and must not grow its own copy of the
 * rule.
 */

/**
 * Flat shipping, in cents — the fallback, not the source of truth any more.
 *
 * ---------------------------------------------------------------------------
 * The parish sets this in `config/bookstore` now, and edits it on the shop page.
 *
 * It was only ever this parameter, which meant changing what the parish charges
 * for postage was a redeploy performed by somebody with deploy rights. That is
 * exactly what `collections.ts` says the `config` collection exists to avoid:
 * "feature switches that staff can change without a code deploy". A price is the
 * clearest possible member of that set.
 *
 * The parameter stays as the floor. A missing or unreadable settings document
 * then means the charge the parish has been using all along, rather than free
 * postage on every delivered order — which is the failure mode that costs money
 * quietly.
 *
 * Flat was once the only honest option, because nothing in the catalog carried
 * a weight. Weights are now the parish's own field on the mirror and live USPS
 * postage is quoted from them (see shipping.ts), but flat remains what a basket
 * pays whenever it cannot be quoted — an unweighed book, the switch off, USPS
 * down.
 * ---------------------------------------------------------------------------
 */
const SHIPPING_FLAT_CENTS = defineString('SHIPPING_FLAT_CENTS', { default: '700' });

/**
 * Where a buyer should write if their order is wrong. Same arrangement as the
 * charge above: `config/bookstore` wins, this is the fallback. Empty is fine —
 * the email then says "contact the parish office" rather than naming an address
 * that does not exist.
 */
const PARISH_EMAIL = defineString('PARISH_EMAIL', { default: '' });

/**
 * The shop's settings, or the deploy-time fallbacks.
 *
 * Read per request rather than cached in a module global. A Function instance
 * lives for hours, and a cache would mean the parish changes the delivery charge
 * and warm instances keep charging the old one for the rest of the afternoon —
 * with the page already showing the new figure. One extra document read on a
 * request that is already making two round trips to Square is not worth that.
 */
async function bookstoreSettings(db: FirebaseFirestore.Firestore): Promise<BookstoreConfig> {
  /*
   * The document wins outright when it exists; the deployed parameters are used
   * only when it does not.
   *
   * An earlier version of this merged the two field by field, treating "equal to
   * the committed default" as "the document did not really say that". It was
   * wrong in a way worth recording: a parish that deliberately set the delivery
   * charge to $7.00 — the committed default — would have had it silently
   * replaced by whatever `SHIPPING_FLAT_CENTS` happened to be. A value is not
   * unset because it matches a default.
   *
   * `parseBookstoreConfig` already falls each field back individually when it is
   * missing or out of range, so a half-written document is handled there.
   */
  try {
    const snapshot = await db.collection(COLLECTIONS.config).doc(CONFIG_DOC_BOOKSTORE).get();
    if (snapshot.exists) return parseBookstoreConfig(snapshot.data());
  } catch (error) {
    console.error('[checkout] could not read config/bookstore; using the deployed values', error);
  }

  return {
    ...DEFAULT_BOOKSTORE_CONFIG,
    deliveryCents: Number(SHIPPING_FLAT_CENTS.value()) || 0,
    orderEmail: PARISH_EMAIL.value(),
  };
}

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
/** The one tax on an order, named so taxable lines can point at it. */
const SALES_TAX_UID = 'sales-tax';

export const squareCheckout = onRequest(
  {
    secrets: [
      SQUARE_ACCESS_TOKEN,
      SQUARE_SANDBOX_ACCESS_TOKEN,
      USPS_CLIENT_ID,
      USPS_CLIENT_SECRET,
      SHIPPING_QUOTE_SECRET,
    ],
    maxInstances: CAPS.squareCheckout,
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
     * Every call here creates an order in the parish's real Square account and
     * spends a Square API call doing it. Unauthenticated, necessarily — a buyer
     * on this site has no account — so the address is all there is to key on.
     *
     * Twelve a minute is far above a person buying books and far below anything
     * that would fill the Square dashboard with junk orders. It is deliberately
     * not as tight as the order lookup: a shopper who fails a card, corrects it
     * and fails again is on their third checkout in under a minute and has done
     * nothing wrong.
     */
    if (
      throttled(req, res, {
        bucket: 'squareCheckout',
        max: BUDGETS.squareCheckout,
        message: 'Too many checkout attempts from here. Please wait a minute and try again.',
      })
    ) {
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
      firstName?: unknown;
      lastName?: unknown;
      phone?: unknown;
      fulfillment?: unknown;
      address?: Record<string, string>;
      idempotencyKey?: unknown;
      /** A signed quote from `/api/shipping/quote`. Optional: absent means flat. */
      shippingOptionId?: unknown;
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

    /*
     * Required, and validated here rather than only in the browser.
     *
     * A collection order is handed to a person, and an order with nobody's name
     * on it is one a volunteer cannot file or hand over. The page marks both
     * fields required; this is the half that actually holds, because the page
     * is one anybody can edit.
     */
    const firstName = cleanName(body.firstName);
    const lastName = cleanName(body.lastName);
    if (!firstName || !lastName) {
      res.status(400).json({ error: 'A first and last name are needed for the order.' });
      return;
    }
    /*
     * A number to ring about the order. Asked for by the shop, the app and the
     * App Clip — but optional *here* for now, because copies of the app already
     * installed from the App Store do not send one, and refusing them would stop
     * those parishioners paying at all until they update. Sent and malformed is
     * still refused: that is a typo the buyer can fix. Make it required once the
     * builds without the field have aged out.
     */
    const phoneSent = typeof body.phone === 'string' && body.phone.trim() !== '';
    const phone = cleanPhone(body.phone);
    if (phoneSent && !phone) {
      res.status(400).json({ error: 'That phone number does not look right — please check it.' });
      return;
    }
    if (shipping && !isUsableAddress(body.address ?? {})) {
      res.status(400).json({ error: 'A full shipping address is needed.' });
      return;
    }

    // ── Price the basket from the catalog, never from the request ──────────
    const db = getFirestore();
    const settings = await bookstoreSettings(db);
    const cart = Array.isArray(body.cart) ? body.cart : [];
    if (cart.length === 0) {
      res.status(400).json({ error: 'The basket is empty.' });
      return;
    }

    const slugs = [...new Set(cart.map((l: { slug?: unknown }) => String(l?.slug ?? '')).filter(Boolean))].slice(0, 40);
    const catalog = await productsFor(db, slugs);

    const built = buildSquareOrder(cart, catalog);
    if (built.lines.length === 0) {
      res.status(409).json({ error: 'Nothing in the basket is available.', rejected: built.rejected });
      return;
    }

    /*
     * What delivery costs, decided here and only here.
     *
     * The browser may carry a signed quote from `/api/shipping/quote`. It is
     * honoured only if the signature holds, it has not expired, and it was
     * issued for *this* basket going to *this* ZIP — so the browser carries a
     * price it cannot choose.
     *
     * Three outcomes, and each keeps the rule that the amount the buyer saw is
     * the amount charged:
     *
     *   - a valid token: its cents.
     *   - a token that does not verify: refused with `quote-expired`, and the
     *     page fetches a fresh quote and shows it before trying again.
     *     Re-quoting silently here would charge a figure nobody was shown.
     *   - no token: the flat charge. That is what the page shows when USPS
     *     could not quote, and what the App Clip's Apple Pay sheet shows, since
     *     it does not ask for live rates yet.
     *
     * The last one means a hand-built request can choose flat over a live
     * price. Accepted knowingly: flat is a figure the parish set itself, and
     * requiring a token would break the clip until it learns to fetch one.
     *
     * The basket key comes from `parcelLines`, the same cleaning the quote
     * endpoint applied, so an honest token for an unchanged basket matches.
     */
    let postage = { cents: settings.deliveryCents, label: FLAT_SHIPPING_LABEL, handling: 0 };
    if (shipping && body.shippingOptionId !== undefined && body.shippingOptionId !== null) {
      const zip = usableZip(body.address?.['postalCode']);
      const hmac = quoteHmac();
      const quoted =
        zip && hmac
          ? verifyQuote(body.shippingOptionId, hmac, {
              zip,
              basket: basketKey(parcelLines(cart)),
              now: Date.now(),
            })
          : null;
      if (!quoted) {
        res.status(409).json({
          error: 'The postage quote has expired. Please check the delivery price and try again.',
          code: 'quote-expired',
        });
        return;
      }
      postage = {
        cents: quoted.cents,
        label: SERVICE_LABELS[quoted.service],
        handling: Math.min(quoted.cents, Math.max(0, Number(quoted.handling) || 0)),
      };
    }

    const host = squareHost(environment);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    };

    /*
     * Sales tax: which lines carry it is the parish's flag on each product,
     * read here from Firestore — the request has no say. The shipping service
     * charge is never taxed (Square leaves service charges untaxed unless told
     * otherwise), which is Massachusetts' rule for a separately stated,
     * avoidable delivery charge. See payments/salesTax.ts.
     */
    const byVariation = new Map(
      [...catalog.values()].flatMap((product) =>
        product.squareVariationId ? [[product.squareVariationId, product] as const] : [],
      ),
    );
    const taxedLines = built.lines.map((line) =>
      settings.taxRateBps > 0 && byVariation.get(line.catalog_object_id)?.taxable === true
        ? { ...line, applied_taxes: [{ tax_uid: SALES_TAX_UID }] }
        : line,
    );
    const taxing = taxedLines.some((line) => 'applied_taxes' in line);

    /*
     * Set the moment Square says the card was charged. The catch at the bottom
     * reads it: after this point "Nothing was charged" is a lie that invites the
     * buyer to pay twice, so a failure tells them the opposite.
     */
    let charged: { orderId: string; status: string; total: number } | null = null;

    try {
      // ── 1. Square builds and prices the order ────────────────────────────
      const orderBody: Record<string, unknown> = {
        idempotency_key: `${idempotencyKey}-order`,
        order: {
          location_id: locationId,
          line_items: taxedLines,
          ...(taxing
            ? {
                /*
                 * A real tax, not a fee, so it reaches Square's sales-tax
                 * reports. LINE_ITEM scope: it applies only to the lines that
                 * name it, which are the products marked taxable.
                 */
                taxes: [
                  {
                    uid: SALES_TAX_UID,
                    name: 'Massachusetts sales tax',
                    percentage: taxPercentage(settings.taxRateBps),
                    type: 'ADDITIVE',
                    scope: 'LINE_ITEM',
                  },
                ],
              }
            : {}),
          ...(shipping
            ? {
                // Shipping as a service charge rather than a line item, so it
                // is not mistaken for something in the catalog and does not
                // appear as stock sold.
                service_charges: [
                  {
                    // Square shows this name on its receipt and dashboard, so
                    // whoever posts the parcel can see which service was paid for.
                    name: `Shipping: ${postage.label}`,
                    amount_money: {
                      amount: postage.cents,
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
          total_tax_money?: { amount?: number };
          /*
           * Read for the confirmation email, and read from *here* rather than
           * from the Firestore mirror on purpose. Square prices the order from
           * its own catalog — that is the whole reason the browser never sends
           * a price — so the mirror can be stale by exactly the amount that
           * would make the email disagree with the card statement.
           */
          line_items?: {
            /** Ours, echoed back — see `SquareOrderLine.uid`. */
            uid?: string;
            name?: string;
            quantity?: string;
            total_money?: { amount?: number };
            // Before tax. `total_money` includes the line's tax now that there
            // can be some, so prices and email lines read this one.
            gross_sales_money?: { amount?: number };
          }[];
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

      const builtByUid = new Map(built.items.map((item) => [item.uid, item]));
      const total = orderJson.order?.total_money?.amount ?? 0;
      const taxCharged = orderJson.order?.total_tax_money?.amount ?? 0;

      /*
       * The page showed the buyer a tax figure computed the way Square computes
       * it. If Square ever came to a different number, the charge is still
       * Square's — but somebody should hear about the gap, because the page and
       * the card statement would disagree by it.
       */
      if (taxing) {
        const expected = salesTaxCents(
          (orderJson.order?.line_items ?? []).map((item) => ({
            amountCents: item.gross_sales_money?.amount ?? 0,
            taxable: catalog.get(builtByUid.get(item.uid ?? '')?.slug ?? '')?.taxable === true,
          })),
          settings.taxRateBps,
        );
        if (expected !== taxCharged) {
          console.warn(`[checkout] tax for ${orderId}: page arithmetic ${expected}, Square ${taxCharged}`);
        }
      }
      if (total <= 0) {
        // A zero total means the catalog priced everything at nothing, which is
        // a data fault rather than a free order. Charging $0 would "succeed"
        // and ship books.
        console.error(`[checkout] refusing a zero-total order ${orderId}`);
        res.status(409).json({ error: 'Could not price the order.' });
        return;
      }

      /*
       * Unit prices, taken from the order Square priced.
       *
       * Not from the Firestore catalog mirror, for the same reason the
       * confirmation email is not: the mirror can be stale by exactly the
       * amount that would make a sales report disagree with the bank. Square's
       * `gross_sales_money` is what it actually charged for the line before
       * tax — a size's add-on included — and the report is built on that or on
       * nothing.
       *
       * Matched by the `uid` each line was sent with. Names were used once, and
       * stopped being enough with clothing: two sizes of one shirt come back as
       * two lines with the same name. A line that fails to match leaves
       * `unitPrice` null, which the rollup handles by leaving per-product
       * revenue at zero rather than guessing.
       */
      const pricedByUid = new Map<string, number>();
      for (const item of orderJson.order?.line_items ?? []) {
        const quantity = Number(item.quantity ?? '1') || 1;
        // Before tax, so per-product revenue is the book's price, not price plus tax.
        const lineTotal = item.gross_sales_money?.amount ?? item.total_money?.amount;
        if (item.uid && typeof lineTotal === 'number') {
          pricedByUid.set(item.uid, Math.round(lineTotal / quantity));
        }
      }

      // ── 2. Record it — before any money moves ────────────────────────────
      /*
       * ---------------------------------------------------------------------
       * Written first, so a paid order can never be one we have no record of.
       *
       * This used to charge the card and *then* write the order. When that
       * write failed, the buyer was told "Nothing was charged" with the money
       * gone, and the webhook — which ignores payments for orders it has never
       * heard of, because the register's in-person sales arrive there too —
       * ignored this one as well. Everything the buyer typed was lost with it:
       * their name, how to reach them, whether to post it and where.
       *
       * Now everything the buyer told us is on file, as `pending`, before
       * Square is asked for a penny. If the write after the charge fails, the
       * order is still here, and Square's `payment.updated` webhook finds it by
       * id and marks it paid. A declined card marks it `failed`, which the staff
       * lists and the takings both leave out.
       *
       * The clothing sizes are taken in the same transaction, so this is also
       * what stops two buyers paying for the last shirt: the second one is told
       * it has gone *before* their card is touched. Checking the count here and
       * lowering it after payment, as this did, let both through.
       * ---------------------------------------------------------------------
       */
      const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
      const demand = sizeDemand(built.items);
      const memberUid = (await callerOf(req))?.uid ?? null;
      const record = {
        squareOrderId: orderId,
        /*
         * The uid when the buyer happens to be signed in, null otherwise.
         *
         * Nearly always null, and that is not a defect: sign-in on this site is
         * Microsoft-only and restricted to the parish tenant, so a parishioner
         * cannot have an account. A servant buying a book from their own laptop
         * can, and attributing that order costs one header read. Buyers find
         * their orders by receipt instead — see functions/src/orders.ts.
         *
         * Read from a verified ID token, never from the request body. A uid the
         * browser could name is a uid the browser could choose.
         */
        memberUid,
        contactEmail: email,
        // The only form a lookup query can match. See the note on
        // `contactEmailLower` in schema/commerce.ts.
        contactEmailLower: normalizeEmail(email),
        // Who the books are for. Not the cardholder name — see the note in
        // schema/commerce.ts.
        buyerFirstName: firstName,
        buyerLastName: lastName,
        ...(phone ? { buyerPhone: phone } : {}),
        lineItems: built.items.map((item) => {
          const unit = pricedByUid.get(item.uid);
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
        // What Square charged as tax, never our own arithmetic.
        tax: { amount: taxCharged, currency: 'USD' },
        shipping,
        shippingAddress: shipping ? (body.address ?? null) : null,
        ...(shipping ? { shippingService: postage.label } : {}),
        /*
         * The total's parts, recorded so the metrics and the finance page can
         * show books, tax and delivery separately rather than working them back
         * out of the total. All from Square's priced order except delivery,
         * which is the figure this Function put on it.
         */
        subtotal: { amount: total - taxCharged - (shipping ? postage.cents : 0), currency: 'USD' },
        shippingCents: shipping ? postage.cents : 0,
        handlingCents: shipping ? postage.handling : 0,
        idempotencyKey,
        /*
         * `refund` is deliberately NOT written here, not even as null.
         *
         * This write merges, and Square returns the original order for a
         * repeated idempotency key — so this block can run a second time for one
         * purchase. Writing `refund: null` would then erase a refund that had
         * already been issued, and the order would read as never refunded while
         * the money was gone. Absent means not refunded; readers treat it that
         * way.
         */
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: null,
      };

      let held: { short: { slug: string; size: string; left: number }[] };
      try {
        held = await db.runTransaction(async (tx) => {
          const slugsWithSizes = [...new Set(demand.map((entry) => entry.slug))];
          const productRefs = slugsWithSizes.map((slug) => db.collection(COLLECTIONS.products).doc(slug));
          const [existing, ...productSnaps] = await Promise.all([
            tx.get(orderRef),
            ...productRefs.map((ref) => tx.get(ref)),
          ]);

          /*
           * The same purchase arriving again — a double-tap, or the app
           * retrying after a dropped connection. Square hands back the same
           * order id for the same key, so this document may already be paid,
           * refunded, or marked ready by a volunteer. Those are left exactly as
           * they are: only the buyer's own details are refreshed.
           */
          const status = existing.get('status');
          const settled = existing.exists && status !== 'pending' && status !== 'failed' && status !== 'canceled';
          const holding = existing.get('sizesCounted') === true;

          const write: Record<string, unknown> = { ...record };
          if (!existing.exists) {
            write['status'] = 'pending';
            write['fulfillment'] = 'unfulfilled';
            // The webhook fills this as events arrive; starting it empty means
            // the first one is never mistaken for a replay.
            write['appliedEventIds'] = [];
            write['createdAt'] = FieldValue.serverTimestamp();
          } else if (!settled) {
            write['status'] = 'pending';
          }

          const short: { slug: string; size: string; left: number }[] = [];
          const sizeWrites: (() => void)[] = [];
          if (demand.length > 0 && !holding && !settled) {
            productSnaps.forEach((snap, index) => {
              const slug = slugsWithSizes[index]!;
              const sizes = snap.exists ? cleanSizes(snap.get('sizes')) : null;
              if (!sizes) {
                // No longer clothing at all — staff cleared its sizes after
                // the basket was filled. Nothing to take from, so nothing sold.
                for (const entry of demand.filter((one) => one.slug === slug)) {
                  short.push({ slug, size: entry.size, left: 0 });
                }
                return;
              }
              const taken = takeSizes(sizes, slug, demand);
              short.push(...taken.short.map((one) => ({ slug, ...one })));
              sizeWrites.push(() =>
                tx.update(productRefs[index]!, { sizes: taken.next, updatedAt: FieldValue.serverTimestamp() }),
              );
            });
            if (short.length > 0) return { short };
            sizeWrites.forEach((apply) => apply());
            write['sizesCounted'] = true;
          }

          tx.set(orderRef, write, { merge: true });
          return { short };
        });
      } catch (cause) {
        // Before the card: true, and the buyer can simply try again.
        console.error(`[checkout] could not record ${orderId} before charging`, cause);
        res.status(503).json({ error: 'The order could not be saved, so nothing was charged. Please try again.' });
        return;
      }

      if (held.short.length > 0) {
        const first = held.short[0]!;
        const name = catalog.get(first.slug)?.name ?? 'That item';
        res.status(409).json({
          error:
            first.left > 0
              ? `Only ${first.left} of ${name} in size ${first.size} ${first.left === 1 ? 'is' : 'are'} left. Please change the basket and try again. Nothing was charged.`
              : `${name} in size ${first.size} has just sold out. Please change the basket and try again. Nothing was charged.`,
          code: 'size-sold-out',
          rejected: held.short.map((one) => ({
            slug: one.slug,
            reason: one.left > 0 ? 'not-enough' : 'sold-out',
            size: one.size,
          })),
        });
        return;
      }

      // ── 3. Charge it, for exactly what Square said it costs ──────────────
      let payRes: Response;
      let payJson: {
        payment?: { id?: string; status?: string };
        errors?: { detail?: string; code?: string }[];
      };
      try {
        payRes = await fetch(`${host}/v2/payments`, {
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
        payJson = (await payRes.json()) as typeof payJson;
      } catch (cause) {
        /*
         * No answer from Square, so no way to know whether the card was
         * charged. The order stays `pending` with its sizes held: if the
         * payment went through, Square's webhook marks it paid; a retry with the
         * same key gets the same payment rather than a second one. Telling the
         * buyer either "paid" or "not charged" would be a guess.
         */
        console.error(`[checkout] PAYMENT OUTCOME UNKNOWN — order=${orderId}`, cause);
        res.status(502).json({
          error:
            'We could not hear back from the card processor. Check your email for a receipt from Square ' +
            'before trying again — if one has arrived, you have paid and the order is on file.',
          code: 'payment-unknown',
        });
        return;
      }

      if (!payRes.ok || !payJson.payment?.id) {
        const detail = payJson.errors?.[0];
        console.error('[checkout] payment failed', JSON.stringify(payJson.errors));
        /*
         * A 4xx is Square refusing — a decline, a bad nonce — and nothing was
         * charged: put the sizes back and mark the order failed, so the shirt is
         * for sale again at once. A 5xx is Square's own fault, and whether the
         * charge happened is as unknown as a dropped connection; that order is
         * left pending for the webhook to settle.
         */
        /*
         * One exception among the 4xxs: IDEMPOTENCY_KEY_REUSED is Square saying
         * this key already has a payment — the first tap's, whose answer was
         * lost. That payment may well have succeeded, so it is as unknown as a
         * 5xx and nothing is released.
         *
         * And the release itself only acts on an order still `pending`, in one
         * transaction, so no answer from Square can mark a paid order failed or
         * put its sizes back.
         */
        const reused = payJson.errors?.some((error) => error.code === 'IDEMPOTENCY_KEY_REUSED') === true;
        if (payRes.status < 500 && !reused) {
          try {
            await db.runTransaction(async (tx) => {
              const snap = await tx.get(orderRef);
              if (snap.get('status') !== 'pending') return;
              const order = snap.data() ?? {};
              const putBack = shouldReturnSizes('failed', order) ? await readSizeReturn(tx, db, orderRef, order) : null;
              putBack?.();
              tx.update(orderRef, { status: 'failed', updatedAt: FieldValue.serverTimestamp() });
            });
          } catch (cause) {
            console.error(`[checkout] could not release ${orderId} after a decline`, cause);
          }
        }
        // Square's decline messages are written for buyers, so pass one
        // through rather than replacing it with something vaguer.
        res.status(402).json({ error: detail?.detail ?? 'The card was declined.' });
        return;
      }

      // ── 4. Mark it paid ──────────────────────────────────────────────────
      const paymentId = payJson.payment.id;
      const status = payJson.payment.status === 'COMPLETED' ? 'paid' : 'pending';
      charged = { orderId, status, total };

      /*
       * In a transaction so it never moves an order backwards: the webhook can
       * beat this write, since a COMPLETED payment fires an event before this
       * request has finished, and writing `pending` over the `paid` it applied
       * would hide a paid order from the staff lists.
       *
       * A failure here is logged loudly and otherwise survived. The order and
       * everything the buyer typed are already on file, and the webhook will
       * mark it paid by its id — so the buyer is told the truth: it worked.
       */
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(orderRef);
          const current = snap.get('status');
          // A failed order found paid after all had its sizes put back; take
          // them again so the shelf agrees with what was sold.
          const order = snap.data() ?? {};
          const retake =
            current !== 'pending' && mayMoveOrder(current, status) && needsRetake(status, order)
              ? await readSizeRetake(tx, db, orderRef, order)
              : null;
          retake?.();
          tx.update(orderRef, {
            squarePaymentId: paymentId,
            ...(current === 'pending' || current === 'failed' ? { status } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (cause) {
        console.error(
          // No buyer details in the log: unlike the old order of steps, they
          // are already in the order document, and logs are kept far longer.
          `[checkout] PAID BUT NOT MARKED — order=${orderId} payment=${paymentId}. ` +
            'The order is on file as pending; the payment webhook should mark it paid.',
          cause,
        );
      }

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
              buyerName: `${firstName} ${lastName}`,
              shipping,
              lines: (orderJson.order?.line_items ?? []).map((item) => {
                const asked = builtByUid.get(item.uid ?? '');
                return {
                  name: `${item.name ?? 'Book'}${asked?.size ? ` — size ${asked.size}` : ''}`,
                  quantity: Number(item.quantity ?? '1'),
                  amount: item.gross_sales_money?.amount ?? item.total_money?.amount ?? 0,
                  sku: (asked && catalog.get(asked.slug)?.sku) || null,
                };
              }),
              ...(shipping ? { shippingService: postage.label, shippingCents: postage.cents } : {}),
              ...(taxCharged > 0 ? { taxCents: taxCharged, taxLabel: taxLabel(settings.taxRateBps) } : {}),
              total,
              ...(settings.orderEmail ? { parishEmail: settings.orderEmail } : {}),
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
      /*
       * Everything after the charge has its own catch, so this should be
       * unreachable once money has moved — but if it is ever reached, the one
       * sentence it must not say is "nothing was charged". The order is on file
       * from before the charge, so the buyer is told it went through.
       */
      if (charged) {
        console.error(`[checkout] PAID, then failed — order=${charged.orderId}`, error);
        if (!res.headersSent) res.status(200).json({ ok: true, ...charged });
        return;
      }
      console.error('[checkout] unexpected failure', error);
      res.status(500).json({ error: 'Checkout failed. Nothing was charged.' });
    }
  },
);


/**
 * `POST /api/shipping/quote` — `{ cart: [{slug, quantity}], postalCode }`.
 *
 * Here rather than in shipping.ts so that it reads the shop's settings through
 * `bookstoreSettings`, the same function `squareCheckout` uses: the flat charge
 * this returns is then the flat charge checkout takes, including when the
 * settings document is missing and the deploy-time fallback applies.
 *
 * Answers with the live options and the flat charge together, so the page can
 * show the flat line without a second round trip when `options` is empty. Never
 * an error for "could not quote" — that is the flat charge, and a buyer must be
 * able to pay it.
 */
export const shippingQuote = onRequest(
  {
    secrets: [USPS_CLIENT_ID, USPS_CLIENT_SECRET, SHIPPING_QUOTE_SECRET],
    maxInstances: CAPS.shippingQuote,
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }
    if (
      throttled(req, res, {
        bucket: 'shippingQuote',
        max: BUDGETS.shippingQuote,
        message: 'Too many postage quotes from here. Please wait a minute and try again.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as { cart?: unknown; postalCode?: unknown };
    const zip = usableZip(body.postalCode);
    const lines = parcelLines(body.cart);
    if (!zip || lines.length === 0) {
      res.status(400).json({ error: 'A basket and a five-digit ZIP code are needed.' });
      return;
    }

    const db = getFirestore();
    const [settings, catalog] = await Promise.all([
      bookstoreSettings(db),
      productsFor(
        db,
        lines.map((line) => line.slug),
      ),
    ]);

    const options = await liveOptions(lines, zip, catalog, settings.shipping);
    const answer: ShippingQuoteResponse = {
      // Cheapest first, which is also the one preselected.
      options: options.sort((a, b) => a.cents - b.cents),
      fallbackCents: settings.deliveryCents,
    };
    res.set('Cache-Control', 'no-store');
    res.status(200).json(answer);
  },
);
