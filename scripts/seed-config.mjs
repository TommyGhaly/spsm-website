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
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  DEFAULT_PARISH_CONFIG,
} from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const force = process.argv.includes('--force');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

const DOCS = [
  { id: 'integrations', defaults: DEFAULT_INTEGRATIONS_CONFIG },
  { id: 'parish', defaults: DEFAULT_PARISH_CONFIG },
];

let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
} catch {
  console.error('Could not get a gcloud access token. Run: gcloud auth login');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${token}` };
const urlFor = (id) =>
  `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/config/${id}`;

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

/**
 * Plain object -> Firestore's field map.
 *
 * Separate from `toValue` because the two are not the same shape: a document
 * body carries a bare `{ field: value }` map, while a nested object has to be
 * wrapped in `mapValue`. Collapsing them into one recursive function needs a
 * "am I at the top?" test, which is exactly the kind of thing that works until
 * the config grows a second key.
 */
function toFieldMap(object) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, toValue(v)]));
}

/** Plain value -> Firestore's typed-value wire format. */
function toValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'object') return { mapValue: { fields: toFieldMap(value) } };
  throw new Error(`Cannot encode ${typeof value}`);
}

/** Firestore's typed-value wire format -> plain object. */
function fromFirestore(fields) {
  const out = {};
  for (const [key, wrapped] of Object.entries(fields)) {
    out[key] = unwrap(wrapped);
  }
  return out;
}

function unwrap(wrapped) {
  if ('stringValue' in wrapped) return wrapped.stringValue;
  if ('booleanValue' in wrapped) return wrapped.booleanValue;
  if ('integerValue' in wrapped) return Number(wrapped.integerValue);
  if ('doubleValue' in wrapped) return wrapped.doubleValue;
  if ('nullValue' in wrapped) return null;
  if ('mapValue' in wrapped) return fromFirestore(wrapped.mapValue.fields ?? {});
  if ('arrayValue' in wrapped) return (wrapped.arrayValue.values ?? []).map(unwrap);
  return wrapped;
}
