/**
 * Create or inspect the documents in the `config` collection.
 *
 * Writing to `config` needs the `admin` custom claim, and no user has one yet,
 * so this goes in over the Firestore REST API with your own gcloud credentials
 * — which bypass security rules the same way the Admin SDK does. That avoids
 * making you set up Application Default Credentials just to write a document.
 *
 * Prerequisite: `gcloud auth login` (already done if `gcloud` works elsewhere).
 *
 * `--write` never clobbers a document that already exists. These are edited by
 * hand in the Firebase console, and a seed script that overwrites the parish's
 * real phone number with a blank default would be a genuinely bad afternoon.
 * Use `--force` to overwrite deliberately.
 *
 * Usage:
 *   npm run config                  # show what is there now
 *   npm run config -- --write       # create anything missing
 *   npm run config -- --write --force
 */
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
} from '../packages/shared/dist/index.js';
import { accessToken, documentUrl, fromFirestore, toFieldMap } from './lib/firestore-rest.mjs';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const force = process.argv.includes('--force');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const DOCS = [
  { id: 'integrations', defaults: DEFAULT_INTEGRATIONS_CONFIG },
  { id: 'parish', defaults: DEFAULT_PARISH_CONFIG },
];

const authHeader = { Authorization: `Bearer ${accessToken()}` };
const urlFor = (id) => documentUrl(project, `config/${id}`);

let exitCode = 0;

for (const { id, defaults } of DOCS) {
  console.log(`\n=== config/${id} ===`);

  const current = await fetch(urlFor(id), { headers: authHeader });
  let exists = false;

  if (current.ok) {
    exists = true;
    const body = await current.json();
    console.log(JSON.stringify(fromFirestore(body.fields ?? {}), null, 2));
  } else if (current.status === 404) {
    console.log('(does not exist yet)');
  } else {
    console.error(`Read failed: HTTP ${current.status} ${(await current.text()).slice(0, 300)}`);
    exitCode = 1;
    continue;
  }

  if (!write) {
    if (!exists) {
      console.log('\nWould create it with:');
      console.log(JSON.stringify(defaults, null, 2));
    }
    continue;
  }

  if (exists && !force) {
    console.log('\nAlready exists — leaving it alone. Use --force to overwrite.');
    continue;
  }

  const res = await fetch(urlFor(id), {
    method: 'PATCH',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFieldMap(defaults) }),
  });

  if (!res.ok) {
    console.error(`Write failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
    exitCode = 1;
    continue;
  }
  console.log(`\n${exists ? 'Overwrote' : 'Created'} config/${id}.`);
}

if (!write) {
  console.log('\nDry run. Re-run with `-- --write` to create anything missing.');
}
process.exitCode = exitCode;
