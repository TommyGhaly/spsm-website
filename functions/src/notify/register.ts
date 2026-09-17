/**
 * A phone saying "this is my token, and here is what I want to be told".
 *
 * ---------------------------------------------------------------------------
 * ## Why this is an endpoint and not a Firestore write
 *
 * Every instinct in this codebase says a person writing their own preferences
 * should be a rule on their own document, as `members/{uid}` is. Three things
 * make that not work here, and the third is the one that settles it.
 *
 *   The **document id is derived from the token** — a SHA-256, because an FCM
 *   token contains characters a Firestore id may not. A rule cannot hash, so it
 *   could not check that a caller's chosen id matched their token, and a client
 *   free to pick the id can overwrite *somebody else's* registration and
 *   redirect their notifications to its own token.
 *
 *   The **uid must be pinned** to the caller. A rule can do this
 *   (`request.auth.uid == request.resource.data.uid`), so this one is not
 *   decisive on its own — but it is what the hash protects, and the two belong
 *   in the same place.
 *
 *   The **subscription has to be intersected with the entitlement**, and that
 *   is the real reason. A rule can check that a caller holds the `forms` grant;
 *   it cannot cheaply check five of them and save the three that passed. What
 *   this endpoint does instead is take the request as a wish, `AND` it with
 *   `entitledAdminNotices` read fresh from the member document, and store the
 *   result — so a stale app asking for something it lost keeps the rows it
 *   still has rather than being refused outright.
 *
 *   That intersection is also what handles the anonymous session, which is most
 *   people using this app: sign-in is Microsoft restricted to the parish's
 *   Entra tenant, so a signed-in user *is* a servant. An anonymous caller has
 *   no member document, holds no grant, and therefore intersects to nothing —
 *   so no row is kept and the collection stays a list of servants' phones
 *   rather than a census of installs. No special case, and no refusal to
 *   explain.
 *
 * `firestore.rules` still closes the collection to every client — see the note
 * above `match /pushDevices/{deviceId}`. This is the only door.
 *
 * ## What it deliberately does not store
 *
 * No device name, no model, no OS version, no locale, and no last-seen IP. A
 * registry of every servant's phone is a thing the parish would then be
 * holding, and none of it is needed to send a message. `platform` is kept
 * because iOS and Android take different payload shapes and a bad send needs
 * triaging; `appVersion` because a notification bug is nearly always one
 * release. Both are facts about software, not about a person.
 *
 * Calendar reminders never reach this endpoint. They are local notifications
 * and their preferences stay on the phone — see schema/notifications.ts.
 * ---------------------------------------------------------------------------
 */
import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import {
  COLLECTIONS,
  entitledAdminNotices,
  noAdminNotices,
  parseAdminNoticePrefs,
  parseProgramAdmin,
  parseScreenAdmin,
  pushDeviceIsUseful,
  type AdminNotice,
  type AdminNoticePrefs,
  type PushDevice,
} from '@spsm/shared';

import { callerOf } from '../httpAuth.js';
import { BUDGETS, CAPS, throttled } from '../rateLimit.js';

/** The document id for a token. See the header for why it is hashed. */
function deviceIdFor(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 40);
}

/**
 * Register, update, or remove this phone.
 *
 * One endpoint for all three because they are one operation from the app's
 * point of view — "here is my current state" — and because the interesting case
 * is the one in the middle: a person who unticks their last row is *deleting* a
 * registration, not saving an empty one. A device that wants nothing is a
 * device the fan-out must not have to filter, so it is removed. See
 * `pushDeviceIsUseful`.
 *
 * Routed by the `/api/push/register` rewrite in firebase.json.
 */
export const pushRegister = onRequest(
  { cors: false, maxInstances: CAPS.pushRegister },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only.' });
      return;
    }

    // The cheap address gate, before a token is verified — the arrangement
    // every authenticated endpoint here uses. See rateLimit.ts.
    if (throttled(req, res, { bucket: 'push-register:address', max: BUDGETS.adminAddress })) {
      return;
    }

    const caller = await callerOf(req);
    if (!caller) {
      res.status(401).json({ error: 'Sign in again and retry.' });
      return;
    }

    if (throttled(req, res, { bucket: `push-register:${caller.uid}`, max: BUDGETS.pushRegister })) {
      return;
    }

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;

    const token = typeof body['token'] === 'string' ? body['token'].trim() : '';
    if (token === '' || token.length > 4096) {
      res.status(400).json({ error: 'No usable push token was sent.' });
      return;
    }

    const platform = body['platform'] === 'android' ? 'android' : 'ios';
    const db = getFirestore();
    const ref = db.collection(COLLECTIONS.pushDevices).doc(deviceIdFor(token));

    /*
     * A `remove` is honoured without reading anything about the caller's grants.
     *
     * Turning notifications *off* must never be refusable. A person who has
     * lost a grant, or whose member document has gone, still has a phone that
     * will otherwise keep ringing — and "you may not unsubscribe because you
     * are no longer entitled to the thing you are unsubscribing from" is the
     * worst sentence this endpoint could produce.
     */
    if (body['remove'] === true) {
      await ref.delete();
      res.status(200).json({ ok: true, registered: false, notices: noAdminNotices() });
      return;
    }

    /*
     * What this person is allowed to ask for, read fresh from their member
     * document — the same derivation the settings screen makes, so the two
     * cannot disagree about which rows exist.
     *
     * A superadmin with no member document (bootstrapped by `grant-admin.mjs`)
     * is handled by `caller.superadmin`, which comes off the verified token
     * rather than the absent document.
     */
    const member = await db.collection(COLLECTIONS.members).doc(caller.uid).get();
    const data = member.data() ?? {};
    const entitled = entitledAdminNotices(
      { superadmin: caller.superadmin },
      parseScreenAdmin(data['screenAdmin']),
      parseProgramAdmin(data['programAdmin']),
    );

    /*
     * The request's wishes, intersected with the entitlement.
     *
     * Silently dropping what a caller may not have, rather than refusing the
     * whole request with a 403. A client asking for a notice it is not entitled
     * to is a stale app — somebody had the `forms` grant when the screen was
     * drawn and it was removed while they were looking at it — and the right
     * answer to that is to save the rows they may have and echo back the truth,
     * which is what `notices` in the response is for. A 403 would leave the
     * other four switches unsaved for no reason.
     *
     * This is the authorization point for subscriptions. Anything that reaches
     * the stored map has been checked here, and `audience.ts` checks it again
     * at send time against the document as it stands then.
     */
    const asked = parseAdminNoticePrefs(body['notices']);
    const notices = Object.fromEntries(
      Object.entries(asked).map(([notice, wanted]) => [
        notice,
        wanted === true && entitled.includes(notice as AdminNotice),
      ]),
    ) as AdminNoticePrefs;

    if (!pushDeviceIsUseful({ notices })) {
      /*
       * Nothing wanted. Delete rather than store a row of falses, so that
       * `pushDevices` is exactly "phones that have opted in" and the fan-out's
       * query needs no second thought.
       *
       * Note this is also what an ordinary parishioner's app does on start-up
       * if it ever calls here: they hold no grants, so everything intersects to
       * false and no row is kept. The collection stays a list of servants'
       * phones and does not become a census of installs.
       */
      await ref.delete();
      res.status(200).json({ ok: true, registered: false, notices, entitled });
      return;
    }

    const device: PushDevice = {
      token,
      uid: caller.uid,
      platform,
      notices,
      refreshedAt: new Date().toISOString(),
      appVersion: typeof body['appVersion'] === 'string' ? body['appVersion'].slice(0, 32) : null,
    };

    /*
     * A plain `set`, not a merge. The document is small and wholly owned by the
     * phone that wrote it, so the last word should be complete — a merge would
     * leave a `notices` key from an older app version sitting under the new
     * one, subscribed to something the person cannot see a switch for.
     */
    await ref.set(device);

    res.status(200).json({ ok: true, registered: true, notices, entitled });
  },
);
