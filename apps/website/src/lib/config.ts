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
  CONFIG_DOC_INTEGRATIONS,
  DEFAULT_INTEGRATIONS_CONFIG,
  parseIntegrationsConfig,
  type IntegrationsConfig,
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
