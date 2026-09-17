/**
 * The moments a servant is told something happened.
 *
 * ---------------------------------------------------------------------------
 * ## Firestore triggers, in the database's region
 *
 * `us-east1`, like `galleries.ts` and for the same non-negotiable reason: a v2
 * Firestore trigger must be deployed in the region of the database it watches,
 * and `spsm-database` is us-east1. Deploying these alongside the HTTP endpoints
 * in us-central1 fails at deploy time with a region mismatch.
 *
 * ## Why triggers rather than a line in each writing Function
 *
 * `formSubmit` could send its own push — it already queues its own email. The
 * orders one could not: an order becomes real when **Square's webhook says the
 * money settled**, which is a different Function from the one that created it,
 * and a refund arrives the same way. So `orders` has to be a trigger watching
 * the document rather than a line in a request handler, and once one of them is
 * a trigger the others should be too: it keeps every "who gets told" decision
 * in this directory instead of scattered across the handlers that happen to
 * write each record, each of which would grow a notification as an
 * afterthought.
 *
 * It also means a record written by *any* path produces a notification —
 * including a correction made by hand in the Firebase console, which is how a
 * parish actually fixes things.
 *
 * ## The rule every handler below obeys
 *
 * **Never throw.** A trigger that throws is retried by Cloud Functions, and
 * every one of these fires *after* the real work has already succeeded and been
 * committed. A retry cannot un-send a push that did go out, so a failure here
 * would produce duplicates rather than a fix. `sendNotice` swallows its own
 * transport errors; these handlers guard the reads around it.
 * ---------------------------------------------------------------------------
 */
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, formatMoney, type FormDefinition } from '@spsm/shared';

import { audienceForProgramEvent, audienceForScreen } from './audience.js';
import { sendNotice } from './send.js';

/** Must match the Firestore database's region. See the header. */
const RUNTIME = {
  region: 'us-east1',
  /*
   * Small and few. Each of these reads at most three documents and posts to
   * FCM; the work is network-bound, not memory-bound. The cap matters more
   * than the memory: a batch of forty camp registrations imported at once
   * would otherwise spin up forty instances to send forty pushes.
   */
  memory: '256MiB' as const,
  timeoutSeconds: 60,
  maxInstances: 5,
} as const;

/* -------------------------------------------------------------------------- */
/* Bookstore orders                                                           */
/* -------------------------------------------------------------------------- */

/**
 * An order, once the money has actually arrived.
 *
 * ---------------------------------------------------------------------------
 * `onDocumentWritten` and not `onDocumentCreated`, which is the whole subtlety
 * of this one.
 *
 * `squareCheckout` creates the order document *before* the buyer has paid —
 * that is what a checkout is — so a create trigger would announce every
 * abandoned basket as a sale. The money is confirmed later, by
 * `applyOrderUpdate` in index.ts, when Square's webhook reports the payment.
 * So the event worth telling somebody about is the **transition into `paid`**,
 * and only a written trigger can see a transition.
 *
 * Guarded on the transition rather than on the value. Square redelivers, and
 * `applyOrderUpdate` writes `appliedEventIds` on the same document — so a
 * `paid` order is written to again on the next delivery, and a handler that
 * only checked `status === 'paid'` would push once per redelivery. Comparing
 * before and after makes it exactly once per real change, which is the
 * property `appliedEventIds` gives the order itself.
 *
 * The hint on the settings row says "Not when a basket is abandoned", because
 * that is the question somebody will have about this notification.
 * ---------------------------------------------------------------------------
 */
export const onOrderPaid = onDocumentWritten(
  { ...RUNTIME, document: `${COLLECTIONS.orders}/{orderId}` },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;

    // The transition, not the state. See the note above.
    if (before?.['status'] === 'paid' || after['status'] !== 'paid') return;

    try {
      const recipients = await audienceForScreen('orders', 'bookstore');

      const lines = Array.isArray(after['lineItems']) ? after['lineItems'].length : 0;
      /*
       * `total` is a `Money`, and it is the one figure on an order document
       * that is always populated — `subtotal` and `tax` are optional because
       * the checkout does not ask Square for the breakdown. See the note on
       * them in schema/commerce.ts.
       */
      const total = after['total'] as { amount?: unknown; currency?: unknown } | undefined;
      const money =
        typeof total?.amount === 'number'
          ? formatMoney({ amount: total.amount, currency: 'USD' })
          : null;

      const reached = await sendNotice(recipients, {
        notice: 'orders',
        title: 'Bookstore order paid',
        /*
         * The money and the size, and deliberately not the buyer or the books.
         * `buyerFirstName` is right there on the document and is not used: a
         * name on a lock screen is a disclosure, and "who bought what" is the
         * part that should cost one tap into an app that knows who is holding
         * it. An order is identified to a volunteer by its number on the
         * packing screen, not by a push.
         */
        body:
          (money ? `${money} · ` : '') +
          `${lines} ${lines === 1 ? 'item' : 'items'}` +
          (after['shipping'] === true ? ' · to post' : ' · for collection'),
        route: '/admin/bookstore',
      });

      console.info(`[notify] order ${event.params.orderId} paid — told ${reached} device(s).`);
    } catch (error) {
      console.error('[notify] could not announce a paid order:', error);
    }
  },
);

/**
 * A refund, to whoever reconciles the takings.
 *
 * ---------------------------------------------------------------------------
 * A second trigger on the same collection rather than a second branch inside
 * `onOrderPaid`, because the two have nothing in common but the document: a
 * different audience (`finance`, not `bookstore`), a different grant, a
 * different transition, and a different reason for existing. Folding them
 * together would mean one handler resolving two audiences and choosing between
 * them, which is how the wrong group gets told something.
 *
 * Keyed on `refund` appearing rather than on `status` becoming `refunded`, and
 * the distinction matters. `status` is Square's webhook doing its job and can
 * arrive more than once; `order.refund` is **the parish's own note** about why
 * an exception to the no-returns policy was made, written once by
 * `squareRefund` with the name of the servant who pressed the button. That is
 * the thing worth a notification, and its appearance is a single transition.
 * ---------------------------------------------------------------------------
 */
export const onOrderRefunded = onDocumentWritten(
  { ...RUNTIME, document: `${COLLECTIONS.orders}/{orderId}` },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;

    const refund = after['refund'] as
      | { amount?: { amount?: unknown }; reason?: unknown; refundedByEmail?: unknown }
      | null
      | undefined;

    // The appearance of the note, not its presence. See above.
    if (!refund || before?.['refund']) return;

    try {
      const recipients = await audienceForScreen('refunds', 'finance');

      const money =
        typeof refund.amount?.amount === 'number'
          ? formatMoney({ amount: refund.amount.amount, currency: 'USD' })
          : null;

      /*
       * The servant's email and their reason, which is a deliberate exception
       * to the rule that these bodies name nobody.
       *
       * Everywhere else the name withheld is a *parishioner's* — somebody who
       * filled in a form or bought a book, and who did not consent to appearing
       * on a third party's lock screen. This is a servant acting in an official
       * capacity, spending the parish's money, and the audience is the person
       * whose job is to ask why. "Who refunded it and why" is the entire
       * content of the notification; without it there is nothing to act on.
       */
      const who = typeof refund.refundedByEmail === 'string' ? refund.refundedByEmail : null;
      const why = typeof refund.reason === 'string' && refund.reason !== '' ? refund.reason : null;

      const reached = await sendNotice(recipients, {
        notice: 'refunds',
        title: money ? `Refund issued — ${money}` : 'Refund issued',
        body: [who, why].filter(Boolean).join(' · ') || 'No reason was recorded.',
        route: '/admin/finance',
      });

      console.info(`[notify] order ${event.params.orderId} refunded — told ${reached} device(s).`);
    } catch (error) {
      console.error('[notify] could not announce a refund:', error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Forms, and the two things that are not quite forms                         */
/* -------------------------------------------------------------------------- */

/**
 * A form was filled in and signed.
 *
 * ---------------------------------------------------------------------------
 * Routed by the form's own kind, because "forms" is three different jobs done
 * by three different people:
 *
 *   a vehicle registration  → `parking`, the car-park's grant
 *   anything else           → `forms`, the grant that reads submissions
 *
 * That split matters more than it looks. The `forms` grant is one of the two on
 * this site that opens personal data — a submission carries whatever the form
 * asked for, which on a registration form is a child's allergies — and the
 * car-park volunteer holds `parking` and not `forms`. Sending every submission
 * to both would hand the car park a notification stream about baptism requests.
 *
 * The form definition is fetched for its title and kind. If that read fails the
 * notification is skipped rather than sent with a vague title: "A form was
 * signed" tells a reviewer nothing they can act on, and this is not important
 * enough to guess about.
 * ---------------------------------------------------------------------------
 */
export const onFormSubmitted = onDocumentCreated(
  { ...RUNTIME, document: `${COLLECTIONS.formSubmissions}/{submissionId}` },
  async (event) => {
    const submission = event.data?.data();
    if (!submission) return;

    const formId = typeof submission['formId'] === 'string' ? submission['formId'] : '';
    if (formId === '') return;

    try {
      const formDoc = await getFirestore().collection(COLLECTIONS.forms).doc(formId).get();
      if (!formDoc.exists) return;
      const form = formDoc.data() as FormDefinition;

      const parking = form.kind === 'vehicle';
      const notice = parking ? 'parking' : 'forms';
      const recipients = await audienceForScreen(notice, parking ? 'parking' : 'forms');

      /*
       * "A new submission: <title>." is the wording `buildFormEmails` settled
       * on, and for the reason written there: half of these titles are verb
       * phrases ("Contact the church office"), so a colon takes the title as
       * the label it is instead of producing "A Contact the church office was
       * signed". Two surfaces telling the office the same thing should say it
       * the same way.
       */
      /*
       * `totalCents` is a bare number on a submission, unlike an order's
       * `total`, which is a `Money`. Wrapped rather than formatted by hand so
       * the two surfaces print the same string — see `formatMoney`.
       */
      const paid = typeof submission['totalCents'] === 'number' ? submission['totalCents'] : 0;

      const reached = await sendNotice(recipients, {
        notice,
        title: parking ? 'Vehicle registered' : 'Form signed',
        body:
          form.title +
          (paid > 0 ? ` · ${formatMoney({ amount: paid, currency: 'USD' })} paid` : ''),
        route: parking ? '/admin/parking' : '/admin/forms',
      });

      console.info(
        `[notify] submission ${event.params.submissionId} (${form.kind}) — told ${reached} device(s).`,
      );
    } catch (error) {
      console.error('[notify] could not announce a form submission:', error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Camp                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A family registering a child for camp.
 *
 * Its own notice rather than part of `forms`, because `camp` is its own grant
 * for reasons `screens.ts` sets out at length: the registrar who takes families
 * at a desk is not the person who builds parish forms, and a registration holds
 * a child's date of birth, allergies and medical notes. The notification says
 * only that one arrived.
 *
 * Deliberately no child's name and no count. This is the most sensitive
 * collection on the site and the lock screen is the least private place this
 * codebase writes to.
 */
export const onCampRegistration = onDocumentCreated(
  { ...RUNTIME, document: `${COLLECTIONS.campRegistrations}/{registrationId}` },
  async (event) => {
    if (!event.data?.exists) return;

    try {
      const recipients = await audienceForScreen('camp', 'camp');
      const reached = await sendNotice(recipients, {
        notice: 'camp',
        title: 'Camp registration',
        body: 'A new registration has been filed.',
        route: '/admin/camp',
      });
      console.info(`[notify] camp registration — told ${reached} device(s).`);
    } catch (error) {
      console.error('[notify] could not announce a camp registration:', error);
    }
  },
);

/**
 * A servant asking to help at camp.
 *
 * The same notice as a registration, and the same grant, because it is the same
 * person's inbox — but a separate trigger because it is a separate collection
 * and a waiting room rather than a record. See the note on
 * `campServantRequests` in collections.ts.
 *
 * A name is safe here in a way it is not above: this is a servant volunteering,
 * not a family's medical paperwork, and "who has offered" is the whole of what
 * the person accepting them needs to know.
 */
export const onCampServantRequest = onDocumentCreated(
  { ...RUNTIME, document: `${COLLECTIONS.campServantRequests}/{requestId}` },
  async (event) => {
    const request = event.data?.data();
    if (!request) return;

    try {
      const recipients = await audienceForScreen('camp', 'camp');
      /*
       * `registration.contact.name`, not a top-level field. A servant request
       * wraps a whole `CampRegistrationDraft` — see the note on
       * `CampServantRequest` — and the name a person typed is the contact on
       * it. Read defensively because this document is written from a public,
       * unauthenticated endpoint.
       */
      const contact = (request['registration'] as { contact?: { name?: unknown } } | undefined)
        ?.contact;
      const name = typeof contact?.name === 'string' && contact.name.trim() !== ''
        ? contact.name.trim()
        : null;

      const reached = await sendNotice(recipients, {
        notice: 'camp',
        title: 'Servant sign-up',
        body: name ? `${name} has offered to help at camp.` : 'Somebody has offered to help at camp.',
        route: '/admin/camp',
      });
      console.info(`[notify] camp servant request — told ${reached} device(s).`);
    } catch (error) {
      console.error('[notify] could not announce a camp servant request:', error);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Gallery submissions                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A parishioner sent a photograph in.
 *
 * ---------------------------------------------------------------------------
 * ## Not a trigger, and that is the interesting part of this one
 *
 * Every other notice here is a Firestore trigger. This is a plain function
 * called from the *end* of `onGalleryMediaCreated` in galleries.ts, because a
 * `galleryMedia` document is not evidence that a photograph exists.
 *
 * `galleryUploadUrl` writes the document when it issues the signed URL —
 * **before any bytes have been sent** — so a create trigger here would fire for
 * every URL ever handed out, including the ones nobody uploads to.
 * `sweepUnuploadedSubmissions` exists precisely because those happen. The
 * notification would then be "a photograph was sent in" for a photograph that
 * never was, which is the single worst thing a review queue notification can
 * say: the servant opens the app and finds nothing there.
 *
 * The Storage trigger already solves this — `onGalleryMediaCreated` keys on the
 * object's arrival, so there is a file by definition when it runs. Hanging this
 * off the end of it inherits that guarantee rather than re-deriving it, which
 * is why this is an ordinary export and not an `onDocumentCreated`.
 *
 * ## Only what needs reviewing
 *
 * Skipped when `autoApproveBy` is set. That field means an administrator
 * uploaded it themselves and `publishWithoutReview` has just approved it — so
 * there is no queue entry, and a notification would be telling somebody about
 * their own tap of thirty seconds ago.
 * ---------------------------------------------------------------------------
 */
export async function announceGallerySubmission(media: {
  programId: string;
  programEventId: string;
  autoApproveBy: string | null;
  kind: string;
}): Promise<void> {
  // An administrator's own upload. Already approved; nothing to review.
  if (media.autoApproveBy) return;

  try {
    const recipients = await audienceForProgramEvent(media.programId, media.programEventId);
    if (recipients.length === 0) return;

    /*
     * The gallery's own name, so the notification says which queue to open.
     * Read from `programEvents` and falling back to the program — a photograph
     * may be filed on the ministry itself rather than on a level under it, in
     * which case the two ids are equal. See `GalleryMedia.programEventId`.
     */
    const where = await galleryName(media.programId, media.programEventId);
    const thing = media.kind === 'photo' ? 'A photograph' : 'A video';

    const reached = await sendNotice(recipients, {
      notice: 'uploads',
      title: 'Photograph sent in',
      body: where ? `${thing} was sent to ${where}. It needs review.` : `${thing} needs review.`,
      /*
       * The review queue, not the picture. A pending submission has no public
       * URL by design — `galleries/` is the world-readable prefix and nothing
       * reaches it until somebody approves this.
       */
      route: '/admin/events',
    });

    console.info(`[notify] gallery submission — told ${reached} device(s).`);
  } catch (error) {
    // Never throws: this runs at the tail of a transcode that has already
    // succeeded, and a retried Storage trigger is a second transcode.
    console.error('[notify] could not announce a gallery submission:', error);
  }
}

/** The level's name, or the ministry's, or null if neither reads back. */
async function galleryName(programId: string, programEventId: string): Promise<string | null> {
  const db = getFirestore();

  if (programEventId && programEventId !== programId) {
    const level = await db.collection(COLLECTIONS.programEvents).doc(programEventId).get();
    const title = level.get('title');
    if (typeof title === 'string' && title !== '') return title;
  }

  const program = await db.collection(COLLECTIONS.programs).doc(programId).get();
  const name = program.get('name');
  return typeof name === 'string' && name !== '' ? name : null;
}
