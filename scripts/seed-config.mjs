/**
 * Create or update `config/integrations` in our Firestore.
 *
 * Writing to `config` needs the `admin` custom claim, and no user has one yet,
 * so this goes in over the Firestore REST API with your own gcloud credentials
 * — which bypass security rules the same way the Admin SDK does. That avoids
 * making you set up Application Default Credentials just to write one document.
 *
 * Prerequisite: `gcloud auth login` (already done if `gcloud` works elsewhere).
 *
 * Usage:
 *   node scripts/seed-config.mjs           # show what is there now
 *   node scripts/seed-config.mjs --write   # write the defaults
 */
import { execFileSync } from 'node:child_process';
import { DEFAULT_INTEGRATIONS_CONFIG } from '../packages/shared/dist/index.js';

process.loadEnvFile('.env');

const write = process.argv.includes('--write');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/config/integrations`;

let token;
try {
  token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
} catch {
  console.error('Could not get a gcloud access token. Run: gcloud auth login');
  process.exit(1);
}

const authHeader = { Authorization: `Bearer ${token}` };

// --- show current state -----------------------------------------------------
const current = await fetch(url, { headers: authHeader });
if (current.ok) {
  const body = await current.json();
  console.log(`Existing config/integrations in ${project}:`);
  console.log(JSON.stringify(fromFirestore(body.fields ?? {}), null, 2));
} else if (current.status === 404) {
  console.log(`config/integrations does not exist yet in ${project}.`);
} else {
  console.error(`Read failed: HTTP ${current.status} ${(await current.text()).slice(0, 300)}`);
  process.exit(1);
}

if (!write) {
  console.log('\nDry run. Re-run with --write to create/overwrite it with:');
  console.log(JSON.stringify(DEFAULT_INTEGRATIONS_CONFIG, null, 2));
  process.exit(0);
}

// --- write ------------------------------------------------------------------
const res = await fetch(url, {
  method: 'PATCH',
  headers: { ...authHeader, 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: toFieldMap(DEFAULT_INTEGRATIONS_CONFIG) }),
});

if (!res.ok) {
  console.error(`Write failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  process.exit(1);
}
console.log(`\nWrote config/integrations to ${project}.`);
console.log(JSON.stringify(DEFAULT_INTEGRATIONS_CONFIG, null, 2));

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
