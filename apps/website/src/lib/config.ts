/**
 * Runtime configuration, read from Firestore at build time.
 *
 * The bootstrap order matters and is worth stating: the six
 * `NEXT_PUBLIC_FIREBASE_*` values stay in the environment because you need them
 * to reach Firestore at all. Everything downstream of that — which project the
 * bulletin lives in, which collection, whether to show it — lives in
 * `config/integrations` so staff can change it without a deploy.
 *
 * Reads are anonymous, which is why `config` is world-readable and why nothing
 * secret may ever be written there. See packages/shared/src/schema/config.ts.
 */
import { doc, getDoc } from 'firebase/firestore';
import {
  COLLECTIONS,
  CONFIG_DOC_EVENTS,
  CONFIG_DOC_INTEGRATIONS,
  CONFIG_DOC_PARISH,
  DEFAULT_EVENTS_PAGE_CONFIG,
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
  parseEventsPageConfig,
  parseIntegrationsConfig,
  parseParishConfig,
  type EventsPageConfig,
  type IntegrationsConfig,
  type ParishConfig,
} from '@spsm/shared';
import { db, isConfigured } from './firebase';

/**
 * Never throws.
 *
 * A missing or unreadable settings document should degrade to the committed
 * defaults, not take the site down. The one thing it must not do is fail
 * silently, so every fallback path says why on the build log.
 */
export async function getIntegrationsConfig(): Promise<IntegrationsConfig> {
  if (!isConfigured()) {
    console.warn('[config] Firebase not configured; using built-in defaults.');
    return DEFAULT_INTEGRATIONS_CONFIG;
  }

  try {
    const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_INTEGRATIONS));
    if (!snapshot.exists()) {
      console.warn(
        `[config] ${COLLECTIONS.config}/${CONFIG_DOC_INTEGRATIONS} does not exist; ` +
          `using built-in defaults. Create it with: node scripts/seed-config.mjs`,
      );
      return DEFAULT_INTEGRATIONS_CONFIG;
    }
    return parseIntegrationsConfig(snapshot.data());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[config] could not read settings, using built-in defaults: ${message}`);
    return DEFAULT_INTEGRATIONS_CONFIG;
  }
}

/**
 * Parish contact details and service times.
 *
 * Also never throws, but the fallback here is *blank* rather than a set of
 * working defaults — see `DEFAULT_PARISH_CONFIG`. An address nobody has
 * confirmed is worse than a visible gap, because a plausible wrong address is
 * one nobody thinks to check.
 */
export async function getParishConfig(): Promise<ParishConfig> {
  if (!isConfigured()) {
    console.warn('[config] Firebase not configured; parish details unavailable.');
    return DEFAULT_PARISH_CONFIG;
  }

  try {
    const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_PARISH));
    if (!snapshot.exists()) {
      console.warn(
        `[config] ${COLLECTIONS.config}/${CONFIG_DOC_PARISH} does not exist, so the ` +
          `contact page has no address, phone, or service times to show. ` +
          `Create it with: npm run config -- --write`,
      );
      return DEFAULT_PARISH_CONFIG;
    }
    return parseParishConfig(snapshot.data());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[config] could not read parish details: ${message}`);
    return DEFAULT_PARISH_CONFIG;
  }
}

/**
 * The `/events` page's own settings — today, which section the parish is
 * pointing at.
 *
 * ## Read in the browser, unlike the two above
 *
 * Those run at build time, on a page that is exported as HTML. This one runs on
 * the client: `/events` is client-rendered so that a ministry created after the
 * last deploy appears without one (see ProgramDirectory), and the setting is
 * changed from that same page — a value baked into the export would go stale the
 * moment somebody set it. It lives here rather than in features/programs because
 * the NFC routes will read it too, and they are not part of the galleries.
 *
 * **A missing document is the ordinary state and says nothing on the log.** The
 * other two readers warn, because a site with no parish address or no
 * integrations is misconfigured. Nothing is wrong with a parish that has never
 * named a section: `config/events` does not exist until the first time one is
 * chosen, so a warning here would fire on every visit to a perfectly correct
 * site.
 */
export async function getEventsPageConfig(): Promise<EventsPageConfig> {
  if (!isConfigured()) return DEFAULT_EVENTS_PAGE_CONFIG;

  try {
    const snapshot = await getDoc(doc(db(), COLLECTIONS.config, CONFIG_DOC_EVENTS));
    return snapshot.exists()
      ? parseEventsPageConfig(snapshot.data())
      : DEFAULT_EVENTS_PAGE_CONFIG;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[config] could not read the events page settings: ${message}`);
    return DEFAULT_EVENTS_PAGE_CONFIG;
  }
}
