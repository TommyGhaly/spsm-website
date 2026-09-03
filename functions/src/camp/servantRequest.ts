import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_CAMP,
  parseCampConfig,
  parseCampRegistration,
  validateServantSignUp,
  type CampRegistrationDraft,
} from '@spsm/shared';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';

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
 * It also sends no confirmation email. There is nowhere to send one from — the
 * parish's mail is Breeze's and this project holds no credential for it — and a
 * form that claims a confirmation is coming is worse than one that says plainly
 * on screen that the camp will be in touch.
 * ---------------------------------------------------------------------------
 */
export const campServantRequest = onRequest(
  { cors: false, maxInstances: CAPS.campServantRequest },
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

    const body = (req.body ?? {}) as { registration?: unknown; message?: unknown };
    const message = typeof body.message === 'string' ? body.message.slice(0, 2_000) : '';

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
      billing: { baseCents: 0, discounts: [], payments: [] },
    };

    const problems = validateServantSignUp(registration, {
      waiverInForce: config.waiverText.trim().length > 0,
    });
    if (problems.length > 0) {
      res.status(400).json({ errors: problems });
      return;
    }

    try {
      const written = await db.collection(COLLECTIONS.campServantRequests).add({
        programId: config.programId,
        season: config.season,
        registration,
        message,
        submittedAt: FieldValue.serverTimestamp(),
      });
      res.json({ requestId: written.id });
    } catch (cause) {
      console.error('[camp] could not store a servant sign-up', cause);
      res.status(500).json({ errors: ['That did not send. Please try again shortly.'] });
    }
  },
);
