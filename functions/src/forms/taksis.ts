import { defineSecret, defineString } from 'firebase-functions/params';
import {
  toTaksisRecord,
  validateVehicleRegistration,
  type FormAnswers,
  type TaksisDriver,
  type VehicleRegistrationInput,
} from '@spsm/shared';
import { externalWrite } from '../external/secondaryApp.js';

/**
 * Pushing a vehicle registration into the Taksis project.
 *
 * ---------------------------------------------------------------------------
 * This is the integration `docs/integrations.md` describes as blocked.
 *
 * It was blocked on one thing: "the shape of one `pending_registrations`
 * record". The refusal to guess was correct — a create-only identity cannot
 * read, so a wrong field name produces a document Taksis silently ignores and
 * there is no way for us to notice.
 *
 * That shape is now known, from a standalone form that has been writing these
 * records directly. It lives in `@spsm/shared`'s `schema/taksis.ts`, along with
 * the twelve colour values Taksis matches on and the parish's name spelled the
 * way Taksis spells it. Update `docs/integrations.md`, `README.md` and
 * `docs/decisions.md`, all three of which still say this is waiting.
 *
 * ## No local copy, deliberately
 *
 * `docs/integrations.md` planned "write our record first, then push outward, so
 * a Taksis outage cannot lose a parishioner's registration". That is not what
 * this does, and the difference was a decision rather than an oversight:
 * registrations go to Taksis only.
 *
 * What that buys is one answer to "who may park here". The failure mode of the
 * write-both design is not an outage — it is our `vehicles` collection and
 * Taksis disagreeing six months later with no rule for which wins, and a parking
 * team looking at whichever one happens to be in front of them.
 *
 * What it costs is that a failure here loses the submission. So a failure must
 * be *visible*: this returns a reason, `formSubmit` returns it as an error
 * status, and the page keeps the answers on screen. Nothing shows a confirmation
 * for a write that did not land.
 * ---------------------------------------------------------------------------
 */

export const TAKSIS_SERVICE_ACCOUNT = defineSecret('TAKSIS_SERVICE_ACCOUNT');
const TAKSIS_BACKEND = defineString('TAKSIS_BACKEND', { default: '' });
const TAKSIS_PENDING_VEHICLES_PATH = defineString('TAKSIS_PENDING_VEHICLES_PATH', {
  default: 'pending_registrations',
});

type PushResult =
  | { ok: true; id: string }
  /**
   * `rejected` marks input we refused before contacting Taksis at all, as
   * opposed to a push that was attempted and failed. Only the second is worth
   * an error in the log — the first is somebody mistyping a plate.
   */
  | { ok: false; status: number; reason: string; rejected?: boolean };

export async function pushVehicleRegistration(answers: FormAnswers): Promise<PushResult> {
  const input = readInput(answers);

  /*
   * Validated here as well as in the browser. The browser's run decides what
   * message to show beside which box; this one decides what Taksis is asked to
   * store, and it is the only one that a hand-crafted request cannot skip.
   */
  const problems = validateVehicleRegistration(input);
  if (problems.length > 0) {
    // `rejected`, so the caller can tell "we never tried" from "the write
    // failed". Logging both as a failed push makes an ordinary typo look like
    // a broken integration in the one log somebody reads when Taksis is down.
    return { ok: false, status: 400, reason: problems.join(' '), rejected: true };
  }

  const serviceAccount = TAKSIS_SERVICE_ACCOUNT.value();
  if (!serviceAccount) {
    return {
      ok: false,
      status: 503,
      reason: 'Vehicle registration is not connected yet. Please contact the church office.',
    };
  }

  /*
   * Firestore only. `TAKSIS_BACKEND` exists because the backend was genuinely
   * unknown when the plumbing was written — "a root branch in the database"
   * sounded like Realtime Database. It is Firestore, confirmed by the form that
   * has been writing these records through the Firestore REST API. This checks
   * the variable anyway rather than ignoring it: if somebody sets it to `rtdb`,
   * a clear refusal beats writing Firestore documents nobody will read.
   */
  const backend = TAKSIS_BACKEND.value().trim() || 'firestore';
  if (backend !== 'firestore') {
    console.error(`[taksis] TAKSIS_BACKEND is "${backend}"; only firestore is implemented.`);
    return {
      ok: false,
      status: 503,
      reason: 'Vehicle registration is not connected yet. Please contact the church office.',
    };
  }

  const record = toTaksisRecord(input);

  try {
    const taksis = externalWrite('taksis', serviceAccount);
    const collection = TAKSIS_PENDING_VEHICLES_PATH.value().trim() || 'pending_registrations';

    /*
     * `add`, not `set` with a plate-derived id.
     *
     * A deterministic id would make a re-send idempotent, which is genuinely
     * attractive — but the service account is scoped create-only, so `set`
     * against an existing id is an overwrite it may or may not be permitted to
     * make, and we cannot read to find out which. `add` always creates. A
     * double-tap therefore produces two pending registrations for one plate,
     * which is a duplicate Taksis's own review queue can see and dismiss — the
     * failure that shows up in front of a person rather than in nobody's logs.
     */
    const written = await taksis.collection(collection).add(record);
    return { ok: true, id: written.id };
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    console.error(`[taksis] write to pending_registrations failed (code ${String(code)})`, error);

    /*
     * PERMISSION_DENIED here means the service account's custom role is missing
     * `datastore.entities.create`, and NOT_FOUND with no message usually means
     * the project has a non-default Firestore database — see the note in
     * secondaryApp.ts. Neither is something the person filling in the form can
     * act on, so they get one plain sentence and the detail goes to the log.
     */
    return {
      ok: false,
      status: 502,
      reason:
        'The registration could not be sent to the parking system, so nothing was saved. ' +
        'Please try again, or contact the church office.',
    };
  }
}

/**
 * The form's answers, back into a registration.
 *
 * `VehicleForm` sends its driver list as a JSON string under a reserved key,
 * because `FormAnswers` has no shape for an array of objects — the generic
 * validator's answers are strings, numbers, booleans, and arrays of strings.
 * Rather than widen that type for one form, the repeating group is encoded here
 * and decoded here, in the two places that know about it.
 */
function readInput(answers: FormAnswers): VehicleRegistrationInput {
  const text = (key: string): string => {
    const value = answers[key];
    return typeof value === 'string' ? value : '';
  };

  let drivers: TaksisDriver[] = [];
  const raw = answers['drivers'];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        drivers = parsed.map((entry) => {
          const driver = (entry ?? {}) as Record<string, unknown>;
          return {
            name: typeof driver['name'] === 'string' ? driver['name'] : '',
            phone: typeof driver['phone'] === 'string' ? driver['phone'] : '',
            has_taksis: driver['has_taksis'] === true,
          };
        });
      }
    } catch {
      // Left empty. The validator below then reports "enter the name of the
      // main driver", which is the right message for a submission that arrived
      // with an unreadable driver list.
      drivers = [];
    }
  }

  return {
    plate: text('plate'),
    make: text('make'),
    model: text('model'),
    color: text('color'),
    drivers,
  };
}
