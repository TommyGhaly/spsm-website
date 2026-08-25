/**
 * Prove the credentials in .env actually work — and, for the two external
 * projects, that they are scoped the way docs/integrations.md claims.
 *
 * The scoping half is the point. A service-account key is a bearer credential:
 * whatever IAM granted it, it can do, and no amount of care in
 * functions/src/external/secondaryApp.ts takes that back. "Read only" and
 * "write only" are assertions about the *other* project's IAM, and an assertion
 * nobody checks is a wish. This checks it.
 *
 * How the scope check works: Cloud Resource Manager's testIamPermissions
 * returns the subset of the permissions you ask about that the caller actually
 * holds. It is non-mutating and needs no special privilege — which matters,
 * because the alternative (try a write and see if it lands) would leave junk
 * documents in someone else's project and cannot be undone by an identity that
 * has no delete.
 *
 * Run via: npm run verify:scopes
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';

process.loadEnvFile('.env');

let failures = 0;
let warnings = 0;

const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => {
  console.log(`  FAIL  ${msg}`);
  failures += 1;
};
const warn = (msg) => {
  console.log(`  WARN  ${msg}`);
  warnings += 1;
};
const info = (msg) => console.log(`        ${msg}`);
const section = (n, title) => console.log(`\n${n}. ${title}\n${'-'.repeat(72)}`);

/** Absent, blank, or a leftover template placeholder all mean "not set". */
function env(key) {
  const value = process.env[key];
  if (!value || value.startsWith('REPLACE_ME')) return undefined;
  return value;
}

function parseServiceAccount(key) {
  const raw = env(key);
  if (!raw) return { error: `${key} is not set.` };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      return { error: `${key} parsed as JSON but has no client_email/private_key.` };
    }
    return { parsed };
  } catch (error) {
    // Never echo the value; it contains a private key.
    return {
      error:
        `${key} is not valid JSON (${error.message}). The usual cause is a ` +
        `pretty-printed key pasted across multiple lines — dotenv stops at the ` +
        `first newline. It must be one line, or single-quoted.`,
    };
  }
}

/**
 * Ask GCP which of these permissions this service account actually holds.
 * Returns a Set, or null if the API itself was unreachable.
 */
async function heldPermissions(serviceAccount, projectId, permissions) {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const res = await client.request({
    url: `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`,
    method: 'POST',
    data: { permissions },
  });
  return new Set(res.data.permissions ?? []);
}

/** Report a permission the account SHOULD hold. */
function expectGranted(held, permission, why) {
  if (held.has(permission)) pass(`has ${permission} — ${why}`);
  else fail(`missing ${permission} — ${why}`);
}

/** Report a permission the account MUST NOT hold. */
function expectDenied(held, permission, why) {
  if (!held.has(permission)) pass(`does not have ${permission} — ${why}`);
  else fail(`HAS ${permission}, and should not. ${why}`);
}

const DATASTORE_PERMISSIONS = [
  'datastore.databases.get',
  'datastore.entities.get',
  'datastore.entities.list',
  'datastore.entities.create',
  'datastore.entities.update',
  'datastore.entities.delete',
];

// ---------------------------------------------------------------------------
section(1, 'SPSM Firebase — our own project');

const publicConfig = {
  apiKey: env('NEXT_PUBLIC_FIREBASE_API_KEY'),
  authDomain: env('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN'),
  projectId: env('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
  storageBucket: env('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
  appId: env('NEXT_PUBLIC_FIREBASE_APP_ID'),
};

const missingPublic = Object.entries(publicConfig)
  .filter(([, v]) => v === undefined)
  .map(([k]) => k);

if (missingPublic.length > 0) {
  fail(`web config incomplete, missing: ${missingPublic.join(', ')}`);
} else {
  pass(`all six web config values present (project ${publicConfig.projectId})`);

  if (!publicConfig.authDomain.startsWith(`${publicConfig.projectId}.`)) {
    warn(`authDomain "${publicConfig.authDomain}" does not match the project id — likely a paste from a different project`);
  }
  if (!publicConfig.storageBucket.startsWith(`${publicConfig.projectId}.`)) {
    warn(`storageBucket "${publicConfig.storageBucket}" does not match the project id`);
  }

  // The web API key is an identifier, not a credential — so the only useful
  // question is "does it resolve to a real project with Identity Toolkit on?"
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${publicConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'scope-probe@example.invalid',
          continueUri: 'http://localhost',
        }),
      },
    );
    const body = await res.json();
    if (res.ok) {
      pass('web API key is live and Identity Toolkit is enabled');
    } else {
      const reason = body?.error?.message ?? `HTTP ${res.status}`;
      if (reason.includes('API_KEY_INVALID') || reason.includes('API key not valid')) {
        fail(`web API key rejected by Google: ${reason}`);
      } else if (reason.includes('CONFIGURATION_NOT_FOUND')) {
        fail('key is valid but Authentication is not enabled — Firebase console > Build > Authentication > Get started');
      } else {
        warn(`unexpected response validating the API key: ${reason}`);
      }
    }
  } catch (error) {
    warn(`could not reach Identity Toolkit to validate the key: ${error.message}`);
  }

  // "Identity Toolkit responds" and "a parishioner can sign in" are different
  // claims, and the first one starts passing on its own the moment any deploy
  // enables the API. Probe the provider itself.
  //
  // A deliberately bogus sign-in is the non-mutating way to ask. accounts:signUp
  // would answer the same question and create a real user when the answer is
  // yes, which is not a trade worth making.
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${publicConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'scope-probe@example.invalid',
          password: 'not-a-real-password',
          returnSecureToken: true,
        }),
      },
    );
    const reason = (await res.json())?.error?.message ?? 'OK';

    // Firebase has two ways of saying "off" and they are not interchangeable:
    // OPERATION_NOT_ALLOWED for a provider that was never configured, and
    // PASSWORD_LOGIN_DISABLED for one explicitly turned off. Treating anything
    // that is not OPERATION_NOT_ALLOWED as "on" reports a disabled provider as
    // working.
    if (reason === 'OPERATION_NOT_ALLOWED' || reason === 'PASSWORD_LOGIN_DISABLED') {
      warn(
        'Email/Password sign-in is DISABLED. Firebase console > Build > ' +
          'Authentication > Sign-in method. Nothing that needs a signed-in user ' +
          'works until this is on — prayer requests, member profiles, orders.',
      );
    } else {
      pass(`Email/Password sign-in is enabled (probe rejected as expected: ${reason})`);
    }
  } catch (error) {
    warn(`could not probe sign-in providers: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
section(2, 'Weekly announcements — must be READ ONLY');

const announcementsProject = env('ANNOUNCEMENTS_PROJECT_ID');
const announcementsPath = env('ANNOUNCEMENTS_COLLECTION_PATH');
const announcementsDb = env('ANNOUNCEMENTS_DATABASE_ID');
const announcements = parseServiceAccount('ANNOUNCEMENTS_SERVICE_ACCOUNT');

if (announcements.error) {
  fail(announcements.error);
} else if (!announcementsProject) {
  fail('ANNOUNCEMENTS_PROJECT_ID is not set.');
} else {
  const sa = announcements.parsed;
  info(`service account: ${sa.client_email}`);

  if (sa.project_id !== announcementsProject) {
    fail(`key belongs to "${sa.project_id}" but ANNOUNCEMENTS_PROJECT_ID is "${announcementsProject}"`);
  }
  if (/^firebase-adminsdk-/.test(sa.client_email)) {
    fail('this is the auto-created firebase-adminsdk account — Firebase grants it roles/editor, which is full write access to the announcements project. Create a dedicated read-only account (infra/iam/announcements-reader.yaml).');
  }

  try {
    const held = await heldPermissions(sa, announcementsProject, DATASTORE_PERMISSIONS);
    expectGranted(held, 'datastore.entities.get', 'needed to read an announcement');
    expectGranted(held, 'datastore.entities.list', 'needed to query the collection');
    expectDenied(held, 'datastore.entities.create', 'we must never add to their project');
    expectDenied(held, 'datastore.entities.update', 'we must never edit their announcements');
    expectDenied(held, 'datastore.entities.delete', 'we must never delete their data');
  } catch (error) {
    warn(`could not check IAM scope: ${error.message}`);
    info('If this says cloudresourcemanager.googleapis.com is disabled, enable it on the announcements project — it is read-only metadata and safe to turn on.');
  }

  // A live read is the only thing that proves the database id and collection
  // path are right. Getting ANNOUNCEMENTS_DATABASE_ID wrong fails by returning
  // an empty collection, not an error, which is the worst kind of wrong.
  let app;
  try {
    app = initializeApp(
      { credential: cert(sa), projectId: announcementsProject },
      `verify-announcements-${Date.now()}`,
    );
    const db = announcementsDb ? getFirestore(app, announcementsDb) : getFirestore(app);
    const snapshot = await db.collection(announcementsPath ?? 'bulletins').limit(3).get();

    if (snapshot.empty) {
      warn(`read succeeded but "${announcementsPath}" is empty in database "${announcementsDb ?? '(default)'}" — check the collection path and database id`);
    } else {
      pass(`read ${snapshot.size} document(s) from ${announcementsDb ?? '(default)'}/${announcementsPath}`);
      // Field names only. The shape is what we need for the mirror schema; the
      // contents are the parish's, not ours to print.
      const fields = new Set();
      snapshot.forEach((doc) => Object.keys(doc.data()).forEach((f) => fields.add(f)));
      info(`fields present: ${[...fields].sort().join(', ')}`);
      info(`example doc id: ${snapshot.docs[0].id}`);
    }
  } catch (error) {
    fail(`live read failed: ${error.message}`);
  } finally {
    if (app) await deleteApp(app).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
section(3, 'Taksis — must be WRITE ONLY');

const taksisProject = env('TAKSIS_PROJECT_ID');
const taksisBackend = env('TAKSIS_BACKEND');
const taksis = parseServiceAccount('TAKSIS_SERVICE_ACCOUNT');

if (taksis.error) {
  fail(taksis.error);
} else if (!taksisProject) {
  fail('TAKSIS_PROJECT_ID is not set.');
} else {
  const sa = taksis.parsed;
  info(`service account: ${sa.client_email}`);
  info(`backend declared as: ${taksisBackend ?? 'UNSET'}, path: ${env('TAKSIS_PENDING_VEHICLES_PATH') ?? 'UNSET'}`);

  if (sa.project_id !== taksisProject) {
    fail(`key belongs to "${sa.project_id}" but TAKSIS_PROJECT_ID is "${taksisProject}"`);
  }
  if (/^firebase-adminsdk-/.test(sa.client_email)) {
    fail('this is the auto-created firebase-adminsdk account (roles/editor) — it can read all of Taksis. Create a dedicated create-only account.');
  }
  if (taksisBackend === 'rtdb' && !env('TAKSIS_DATABASE_URL')) {
    fail('TAKSIS_BACKEND=rtdb but TAKSIS_DATABASE_URL is empty.');
  }

  try {
    const held = await heldPermissions(sa, taksisProject, DATASTORE_PERMISSIONS);
    expectGranted(held, 'datastore.entities.create', 'needed to push a pending registration');
    expectDenied(held, 'datastore.entities.get', 'we must not be able to read Taksis data');
    expectDenied(held, 'datastore.entities.list', 'we must not be able to enumerate Taksis data');
    expectDenied(held, 'datastore.entities.delete', 'we must not be able to remove Taksis data');

    // Not a failure either way — it decides the dedupe strategy, so surface it.
    if (held.has('datastore.entities.update')) {
      info('has datastore.entities.update: deterministic-id dedupe (set/merge) is available.');
    } else {
      info('no datastore.entities.update: create-only, so a re-send duplicates. Dedupe must happen on the Taksis side. See docs/integrations.md.');
    }
  } catch (error) {
    warn(`could not check IAM scope: ${error.message}`);
  }

  // Deliberately no live write. A create-only identity cannot clean up after
  // itself, so a probe document would be permanent litter in Taksis's project.
  info('No live write attempted — a create-only key cannot delete its own probe document.');
}

// ---------------------------------------------------------------------------
section(4, 'Square — bookstore payments');

/*
 * The token and the location that match the environment — not whichever pair
 * happens to be named first.
 *
 * ---------------------------------------------------------------------------
 * This script reported a false failure for as long as it existed.
 *
 * It read `SQUARE_ACCESS_TOKEN` unconditionally and then chose the host from
 * `SQUARE_ENVIRONMENT`. With the repo's normal `SQUARE_ENVIRONMENT=sandbox`
 * that sends the *production* token to the sandbox host, which is a guaranteed
 * 401 — and the message it printed blamed the credentials: "the classic cause
 * is a sandbox token with SQUARE_ENVIRONMENT=production, or the reverse". The
 * diagnosis was right about the mechanism and wrong about the culprit. Checked
 * 2026-08-23: both tokens in this .env are valid, each against its own host.
 *
 * The same pairing bug was found and fixed in the checkout Function months
 * earlier — see the note in functions/src/checkout.ts and `squareClient()` in
 * functions/src/square.ts. This is the third copy of that rule; it is the last
 * place that had it wrong.
 *
 * The location id is environment-specific too. A sandbox account has its own
 * locations, so checking `SQUARE_LOCATION_ID` while pointed at sandbox fails
 * even once the token is right.
 * ---------------------------------------------------------------------------
 */
const squareEnvironment = env('SQUARE_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
const squareProduction = squareEnvironment === 'production';

const squareTokenName = squareProduction
  ? 'SQUARE_ACCESS_TOKEN'
  : env('SQUARE_SANDBOX_ACCESS_TOKEN')
    ? 'SQUARE_SANDBOX_ACCESS_TOKEN'
    : 'SQUARE_ACCESS_TOKEN';
const squareToken = env(squareTokenName);

const squareLocationName = squareProduction
  ? 'SQUARE_LOCATION_ID'
  : env('SQUARE_SANDBOX_LOCATION_ID')
    ? 'SQUARE_SANDBOX_LOCATION_ID'
    : 'SQUARE_LOCATION_ID';
const squareLocation = env(squareLocationName);

if (!squareToken) {
  fail(`${squareTokenName} is not set.`);
} else {
  const host =
    squareEnvironment === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
  info(`environment: ${squareEnvironment} (${host})`);
  info(`using ${squareTokenName} and ${squareLocationName}`);

  try {
    const res = await fetch(`${host}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${squareToken}`,
        'Square-Version': '2025-01-23',
      },
    });
    const body = await res.json();

    if (res.status === 401) {
      fail(
        `Square rejected ${squareTokenName} (401) against the ${squareEnvironment} host. ` +
          'The two credential sets are not interchangeable — a sandbox token 401s against ' +
          'connect.squareup.com and a production token 401s against connect.squareupsandbox.com. ' +
          `Either ${squareTokenName} holds the wrong environment's token, or SQUARE_ENVIRONMENT ` +
          'should be the other value.',
      );
    } else if (!res.ok) {
      fail(`Square returned HTTP ${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    } else {
      const locations = body.locations ?? [];
      pass(`token valid — ${locations.length} location(s) visible`);
      const match = locations.find((l) => l.id === squareLocation);
      if (!squareLocation) {
        fail(`${squareLocationName} is not set.`);
      } else if (match) {
        pass(`${squareLocationName} matches "${match.name}" (${match.status}, ${match.currency})`);
      } else {
        fail(`${squareLocationName} "${squareLocation}" is not among this token's locations: ${locations.map((l) => l.id).join(', ') || 'none'}`);
      }

      /*
       * Can this token write to the catalog?
       *
       * `ITEMS_WRITE` is needed by nothing else on this site — checkout reads
       * prices, the sync reads the catalog, the webhook reads payments — so the
       * first time anyone adds a product through /bookstore is the first time a
       * token without it fails. That failure arrives as a bare `FORBIDDEN` in a
       * Cloud Function log and sends people looking at Firestore rules.
       *
       * Checked by asking for the *permissions the token actually has*, not by
       * attempting a write: a probe that creates and deletes a catalog object
       * would leave debris in the parish's live catalog on every run of this
       * script.
       */
      const scopes = await fetch(`${host}/oauth2/token/status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${squareToken}`,
          'Square-Version': '2025-01-23',
          'Content-Type': 'application/json',
        },
      });

      if (scopes.ok) {
        const granted = (await scopes.json())?.scopes ?? [];
        if (granted.includes('ITEMS_WRITE')) {
          pass('token carries ITEMS_WRITE — the bookstore admin can add products, photos, and remove them');
        } else {
          fail(
            'token is missing ITEMS_WRITE. Adding a product or a photo from /bookstore, or ' +
              'removing one, will fail with FORBIDDEN. Grant it on the application in the ' +
              'Square Developer Dashboard.',
          );
        }

        /*
         * Inventory, which is a separate pair of permissions from ITEMS_WRITE
         * and fails in two different places.
         *
         * `INVENTORY_WRITE` is what the stock box on /bookstore needs, and its
         * absence is at least visible — a volunteer presses Save and is told.
         * `INVENTORY_READ` is the quiet one: `sync-catalog.mjs` needs it to read
         * counts back, and without it the sync drops `stockCount` from its field
         * mask and every count silently stops updating. Both are worth naming
         * here rather than discovering from a log.
         */
        for (const [scope, consequence] of [
          ['INVENTORY_WRITE', 'setting a stock count from /bookstore will fail with FORBIDDEN'],
          ['INVENTORY_READ', 'npm run catalog cannot read stock counts and will leave them unchanged'],
        ]) {
          if (granted.includes(scope)) {
            pass(`token carries ${scope}`);
          } else {
            fail(`token is missing ${scope} — ${consequence}.`);
          }
        }
      } else {
        /*
         * A personal access token has no OAuth status endpoint and returns 401
         * here even though it is perfectly valid — it simply carries every
         * permission the account has. Not a failure, but not a confirmation
         * either, so say which of the two this is.
         */
        info(
          'could not read token scopes (normal for a personal access token); ITEMS_WRITE, ' +
            'INVENTORY_READ, and INVENTORY_WRITE unverified',
        );
      }
    }
  } catch (error) {
    warn(`could not reach Square: ${error.message}`);
  }
}

if (!env('SQUARE_WEBHOOK_SIGNATURE_KEY')) {
  warn('SQUARE_WEBHOOK_SIGNATURE_KEY is not set — the webhook handler cannot verify signatures, so anyone who finds the URL can mark orders paid.');
} else {
  pass('SQUARE_WEBHOOK_SIGNATURE_KEY is present (only a live webhook delivery can confirm it is the right one)');
}

// ---------------------------------------------------------------------------
section(5, 'Tithe.ly — awaiting API access');

const tithelyKeys = [
  'NEXT_PUBLIC_TITHELY_PUBLIC_KEY',
  'TITHELY_PRIVATE_KEY',
  'TITHELY_ORGANIZATION_ID',
];
const tithelySet = tithelyKeys.filter((k) => env(k));
if (tithelySet.length === 0) {
  info('Giving API not configured. Expected — access is by request (support@tithe.ly). Nothing depends on it yet.');
  if (!env('NEXT_PUBLIC_TITHELY_GIVING_URL')) {
    warn('NEXT_PUBLIC_TITHELY_GIVING_URL is also empty. That one needs no API access — it is just the parish\'s existing giving page, and it is the fallback if the API request is declined. Worth filling in now.');
  }
} else if (tithelySet.length < tithelyKeys.length) {
  warn(`partially configured: ${tithelySet.join(', ')} set, others blank`);
} else {
  pass('Giving API credentials present');
}

// ---------------------------------------------------------------------------
section(6, 'Microsoft Entra ID — staff auth');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
for (const key of ['NEXT_PUBLIC_AZURE_TENANT_ID', 'NEXT_PUBLIC_AZURE_CLIENT_ID']) {
  const value = env(key);
  if (!value) warn(`${key} is not set (only needed for the servants calendar).`);
  else if (!GUID.test(value)) fail(`${key} is not a GUID.`);
  else pass(`${key} is a well-formed GUID`);
}
info('The client SECRET belongs in the Firebase console\'s Microsoft provider, not in this repo.');

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(72)}`);
console.log(`${failures} failure(s), ${warnings} warning(s)`);
if (failures > 0) {
  console.log('Scope guarantees in docs/integrations.md are NOT holding. Fix before building on them.');
}
process.exit(failures > 0 ? 1 : 0);
