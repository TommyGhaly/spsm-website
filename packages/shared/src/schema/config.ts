/**
 * Runtime configuration, stored in Firestore rather than in env files.
 *
 * Why the database and not `.env`: these values describe *where the parish's
 * data lives*, and that changes for reasons that have nothing to do with the
 * code — a project gets renamed, a collection moves, the bulletin section needs
 * turning off for a week. Putting them in Firestore means those are edits, not
 * deploys, and there is exactly one copy instead of one per environment file.
 *
 * ---------------------------------------------------------------------------
 * WHAT MUST NEVER GO IN HERE
 *
 * Credentials. `config` is world-readable (see firestore.rules) because the
 * website build reads it as an anonymous client, so anything written here is
 * public. That is fine for a project id and a collection name — neither
 * authorizes anything, and IAM on the other project is what actually restricts
 * access. It would be catastrophic for a service-account key or an API token.
 *
 * Secrets stay in Secret Manager (`firebase functions:secrets:set`) and in the
 * gitignored root `.env`.
 * ---------------------------------------------------------------------------
 *
 * Bootstrap note: the Firebase connection itself cannot live here, for the
 * obvious reason that you need it to read this. The six `NEXT_PUBLIC_FIREBASE_*`
 * values stay in the environment; everything else moves here.
 */

/** Document id of the single integrations config document. */
export const CONFIG_DOC_INTEGRATIONS = 'integrations';

export interface IntegrationsConfig {
  announcements: AnnouncementsConfig;
}

export interface AnnouncementsConfig {
  /**
   * Lets staff hide the weekly bulletin from the site without a deploy — for a
   * week the bulletin is not ready, or if the source app breaks.
   */
  enabled: boolean;

  /** GCP/Firebase project id holding the bulletins. */
  projectId: string;

  /** Collection within that project. */
  collectionPath: string;

  /**
   * Named Firestore database, or empty for `(default)`.
   *
   * Empty is correct for this project and worth leaving that way. Its display
   * name is "weeklyAnnouncements", which is *not* a database id — putting that
   * here produces a bare `5 NOT_FOUND` that reads like a missing collection
   * rather than a missing database.
   */
  databaseId: string;
}

/**
 * Used when the config document is missing or unreadable.
 *
 * A parish website should not go blank because someone deleted a settings
 * document. These are the values in use as of 2026-08-07; treat them as a
 * fallback, not as the source of truth.
 */
export const DEFAULT_INTEGRATIONS_CONFIG: IntegrationsConfig = {
  announcements: {
    enabled: true,
    projectId: 'weeklyannouncements-1d046',
    collectionPath: 'bulletins',
    databaseId: '',
  },
};

/**
 * Coerce whatever is in the document into a usable config.
 *
 * Staff can edit this document by hand in the Firebase console, so a missing
 * or mistyped field is an ordinary occurrence rather than an exceptional one.
 * Each field falls back independently, so one bad edit does not discard the
 * others.
 */
export function parseIntegrationsConfig(raw: unknown): IntegrationsConfig {
  const doc = asRecord(raw);
  const announcements = asRecord(doc?.['announcements']);
  const fallback = DEFAULT_INTEGRATIONS_CONFIG.announcements;

  return {
    announcements: {
      // Only an explicit `false` disables it. A missing field means "on",
      // which is the safer default for a section that is normally present.
      enabled: announcements?.['enabled'] !== false,
      projectId: str(announcements?.['projectId']) ?? fallback.projectId,
      collectionPath: str(announcements?.['collectionPath']) ?? fallback.collectionPath,
      // Note the `??` rather than `||`: an empty string is a meaningful value
      // here — it means the (default) database — and must not fall back.
      databaseId: str(announcements?.['databaseId']) ?? fallback.databaseId,
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Preserves the empty string; rejects non-strings. */
function str(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}
