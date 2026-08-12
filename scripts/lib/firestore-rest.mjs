/**
 * Firestore REST wire format, and the credentials to talk to it.
 *
 * Writing to `content` needs the `staff` claim and writing to `config` needs
 * `admin`; no user has either yet, and the seed scripts have to work before
 * anyone does. So these go in over the REST API with your own gcloud
 * credentials, which bypass security rules the same way the Admin SDK does.
 * That avoids setting up Application Default Credentials just to write a
 * document.
 *
 * Extracted from seed-config.mjs so the two seed scripts share one encoder.
 * When the runtime theme work lands, this moves to
 * packages/shared/src/firestoreRest.ts — the website and the mobile app need
 * the same decoder, and it must not depend on Node by then.
 */
import { execFileSync } from 'node:child_process';

/** @returns {string} a gcloud OAuth access token. Exits the process if there isn't one. */
export function accessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
  } catch {
    console.error('Could not get a gcloud access token. Run: gcloud auth login');
    process.exit(1);
  }
}

/** REST URL for one document. `path` is like `config/parish` or `content/who-we-are`. */
export function documentUrl(project, path) {
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${path}`;
}

/**
 * Plain object -> Firestore's field map.
 *
 * Separate from `toValue` because the two are not the same shape: a document
 * body carries a bare `{ field: value }` map, while a nested object has to be
 * wrapped in `mapValue`. Collapsing them into one recursive function needs a
 * "am I at the top?" test, which is exactly the kind of thing that works until
 * the config grows a second key.
 */
export function toFieldMap(object) {
  return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, toValue(v)]));
}

/** Plain value -> Firestore's typed-value wire format. */
export function toValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
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
export function fromFirestore(fields) {
  const out = {};
  for (const [key, wrapped] of Object.entries(fields)) {
    out[key] = unwrap(wrapped);
  }
  return out;
}

export function unwrap(wrapped) {
  if ('stringValue' in wrapped) return wrapped.stringValue;
  if ('booleanValue' in wrapped) return wrapped.booleanValue;
  if ('integerValue' in wrapped) return Number(wrapped.integerValue);
  if ('doubleValue' in wrapped) return wrapped.doubleValue;
  if ('timestampValue' in wrapped) return new Date(wrapped.timestampValue);
  if ('nullValue' in wrapped) return null;
  if ('mapValue' in wrapped) return fromFirestore(wrapped.mapValue.fields ?? {});
  if ('arrayValue' in wrapped) return (wrapped.arrayValue.values ?? []).map(unwrap);
  return wrapped;
}
