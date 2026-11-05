import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  formDay,
  ORDINATION_RANK_INFO,
  longDay,
  PARISH_TIME_ZONE,
  ordinationAccepting,
  ordinationRankLabel,
  parseOrdination,
  parseOrdinationDraft,
  todayIn,
  validateOrdinationDraft,
  type Ordination,
  type OrdinationApplication,
} from '@spsm/shared';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';
import type { MailDocument } from '../forms/email.js';

/** Where the email sends an admin. The site's own address, as Hosting serves it. */
const REVIEW_URL = 'https://spsmwayland.org/admin/ordination';

/**
 * A nomination for ordination, from the public form on /forms/ordination.
 *
 * ---------------------------------------------------------------------------
 * A Function rather than a rule-checked client write, for the reasons
 * `camp/servantRequest.ts` gives, and one of them matters more here:
 *
 *   - **The ordination is read, not trusted.** An ordination that is closed
 *     or does not exist refuses the nomination, and its date is what the
 *     nominee's age is checked against. A hand-made request cannot file a
 *     nomination under one the parish has closed.
 *   - **The review is not the sender's.** `status`, `review` and `signatures`
 *     are written here as pending, empty and none. Whatever arrived under those
 *     names is dropped by `parseOrdinationDraft` before anything is stored, so
 *     no request can approve itself or arrive already signed.
 *   - **Rules cannot rate-limit** an endpoint anybody can post to.
 *
 * It then emails each person holding the `ordination` screen, one message
 * apiece. The email names the nominee and the ordination and nothing more — the parents' numbers and
 * the date of birth stay behind the sign-in.
 * ---------------------------------------------------------------------------
 */
export const ordinationApply = onRequest(
  { cors: false, maxInstances: CAPS.ordinationApply },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ errors: ['Method not allowed.'] });
      return;
    }

    if (
      throttled(req, res, {
        bucket: 'ordinationApply',
        max: BUDGETS.ordinationApply,
        plural: true,
        message: 'Too many nominations from here. Please wait a minute.',
      })
    ) {
      return;
    }

    const draft = parseOrdinationDraft(req.body ?? {});
    const db = getFirestore();

    let ordination: Ordination;
    try {
      const snapshot = draft.ordinationId
        ? await db.collection(COLLECTIONS.ordinations).doc(draft.ordinationId).get()
        : null;
      if (!snapshot?.exists) {
        res.status(404).json({ errors: ['That ordination could not be found. Please reload the page.'] });
        return;
      }
      ordination = parseOrdination(snapshot.data());
    } catch (cause) {
      console.error('[ordination] could not read the ordination', cause);
      res.status(503).json({ errors: ['Could not reach the church server. Please try again.'] });
      return;
    }

    if (!ordinationAccepting(ordination, todayIn(PARISH_TIME_ZONE))) {
      const why = ordination.open && ordination.closesOn
        ? `Nominations closed after ${longDay(ordination.closesOn)}.`
        : 'This ordination is no longer taking nominations.';
      res.status(409).json({ errors: [why] });
      return;
    }

    const problems = validateOrdinationDraft(draft, ordination.date);
    if (problems.length > 0 || !draft.rank) {
      res.status(400).json({ errors: problems });
      return;
    }

    const application: Omit<OrdinationApplication, 'submittedAt' | 'updatedAt'> = {
      ...draft,
      // Only a cantor's and a reader's page has parents on it, so a
      // subdeacon's stores none rather than two the form never showed.
      parents: ORDINATION_RANK_INFO[draft.rank].minor ? draft.parents : [],
      rank: draft.rank,
      status: 'pending',
      review: null,
      signatures: [],
      updatedBy: null,
    };

    let id: string;
    try {
      const written = await db.collection(COLLECTIONS.ordinationApplications).add({
        ...application,
        submittedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      id = written.id;
    } catch (cause) {
      console.error('[ordination] could not store a nomination', cause);
      res.status(500).json({ errors: ['That did not send. Please try again shortly.'] });
      return;
    }

    // Answered before the email, which must never turn a stored nomination
    // into an error the sender sees — the only thing it would tell them to do
    // is send it again.
    res.json({ applicationId: id });

    try {
      const to = await adminEmails();
      if (to.length === 0) {
        console.warn('[ordination] nobody holds the ordination screen, so nobody was emailed.');
        return;
      }
      // One email per admin rather than one to all of them: nobody sees the
      // others' addresses, and an address the mail service rejects fails only
      // its own message instead of the whole send.
      const batch = db.batch();
      to.forEach((address, index) => {
        const message = nominationEmail([address], ordination, application, draft.submittedBy);
        batch.create(db.collection(COLLECTIONS.mail).doc(`ordination-${id}-${index}`), message);
      });
      await batch.commit();
    } catch (error) {
      console.error('[ordination] could not queue the notification emails', error);
    }
  },
);

/**
 * Everybody given the `ordination` screen, by the email on their member record.
 *
 * Superadmins are the fallback rather than an addition: a parish that has given
 * the screen to its priests does not want the web administrator copied on every
 * nomination, but one that has given it to nobody yet should not lose them.
 */
async function adminEmails(): Promise<string[]> {
  const members = getFirestore().collection(COLLECTIONS.members);
  let docs = (await members.where('screenAdmin.ordination', '==', true).get()).docs;
  if (docs.length === 0) docs = (await members.where('superadminMirror', '==', true).get()).docs;
  const emails = docs
    .map((doc) => doc.get('email'))
    .filter((email): email is string => typeof email === 'string' && email.includes('@'));
  return [...new Set(emails.map((email) => email.toLowerCase()))];
}

function nominationEmail(
  to: string[],
  ordination: Ordination,
  application: Pick<OrdinationApplication, 'rank' | 'nominee'>,
  submittedBy: string,
): MailDocument {
  const nominee = application.nominee.name;
  const title = `${ordinationRankLabel(application.rank)} at the ordination on ${longDay(ordination.date)}`;
  const by = submittedBy ? ` It was sent by ${submittedBy}.` : '';
  const text =
    `${nominee} has been nominated for ${title}.${by}\n\n` +
    `Review it at ${REVIEW_URL}\n\n` +
    `The completed and signed form is due at the diocese three days before ${formDay(ordination.date)}.`;
  const html = [
    `<p><strong>${escapeHtml(nominee)}</strong> has been nominated for ${escapeHtml(title)}.${escapeHtml(by)}</p>`,
    `<p><a href="${REVIEW_URL}">Review the nomination</a></p>`,
    `<p style="color:#666">The completed and signed form is due at the diocese three days before ${escapeHtml(formDay(ordination.date))}.</p>`,
  ].join('\n');
  return { to, message: { subject: `Ordination nomination: ${nominee}`, text, html } };
}

/** Same as the forms email's: everything here was typed by the public. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
