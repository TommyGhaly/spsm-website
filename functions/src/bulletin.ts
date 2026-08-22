/**
 * The active bulletin, read at request time instead of at build time.
 *
 * ---------------------------------------------------------------------------
 * Why this endpoint exists.
 *
 * The site is a static export, so every page is HTML written to disk when the
 * build ran, and the homepage schedule was part of that HTML. The parish makes
 * a bulletin active in the announcements app and nothing anybody could see
 * changed until somebody redeployed this website. On the one section most
 * people came for, that is the wrong failure: a stale schedule does not look
 * stale, so a reader acts on it and turns up at the wrong hour.
 *
 * The browser cannot make this read itself, and not for want of trying. The
 * bulletin lives in a *different* Firebase project, and cross-project access
 * needs that project's service-account key — a bearer credential, which is
 * exactly the thing that must never be shipped to a browser. So the read
 * happens here, where the key stays in Secret Manager, and the browser gets
 * JSON from our own origin.
 *
 * What the page keeps from the build is a first paint. The section still ships
 * with whatever was active at deploy, then re-checks here on load and while it
 * is open — so this endpoint being down or misconfigured costs freshness and
 * never costs the section. See features/bulletin/useActiveBulletin.ts.
 * ---------------------------------------------------------------------------
 *
 * The read itself is deliberately not written here. It is
 * `readActiveBulletin` in @spsm/shared, imported so that the build and this
 * Function resolve "the active bulletin" through the same code.
 * If they ever diverged, the homepage would change week on load for no reason a
 * reader could see, and that is a bug nobody would think to look for.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_INTEGRATIONS,
  DEFAULT_INTEGRATIONS_CONFIG,
  parseIntegrationsConfig,
  readActiveBulletin,
} from '@spsm/shared';
import { externalRead } from './external/secondaryApp.js';

/**
 * Read-only on the announcements project — see infra/iam/announcements-reader.yaml.
 * Set with: firebase functions:secrets:set ANNOUNCEMENTS_SERVICE_ACCOUNT
 */
const ANNOUNCEMENTS_SERVICE_ACCOUNT = defineSecret('ANNOUNCEMENTS_SERVICE_ACCOUNT');

/**
 * How long Hosting's CDN may serve one answer, in seconds.
 *
 * The point of this endpoint is freshness, so this number is how much of it
 * there actually is. Thirty seconds is the trade: making a bulletin active
 * reaches the site within half a minute, and a Sunday morning's readers
 * arriving at once cost the announcements project two reads a minute rather
 * than two per visitor.
 *
 * `max-age=0` separately, so the *browser* never holds a copy — a reader who
 * refreshes after being told the schedule changed must not be served their own
 * cache. `stale-while-revalidate` lets the CDN answer instantly from a slightly
 * old copy while it fetches a new one, which is what stops a cold Function
 * instance from being visible as a wait.
 */
const CACHE_CONTROL = 'public, max-age=0, s-maxage=30, stale-while-revalidate=300';

/**
 * `GET /api/bulletin` -> `{ bulletin }`.
 *
 * 200 with `bulletin: null` when there is genuinely nothing to show, so the
 * caller can tell that apart from a failure. The only error statuses are for a
 * wrong method, a missing credential, and a read that actually broke — and the
 * page's response to every one of those is to keep the week it already has.
 */
export const bulletin = onRequest(
  {
    secrets: [ANNOUNCEMENTS_SERVICE_ACCOUNT],
    // Same origin through the Hosting rewrite in firebase.json. Nothing here is
    // secret — this is the sheet pinned up in the narthex — but there is no
    // reason for another site to read it through the parish's own credential
    // and quota.
    cors: false,
  },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'This endpoint is read-only; use GET.' });
      return;
    }

    try {
      const config = await integrations();

      if (!config.enabled) {
        // Not an error: somebody switched the section off in
        // config/integrations. Reported as an explicit null so the caller does
        // not confuse it with a failure.
        res.set('Cache-Control', CACHE_CONTROL);
        res.status(200).json({ bulletin: null, reason: 'disabled' });
        return;
      }

      const serviceAccount = ANNOUNCEMENTS_SERVICE_ACCOUNT.value();
      if (!serviceAccount || serviceAccount.startsWith('REPLACE_ME')) {
        console.error(
          '[bulletin] ANNOUNCEMENTS_SERVICE_ACCOUNT is not set, so the live read ' +
            'cannot happen. Set it with: firebase functions:secrets:set ' +
            'ANNOUNCEMENTS_SERVICE_ACCOUNT',
        );
        // 503, not 200-with-null: this is us being broken rather than the
        // parish having nothing active, and those call for opposite behaviour
        // in the page.
        res.status(503).json({ error: 'The bulletin source is not configured.' });
        return;
      }

      const firestore = externalRead(
        'weeklyAnnouncements',
        serviceAccount,
        config.databaseId || undefined,
      );

      const active = await readActiveBulletin(firestore, config);

      res.set('Cache-Control', CACHE_CONTROL);
      res.status(200).json({ bulletin: active, reason: active ? null : 'nothing-active' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Deliberately not echoed to the caller: the failures here are IAM and
      // credential shapes, and those messages name projects and accounts.
      console.error(`[bulletin] live read failed: ${message}`);
      res.status(502).json({ error: 'Could not reach the bulletin source.' });
    }
  },
);

/**
 * Which project and collection to read, from our own Firestore.
 *
 * Read here rather than taken from the request, because a caller that names its
 * own source project is a caller that can point the parish's read-only
 * credential wherever it likes. Falls back to the committed defaults on a
 * missing document, for the same reason the website does: a settings document
 * nobody has created yet should not take the section down.
 */
async function integrations() {
  const snapshot = await getFirestore()
    .doc(`${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS}`)
    .get();

  if (!snapshot.exists) {
    console.warn(
      `[bulletin] ${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS} does not exist; ` +
        `using built-in defaults.`,
    );
    return DEFAULT_INTEGRATIONS_CONFIG.announcements;
  }
  return parseIntegrationsConfig(snapshot.data()).announcements;
}
