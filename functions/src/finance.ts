import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  campFinanceDocId,
  dayKey,
  formFinanceDocId,
  parseCampRegistration,
  parseFormDefinition,
  rollupCampFinance,
  rollupFormFinance,
  type CampFinanceInput,
  type FormFinanceInput,
} from '@spsm/shared';
import { callerOf, mayReadFinance } from './httpAuth.js';
import { BUDGETS, CAPS, exclusive, throttled } from './rateLimit.js';

/**
 * Turning the two collections the treasurer may not read into documents they
 * may.
 *
 * ---------------------------------------------------------------------------
 * This Function exists to make a permission honest.
 *
 * `finance` was always a flag that reached less than its name promised. The
 * bookstore keeps money in documents of its own, so a rule could hand those
 * over exactly; camp fees and paid form totals live *inside* records full of
 * personal data — a child's allergies, a parent's phone number, whatever a form
 * asked for — and Firestore rules grant documents rather than fields. There was
 * no rule that could give the treasurer the money without the medical notes.
 *
 * So the Admin SDK reads those collections, adds them up here, and writes
 * documents with no people in them. The trust boundary is this file: everything
 * sensitive is read on a server and nothing sensitive is written out. See
 * packages/shared/src/schema/finance.ts, which holds the arithmetic and the
 * rule about what may appear in the output.
 *
 * ## Why a scan and not a trigger
 *
 * An `onDocumentWritten` on `campRegistrations` would keep the season document
 * fresh to the second, and it would do it by making every registration edit
 * contend on one document per season — at a registration desk with two
 * volunteers typing, which is the exact write pattern Firestore's per-document
 * limit punishes. The bookstore made this decision already and for the same
 * reason: nothing shared, arithmetic on a schedule, staleness stated on screen.
 * ---------------------------------------------------------------------------
 */

const PARISH_TIME_ZONE = 'America/New_York';

function rollupRef(docId: string) {
  return getFirestore().collection(COLLECTIONS.financeRollups).doc(docId);
}

/* ---------------------------------------------------------------------------
 * The camp
 * ------------------------------------------------------------------------ */

/**
 * Every camp season there is anything to say about.
 *
 * A whole-collection read, knowingly. The alternative is a list of seasons kept
 * somewhere and maintained by hand, which goes stale the first time somebody
 * registers a family under a season the list does not have — and then the
 * treasurer's screen is silently missing a season's money, which is the worst
 * failure this screen has. At parish volume this is a few hundred documents
 * once an hour.
 *
 * `season` is grouped with `programId` because the camp's ministry id is
 * configurable and a parish running two camps would otherwise have both summed
 * into one figure.
 */
async function campSeasons(): Promise<Map<string, { programId: string; season: string; rows: CampFinanceInput[] }>> {
  const snapshot = await getFirestore()
    .collection(COLLECTIONS.campRegistrations)
    /*
     * Only the fields the rollup needs. This does not lower the bill —
     * Firestore charges per document either way — but it does mean a name, an
     * address and a child's medical notes are never carried into this
     * process's memory at all, which is the property this whole file is for.
     */
    .select('programId', 'season', 'kind', 'status', 'children', 'billing')
    .get();

  const seasons = new Map<string, { programId: string; season: string; rows: CampFinanceInput[] }>();

  for (const doc of snapshot.docs) {
    // The tolerant parser, not a cast: these documents are edited over weeks by
    // more than one person, and a half-written one is the normal case.
    const registration = parseCampRegistration(doc.data());
    const season = registration.season.trim();
    // A registration with no season cannot be filed under one. It is a bug
    // upstream and dropping it here is better than inventing a bucket for it.
    if (!season) continue;

    const key = campFinanceDocId(registration.programId, season);
    const bucket = seasons.get(key) ?? {
      programId: registration.programId,
      season,
      rows: [] as CampFinanceInput[],
    };
    bucket.rows.push({
      kind: registration.kind,
      status: registration.status,
      children: registration.children,
      billing: registration.billing,
    });
    seasons.set(key, bucket);
  }

  return seasons;
}

export async function rollupCamp(): Promise<string[]> {
  const seasons = await campSeasons();
  const written: string[] = [];

  for (const [docId, bucket] of seasons) {
    const rolled = rollupCampFinance({
      programId: bucket.programId,
      season: bucket.season,
      registrations: bucket.rows,
    });
    await rollupRef(docId).set(
      { ...rolled, computedAt: FieldValue.serverTimestamp() },
      // Overwrite, like the bookstore rollup: a merge cannot express "this
      // month is no longer in the map", so a corrected payment date would leave
      // the old month behind forever.
      { merge: false },
    );
    written.push(docId);
  }

  return written;
}

/* ---------------------------------------------------------------------------
 * The forms
 * ------------------------------------------------------------------------ */

/**
 * Only the forms that charge for something.
 *
 * The parish's forms are mostly free — a vehicle registration, a sign-up sheet
 * — and their submissions are the bulk of the collection. Rolling those up
 * would read thousands of documents an hour to write a row of zeroes. The
 * definitions are few and cheap to read, so the paid ones are found first and
 * only their submissions are scanned.
 *
 * A form whose payment is switched off after it took money keeps its rollup
 * document, which then stops being updated. That is deliberate: the money was
 * still taken, and deleting the record because the form changed would lose it.
 */
export async function rollupForms(): Promise<string[]> {
  const db = getFirestore();
  const formsSnapshot = await db.collection(COLLECTIONS.forms).get();
  const written: string[] = [];

  for (const formDoc of formsSnapshot.docs) {
    const form = parseFormDefinition(formDoc.id, formDoc.data());
    if (!form.payment.enabled) continue;

    const submissions = await db
      .collection(COLLECTIONS.formSubmissions)
      .where('formId', '==', formDoc.id)
      .select('totalCents', 'paymentId', 'submittedAt')
      .get();

    const rows: FormFinanceInput[] = submissions.docs.map((doc) => ({
      totalCents: Number(doc.get('totalCents')) || 0,
      paymentId: (doc.get('paymentId') as string | null) ?? null,
      month: monthOf(doc.get('submittedAt')),
    }));

    const rolled = rollupFormFinance({
      form: { id: formDoc.id, slug: form.slug, title: form.title },
      submissions: rows,
    });

    const docId = formFinanceDocId(formDoc.id);
    await rollupRef(docId).set(
      { ...rolled, computedAt: FieldValue.serverTimestamp() },
      { merge: false },
    );
    written.push(docId);
  }

  return written;
}

/**
 * `YYYY-MM` in the parish's zone, from whatever `submittedAt` turns out to be.
 *
 * The same `dayKey` the rest of the site buckets by, so a submission taken at
 * half past eight on the last night of the month lands in that month here and
 * in the bookstore's day rollup alike — rather than in the next one, which is
 * what a UTC `toISOString().slice(0, 7)` would do for every evening in the
 * parish's summer.
 */
function monthOf(value: unknown): string | null {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate(): Date }).toDate()
      : value instanceof Date
        ? value
        : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return dayKey(date, PARISH_TIME_ZONE).slice(0, 7);
}

/* ---------------------------------------------------------------------------
 * When it runs
 * ------------------------------------------------------------------------ */

export async function rollupFinanceNow(): Promise<{ camp: string[]; forms: string[] }> {
  const camp = await rollupCamp();
  const forms = await rollupForms();
  return { camp, forms };
}

/**
 * Hourly, alongside the bookstore's.
 *
 * The camp ledger moves in bursts — a registration desk after Liturgy, a
 * fortnight of nothing — so the interval is not chosen for how fast the numbers
 * change. It is chosen so that the worst staleness anybody sees is an hour, and
 * `computedAt` is on the screen saying which hour.
 */
export const rollupFinanceStats = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: PARISH_TIME_ZONE,
    timeoutSeconds: 540,
    maxInstances: CAPS.scheduled,
  },
  async () => {
    const written = await rollupFinanceNow();
    console.info(
      `[finance] rolled up ${written.camp.length} camp season(s) and ${written.forms.length} paid form(s).`,
    );
  },
);

/**
 * The same, on demand, for a treasurer who has just watched a payment be
 * recorded and does not want to wait an hour to see it.
 *
 * Guarded, and not because the output is secret — it is written to documents
 * the caller may read anyway. It is guarded because this *writes*, and because
 * an unauthenticated caller could otherwise make the parish pay for a
 * full-collection scan as often as they liked.
 */
export const refreshFinanceStats = onRequest(
  { cors: false, timeoutSeconds: 540, maxInstances: CAPS.rebuild },
  async (req, res) => {
    // The cheap gate, before a token is verified.
    if (throttled(req, res, { bucket: 'finance:address', max: BUDGETS.adminAddress })) return;

    const caller = await callerOf(req);
    if (!(await mayReadFinance(caller))) {
      res.status(caller ? 403 : 401).json({ error: 'Not permitted.' });
      return;
    }

    /*
     * The most expensive thing a signed-in person can ask this site to do.
     *
     * It reads `campRegistrations` and `formSubmissions` in full — every document,
     * every time — and it is allowed nine minutes to finish. Four starts a minute
     * is already generous for a button somebody presses when they want today's
     * figures; the `exclusive` hold below is what stops those four overlapping.
     */
    if (
      throttled(req, res, {
        bucket: 'financeRebuild',
        max: BUDGETS.financeRebuild,
        identity: caller!.uid,
        message: 'The figures were just rebuilt. Please wait a minute before asking again.',
      })
    ) {
      return;
    }

    const release = exclusive('financeRollup');
    if (!release) {
      // Already running here. 409 rather than 429: the caller is not over a
      // budget, the work is simply in progress — and a page that says so can wait
      // for it instead of asking again.
      res.status(409).json({ error: 'The figures are being rebuilt right now. This can take a few minutes.' });
      return;
    }

    try {
      const written = await rollupFinanceNow();
      res.status(200).json({ ok: true, camp: written.camp.length, forms: written.forms.length });
    } catch (error) {
      console.error('[finance] refresh failed', error);
      res.status(500).json({ error: 'Could not refresh the figures.' });
    } finally {
      // A hold that is not released is an endpoint switched off until the
      // instance recycles, so this is a `finally` and never anything else.
      release();
    }
  },
);
