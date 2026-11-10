import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  ORDINATION_EMAIL_KINDS,
  PARISH_TIME_ZONE,
  ordinationEmailHtml,
  ordinationRecipients,
  parseOrdinationApplication,
  todayIn,
  type OrdinationEmailKind,
  type OrdinationEmailSent,
} from '@spsm/shared';
import { callerOf, mayAdminScreen } from '../httpAuth.js';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';
import type { MailDocument } from '../forms/email.js';

/**
 * An admin emailing a nominee about the decision on their nomination.
 *
 * ---------------------------------------------------------------------------
 * The admin writes the words; this Function decides who they go to. The body
 * carries the application's id and never an address, and the recipients are
 * read from the stored application — the nominee and whoever filled the form
 * in — so the screen cannot be used to send parish mail to anybody else.
 *
 * The kind must match the status already saved: an approval email only for an
 * approved nomination, and the two "not approved" emails only for a rejected
 * one. Any email may carry the admin's own files; `needsFather` must carry the
 * printed packet, built in the browser (where pdf-lib and the diocese's
 * templates already are). All attachments arrive as base64.
 * ---------------------------------------------------------------------------
 */

/**
 * All attachments together, as base64. The mail document is a Firestore
 * document and must stay under 1 MiB; a one-nominee packet is ~330 KB of this.
 */
const ATTACHMENTS_MAX_BASE64 = 900_000;
const ATTACHMENTS_MAX_COUNT = 5;

export const ordinationNotify = onRequest(
  { cors: false, maxInstances: CAPS.ordinationNotify },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (
      throttled(req, res, {
        bucket: 'ordinationNotify',
        max: BUDGETS.ordinationNotify,
        plural: true,
        message: 'Too many emails at once. Please wait a minute.',
      })
    ) {
      return;
    }

    const caller = await callerOf(req);
    if (!(await mayAdminScreen(caller, 'ordination')) || !caller) {
      res.status(403).json({ error: 'You do not have the ordination screen.' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const applicationId = typeof body['applicationId'] === 'string' ? body['applicationId'].slice(0, 100) : '';
    const kind = body['kind'] as OrdinationEmailKind;
    const subject = typeof body['subject'] === 'string' ? body['subject'].trim().slice(0, 200) : '';
    const text = typeof body['text'] === 'string' ? body['text'].trim().slice(0, 10_000) : '';
    const attachments = (Array.isArray(body['attachments']) ? body['attachments'] : [])
      .slice(0, ATTACHMENTS_MAX_COUNT + 1)
      .map((raw) => {
        const entry = (raw ?? {}) as Record<string, unknown>;
        const filename = typeof entry['filename'] === 'string' ? entry['filename'].replace(/[^\w.\- ()]/g, '').slice(0, 120) : '';
        const content = typeof entry['content'] === 'string' ? entry['content'] : '';
        const contentType = typeof entry['contentType'] === 'string' ? entry['contentType'].slice(0, 100) : '';
        return { filename: filename || 'attachment', content, encoding: 'base64' as const, ...(contentType ? { contentType } : {}) };
      });
    const sentByName = typeof body['sentByName'] === 'string' ? body['sentByName'].slice(0, 120) : '';

    if (!applicationId || !(ORDINATION_EMAIL_KINDS as readonly unknown[]).includes(kind) || !subject || !text) {
      res.status(400).json({ error: 'The email needs a subject and a message.' });
      return;
    }
    if (attachments.length > ATTACHMENTS_MAX_COUNT) {
      res.status(400).json({ error: `Attach at most ${ATTACHMENTS_MAX_COUNT} files.` });
      return;
    }
    if (attachments.some((file) => !file.content || !/^[A-Za-z0-9+/=]+$/.test(file.content))) {
      res.status(400).json({ error: 'An attachment could not be read.' });
      return;
    }
    if (attachments.reduce((sum, file) => sum + file.content.length, 0) > ATTACHMENTS_MAX_BASE64) {
      res.status(413).json({ error: 'The attachments are too large together (about 650 KB at most).' });
      return;
    }
    if (kind === 'needsFather' && !attachments.some((file) => file.contentType === 'application/pdf')) {
      res.status(400).json({ error: 'Attach the printed form for the father of confession to sign.' });
      return;
    }

    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.ordinationApplications).doc(applicationId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      res.status(404).json({ error: 'That nomination no longer exists.' });
      return;
    }
    const application = parseOrdinationApplication(snapshot.data());
    const expected = kind === 'approved' ? 'approved' : 'rejected';
    if (application.status !== expected) {
      res.status(409).json({
        error: expected === 'approved' ? 'Approve the nomination before sending this.' : 'Reject the nomination before sending this.',
      });
      return;
    }

    const to = ordinationRecipients(application);
    if (to.length === 0) {
      res.status(409).json({ error: 'Nobody on this nomination gave an email address.' });
      return;
    }

    const message: MailDocument = {
      to,
      message: {
        subject,
        text,
        html: ordinationEmailHtml(text),
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    };
    const sent: OrdinationEmailSent = {
      kind,
      sentOn: todayIn(PARISH_TIME_ZONE),
      sentByName: sentByName || caller.email,
      to,
    };

    try {
      const batch = db.batch();
      batch.create(db.collection(COLLECTIONS.mail).doc(), message);
      batch.update(ref, { emailsSent: FieldValue.arrayUnion(sent) });
      await batch.commit();
    } catch (cause) {
      console.error('[ordination] could not queue a decision email', cause);
      res.status(500).json({ error: 'The email did not send. Please try again.' });
      return;
    }
    res.json({ to });
  },
);
