import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Talking to Firebase projects we don't own the default credentials for.
 *
 * Two external projects, with deliberately opposite permissions:
 *
 *   weeklyAnnouncements — READ ONLY. We pull announcements out and mirror them
 *                         into our own `announcements` collection.
 *   taksis             — WRITE ONLY. We push pending vehicle registrations in.
 *                         We must not be able to read Taksis's data.
 *
 * Why this file exists at all: a browser client authenticated to the SPSM
 * project cannot touch another project's database, no matter what rules say.
 * Cross-project access has to run server-side with that project's credentials.
 *
 * ---------------------------------------------------------------------------
 * The real enforcement is IAM on the *other* project, not this code.
 *
 * A service account key is a bearer credential: whatever IAM grants it, it can
 * do, and nothing in this file can take that back. The accessor functions below
 * encode intent so a mistake fails fast and legibly in development — they are
 * not a security boundary. Scope the service accounts properly:
 *
 *   READ ONLY (weeklyAnnouncements project):
 *     roles/datastore.viewer
 *     — or a custom role with only datastore.entities.get + .list
 *
 *   WRITE ONLY (Taksis project, IF it turns out to be Firestore):
 *     custom role with only datastore.entities.create
 *
 *     Consequence worth knowing before choosing this: a create-only identity
 *     cannot read, so it cannot check whether a record already exists, and it
 *     cannot run a transaction. Deduplication has to happen either on the
 *     Taksis side or via a deterministic document id that makes a re-send
 *     idempotent. See docs/integrations.md.
 *
 *   If Taksis is Realtime Database instead, none of the above applies —
 *   RTDB write-only is expressed in that project's security rules on the path
 *   (`".read": false`), not in IAM. Pending confirmation.
 * ---------------------------------------------------------------------------
 */

export type ExternalProject = 'weeklyAnnouncements' | 'taksis';

const INTENT: Record<ExternalProject, 'read-only' | 'write-only'> = {
  weeklyAnnouncements: 'read-only',
  taksis: 'write-only',
};

/**
 * Named admin apps, memoized. `initializeApp` throws if called twice with the
 * same name, and Functions instances are reused across invocations, so this has
 * to be idempotent rather than "run once at module load".
 */
function getExternalApp(project: ExternalProject, serviceAccountJson: string): App {
  const existing = getApps().find((app) => app.name === project);
  if (existing) return existing;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(serviceAccountJson) as Record<string, unknown>;
  } catch {
    // Deliberately does not echo the value — it's a private key.
    throw new Error(
      `Service account for "${project}" is not valid JSON. Check the ` +
        `Secret Manager entry; a common cause is pasting the file path rather ` +
        `than the file contents.`,
    );
  }

  return initializeApp(
    {
      credential: cert(parsed as never),
      projectId: parsed['project_id'] as string,
    },
    project,
  );
}

/**
 * Read access to an external project.
 *
 * Only callable for projects marked read-only, so an accidental
 * `externalRead('taksis')` fails at the call site with a clear message instead
 * of producing a confusing IAM PERMISSION_DENIED at request time.
 */
export function externalRead(
  project: Extract<ExternalProject, 'weeklyAnnouncements'>,
  serviceAccountJson: string,
  databaseId?: string,
): Firestore {
  assertIntent(project, 'read-only');
  return openDatabase(getExternalApp(project, serviceAccountJson), databaseId);
}

/**
 * Write access to an external project.
 *
 * Returns the raw Firestore handle because the Admin SDK has no "writes only"
 * variant — the restriction lives in IAM. Treat reads through this handle as a
 * bug even though the type system permits them.
 */
export function externalWrite(
  project: Extract<ExternalProject, 'taksis'>,
  serviceAccountJson: string,
  databaseId?: string,
): Firestore {
  assertIntent(project, 'write-only');
  return openDatabase(getExternalApp(project, serviceAccountJson), databaseId);
}

/**
 * A project can host several Firestore databases; only one of them is
 * `(default)`. Passing the wrong id does not fail the way you would expect —
 * the Admin SDK connects and the first query returns a bare `5 NOT_FOUND` with
 * no message, which reads like a missing collection rather than a missing
 * database. So treat an empty-string env var as "unset" rather than passing it
 * through, and never guess an id from the project's display name.
 */
function openDatabase(app: App, databaseId?: string): Firestore {
  const id = databaseId?.trim();
  if (!id || id === '(default)') return getFirestore(app);
  return getFirestore(app, id);
}

function assertIntent(project: ExternalProject, expected: 'read-only' | 'write-only'): void {
  if (INTENT[project] !== expected) {
    throw new Error(
      `"${project}" is configured ${INTENT[project]}; refusing to open it as ${expected}.`,
    );
  }
}
