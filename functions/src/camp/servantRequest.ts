import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  campLineId,
  dayKey,
  parseCampConfig,
  parseCampRegistration,
  validateServantSignUp,
  type CampPaymentRecord,
  type CampRegistrationDraft,
} from '@spsm/shared';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';

/**
 * The zone every date on this endpoint is read in, as it is in `stats.ts` and
 * `calendar.ts`. A payment taken at nine on a Saturday evening in Wayland is a
 * Sunday in UTC, and a treasurer reconciling a month by `receivedOn` should
 * never have to know that.
 */
const PARISH_TIME_ZONE = 'America/New_York';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  chargeCard,
} from '../square.js';

/**
 * A servant signing themselves up for camp.
 *
 * ---------------------------------------------------------------------------
 * Why this is a Function and not a Firestore write with a clever rule.
 *
 * `firestore.rules` keeps `campServantRequests` closed to every client —
 * `allow create: if false` — and this is what it is closed in favour of. The
 * same three-part argument as `forms/submit.ts`, with one addition that is
 * specific to the camp:
 *
 *   1. **The ministry and the season are not the sender's to choose.** They are
 *      read here from `config/camp` and written from that, so a hand-made
 *      request cannot file itself under a ministry whose administrators would
 *      never have been shown it, or under next year's season where nobody is
 *      looking yet.
 *   2. **Whether sign-ups are open is a document, not a field on the request.**
 *      `servantSignUp` lives in the same config, and a rule that read it would
 *      cost a `get()` on every attempt while still being unable to say anything
 *      useful when it is false.
 *   3. **Rules cannot rate-limit.** This is an unauthenticated endpoint on a
 *      billed project, reachable by anyone with the address.
 *
 * The addition: the answers are validated against the *shared* validator, which
 * is the same one the page ran before sending. That run was a courtesy to save
 * a round trip; this one decides.
 *
 * ## What it deliberately does not do
 *
 * It does not write a `campRegistrations` document, and nothing here can. A
 * sign-up is a request until an administrator holding the camp's program grant
 * accepts it in the queue, at which point *their* browser writes the
 * registration under their own uid. That is the whole shape of the feature: the
 * open door leads to a waiting room, not to the register.
 *
 * ## What it does do, that it did not before
 *
 * It takes money. A camp can set a flat charge for its servants — the shirt —
 * in `config/camp.servantChargeCents`, and when it is set this endpoint charges
 * the card token that came with the sign-up before it stores anything. The
 * amount is read from the settings and never from the request, for the same
 * reason the season is: a figure the browser can name is a figure the browser
 * can set to zero. When the setting is zero there is no card, no Square call
 * and no change to what this endpoint was.
 *
 * It also sends no confirmation email. There is nowhere to send one from — the
 * parish's mail is Breeze's and this project holds no credential for it — and a
 * form that claims a confirmation is coming is worse than one that says plainly
 * on screen that the camp will be in touch.
 * ---------------------------------------------------------------------------
 */
export const campServantRequest = onRequest(
  {
    cors: false,
    maxInstances: CAPS.campServantRequest,
    /*
     * Declared because a camp that charges its servants takes a card here, and
     * `chargeCard` cannot read a secret this Function did not ask for. Both are
     * listed for the reason `square.ts` gives: the environment and the token
     * are a pair, and the pairing is decided there rather than here.
     */
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ errors: ['Method not allowed.'] });
      return;
    }

    /*
     * Tighter than the forms endpoint's ten.
     *
     * A servant signs up once. Somebody correcting a rejected form might post
     * three or four times in a minute; nobody posts a fifth legitimately, and the
     * cost of being wrong is a sentence asking them to wait a minute.
     */
    if (
      throttled(req, res, {
        bucket: 'campServantRequest',
        max: BUDGETS.campServantRequest,
        plural: true,
        message: 'Too many sign-ups from here. Please wait a minute.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as {
      registration?: unknown;
      message?: unknown;
      cardToken?: unknown;
    };
    const message = typeof body.message === 'string' ? body.message.slice(0, 2_000) : '';
    const cardToken = typeof body.cardToken === 'string' ? body.cardToken : '';

    const db = getFirestore();

    /*
     * The config read is not optional here, unlike on the admin screen.
     *
     * There, a failed read falls back to the committed defaults so the screen
     * opens saying "no fee set" rather than not opening at all. Here the config
     * *is* the authorisation — the season a sign-up is filed under and whether
     * sign-ups are being taken at all — and defaulting either would accept a
     * stranger's registration into a guessed season on a camp that may have
     * closed its list. A 503 asks them to try again; a guess quietly loses them.
     */
    let config;
    try {
      const snapshot = await db.collection(COLLECTIONS.config).doc(CONFIG_DOC_CAMP).get();
      if (!snapshot.exists) {
        console.error(
          `[camp] ${COLLECTIONS.config}/${CONFIG_DOC_CAMP} does not exist, so there is no season ` +
            'to file a sign-up under. Create it with: npm run camp -- --write',
        );
        res.status(503).json({
          errors: ['Camp sign-ups are not set up yet. Please contact the church office.'],
        });
        return;
      }
      config = parseCampConfig(snapshot.data());
    } catch (cause) {
      console.error('[camp] could not read the camp settings', cause);
      res.status(503).json({ errors: ['Could not reach the camp settings. Please try again.'] });
      return;
    }

    if (!config.servantSignUp) {
      res.status(409).json({
        errors: ['The camp is not taking servant sign-ups at the moment.'],
      });
      return;
    }

    /*
     * Parsed through the same tolerant reader the register uses, then overwritten
     * on the fields that are ours to decide.
     *
     * `parseCampRegistration` is what makes this safe to accept from a stranger:
     * it takes an arbitrary object and yields a registration with every field
     * coerced, unknown keys dropped, and the children array emptied because the
     * kind is `servant`. Nothing arrives on this document that this project's own
     * schema did not put there.
     */
    const parsed = parseCampRegistration({ ...(body.registration as object), kind: 'servant' });
    const { createdAt: _c, updatedAt: _u, updatedBy: _b, ...draft } = parsed;

    const registration: CampRegistrationDraft = {
      ...draft,
      programId: config.programId,
      season: config.season,
      kind: 'servant',
      // A sign-up is never registered by arriving. See the queue.
      status: 'draft',
      // Nobody took this at a desk, and nothing they sent may claim otherwise.
      takenByUid: null,
      // The administrators' note is theirs. What the servant wrote goes in
      // `message`, and is carried across with its provenance when accepted.
      note: '',
      servant: draft.servant
        ? {
            ...draft.servant,
            /*
             * `assignedRoles`, `cleared` and `clearedNote` were set to empty
             * here, and they are gone because the fields are gone: all three
             * were deleted from `CampServantDetails` when servant registrations
             * became read-only.
             *
             * The comment they carried is worth keeping, because it is the
             * reason this endpoint was ever safe: `assignedRoles` was what
             * administrators gave somebody as opposed to what they asked for, so
             * a sign-up able to set it would be a servant assigning themselves a
             * role; and `cleared` was the safeguarding flag, where a stranger
             * setting it on their own record was the most serious thing this
             * endpoint could get wrong. Neither is expressible now, which is a
             * stronger guarantee than clearing them was.
             */
            // Nobody is signed in. A uid could only be one they made up.
            uid: null,
          }
        : null,
      /*
       * The charge is read from the settings, never from the request.
       *
       * `baseCents` stays zero because a servant is not billed for weeks — see
       * `campBill` — and `chargeCents` is the flat shirt money the camp set. A
       * charge the browser could name is a charge the browser could set to
       * nothing, so whatever arrived in `registration.billing` is discarded
       * here along with any payments a hand-made request tried to claim it had
       * already made.
       */
      billing: {
        baseCents: 0,
        chargeCents: config.servantChargeCents,
        chargeLabel: config.servantChargeLabel,
        discounts: [],
        payments: [],
      },
    };

    const problems = validateServantSignUp(registration, {
      waiverInForce: config.waiverText.trim().length > 0,
    });
    if (problems.length > 0) {
      res.status(400).json({ errors: problems });
      return;
    }

    /*
     * ── The money ────────────────────────────────────────────────────────────
     *
     * Charged before anything is written, and the ordering is the same choice
     * `forms/submit.ts` makes for the same reason: recording first would leave
     * a declined card as a junk sign-up in the queue that an administrator has
     * to recognise and dismiss, and the cleanup write can fail in its own
     * right. This way the queue only holds sign-ups that actually happened.
     *
     * The failure it accepts is the narrow one below — the card is charged and
     * the write then fails — and that is answered rather than ignored.
     */
    let payment: CampPaymentRecord | null = null;
    if (config.servantChargeCents > 0) {
      if (!cardToken) {
        res.status(400).json({ errors: ['This sign-up needs to be paid for.'] });
        return;
      }

      const charged = await chargeCard({
        cardToken,
        totalCents: config.servantChargeCents,
        note: config.servantChargeLabel || `Summer camp ${config.season} — servant`,
        buyerEmail: registration.contact.email || null,
        tag: 'camp',
      });

      if (!charged.ok) {
        res.status(charged.status).json({ errors: [charged.reason] });
        return;
      }

      /*
       * Recorded as a payment on the registration, so it is one thing and not
       * two: the camp's ledger, the finance rollup and the balance on the
       * roster all read `billing.payments[]`, and a Square id kept anywhere
       * else would be money the church's own books cannot see.
       *
       * `recordedByUid` is null because nobody was signed in — the same honesty
       * `takenByUid` keeps above. `receivedOn` is today in the parish's own
       * zone, which is what the finance screen buckets a month by.
       */
      payment = {
        id: campLineId('payment'),
        amountCents: config.servantChargeCents,
        method: 'square',
        reference: charged.paymentId,
        receivedOn: dayKey(new Date(), PARISH_TIME_ZONE),
        note: config.servantChargeLabel || 'Paid at sign-up',
        recordedByUid: null,
        recordedAt: null,
      };
      registration.billing.payments = [payment];
    }

    try {
      const written = await db.collection(COLLECTIONS.campServantRequests).add({
        programId: config.programId,
        season: config.season,
        registration,
        message,
        submittedAt: FieldValue.serverTimestamp(),
      });
      res.json({ requestId: written.id, paymentId: payment?.reference ?? null });
    } catch (cause) {
      console.error('[camp] could not store a servant sign-up', cause);

      /*
       * Paid, and not recorded. The one outcome worth its own message.
       *
       * Telling somebody whose card has just been charged to "try again" is
       * inviting them to pay twice, so this says plainly what happened and asks
       * them to ring the office. The sign-up itself goes to the log, because it
       * is now the only copy of what they answered.
       */
      if (payment) {
        console.error(
          `[camp] PAID BUT NOT RECORDED — payment=${payment.reference} ` +
            `signup=${JSON.stringify(registration)}`,
        );
        res.status(200).json({
          requestId: '',
          paymentId: payment.reference,
          errors: [
            'Your payment went through, but the sign-up did not save. ' +
              'Please ring the church office — do not pay again.',
          ],
        });
        return;
      }

      res.status(500).json({ errors: ['That did not send. Please try again shortly.'] });
    }
  },
);
