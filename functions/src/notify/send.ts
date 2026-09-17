/**
 * Putting a sentence on somebody's lock screen.
 *
 * ---------------------------------------------------------------------------
 * The transport is FCM through the Admin SDK, which needs no key of its own —
 * `initializeApp()` in index.ts is already credentialed, and the same
 * credential sends messages. There is nothing to add to `api-keys.md`. What
 * *does* need doing once, by hand, is uploading an APNs authentication key to
 * the Firebase project, because iOS pushes leave Google's network and enter
 * Apple's. Without it every iOS send fails with `third-party auth error` and
 * Android carries on working, which is a confusing way to find out. See
 * docs/notifications-setup.md.
 *
 * ## What these messages say, and what they must not
 *
 * A push is read by whoever is holding the phone, which is not always the
 * person it was sent to. So the body names **what happened and where to go**,
 * and never the contents:
 *
 *   "A new submission: Baptism request."      not the answers
 *   "An order was paid — $48.00, 3 items."    not the buyer's address
 *   "A photograph was sent to Rite of Palms." not the photograph
 *
 * The audience is already restricted to people trusted with the underlying
 * record (see audience.ts), so this is not the security boundary — it is the
 * difference between a notification and a leak onto a kitchen table. The detail
 * is one tap away in an app that asks who you are.
 *
 * ## Why `sendEachForMulticast` and not `sendMulticast`
 *
 * They differ in what happens to the twelfth token when the third is dead.
 * `sendEachForMulticast` returns a per-token result, which is what makes the
 * pruning below possible; the batch API fails in ways that do not tell you
 * which token was at fault. Dead tokens are not an edge case — every reinstall
 * and every restored-from-backup phone leaves one — and a registry nothing
 * prunes is a registry whose sends get slower and noisier forever.
 * ---------------------------------------------------------------------------
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { COLLECTIONS, type AdminNotice } from '@spsm/shared';

import type { Recipient } from './audience.js';

/**
 * Android notification channels, which must match the ids the app creates.
 *
 * A channel is what lets somebody silence bookstore orders in the OS settings
 * without silencing the whole app, and on Android 8+ a message naming a channel
 * that does not exist is delivered with no sound and no heads-up — so these
 * strings are a contract with `src/notify/channels.ts` in the app repo, not a
 * label. Keep them in step.
 */
const CHANNELS: Record<AdminNotice, string> = {
  uploads: 'admin-uploads',
  orders: 'admin-orders',
  forms: 'admin-forms',
  camp: 'admin-camp',
  parking: 'admin-parking',
  refunds: 'admin-refunds',
};

export interface Notice {
  notice: AdminNotice;
  title: string;
  body: string;
  /**
   * Where tapping it should land, as an app route — `/events/rite-of-palms`.
   *
   * A route rather than a URL because the app resolves it with expo-router and
   * has no business fetching anything. Null when there is nowhere better than
   * the screen the notice is about, which the app maps by `notice` instead.
   */
  route?: string | null;
}

/**
 * Send one notice to everybody resolved for it.
 *
 * Returns how many phones were reached, for the log line. Never throws: this is
 * called from a Firestore trigger whose real job already succeeded, and a
 * failed push must not retry the trigger. A photograph that was transcoded and
 * then failed to notify is a photograph in the review queue — mildly worse than
 * intended. The same trigger retried is a second transcode, or a second copy of
 * a notification somebody already read.
 */
export async function sendNotice(recipients: Recipient[], notice: Notice): Promise<number> {
  if (recipients.length === 0) return 0;

  /*
   * One entry per token, but a person with a phone and a tablet is two tokens
   * and should get it on both — so this is deliberately not deduplicated by
   * uid. Deduplicated by *token*, though, in case two rows carry the same one
   * after a restore.
   */
  const tokens = [...new Set(recipients.map((recipient) => recipient.token))];

  let reached = 0;
  const dead: string[] = [];

  /*
   * 500 is the multicast limit. A parish will never reach it, and the loop is
   * two lines; an unchunked send that works for four years and then silently
   * drops everybody past the cap is the failure this avoids.
   */
  for (let index = 0; index < tokens.length; index += 500) {
    const batch = tokens.slice(index, index + 500);

    let response;
    try {
      response = await getMessaging().sendEachForMulticast({
        tokens: batch,
        notification: { title: notice.title, body: notice.body },
        /*
         * Every value must be a string — FCM's data payload is
         * `map<string,string>` and the SDK throws on a number, which is an
         * easy thing to discover in production. The app reads these in
         * `src/notify/handle.ts`.
         */
        data: {
          notice: notice.notice,
          ...(notice.route ? { route: notice.route } : {}),
        },
        android: {
          // `high` so it appears as a heads-up rather than a silent tray entry.
          // These are all things somebody is waiting on; none of them is a
          // marketing message.
          priority: 'high',
          notification: { channelId: CHANNELS[notice.notice] },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              /*
               * A thread per kind, so eight photographs arriving in a morning
               * stack into one group in Notification Center rather than
               * burying everything else the phone had to say.
               */
              'thread-id': notice.notice,
            },
          },
        },
      });
    } catch (error) {
      // The whole batch failed — almost always a project misconfiguration
      // (no APNs key) rather than anything about these tokens. Logged loudly
      // because it is invisible otherwise, and not rethrown; see above.
      console.error(`[notify] could not send ${notice.notice}:`, error);
      continue;
    }

    response.responses.forEach((result, position) => {
      if (result.success) {
        reached += 1;
        return;
      }

      const code = result.error?.code ?? '';
      /*
       * The two codes that mean "this token will never work again" — the app
       * was uninstalled, or the token was reissued. Anything else
       * (`unavailable`, `internal`, a quota error) is transient and must NOT
       * prune, or one FCM wobble empties the registry and everybody silently
       * stops being notified until they reinstall.
       */
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        const token = batch[position];
        if (token) dead.push(token);
      } else {
        console.warn(`[notify] ${notice.notice} failed for one device: ${code}`);
      }
    });
  }

  if (dead.length > 0) await pruneTokens(dead);

  return reached;
}

/**
 * Delete the rows for tokens FCM has told us are gone.
 *
 * By query on `token` rather than by recomputing the document id. The id is a
 * hash of the token and recomputing it here would work — but it would put the
 * hashing in two files, and the day one of them changes the registry quietly
 * stops being prunable.
 */
async function pruneTokens(tokens: string[]): Promise<void> {
  const db = getFirestore();

  try {
    const found = await Promise.all(
      tokens.map((token) =>
        db.collection(COLLECTIONS.pushDevices).where('token', '==', token).limit(1).get(),
      ),
    );

    const batch = db.batch();
    let count = 0;
    for (const snapshot of found) {
      const doc = snapshot.docs[0];
      if (doc) {
        batch.delete(doc.ref);
        count += 1;
      }
    }

    if (count > 0) {
      await batch.commit();
      console.info(`[notify] pruned ${count} dead device registration(s).`);
    }
  } catch (error) {
    // Tidying failed. The next send tries again, so this is a log line and not
    // a reason to fail a trigger.
    console.warn('[notify] could not prune dead tokens:', error);
  }
}
