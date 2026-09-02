import { onRequest } from 'firebase-functions/v2/https';
import { BUDGETS, CAPS, throttled } from './rateLimit.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  MAX_LOOKUP_RESULTS,
  normalizeEmail,
  orderMatchesEmail,
  parseLookupRequest,
  toPublicOrderView,
  type DocOf,
  type Order,
  type OrderLookupResponse,
} from '@spsm/shared';

/**
 * A buyer looking up their own orders.
 *
 * ---------------------------------------------------------------------------
 * The order id is checked first, and the check is a `get`, not a query.
 *
 * The flow is: fetch the one order whose id was typed, confirm its email
 * matches the one that was typed, and only then query for the rest of that
 * email's history. Doing it the other way round — querying by email and looking
 * for the order id in the results — reads the same documents but turns the
 * endpoint into an oracle: it would answer "does anyone with this address have
 * orders" for an attacker who supplies a junk order id, because the query runs
 * before the pair is validated and its cost is observable in the timing.
 *
 * The single `get` also costs one read to reject a wrong guess, which is what
 * makes brute force pointless rather than merely slow.
 *
 * Everything is reported as one message. "No order with that number" and "that
 * email does not match" are two facts an attacker would very much like to be
 * able to tell apart, and no honest buyer needs to.
 * ---------------------------------------------------------------------------
 */
export const orderLookup = onRequest(
  { cors: false, maxInstances: CAPS.orderLookup },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'POST only.' } satisfies OrderLookupResponse);
      return;
    }

    /*
     * The tightest public budget on the site, because this is the one endpoint
     * whose credential can be guessed at rather than stolen.
     *
     * The note above explains why a wrong guess is cheap for us — one `get`, no
     * query, no oracle. It is also cheap for the guesser, and that is the half
     * this covers: ten attempts a minute makes working through an order-number
     * space a matter of years rather than an afternoon. A buyer who mistypes
     * their receipt twice is nowhere near it.
     */
    if (
      throttled(req, res, {
        bucket: 'orderLookup',
        max: BUDGETS.orderLookup,
        message:
          'Too many lookups from here. Please wait a minute, then check the order ' +
          'number and email against your receipt.',
      })
    ) {
      return;
    }

    const parsed = parseLookupRequest((req.body ?? {}) as Record<string, unknown>);
    if (!parsed) {
      res.status(400).json({
        ok: false,
        error: 'Enter the order number from your receipt and the email you used.',
      } satisfies OrderLookupResponse);
      return;
    }

    const notFound: OrderLookupResponse = {
      ok: false,
      error:
        'No order matches that number and email. Check both against your receipt — ' +
        'the email must be the one the receipt was sent to.',
    };

    const db = getFirestore();

    try {
      const proof = await db.collection(COLLECTIONS.orders).doc(parsed.orderId).get();
      if (!proof.exists) {
        res.status(404).json(notFound);
        return;
      }

      const proofOrder = proof.data() as Order;
      if (!orderMatchesEmail(proofOrder, parsed.email)) {
        res.status(404).json(notFound);
        return;
      }

      // ── The pair is good. Return everything that address has bought ────────
      const email = normalizeEmail(parsed.email);
      const collection = db.collection(COLLECTIONS.orders);

      /*
       * Two queries, because `contactEmailLower` is newer than the collection.
       *
       * Orders written before that field existed have only the address as the
       * buyer typed it at the time, so a query on the lowercased field silently
       * omits them — and a history that quietly starts in September is worse than
       * one that errors.
       *
       * The second query matches `proofOrder.contactEmail`, the address **as
       * stored on the order they just proved**, and not the address as they typed
       * it into the form. Firestore `==` is byte-exact: matching on the typed form
       * only finds a legacy order when the buyer happens to capitalise their own
       * address the same way twice, months apart. Their earlier orders were
       * almost certainly written with the casing sitting on this one — same
       * person, same autofill — so this is the string with a real chance of
       * matching. Verified: matching the typed form returned one of two orders,
       * matching the stored form returns both.
       *
       * It is still only a best effort for legacy rows; `scripts/backfill-order-emails.mjs`
       * is the actual fix, and once it has run every order has the lowercased
       * field and the first query alone is complete.
       */
      const [byLower, byStoredCase] = await Promise.all([
        collection
          .where('contactEmailLower', '==', email)
          .orderBy('createdAt', 'desc')
          .limit(MAX_LOOKUP_RESULTS)
          .get(),
        collection
          .where('contactEmail', '==', proofOrder.contactEmail)
          .orderBy('createdAt', 'desc')
          .limit(MAX_LOOKUP_RESULTS)
          .get(),
      ]);

      const found = new Map<string, DocOf<Order>>();
      // The proven order goes in first so it is always present, even if an index
      // is still building or the address was stored in some third casing.
      found.set(proof.id, { ...proofOrder, id: proof.id });
      for (const snapshot of [byLower, byStoredCase]) {
        for (const doc of snapshot.docs) {
          const order = doc.data() as Order;
          // Re-checked rather than trusted: the queries are two different fields
          // and only this comparison is the actual rule.
          if (orderMatchesEmail(order, parsed.email)) {
            found.set(doc.id, { ...order, id: doc.id });
          }
        }
      }

      const orders = [...found.values()]
        .map((order) => {
          const createdAt = order.createdAt;
          const placedAt = createdAt instanceof Timestamp ? createdAt.toDate() : null;
          return { placedAt, view: toPublicOrderView(order, placedAt) };
        })
        .sort((a, b) => (b.placedAt?.getTime() ?? 0) - (a.placedAt?.getTime() ?? 0))
        .slice(0, MAX_LOOKUP_RESULTS)
        .map((row) => row.view);

      res.status(200).json({ ok: true, orders } satisfies OrderLookupResponse);
    } catch (error) {
      console.error('[orders] lookup failed', error);
      res
        .status(500)
        .json({ ok: false, error: 'Could not look that up just now.' } satisfies OrderLookupResponse);
    }
  },
);
