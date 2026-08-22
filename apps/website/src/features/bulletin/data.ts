/**
 * Read the weekly bulletin straight out of the announcements project.
 *
 * BUILD TIME ONLY. Never import this from a client component.
 *
 * Cross-project access needs that project's service-account key, and a key is a
 * bearer credential — whatever IAM granted it, whoever holds it can do. A
 * browser cannot hold one. So unlike everything else the site reads, this
 * cannot happen in the browser at all, and `next build` now requires
 * `ANNOUNCEMENTS_SERVICE_ACCOUNT` to be present.
 *
 * The key is read-only on that project (verified by `npm run verify:scopes`),
 * so the blast radius of a leak is "can read the parish bulletin", which is
 * already public. That is not a reason to be careless with it — the variable
 * has no `NEXT_PUBLIC_` prefix precisely so Next will not inline it, and the
 * guard below fails loudly if this module is ever pulled into browser code.
 */
import { initializeApp, getApps, getApp, cert, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readActiveBulletin, type AnnouncementsConfig, type Bulletin } from '@spsm/shared';

/** Reused across pages in one build; initializeApp throws on a duplicate name. */
const APP_NAME = 'announcements-source';

function sourceApp(serviceAccountJson: string): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return existing;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(serviceAccountJson) as Record<string, unknown>;
  } catch {
    // Deliberately does not echo the value — it contains a private key.
    throw new Error(
      'ANNOUNCEMENTS_SERVICE_ACCOUNT is not valid JSON. The usual cause is a ' +
        'pretty-printed key pasted across multiple lines: dotenv stops at the ' +
        'first newline, so the variable ends up as the single character "{". ' +
        'It must be one line, or single-quoted.',
    );
  }

  return initializeApp(
    { credential: cert(parsed as never), projectId: parsed['project_id'] as string },
    APP_NAME,
  );
}

/**
 * The active bulletin, or null if there isn't a usable one.
 *
 * "Active" is the announcements app's own word for it: that app writes
 * `config/active_bulletin` when staff put a bulletin up, and this follows it —
 * see `readActiveBulletin`, which is in @spsm/shared because the `bulletin`
 * Cloud Function performs the identical read at request time.
 *
 * **What this returns is a first paint, not the answer the reader ends up
 * with.** The build bakes it into static HTML and the homepage re-checks
 * `/api/bulletin` on load, so making a different bulletin active does not need
 * a deploy. This is what shows instantly, and what stays on screen if that
 * check cannot be made.
 *
 * Returns null rather than throwing for every recoverable case. The bulletin is
 * one section of the homepage; a bad week over there should cost that section,
 * not the whole deploy.
 */
export async function getCurrentBulletin(config: AnnouncementsConfig): Promise<Bulletin | null> {
  if (!config.enabled) {
    console.warn('[bulletin] disabled in config/integrations; skipping.');
    return null;
  }

  const serviceAccount = process.env.ANNOUNCEMENTS_SERVICE_ACCOUNT;
  if (!serviceAccount || serviceAccount.startsWith('REPLACE_ME')) {
    console.warn(
      '[bulletin] ANNOUNCEMENTS_SERVICE_ACCOUNT is not set, so the bulletin ' +
        'section will be missing from this build. Unlike the rest of the site, ' +
        'this read cannot fall back to public access — another project is ' +
        'involved. See docs/local-dev.md.',
    );
    return null;
  }

  if (typeof window !== 'undefined') {
    throw new Error(
      'getCurrentBulletin() ran in a browser. This module holds a service-account ' +
        'credential and must never reach client code.',
    );
  }

  try {
    const app = sourceApp(serviceAccount);
    // An empty databaseId means (default). Passing the empty string through
    // fails as a bare `5 NOT_FOUND`, which reads like a missing collection.
    const firestore = config.databaseId
      ? getFirestore(app, config.databaseId)
      : getFirestore(app);

    return await readActiveBulletin(firestore, config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[bulletin] read failed, rendering without it: ${message}`);
    return null;
  }
}
