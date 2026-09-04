import { createHash, randomUUID } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  FORM_UPLOAD_PREFIX,
  computeTotalCents,
  isFormUploadPath,
  identifySubmitter,
  keepsNoSubmissions,
  parseFormDefinition,
  submissionAnswers,
  validateSubmission,
  type FormAnswers,
  type FormDefinition,
} from '@spsm/shared';
import {
  SQUARE_ACCESS_TOKEN,
  SQUARE_SANDBOX_ACCESS_TOKEN,
  squareClient,
} from '../square.js';
import { TAKSIS_SERVICE_ACCOUNT, pushVehicleRegistration } from './taksis.js';
import { buildFormEmails } from './email.js';
import { loadForm } from './loadForm.js';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';

/**
 * Every parish form arrives here.
 *
 * ---------------------------------------------------------------------------
 * Why a Function rather than a Firestore write from the page.
 *
 * `firestore.rules` keeps `formSubmissions` closed — `allow create: if false` —
 * and this is what it is closed in favour of. Three things a submission has to
 * do cannot be done from a browser at all:
 *
 *   1. **Price it.** A form charges a base fee plus per-option and per-unit
 *      prices. The total has to be computed from the *stored* definition by
 *      something the submitter cannot edit. There is deliberately nowhere in the
 *      request body to put an amount.
 *   2. **Take the payment.** The Square access token lives here and goes nowhere
 *      near a page.
 *   3. **Reach Taksis.** The vehicle form writes to a different Firebase
 *      project, which a browser holding our credentials cannot touch no matter
 *      what any rule says.
 *
 * Given the Function has to exist for those, free forms come through it too. One
 * path that validates, one that notifies, and no unauthenticated write surface
 * on a billed project.
 * ---------------------------------------------------------------------------
 */

export const formSubmit = onRequest(
  {
    cors: false,
    maxInstances: CAPS.formSubmit,
    secrets: [SQUARE_ACCESS_TOKEN, SQUARE_SANDBOX_ACCESS_TOKEN, TAKSIS_SERVICE_ACCOUNT],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ errors: ['Method not allowed.'] });
      return;
    }

    /*
     * Unchanged in budget, and now answered with `Retry-After`. A client that is
     * told how long to wait can wait; one that is not told retries immediately,
     * which is how a refusal becomes the flood it was meant to prevent.
     *
     * `plural` because every other answer this endpoint gives is `{ errors: [] }`
     * and the page reads that key — a 429 in the singular shape is a 429 the
     * form cannot display.
     */
    if (
      throttled(req, res, {
        bucket: 'formSubmit',
        max: BUDGETS.formSubmit,
        plural: true,
        message: 'Too many submissions from here. Please wait a minute.',
      })
    ) {
      return;
    }

    const body = (req.body ?? {}) as {
      slug?: unknown;
      answers?: unknown;
      cardToken?: unknown;
      verificationToken?: unknown;
    };

    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const answers = (body.answers && typeof body.answers === 'object'
      ? body.answers
      : {}) as FormAnswers;
    const cardToken = typeof body.cardToken === 'string' ? body.cardToken : null;

    if (!slug) {
      res.status(400).json({ errors: ['No form was named.'] });
      return;
    }

    const db = getFirestore();

    const found = await loadForm(db, slug);
    if (!found) {
      res.status(404).json({ errors: ['That form does not exist.'] });
      return;
    }
    const { id: formId, form } = found;

    /*
     * Published and open are both checked here, not only in the page.
     *
     * The page checks them to decide what to draw. This checks them because a
     * form closed at noon should stop accepting answers at noon, including from
     * the tab somebody left open since ten — which still holds a perfectly valid
     * copy of the form and would happily post it.
     */
    if (!form.published) {
      res.status(404).json({ errors: ['That form does not exist.'] });
      return;
    }
    if (!form.open) {
      res.status(409).json({
        errors: [form.closedMessage ?? 'That form is no longer accepting submissions.'],
      });
      return;
    }
    if (keepsNoSubmissions(form.kind)) {
      /*
       * Nothing should ever post here for a form we do not host — an `external`
       * card links straight out, and an `embed` one is framed and submits to
       * its own host inside that frame, which this origin cannot even see.
       *
       * A clear 400 beats storing an answer its owner will never see. The case
       * this actually catches is a form whose kind was *changed* to one of
       * these while somebody had it open: their tab still holds a native copy
       * and will happily post it.
       */
      res.status(400).json({ errors: ['That form is hosted elsewhere.'] });
      return;
    }

    /* ── The vehicle registration goes to Taksis and stops there ───────────── */
    if (form.kind === 'vehicle') {
      const result = await pushVehicleRegistration(answers);
      if (!result.ok) {
        /*
         * Reported, not swallowed — this is the price of the Taksis-only
         * design, paid honestly.
         *
         * There is no local copy of this registration, so a failure here means
         * the submission is genuinely gone. The one thing that must not happen
         * is a confirmation screen for a write that did not land, because the
         * person would drive in on Sunday believing they were registered.
         */
        if (!result.rejected) {
          console.error('[forms] Taksis push failed:', result.reason);
        }
        res.status(result.status).json({ errors: [result.reason] });
        return;
      }
      res.json({ submissionId: result.id, totalCents: 0, paymentId: null });
      return;
    }

    /* ── Native forms ──────────────────────────────────────────────────────── */

    /*
     * Validated again, against the stored definition.
     *
     * The browser ran this same function from @spsm/shared before sending, which
     * is why the messages match — but that run was a courtesy to save a round
     * trip, and this one is the one that decides. Anything the page checks can
     * be skipped by anyone willing to open a console.
     */
    const problems = validateSubmission(form, answers);
    if (problems.length > 0) {
      res.status(400).json({ errors: problems });
      return;
    }

    /*
     * Attached photographs are checked against this form's own folder.
     *
     * `validateSubmission` already refuses anything that is not a well-formed
     * `formUploads/<slug>/<file>` path, which stops the obvious abuse — putting
     * `clergy/Father-Armia.jpg` in a submission and having the staff panel
     * render it as though a parishioner had attached it. This is the second
     * half: the slug in the path must be *this* form's.
     *
     * Without it a path is still trusted across forms, so a photograph uploaded
     * to an open public form could be attached to a submission on a different
     * one. That is a small hole and an easy one to close.
     */
    const misfiled = form.fields
      .filter((field) => field.type === 'photo')
      .map((field) => answers[field.key])
      .filter((value) => typeof value === 'string' && value.length > 0)
      .filter((value) => !isFormUploadPath(value) || !String(value).startsWith(`${FORM_UPLOAD_PREFIX}/${form.slug}/`));

    if (misfiled.length > 0) {
      console.error(`[forms] rejected a photograph path outside ${form.slug}`, misfiled);
      res.status(400).json({
        errors: ['A photograph on this form could not be verified. Please attach it again.'],
      });
      return;
    }

    const clean = submissionAnswers(form.fields, answers);
    const totalCents = computeTotalCents(form, answers);

    let paymentId: string | null = null;
    if (totalCents > 0) {
      if (!cardToken) {
        res.status(400).json({ errors: ['This form needs a payment.'] });
        return;
      }

      const charged = await charge({
        cardToken,
        totalCents,
        note: form.payment.label || form.title,
        buyerEmail: identifySubmitter(form, answers).email,
      });

      if (!charged.ok) {
        res.status(charged.status).json({ errors: [charged.reason] });
        return;
      }
      paymentId = charged.paymentId;
    }

    /*
     * Charge first, then record — and the ordering is a choice with a cost.
     *
     * The alternative, recording first, means a declined card leaves a junk
     * submission staff have to recognise and clear, and the cleanup write can
     * fail in its own right. This way the collection only ever holds
     * submissions that actually happened.
     *
     * The failure it accepts is the narrow one below: the card is charged and
     * the write then fails. That is handled rather than ignored — the answers go
     * to the log with the payment id attached, and the submitter is told their
     * payment went through, because the one wrong thing to tell them is to try
     * again.
     */
    const submitter = identifySubmitter(form, answers);
    let submissionId: string;
    try {
      const written = await db.collection(COLLECTIONS.formSubmissions).add({
        formId,
        formSlug: form.slug,
        formTitle: form.title,
        answers: clean,
        submitterName: submitter.name,
        submitterEmail: submitter.email,
        submitterPhone: submitter.phone,
        status: 'new',
        staffNote: null,
        totalCents,
        paymentId,
        submitterUid: null,
        submittedAt: FieldValue.serverTimestamp(),
      });
      submissionId = written.id;
    } catch (error) {
      console.error(
        `[forms] PAID BUT NOT RECORDED — form=${form.slug} payment=${paymentId ?? 'none'} ` +
          `answers=${JSON.stringify(clean)}`,
        error,
      );
      if (paymentId) {
        res.status(200).json({
          submissionId: '',
          totalCents,
          paymentId,
          errors: [
            'Your payment went through, but the church record did not save. ' +
              'Please contact the church office — do not pay again.',
          ],
        });
        return;
      }
      res.status(500).json({ errors: ['That did not save. Please try again.'] });
      return;
    }

    /*
     * Email last, after the response is decided, inside a catch that swallows.
     *
     * Same rule the checkout follows: by this point the submission is recorded
     * and, if it cost anything, paid for. A failure in the mail queue must not
     * turn that into an error the submitter sees, because the only action it
     * would suggest to them is submitting again.
     */
    res.json({ submissionId, totalCents, paymentId });

    try {
      const mail = buildFormEmails({ form, answers: clean, submitter, totalCents, submissionId });
      await Promise.all(
        mail.map((message, index) =>
          // `create` with a deterministic id, so a retried request cannot send
          // a second copy of the same message.
          db.collection(COLLECTIONS.mail).doc(`form-${submissionId}-${index}`).create(message),
        ),
      );
    } catch (error) {
      console.error('[forms] could not queue the notification email', error);
    }
  },
);

type Charged =
  | { ok: true; paymentId: string }
  | { ok: false; status: number; reason: string };

/**
 * Charge a card for an amount this Function worked out.
 *
 * ---------------------------------------------------------------------------
 * A bare payment, not an order — unlike the bookstore.
 *
 * `checkout.ts` builds a Square *order* out of catalog ids and lets Square price
 * it, which is what makes the bookstore's totals untamperable: the browser has
 * nowhere to put a price because it never sends one.
 *
 * A form has no Square catalog behind it. Nothing in the parish's Square account
 * corresponds to "summer camp, two children, family tier", and inventing catalog
 * objects per form would put the prices in a second system that the builder
 * would then have to keep in step. So the guarantee is rebuilt on our side
 * instead: `computeTotalCents` runs against the definition stored in Firestore,
 * and the browser's copy of that number is a display, not an input.
 * ---------------------------------------------------------------------------
 *
 * The idempotency key is derived from the card token rather than random. A
 * single-use token can only be charged once anyway, but deriving the key means a
 * retried request carrying the same token maps to the same key, and Square
 * returns the original payment instead of an error about a spent token.
 */
async function charge(input: {
  cardToken: string;
  totalCents: number;
  note: string;
  buyerEmail: string | null;
}): Promise<Charged> {
  const square = squareClient();
  if (!square) {
    return { ok: false, status: 503, reason: 'Payments are not set up on this site yet.' };
  }

  const idempotencyKey = createHash('sha256')
    .update(input.cardToken)
    .digest('hex')
    .slice(0, 45);

  let response: Response;
  try {
    response = await fetch(`${square.host}/v2/payments`, {
      method: 'POST',
      headers: square.headers,
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        source_id: input.cardToken,
        location_id: square.locationId,
        amount_money: { amount: input.totalCents, currency: 'USD' },
        note: input.note.slice(0, 500),
        ...(input.buyerEmail ? { buyer_email_address: input.buyerEmail } : {}),
        // Square's own reference for the parish's records; a random id is fine
        // because nothing on our side looks a payment up by it.
        reference_id: randomUUID().slice(0, 40),
      }),
    });
  } catch (error) {
    console.error('[forms] could not reach Square', error);
    return { ok: false, status: 502, reason: 'The payment service could not be reached.' };
  }

  const json = (await response.json().catch(() => ({}))) as {
    payment?: { id?: string };
    errors?: { detail?: string }[];
  };

  if (!response.ok || !json.payment?.id) {
    console.error('[forms] payment failed', JSON.stringify(json.errors));
    // Square's decline messages are written for buyers, so pass one through
    // rather than replacing it with something vaguer.
    return {
      ok: false,
      status: 402,
      reason: json.errors?.[0]?.detail ?? 'The card was declined.',
    };
  }

  return { ok: true, paymentId: json.payment.id };
}
